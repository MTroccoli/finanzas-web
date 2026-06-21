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
  console.log('=== MODO DIAGNÓSTICO v2 — BROu Beneficios ===\n');

  const status = await goto(page, HUB);
  console.log(`Hub status: ${status}`);

  // Esperar a que el primer beneficio-item tenga contenido visible (SPA load)
  console.log('Esperando que los cards carguen contenido...');
  try {
    await page.waitForFunction(
      () => {
        const items = document.querySelectorAll('.beneficio-item, [class*="beneficio-item"]');
        return items.length > 0 && (items[0].innerText || '').trim().length > 5;
      },
      { timeout: 20000 }
    );
    console.log('Cards con contenido detectados.');
  } catch (_) {
    console.log('Timeout esperando cards — volcando estado actual.');
  }

  await scrollToEnd(page);
  saveHtml('brou-hub', await page.content());

  const info = await page.evaluate(() => {
    // Contar elementos
    const benItems   = document.querySelectorAll('.beneficio-item');
    const benAny     = document.querySelectorAll('[class*="beneficio"]');
    const withText   = [...benItems].filter(el => (el.innerText || '').trim().length > 2);

    // HTML de los primeros 3 cards con contenido
    const samples = [...benItems].filter(el => (el.innerText || '').trim().length > 2)
      .slice(0, 5).map(el => ({
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        html: el.innerHTML.slice(0, 600),
        classes: el.className,
      }));

    // Selects
    const selects = [...document.querySelectorAll('select')].map(s => ({
      id: s.id, cls: s.className,
      options: [...s.options].map(o => ({ value: o.value, label: o.text.trim() })),
    }));

    // Checkboxes en filtros (Categoría, Medios de Pago)
    const checkboxes = [...document.querySelectorAll('input[type=checkbox]')].map(cb => ({
      name: cb.name, value: cb.value, id: cb.id,
      label: document.querySelector(`label[for="${cb.id}"]`)?.innerText?.trim() || '',
    }));

    // Clases relevantes
    const allCls = new Set();
    document.querySelectorAll('*').forEach(el =>
      el.classList.forEach(c => { if (c.length > 3 && c.length < 50) allCls.add(c); })
    );
    const relevant = [...allCls].filter(c =>
      /ben|tarj|desc|pct|porc|logo|comer|categ|icon|medio|pago|nombre/i.test(c)
    );

    return { benItems: benItems.length, benAny: benAny.length, withText: withText.length, samples, selects, checkboxes, relevant };
  });

  console.log(`\n--- Cards encontrados ---`);
  console.log(`  .beneficio-item total: ${info.benItems}`);
  console.log(`  [class*="beneficio"] total: ${info.benAny}`);
  console.log(`  Con contenido (innerText > 2): ${info.withText}`);

  console.log(`\n--- Primeros 5 cards con contenido ---`);
  info.samples.forEach((s, i) => {
    console.log(`\n  [${i}] cls="${s.classes}"`);
    console.log(`       text: "${s.text}"`);
    console.log(`       html: ${s.html}`);
  });

  console.log(`\n--- Selects ---`);
  info.selects.forEach(s => {
    console.log(`  id="${s.id}" — ${s.options.length} opciones:`);
    s.options.forEach(o => console.log(`    "${o.value}" → "${o.label}"`));
  });

  console.log(`\n--- Checkboxes de filtros (primeros 30) ---`);
  info.checkboxes.slice(0, 30).forEach(cb =>
    console.log(`  name="${cb.name}" value="${cb.value}" label="${cb.label}"`)
  );

  console.log(`\n--- Clases CSS relevantes ---`);
  console.log('  ' + info.relevant.join(', '));
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
