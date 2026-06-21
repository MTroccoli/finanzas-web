// Scraper de beneficios BROu para FinPro — v1 diagnóstico.
//
// URL: https://beneficios.brou.com.uy/beneficios
//
// Salida: data/beneficios-brou.json

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

const HUB    = 'https://beneficios.brou.com.uy/beneficios';
const UA     = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DIAG_MODE = process.argv.includes('--diag');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1366, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8' });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const t = req.resourceType();
    if (t === 'font' || t === 'media') req.abort();
    else req.continue();
  });
  return page;
}

async function goto(page, url) {
  const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2000);
  return resp ? resp.status() : null;
}

function saveHtml(name, html) {
  const dir = path.join(__dirname, 'output');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.html`);
  fs.writeFileSync(file, html);
  console.log(`  → ${file} (${(html.length / 1024).toFixed(1)} KB)`);
}

async function scrollToEnd(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let lastHeight = document.body.scrollHeight;
      let stableCount = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 600);
        const newHeight = document.body.scrollHeight;
        if (newHeight > lastHeight) { lastHeight = newHeight; stableCount = 0; }
        else { stableCount++; if (stableCount >= 6) { clearInterval(timer); resolve(); } }
      }, 300);
      setTimeout(() => { clearInterval(timer); resolve(); }, 30000);
    });
  });
  await sleep(1000);
}

async function diag(page) {
  console.log('=== MODO DIAGNÓSTICO v1 — BROu Beneficios ===\n');

  const status = await goto(page, HUB);
  console.log(`Hub status: ${status}`);
  await scrollToEnd(page);
  saveHtml('brou-hub', await page.content());

  // Estructura general de la página
  const info = await page.evaluate(() => {
    // Contar elementos candidatos a cards
    const candidates = [
      '.beneficio', '.benefit', '.card', '.item',
      '[class*="beneficio"]', '[class*="benefit"]', '[class*="card"]',
      'article', '.offer', '[class*="offer"]', '[class*="descuento"]',
    ];
    const counts = {};
    for (const sel of candidates) {
      try { counts[sel] = document.querySelectorAll(sel).length; } catch (_) {}
    }

    // Buscar selects/filtros
    const selects = [...document.querySelectorAll('select')].map(s => ({
      id: s.id, name: s.name, cls: s.className,
      options: [...s.options].slice(0, 10).map(o => ({ value: o.value, label: o.text.trim() })),
    }));

    // Buscar botones/tabs de filtro
    const filterBtns = [...document.querySelectorAll(
      'button, [class*="filter"], [class*="tab"], [class*="categoria"], [class*="category"]'
    )].slice(0, 20).map(el => ({
      tag: el.tagName, cls: el.className.slice(0, 60), text: (el.innerText || '').trim().slice(0, 40),
    }));

    // Muestra de texto de las primeras 3 "cards" del selector más prometedor
    const allCards = [...document.querySelectorAll('article, [class*="beneficio"], [class*="card-ben"], [class*="ben-item"]')];
    const cardSamples = allCards.slice(0, 3).map(el => el.innerText?.replace(/\s+/g, ' ').trim().slice(0, 200));

    // Estructura del DOM: primeros 2 niveles bajo body
    const bodyChildren = [...document.body.children].map(el => ({
      tag: el.tagName, id: el.id, cls: el.className.slice(0, 60),
    }));

    return { counts, selects, filterBtns, cardSamples, bodyChildren };
  });

  console.log('\n--- Conteo de candidatos a cards ---');
  for (const [sel, count] of Object.entries(info.counts)) {
    if (count > 0) console.log(`  ${sel}: ${count}`);
  }

  console.log('\n--- Selects encontrados ---');
  if (info.selects.length === 0) console.log('  (ninguno)');
  info.selects.forEach(s => {
    console.log(`  id="${s.id}" class="${s.cls.slice(0, 40)}" — ${s.options.length} opciones`);
    s.options.forEach(o => console.log(`    "${o.value}" → "${o.label}"`));
  });

  console.log('\n--- Botones/tabs de filtro (primeros 20) ---');
  info.filterBtns.forEach(b => console.log(`  <${b.tag}> cls="${b.cls}" text="${b.text}"`));

  console.log('\n--- Muestras de cards ---');
  info.cardSamples.forEach((s, i) => console.log(`  [${i}] "${s}"`));

  console.log('\n--- Hijos directos de <body> ---');
  info.bodyChildren.forEach(c => console.log(`  <${c.tag}> id="${c.id}" cls="${c.cls}"`));

  // Dump de clases CSS únicas en el DOM (para detectar nombres de cards)
  const classes = await page.evaluate(() => {
    const all = new Set();
    document.querySelectorAll('*').forEach(el => {
      el.classList.forEach(c => { if (c.length > 3 && c.length < 40) all.add(c); });
    });
    return [...all].sort();
  });
  console.log(`\n--- Clases CSS únicas (${classes.length} total) ---`);
  const relevant = classes.filter(c =>
    /ben|card|offer|desc|cat|tarj|comer|item|promo|list|grid|produc/i.test(c)
  );
  console.log('  Relevantes:', relevant.join(', '));
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox',
           '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await newPage(browser);
    if (DIAG_MODE) {
      await diag(page);
    } else {
      console.log('Modo producción no implementado aún. Correr con --diag primero.');
    }
  } finally {
    await browser.close();
  }
})();
