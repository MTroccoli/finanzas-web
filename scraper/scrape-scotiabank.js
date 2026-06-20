// Scraper de beneficios Scotiabank Uruguay para FinPro — v3.
//
// Hallazgos del diagnóstico v2:
//  - Hub carga 6 featured cards (.benefit-card) con .card-comercio + .pct confirmados.
//  - Hay 3 <select class="category-select">: Categorías / Departamentos / Ordenar.
//  - El catálogo completo se muestra al seleccionar cada categoría programáticamente.
//  - save-the-week: no tiene .benefit-card; tiene layout propio de sub-página.
//  - Estrategia: cargar hub, extraer opciones del select Categorías, iterar seleccionando
//    cada categoría y recolectar .benefit-card que aparecen.
//
// Salida: data/beneficios-scotiabank.json

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

const HUB    = 'https://www.scotiabank.com.uy/Personas/Tarjetas/Beneficios/default';
const ORIGIN = 'https://www.scotiabank.com.uy';
const UA     = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DIAG_MODE = process.argv.includes('--diag');
const DELAY_MS  = 800;
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

// ── Scroll suave ──────────────────────────────────────────────────────────────
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

// ── Seleccionar categoría y recolectar cards ──────────────────────────────────
async function selectCategoryAndCollect(page, optionValue, optionLabel) {
  // Cambiar el select de categorías (primer .category-select)
  await page.evaluate((val) => {
    const selects = document.querySelectorAll('.category-select select, select.category-select, .category-select');
    const sel = [...selects].find(el => el.tagName === 'SELECT') || selects[0];
    if (!sel) return;
    sel.value = val;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sel.dispatchEvent(new Event('input',  { bubbles: true }));
  }, optionValue);

  await sleep(1200); // esperar re-render
  await scrollToEnd(page);

  const cards = await page.evaluate((cat) => {
    const out  = [];
    const seen = new Set();

    document.querySelectorAll('.benefit-card').forEach(card => {
      // Skip cards ocultas por CSS
      const style = window.getComputedStyle(card);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      const comercioEl = card.querySelector('.card-comercio');
      let nombre = (comercioEl?.innerText || '').replace(/\s+/g, ' ').trim();
      if (!nombre) {
        const h = card.querySelector('h2,h3,h4,[class*="title"]');
        nombre = (h?.innerText || '').replace(/\s+/g, ' ').trim();
      }
      if (!nombre || nombre.length < 2) return;

      const key = nombre.toLowerCase().slice(0, 50);
      if (seen.has(key)) return;
      seen.add(key);

      // Porcentajes desde .pct
      const allText = (card.innerText || '').replace(/\s+/g, ' ');
      const pctNums = [...allText.matchAll(/(\d{1,3})\s*%/g)]
        .map(m => parseInt(m[1])).filter(n => n > 0 && n <= 70);
      const pctMax    = pctNums.length ? Math.max(...pctNums) : null;
      const descuentos = [...new Set(pctNums)].map(p => ({ pct: p, texto: `${p}% de ahorro` }));

      // Días / vigencia
      const diasEl   = card.querySelector('.card-badge-dias, [class*="dias"], [class*="badge"]');
      const vigencia = diasEl ? (diasEl.innerText || '').replace(/\s+/g, ' ').trim() : null;

      // Tarjetas — buscar en .card-descuento-item
      const descItems = [...card.querySelectorAll('.card-descuento-item')]
        .map(li => (li.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(t => t.length > 3);
      const tarjLine  = descItems.find(t =>
        /tarjeta|cr[eé]dito|d[eé]bito|visa|mastercard|gold|platinum|infinite|premium/i.test(t)
      ) || null;

      // Link a sub-página
      const anchor = card.querySelector('a[href*="/Beneficios/"]');
      const url_   = anchor?.href || null;

      // Desc = primer descItem que no sea tarjetas
      const desc = descItems[0] || null;

      out.push({ nombre, pctMax, descuentos, vigencia, tarjetas: tarjLine, url: url_, desc, categoria: cat });
    });

    return out;
  }, optionLabel);

  return cards;
}

// ── Diagnóstico ───────────────────────────────────────────────────────────────
async function diag(page) {
  console.log('=== MODO DIAGNÓSTICO v3 — Scotiabank Uruguay ===\n');

  const status = await goto(page, HUB);
  console.log(`Hub status: ${status}`);
  await scrollToEnd(page);
  saveHtml('scotiabank-hub', await page.content());

  // Leer opciones del select de categorías
  const selectInfo = await page.evaluate(() => {
    const selects = [...document.querySelectorAll('.category-select')];
    return selects.map((el, i) => {
      const sel = el.tagName === 'SELECT' ? el : el.querySelector('select');
      if (!sel) return { i, tag: el.tagName, cls: el.className, options: [] };
      return {
        i,
        id: sel.id,
        options: [...sel.options].map(o => ({ value: o.value, label: o.text.trim() })),
      };
    });
  });
  console.log('\nSelects encontrados:');
  selectInfo.forEach(s => {
    console.log(`  [${s.i}] id="${s.id}" — ${s.options.length} opciones:`);
    s.options.forEach(o => console.log(`    value="${o.value}"  label="${o.label}"`));
  });

  // Contar total de .benefit-card incluyendo ocultos
  const totalCards = await page.evaluate(() => {
    const all    = document.querySelectorAll('.benefit-card');
    const visible = [...all].filter(el => {
      const st = window.getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden';
    });
    return { total: all.length, visible: visible.length };
  });
  console.log(`\nTotal .benefit-card en DOM: ${totalCards.total} (visibles: ${totalCards.visible})`);

  // Probar con la primera opción real del categorías select
  if (selectInfo[0]?.options?.length > 1) {
    const firstOpt = selectInfo[0].options[1]; // skip placeholder
    console.log(`\nProbando seleccionar "${firstOpt.label}" (value="${firstOpt.value}")...`);
    const cards = await selectCategoryAndCollect(page, firstOpt.value, firstOpt.label);
    console.log(`  → ${cards.length} cards visibles tras seleccionar categoría`);
    if (DIAG_MODE) saveHtml(`scotiabank-cat-${firstOpt.value}`, await page.content());
    cards.slice(0, 5).forEach((c, i) =>
      console.log(`  [${i+1}] "${c.nombre}"  pct=${c.pctMax}  tarj="${c.tarjetas?.slice(0,60)}"`)
    );
  }
}

// ── Producción: iterar categorías ─────────────────────────────────────────────
async function scrapeAllCategories(page) {
  const status = await goto(page, HUB);
  console.log(`Hub: ${status}`);
  if (status !== 200 && status !== 304) return [];

  await scrollToEnd(page);

  // Obtener opciones del primer select (categorías)
  const options = await page.evaluate(() => {
    const sel = document.querySelector('.category-select select') ||
                [...document.querySelectorAll('select')].find(s =>
                  [...s.options].some(o => /restaurante|vestimenta|caf[eé]/i.test(o.text)));
    if (!sel) return [];
    return [...sel.options]
      .filter(o => o.value && o.value !== '' && o.value !== '0')
      .map(o => ({ value: o.value, label: o.text.trim() }));
  });

  console.log(`  Categorías encontradas: ${options.length}`);
  options.forEach(o => console.log(`    "${o.label}" (${o.value})`));

  const seen  = new Set();
  const cards = [];

  // 1. Cards destacadas del hub (ya visibles sin seleccionar categoría)
  const featuredCards = await selectCategoryAndCollect(page, '', 'Destacados');
  for (const c of featuredCards) {
    const key = c.nombre.toLowerCase().slice(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(c);
  }
  console.log(`  Featured: ${featuredCards.length} cards`);

  // 2. Iterar por cada categoría
  for (const opt of options) {
    await sleep(DELAY_MS);
    const catCards = await selectCategoryAndCollect(page, opt.value, opt.label);
    let nuevas = 0;
    for (const c of catCards) {
      const key = c.nombre.toLowerCase().slice(0, 50);
      if (seen.has(key)) continue;
      seen.add(key);
      c.categoria = opt.label;
      cards.push(c);
      nuevas++;
    }
    console.log(`  "${opt.label}": ${catCards.length} cards (${nuevas} nuevas)`);
  }

  return cards;
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
    await diag(page);
    await browser.close();
    return;
  }

  // Modo producción
  console.log('=== Scraping beneficios Scotiabank Uruguay ===');
  const allCards = await scrapeAllCategories(page);
  await browser.close();

  const beneficios = allCards.map(c => ({
    nombre:    c.nombre,
    url:       c.url || null,
    categoria: c.categoria || null,
    pctMax:    c.pctMax,
    descuentos: c.descuentos || [],
    vigencia:  c.vigencia || null,
    tarjetas:  c.tarjetas || null,
    desc:      c.desc || null,
    exclusivo: false,
  }));

  beneficios.forEach((b, i) =>
    console.log(`  [${i+1}] ${b.nombre} — ${b.pctMax ?? '?'}%  cat:${b.categoria}`));

  const payload = {
    fuente:      'scotiabank.com.uy',
    actualizado: new Date().toISOString(),
    total:       beneficios.length,
    beneficios,
  };

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'beneficios-scotiabank.json'), JSON.stringify(payload, null, 2));
  console.log(`\n✓ data/beneficios-scotiabank.json — ${beneficios.length} beneficios`);
})();
