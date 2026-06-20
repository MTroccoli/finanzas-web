// Scraper de beneficios Itaú Uruguay para FinPro — v2.
//
// Diagnóstico confirmó que la estructura es distinta a BBVA/Santander:
//  - Hub: /inst/beneficios.html → 142 cards directamente, sin páginas de detalle.
//  - Secundario: /inst/beneficiosexclusivos.html → beneficios exclusivos.
//  - Los links internos no siguen patrón /inst/beneficios/<slug>.html.
//  - Estrategia: parsear las cards del hub sin visitar sub-páginas.
//
// Salida: data/beneficios-itau.json

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

const HUBS = [
  { url: 'https://www.itau.com.uy/inst/beneficios.html',           exclusivo: false },
  { url: 'https://www.itau.com.uy/inst/beneficiosexclusivos.html', exclusivo: true  },
];
const ORIGIN = 'https://www.itau.com.uy';
const UA     = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DIAG_MODE = process.argv.includes('--diag');
const DELAY_MS  = 600;
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  await sleep(1500);
  return resp ? resp.status() : null;
}

function saveHtml(name, html) {
  const dir = path.join(__dirname, 'output');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.html`);
  fs.writeFileSync(file, html);
  console.log(`  → ${file} (${(html.length / 1024).toFixed(1)} KB)`);
}

// ── Parsear cards directamente del hub ───────────────────────────────────────
async function parseHub(page, hubUrl, exclusivo) {
  const status = await goto(page, hubUrl);
  console.log(`Hub ${hubUrl} → status: ${status}`);
  if (status !== 200 && status !== 304) return [];

  const html = await page.content();
  if (DIAG_MODE) {
    const slug = hubUrl.split('/').pop().replace('.html', '');
    saveHtml(`itau-${slug}`, html);
  }

  // Esperar a que las cards estén en el DOM
  try {
    await page.waitForSelector('[class*="card"], article', { timeout: 5000 });
  } catch (_) {}

  const cards = await page.evaluate((excl) => {
    const out = [];
    const seen = new Set();

    // Selectores candidatos para cards de beneficios — ordenados por especificidad
    const CARD_SELS = [
      'article',
      '[class*="benefit-card"]',
      '[class*="beneficio-card"]',
      '[class*="card-benefit"]',
      '[class*="promo-card"]',
      '[class*="card"][class*="promo"]',
    ];

    // Intentar encontrar el contenedor correcto inspeccionando cuántos hay
    let cardEls = [];
    for (const sel of CARD_SELS) {
      const els = [...document.querySelectorAll(sel)];
      if (els.length >= 5) { cardEls = els; break; }
    }

    // Fallback: todos los [class*="card"] que no estén dentro de otro card
    if (cardEls.length === 0) {
      const all = [...document.querySelectorAll('[class*="card"]')];
      cardEls = all.filter(el => !el.closest('[class*="card"]:not(el)') || el.parentElement?.closest('[class*="card"]') === null);
      // Filtrar por los que tienen texto suficiente (son cards de contenido)
      cardEls = all.filter(el => (el.innerText || '').trim().length > 20);
    }

    cardEls.forEach(el => {
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 10) return;

      // Deduplicar por texto normalizado
      const key = text.slice(0, 80).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      // Nombre: primera línea no vacía, cortar antes del primer NN%
      const lines = text.split(/[\n|]/).map(l => l.trim()).filter(Boolean);
      let nombre = lines[0] || '';
      const firstPct = nombre.search(/\d{1,3}\s*%/);
      if (firstPct > 0) nombre = nombre.slice(0, firstPct).trim();
      nombre = nombre.slice(0, 80).trim();
      if (!nombre) return;

      // Porcentaje máximo en el texto del card
      const pctMatches = [...text.matchAll(/(\d{1,3})\s*%/g)]
        .map(m => parseInt(m[1], 10)).filter(n => n > 0 && n <= 70);
      const pctMax = pctMatches.length ? Math.max(...pctMatches) : null;

      // Categoría: buscar en elemento padre con clase de categoría/sección
      let categoria = null;
      const catEl = el.closest('[class*="categor"], [class*="section"], [class*="group"]')
        ?.querySelector('h2,h3,h4,[class*="title"],[class*="heading"]');
      if (catEl) categoria = (catEl.innerText || '').trim().slice(0, 60) || null;

      // Vigencia
      const vigLine = lines.find(l => /vigencia|v[aá]lid[ao]|hasta el/i.test(l) && l.length < 100);

      // Tarjetas
      const tarjLine = lines.find(l => /tarjeta|cr[eé]dito|d[eé]bito|platinum|infinite|black/i.test(l)
        && l.length < 200 && !/(art\.|ley)/i.test(l));

      // Descripción: segunda línea relevante
      const desc = lines.find((l, i) => i > 0 && l.length > 20
        && !/^\d{1,3}\s*%/.test(l)
        && !/tarjeta|vigencia|hasta/i.test(l)
      )?.slice(0, 200) || null;

      // Link del card (si existe)
      const anchor = el.querySelector('a[href]');
      const url = anchor?.href || null;

      out.push({ nombre, pctMax, categoria, vigencia: vigLine || null, tarjetas: tarjLine || null, desc, url, exclusivo: excl });
    });

    return out;
  }, exclusivo);

  console.log(`  ${cards.length} cards extraídas`);

  if (DIAG_MODE && cards.length > 0) {
    console.log('\n  Muestra primeras 5 cards:');
    cards.slice(0, 5).forEach((c, i) =>
      console.log(`  [${i+1}] "${c.nombre}"  pct=${c.pctMax}  cat="${c.categoria}"  url=${c.url}`));
  }

  return cards;
}

// ── Diagnóstico extra: volcar clases de cards ─────────────────────────────────
async function diagCardClasses(page) {
  await goto(page, HUBS[0].url);
  const info = await page.evaluate(() => {
    const classGroups = {};
    document.querySelectorAll('[class*="card"]').forEach(el => {
      const cls = [...el.classList].join('.');
      classGroups[cls] = (classGroups[cls] || 0) + 1;
    });
    // Las 10 clases más frecuentes
    return Object.entries(classGroups)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cls, n]) => `${n}x  .${cls}`);
  });
  console.log('\nClases de elementos [class*="card"] más frecuentes:');
  info.forEach(l => console.log(`  ${l}`));
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox',
           '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  const page = await newPage(browser);

  if (DIAG_MODE) {
    console.log('=== MODO DIAGNÓSTICO v2 ===\n');
    await diagCardClasses(page);
    for (const hub of HUBS) {
      console.log(`\n=== Hub: ${hub.url} ===`);
      await parseHub(page, hub.url, hub.exclusivo);
      await sleep(DELAY_MS);
    }
    await browser.close();
    return;
  }

  // Modo producción
  console.log('=== Scraping beneficios Itaú Uruguay ===');
  const seen = new Set();
  const beneficios = [];

  for (const hub of HUBS) {
    console.log(`\nHub: ${hub.url}`);
    const cards = await parseHub(page, hub.url, hub.exclusivo);
    for (const c of cards) {
      const key = c.nombre.toLowerCase().slice(0, 50);
      if (seen.has(key)) continue;
      seen.add(key);
      beneficios.push({
        nombre:    c.nombre,
        url:       c.url,
        categoria: c.categoria,
        pctMax:    c.pctMax,
        descuentos: c.pctMax ? [{ pct: c.pctMax, texto: `${c.pctMax}%` }] : [],
        vigencia:  c.vigencia,
        tarjetas:  c.tarjetas,
        desc:      c.desc,
        exclusivo: c.exclusivo,
      });
    }
    await sleep(DELAY_MS);
  }

  await browser.close();

  const payload = {
    fuente: 'itau.com.uy',
    actualizado: new Date().toISOString(),
    total: beneficios.length,
    beneficios,
  };

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'beneficios-itau.json'), JSON.stringify(payload, null, 2));

  console.log(`\n✓ data/beneficios-itau.json — ${beneficios.length} beneficios`);
  beneficios.slice(0, 5).forEach(b =>
    console.log(`  • [${b.categoria || '?'}] ${b.nombre} — ${b.pctMax ?? '?'}%`));
})();
