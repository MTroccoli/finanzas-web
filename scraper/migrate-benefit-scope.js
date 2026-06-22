// Enriquece los JSONs de beneficios existentes con campos red/niveles/cobranding.
// Uso: node scraper/migrate-benefit-scope.js
'use strict';

const fs   = require('fs');
const path = require('path');
const { parseCardScope } = require('./lib/parse-card-scope');

const DATA_DIR = path.join(__dirname, '..', 'data');

const FILES = {
  'Scotiabank': 'beneficios-scotiabank.json',
  'BROU':       'beneficios-brou.json',
  'Santander':  'beneficios-santander.json',
  'Itaú':       'beneficios-itau.json',
  'OCA':        'beneficios-oca.json',
};

for (const [banco, file] of Object.entries(FILES)) {
  const fpath = path.join(DATA_DIR, file);
  if (!fs.existsSync(fpath)) { console.warn(`  [skip] ${file} no encontrado`); continue; }

  const raw  = JSON.parse(fs.readFileSync(fpath, 'utf8'));
  const arr  = raw.beneficios || raw;
  const meta = raw.beneficios ? raw : null; // preservar wrapper si existe

  let changed = 0;
  for (const b of arr) {
    const scope = parseCardScope(banco, b);
    if (
      b.red       !== scope.red       ||
      JSON.stringify(b.niveles) !== JSON.stringify(scope.niveles) ||
      b.cobranding !== scope.cobranding
    ) {
      b.red        = scope.red;
      b.niveles    = scope.niveles;
      b.cobranding = scope.cobranding;
      changed++;
    }
  }

  const out = meta ? { ...meta, beneficios: arr } : arr;
  fs.writeFileSync(fpath, JSON.stringify(out, null, 2));
  console.log(`✅ ${banco}: ${arr.length} beneficios, ${changed} actualizados → ${file}`);

  // Resumen por scope
  const withRed    = arr.filter(x => x.red).length;
  const withNivel  = arr.filter(x => x.niveles?.length).length;
  const withCob    = arr.filter(x => x.cobranding).length;
  console.log(`   red: ${withRed}  nivel: ${withNivel}  cobranding: ${withCob}`);
}
