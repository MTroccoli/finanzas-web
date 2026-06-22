// Scraper del catálogo de tarjetas de crédito uruguayas para FinPro.
// Extrae banco, red, nivel y cobranding de cada variante disponible.
//
// Modo diag  (--diag): guarda HTML de cada banco como artifact para inspección
// Modo prod  (default): escribe data/catalogo-tarjetas.json
//
// Requiere: DISPLAY=:99 + CHROME_PATH=/usr/bin/google-chrome en CI (para OCA/Xvfb)
// Salida: data/catalogo-tarjetas.json

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

const DIAG_MODE   = process.argv.includes('--diag');
const CHROME_PATH = process.env.CHROME_PATH || null;
const HAS_DISPLAY = !!process.env.DISPLAY;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DELAY_MS = 800;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Diccionarios de parseo ────────────────────────────────────────────────────

const RED_MAP = [
  { re: /american\s+express|amex/i, name: 'Amex'       },
  { re: /\bmastercard\b/i,          name: 'Mastercard'  },
  { re: /\bvisa\b/i,                name: 'Visa'        },
  { re: /\boca\b/i,                 name: 'OCA'         },
];

const NIVEL_MAP = [
  { re: /infinite/i,                name: 'Infinite'   },
  { re: /signature/i,               name: 'Signature'  },
  { re: /the\s+platinum|platinum/i, name: 'Platinum'   },
  { re: /\bblack\b/i,               name: 'Black'      },
  { re: /\bred\b/i,                 name: 'Red'        },
  { re: /\bblue\b/i,                name: 'Blue'       },
  { re: /\boro\b|\bgold\b/i,        name: 'Oro'        },
  { re: /cl[aá]sic[ao]?/i,          name: 'Clásica'   },
  { re: /titanium/i,                name: 'Titanium'   },
  { re: /selecta/i,                 name: 'Selecta'    },
];

const COBRAND_MAP = [
  { re: /advantage/i,                    name: 'Advantage'             },
  { re: /connect\s*miles/i,              name: 'ConnectMiles'          },
  { re: /recompensa/i,                   name: 'Recompensa'            },
  { re: /\bvolar\b/i,                    name: 'Volar'                 },
  { re: /aero\s*l[ií]neas/i,             name: 'Aerolíneas Argentinas' },
  { re: /latam\s*pass/i,                 name: 'LATAM Pass'            },
  { re: /\blider\b/i,                    name: 'Lider'                 },
  { re: /smiles/i,                       name: 'Smiles'                },
  { re: /lanpass|lan\s+pass/i,           name: 'LATAM Pass'            },
];

// Filtros: textos que no son nombres de tarjeta
const NOISE = [
  /^tarjeta(s)?\s+(de\s+)?(cr[eé]dito|d[eé]bito)$/i,
  /^(home|inicio|men[uú]|servicios|personas|empresas|beneficios|descuentos)$/i,
  /^\d+[\s%]/, /^ver\s+m[aá]s/i, /^solicit/i, /^comparar/i,
  /^seg[uú]ro/i, /^(todos|todas)(\s+los|\s+las)?/i,
];

function isNoise(t) {
  const clean = t.trim();
  if (clean.length < 4 || clean.length > 80) return true;
  return NOISE.some(re => re.test(clean));
}

function parseCardName(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  if (isNoise(t)) return null;

  let red = null, nivel = null, cobranding = null;
  for (const { re, name } of COBRAND_MAP) if (re.test(t)) { cobranding = name; break; }
  for (const { re, name } of RED_MAP)     if (re.test(t)) { red        = name; break; }
  for (const { re, name } of NIVEL_MAP)   if (re.test(t)) { nivel      = name; break; }

  if (!red && !nivel && !cobranding) return null;
  return { red, nivel, cobranding, nombre_completo: t };
}

// ── Configuración por banco ───────────────────────────────────────────────────

const BANKS = [
  {
    banco:     'BBVA',
    urls:      ['https://www.bbva.com.uy/personas/tarjetas-de-credito/'],
    cardSel:   'h2, h3, [class*="product"] h2, [class*="card"] h2, [class*="tarjeta"] h2',
  },
  {
    banco:     'Santander',
    urls:      ['https://www.santander.com.uy/personas/productos/tarjetas/'],
    cardSel:   'h2, h3, [class*="card"] .title, [class*="tarjeta"] h2, [class*="product"] h3',
  },
  {
    banco:     'Itaú',
    urls:      ['https://www.itau.com.uy/inst/uy/particulares/tarjetas/credito/'],
    cardSel:   'h2, h3, [class*="card"] h3, [class*="tarjeta"] h3, .title',
  },
  {
    banco:     'Scotiabank',
    urls:      ['https://www.scotiabank.com.uy/Personas/Tarjetas/Credito/'],
    cardSel:   'h2, h3, [class*="card"] h3, [class*="tarjeta"] h3',
  },
  {
    banco:     'BROU',
    urls:      ['https://www.brou.com.uy/web/brou-personas/tarjetas-de-credito'],
    cardSel:   'h2, h3, .portlet-title, .journal-content-article h3, [class*="card"] h3',
  },
  {
    banco:     'OCA',
    urls:      ['https://www.oca.com.uy/tarjetas/'],
    cardSel:   'h2, h3, [class*="card"] h2, [class*="tarjeta"] h2, .card-title',
    useXvfb:   true,
  },
];

// ── Browser helpers ───────────────────────────────────────────────────────────

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1366, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8' });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const t = req.resourceType();
    if (t === 'image' || t === 'font' || t === 'media') req.abort();
    else req.continue();
  });
  return page;
}

async function goto(page, url) {
  const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(DELAY_MS);
  return resp ? resp.status() : null;
}

function saveHtml(banco, url, html) {
  const dir = path.join(__dirname, 'output');
  fs.mkdirSync(dir, { recursive: true });
  const slug = banco.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const file = path.join(dir, `catalogo-${slug}.html`);
  fs.writeFileSync(file, html);
  console.log(`  → ${file} (${(html.length / 1024).toFixed(1)} KB)`);
}

// ── Scrape por banco ──────────────────────────────────────────────────────────

async function scrapeBank(browser, bank) {
  const page = await newPage(browser);
  const results = [];
  const seen = new Set();

  for (const url of bank.urls) {
    console.log(`  [${bank.banco}] ${url}`);
    const status = await goto(page, url);
    if (!status || status >= 400) {
      console.warn(`  [${bank.banco}] HTTP ${status} — saltando`);
      continue;
    }

    const html = await page.content();

    if (DIAG_MODE) {
      saveHtml(bank.banco, url, html);
      // También imprime todos los encabezados encontrados para revisión rápida
      const headings = await page.evaluate(sel => {
        return [...document.querySelectorAll(sel)]
          .map(el => el.innerText.trim())
          .filter(t => t.length > 2 && t.length < 100);
      }, bank.cardSel);
      console.log(`  [${bank.banco}] Encabezados encontrados (${headings.length}):`);
      headings.forEach(h => console.log(`    - ${h}`));
      continue;
    }

    // Modo producción: extraer y parsear textos
    const texts = await page.evaluate(sel => {
      return [...document.querySelectorAll(sel)]
        .map(el => el.innerText.trim())
        .filter(t => t.length > 2 && t.length < 100);
    }, bank.cardSel);

    for (const text of texts) {
      const parsed = parseCardName(text);
      if (!parsed) continue;
      const key = `${parsed.red}|${parsed.nivel}|${parsed.cobranding}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ banco: bank.banco, ...parsed, url });
    }
  }

  await page.close();
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const launchOpts = {
    headless: HAS_DISPLAY ? false : 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  if (CHROME_PATH) launchOpts.executablePath = CHROME_PATH;

  console.log(`Modo: ${DIAG_MODE ? 'DIAGNÓSTICO' : 'PRODUCCIÓN'}`);
  const browser = await puppeteer.launch(launchOpts);

  const allCards = [];
  for (const bank of BANKS) {
    console.log(`\n▶ ${bank.banco}`);
    try {
      const cards = await scrapeBank(browser, bank);
      if (!DIAG_MODE) {
        console.log(`  ${cards.length} tarjetas encontradas`);
        allCards.push(...cards);
      }
    } catch (e) {
      console.error(`  [${bank.banco}] Error: ${e.message}`);
    }
  }

  await browser.close();

  if (DIAG_MODE) {
    console.log('\nModo diagnóstico: revisar archivos en scraper/output/ y encabezados arriba.');
    return;
  }

  const out = {
    actualizado: new Date().toISOString().slice(0, 10),
    tarjetas:    allCards,
  };

  const outPath = path.join(__dirname, '..', 'data', 'catalogo-tarjetas.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${allCards.length} tarjetas → ${outPath}`);

  // Resumen por banco
  const byBanco = {};
  allCards.forEach(c => { byBanco[c.banco] = (byBanco[c.banco] || 0) + 1; });
  Object.entries(byBanco).forEach(([b, n]) => console.log(`   ${b}: ${n}`));
}

main().catch(e => { console.error(e); process.exit(1); });
