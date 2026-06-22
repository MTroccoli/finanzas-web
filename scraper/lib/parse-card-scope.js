// Parsea el campo `tarjetas` (texto libre) de cada banco y devuelve:
// { red: string|null, niveles: string[], cobranding: string|null }
//
// red       → null = todas las redes; "Visa"|"Mastercard"|"Amex"|"OCA"
// niveles   → [] = todos los niveles; ["Gold","Platinum","Infinite"] = restricción
// cobranding→ null = sin restricción; "ConnectMiles"|"Advantage"|"Recompensa"|"Volar"

'use strict';

const NIVEL_RE = [
  { re: /\binfinite\b/i,                 name: 'Infinite'  },
  { re: /\bplatinum\b|\bplatino\b/i,     name: 'Platinum'  },
  { re: /\bblack\b/i,                    name: 'Black'      },
  { re: /\bsignature\b/i,               name: 'Signature'  },
  { re: /\bgold\b|\boro\b/i,             name: 'Gold'       },
  { re: /\bcl[aá]sic[ao]?\b/i,          name: 'Clásica'    },
  { re: /\bblue\b/i,                     name: 'Blue'       },
  { re: /\bred\b/i,                      name: 'Red'        },
];

function extractNiveles(t) {
  return NIVEL_RE.filter(({ re }) => re.test(t)).map(({ name }) => name);
}

// ── Scotiabank ────────────────────────────────────────────────────────────────
// Overrides manuales keyed by nombre exacto del beneficio
const SCOTIA_OVERRIDES = {
  'The Platinum Card American Express (excl. ConnectMiles)':
    { red: 'Amex', niveles: ['Platinum'], cobranding: null },
};

function parseScotia(tarjetas, nombre) {
  if (SCOTIA_OVERRIDES[tarjetas]) return SCOTIA_OVERRIDES[tarjetas];
  if (!tarjetas) return { red: null, niveles: [], cobranding: null };

  const t = tarjetas;
  const niveles = extractNiveles(t);

  const hasVisa = /\bvisa\b/i.test(t);
  const hasMC   = /\bmastercard\b/i.test(t);
  const hasAmex = /\bamex\b|\bamerican\s*express\b/i.test(t);
  const nets    = [hasVisa, hasMC, hasAmex].filter(Boolean).length;
  const red     = nets === 1 ? (hasVisa ? 'Visa' : hasMC ? 'Mastercard' : 'Amex') : null;

  const cobranding = /\bconnectmiles\b/i.test(t) ? 'ConnectMiles' : null;

  return { red, niveles, cobranding };
}

// ── BROU ──────────────────────────────────────────────────────────────────────
const BROU_OVERRIDES = {
  'MI BROU Tarjeta Joven':           { red: null,          niveles: ['Clásica'], cobranding: null },
  'ANTEL y MI BROU Tarjeta Joven':   { red: null,          niveles: ['Clásica'], cobranding: null },
  'Pedí tu Visa Débito':             { red: 'Visa',        niveles: [],          cobranding: null },
  'Ciberseguridad Mastercard':       { red: 'Mastercard',  niveles: [],          cobranding: null },
  'BROU VISA Crédito y Débito':      { red: 'Visa',        niveles: [],          cobranding: null },
};

function parseBROU(tarjetas) {
  if (BROU_OVERRIDES[tarjetas]) return BROU_OVERRIDES[tarjetas];
  if (!tarjetas) return { red: null, niveles: [], cobranding: null };

  const t = tarjetas;
  const niveles = extractNiveles(t);

  const hasVisa = /\bvisa\b/i.test(t);
  const hasMC   = /\bmastercard\b|\brecompensa\b/i.test(t);
  const nets    = [hasVisa, hasMC].filter(Boolean).length;
  const red     = nets === 1 ? (hasVisa ? 'Visa' : 'Mastercard') : null;

  const cobranding = /\brecompensa\b/i.test(t) ? 'Recompensa' : null;

  return { red, niveles, cobranding };
}

// ── Santander ─────────────────────────────────────────────────────────────────
// El campo tarjetas de Santander no tiene info útil de nivel.
// Los beneficios de Advantage se identifican por mencionar "Advantage" en desc/nombre.
function parseSantander(tarjetas, nombre, desc) {
  const full = [tarjetas, nombre, desc].filter(Boolean).join(' ');

  const cobranding = /\badvantage\b/i.test(full) ? 'Advantage' : null;

  const hasVisa = /\bvisa\b/i.test(full);
  const hasAmex = /\bamex\b|\bamerican\s*express\b/i.test(full);
  const nets    = [hasVisa, hasAmex].filter(Boolean).length;
  const red     = nets === 1 ? (hasVisa ? 'Visa' : 'Amex') : null;

  const niveles = extractNiveles(full);

  return { red, niveles, cobranding };
}

// ── Itaú ──────────────────────────────────────────────────────────────────────
function parseItau(tarjetas, nombre, desc) {
  const full = [tarjetas, nombre, desc].filter(Boolean).join(' ');

  const cobranding = /\bvolar\b/i.test(full) ? 'Volar' : null;
  const niveles    = extractNiveles(full);

  const hasVisa = /\bvisa\b/i.test(full);
  const hasMC   = /\bmastercard\b/i.test(full);
  const nets    = [hasVisa, hasMC].filter(Boolean).length;
  const red     = nets === 1 ? (hasVisa ? 'Visa' : 'Mastercard') : null;

  return { red, niveles, cobranding };
}

// ── OCA ───────────────────────────────────────────────────────────────────────
// OCA tiene la info del nivel en el campo `nombre`
function parseOCA(tarjetas, nombre) {
  const full = [tarjetas, nombre].filter(Boolean).join(' ');

  const niveles = [];
  if (/\bblack\b/i.test(full))  niveles.push('Black');
  if (/\bred\b/i.test(full))    niveles.push('Red');
  if (/\bblue\b/i.test(full))   niveles.push('Blue');
  if (!niveles.length && /\boca\b/i.test(full)) {
    // Sin nivel específico = aplica a todas las OCA
  }

  return { red: 'OCA', niveles, cobranding: null };
}

// ── BBVA ──────────────────────────────────────────────────────────────────────
// BBVA tiene info de nivel dentro de cada entrada de `descuentos[]`, no en un
// campo `tarjetas` global.  Parsea el texto de cada descuento individualmente.
//
// Patrones observados:
//  "Tarjetas de Crédito Internacional, Oro, Pymes y Corporativas" → Clásica + Oro
//  "Tarjetas de Crédito Platinum, Black e Infinite"               → Platinum + Black + Infinite
//  "Tarjetas de Débito"                                            → solo débito, ignorar
//  "Tarjetas de Crédito y Débito"                                  → todos los niveles
function parseBBVADescuento(tarjetasText) {
  const t = tarjetasText || '';

  const isDebit  = /\bd[eé]bito\b/i.test(t) && !/cr[eé]dito/i.test(t);
  const isAllCred = /cr[eé]dito\s+y\s+d[eé]bito|todos?\s+los?\s+cr[eé]dito/i.test(t) ||
                    (!/internacional|oro|platinum|black|infinite/i.test(t) && /cr[eé]dito/i.test(t) && !isDebit);

  const niveles = [];
  if (!isAllCred) {
    if (/\binfinite\b/i.test(t))      niveles.push('Infinite');
    if (/\bplatinum\b/i.test(t))      niveles.push('Platinum');
    if (/\bblack\b/i.test(t))         niveles.push('Black');
    if (/\boro\b/i.test(t))           niveles.push('Oro');
    if (/\binternacional\b/i.test(t)) niveles.push('Clásica');
  }

  return { isDebit, niveles }; // niveles vacío = aplica a todos los créditos
}

// Scope a nivel de beneficio BBVA: unión de todos los niveles crédito del beneficio.
function parseBBVABenefit(descuentos = []) {
  const all = new Set();
  let hasCredit = false;
  for (const d of descuentos) {
    const { isDebit, niveles } = parseBBVADescuento(d.tarjetas);
    if (isDebit) continue;
    hasCredit = true;
    niveles.forEach(n => all.add(n));
  }
  return { red: null, niveles: hasCredit ? [...all] : [], cobranding: null };
}

// ── Entry point ───────────────────────────────────────────────────────────────
function parseCardScope(banco, { tarjetas, nombre, desc, descuentos } = {}) {
  switch (banco) {
    case 'Scotiabank': return parseScotia(tarjetas, nombre);
    case 'BROU':       return parseBROU(tarjetas);
    case 'Santander':  return parseSantander(tarjetas, nombre, desc);
    case 'Itaú':       return parseItau(tarjetas, nombre, desc);
    case 'OCA':        return parseOCA(tarjetas, nombre);
    case 'BBVA':       return parseBBVABenefit(descuentos);
    default:           return { red: null, niveles: [], cobranding: null };
  }
}

module.exports = { parseCardScope, parseBBVADescuento };
