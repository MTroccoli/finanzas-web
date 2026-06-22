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

// ── Entry point ───────────────────────────────────────────────────────────────
function parseCardScope(banco, { tarjetas, nombre, desc } = {}) {
  switch (banco) {
    case 'Scotiabank': return parseScotia(tarjetas, nombre);
    case 'BROU':       return parseBROU(tarjetas);
    case 'Santander':  return parseSantander(tarjetas, nombre, desc);
    case 'Itaú':       return parseItau(tarjetas, nombre, desc);
    case 'OCA':        return parseOCA(tarjetas, nombre);
    case 'BBVA':
    default:           return { red: null, niveles: [], cobranding: null };
  }
}

module.exports = { parseCardScope };
