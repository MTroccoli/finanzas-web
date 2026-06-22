// Scraper de costos anuales de tarjetas para condiciones-tarjetas.json
// Targets: BROU (HTML estructurado), Scotiabank (páginas por tarjeta), Santander (manual tarifas)
// Usa Puppeteer + stealth (mismo stack que scrapers de beneficios).
'use strict';

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

async function getText(page, url, warmup = null) {
  if (warmup) {
    await page.goto(warmup, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(2000);
  }
  const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  const status = resp ? resp.status() : null;
  if (status !== 200) { console.log(`  HTTP ${status} → ${url}`); return null; }
  return page.evaluate(() => document.body.innerText);
}

// ── BROU ─────────────────────────────────────────────────────────────────────
async function scrapeBROU(page) {
  console.log('\n=== BROU ===');
  const urls = [
    'https://www.brou.com.uy/personas/tarjetas/costos-y-exoneraciones-visa-y-master/credito',
    'https://www.brou.com.uy/personas/tarjetas/visa/costos-y-exoneraciones',
    'https://www.brou.com.uy/personas/tarjetas/master/costos-y-exoneraciones',
  ];
  const warmup = 'https://www.brou.com.uy';
  const results = {};
  let first = true;
  for (const url of urls) {
    const txt = await getText(page, url, first ? warmup : null);
    first = false;
    if (!txt) continue;
    console.log(`\n--- ${url} ---`);
    // Mostrar líneas relevantes
    txt.split('\n')
      .map(l => l.trim()).filter(Boolean)
      .filter(l => /costo|renovaci|anual|clásica|clasica|oro|platinum|black|UI|exterior|comisi/i.test(l))
      .slice(0, 50)
      .forEach(l => console.log('  ', l));
    results[url] = txt;
    await sleep(800);
  }
  return results;
}

// ── Scotiabank ────────────────────────────────────────────────────────────────
async function scrapeScotia(page) {
  console.log('\n=== Scotiabank ===');
  const urls = [
    'https://www.scotiabank.com.uy/Personas/Tarjetas/Tipos-de-tarjetas/default',
    'https://www.scotiabank.com.uy/Personas/Tarjetas/Tipos-de-tarjetas/visa/visa',
    'https://www.scotiabank.com.uy/Banca-Premium/Productos/Productos/visa-platinum',
    'https://www.scotiabank.com.uy/Banca-Premium/Productos/Productos/visa-infinite',
    'https://www.scotiabank.com.uy/Personas/Tarjetas/Tipos-de-tarjetas/american-express/tarjeta-de-credito-gold-american-express',
    'https://www.scotiabank.com.uy/Acerca-de/novedades/aviso-de-ajustes-de-costos-y-comisiones',
  ];
  const warmup = 'https://www.scotiabank.com.uy';
  const results = {};
  let first = true;
  for (const url of urls) {
    const txt = await getText(page, url, first ? warmup : null);
    first = false;
    if (!txt) continue;
    console.log(`\n--- ${url} ---`);
    txt.split('\n')
      .map(l => l.trim()).filter(Boolean)
      .filter(l => /costo|renovaci|anual|UI|exterior|comisi|gold|platinum|infinite|amex/i.test(l))
      .slice(0, 50)
      .forEach(l => console.log('  ', l));
    results[url] = txt;
    await sleep(800);
  }
  return results;
}

// ── Santander ─────────────────────────────────────────────────────────────────
async function scrapeSantander(page) {
  console.log('\n=== Santander ===');
  const urls = [
    'https://www.santander.com.uy/manual-de-tarifas',
    'https://www.santander.com.uy/todas-las-tarjetas',
    'https://www.santander.com.uy/todas-las-tarjetas/tarjeta-soy-santander',
    'https://www.santander.com.uy/todas-las-tarjetas/Tarjeta-Aadvantage',
  ];
  const warmup = 'https://www.santander.com.uy';
  const results = {};
  let first = true;
  for (const url of urls) {
    const txt = await getText(page, url, first ? warmup : null);
    first = false;
    if (!txt) continue;
    console.log(`\n--- ${url} ---`);
    txt.split('\n')
      .map(l => l.trim()).filter(Boolean)
      .filter(l => /costo|renovaci|anual|UI|exterior|comisi|oro|platinum|clásica|clasica|amex|advantage/i.test(l))
      .slice(0, 50)
      .forEach(l => console.log('  ', l));
    results[url] = txt;
    await sleep(800);
  }
  return results;
}

// ── Itaú (tarifario HTML si hay) ─────────────────────────────────────────────
async function scrapeItau(page) {
  console.log('\n=== Itaú ===');
  const urls = [
    'https://www.itau.com.uy/inst/modTarifas.html',
    'https://www.itau.com.uy/inst/tarjetaVolar.html',
    'https://www.itau.com.uy/inst/tarjetas-de-credito.html',
  ];
  const warmup = 'https://www.itau.com.uy';
  const results = {};
  let first = true;
  for (const url of urls) {
    const txt = await getText(page, url, first ? warmup : null);
    first = false;
    if (!txt) continue;
    console.log(`\n--- ${url} ---`);
    txt.split('\n')
      .map(l => l.trim()).filter(Boolean)
      .filter(l => /costo|renovaci|anual|UI|exterior|comisi|oro|platinum|volar|clásica/i.test(l))
      .slice(0, 50)
      .forEach(l => console.log('  ', l));
    results[url] = txt;
    await sleep(800);
  }
  return results;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    ignoreHTTPSErrors: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox',
           '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage',
           '--ignore-certificate-errors', '--disable-gpu'],
  });

  const page = await newPage(browser);
  const all = {};

  try {
    all.brou      = await scrapeBROU(page);
    all.scotiabank = await scrapeScotia(page);
    all.santander = await scrapeSantander(page);
    all.itau      = await scrapeItau(page);
  } finally {
    await browser.close();
  }

  // Guardar raw para revisión
  const out = path.join(__dirname, '..', 'data', 'condiciones-raw.json');
  fs.writeFileSync(out, JSON.stringify(all, null, 2));
  console.log(`\n✓ data/condiciones-raw.json guardado`);
})();
