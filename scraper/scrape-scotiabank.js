// Scraper de beneficios Scotiabank Uruguay para FinPro — v4.
//
// Hallazgos del diagnóstico v3:
//  - Hub carga 6 featured cards (.benefit-card) con .card-comercio + .pct confirmados.
//  - Hay 3 <select class="category-select">: Categorías / Departamentos / Ordenar.
//  - El catálogo completo se muestra al seleccionar cada categoría programáticamente.
//  - 20 categorías × ~6 cards = ~72 beneficios únicos.
//  - El tipo de tarjeta (ej: AMEX en Telepeaje) no está en el texto de las hub cards;
//    está en las sub-páginas (imágenes de logos, texto de condiciones).
//
// v4: agrega enrichFromSubPage() — visita la sub-página de cada card que tiene URL
//     y extrae tipo de tarjeta desde alt-text de imágenes y texto de condiciones.
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

// URLs de sub-páginas conocidas con información extra
const KNOWN_SUBPAGES = [
  `${ORIGIN}/Personas/Tarjetas/Beneficios/Automovil/Telepeaje`,
  `${ORIGIN}/Personas/Tarjetas/Beneficios/Especiales/parking-exclusivo`,
  `${ORIGIN}/Personas/Tarjetas/Beneficios/Supermercados/tienda-inglesa-junio`,
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
    // Permitir imágenes para capturar alt-text de logos de tarjetas en sub-páginas
    if (t === 'font' || t === 'media') req.abort();
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
  await page.evaluate((val) => {
    const selects = document.querySelectorAll('.category-select select, select.category-select, .category-select');
    const sel = [...selects].find(el => el.tagName === 'SELECT') || selects[0];
    if (!sel) return;
    sel.value = val;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sel.dispatchEvent(new Event('input',  { bubbles: true }));
  }, optionValue);

  await sleep(1200);
  await scrollToEnd(page);

  const cards = await page.evaluate((cat) => {
    const out  = [];
    const seen = new Set();

    document.querySelectorAll('.benefit-card').forEach(card => {
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

      const allText = (card.innerText || '').replace(/\s+/g, ' ');
      const pctNums = [...allText.matchAll(/(\d{1,3})\s*%/g)]
        .map(m => parseInt(m[1])).filter(n => n > 0 && n <= 70);
      const pctMax     = pctNums.length ? Math.max(...pctNums) : null;
      const descuentos = [...new Set(pctNums)].map(p => ({ pct: p, texto: `${p}% de ahorro` }));

      const diasEl   = card.querySelector('.card-badge-dias, [class*="dias"], [class*="badge"]');
      const vigencia = diasEl ? (diasEl.innerText || '').replace(/\s+/g, ' ').trim() : null;

      const descItems = [...card.querySelectorAll('.card-descuento-item')]
        .map(li => (li.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(t => t.length > 3);
      const tarjLine  = descItems.find(t =>
        /tarjeta|cr[eé]dito|d[eé]bito|visa|mastercard|gold|platinum|infinite|premium|amex|american/i.test(t)
      ) || null;

      const anchor = card.querySelector('a[href*="/Beneficios/"]');
      const url_   = anchor?.href || null;

      const desc = descItems[0] || null;

      out.push({ nombre, pctMax, descuentos, vigencia, tarjetas: tarjLine, url: url_, desc, categoria: cat });
    });

    return out;
  }, optionLabel);

  return cards;
}

// ── Enriquecer card desde su sub-página ──────────────────────────────────────
async function enrichFromSubPage(page, url) {
  try {
    const status = await goto(page, url);
    if (status !== 200 && status !== 304) return null;
    await scrollToEnd(page);

    return await page.evaluate(() => {
      const allText = document.body.innerText.replace(/\s+/g, ' ');

      // Frases del texto que mencionan tarjetas (excluye basura del navbar)
      const sentences = allText.split(/[.!\n]/).map(s => s.trim()).filter(s => s.length > 5);
      const tarjLines = sentences.filter(s =>
        /amex|american\s+express|visa|mastercard|d[eé]bito|cr[eé]dito|platinum|infinite|gold|premium|club\s+card|tarjeta/i.test(s) &&
        !/^personas\s+banca\s+premium/i.test(s)   // filtrar línea del navbar
      ).map(s => s.replace(/^t[eé]rminos\s+y\s+condiciones\s+/i, '').trim().slice(0, 160));

      // Alt-text de imágenes de logos de tarjetas (el DOM conserva alt aunque la imagen no cargue)
      const imgAlts = [...document.querySelectorAll('img[alt]')]
        .map(i => i.alt.trim())
        .filter(a => /amex|american express|visa|mastercard|platinum|infinite|gold|premium|d[eé]bito|cr[eé]dito|club card/i.test(a) && a.length > 2);

      // Texto del elemento de condiciones/vigencia si existe
      const termEl = document.querySelector(
        '[class*="condition"], [class*="termino"], [class*="vigencia"], [class*="term"], [class*="bases"], [class*="tyc"]'
      );
      const termText = termEl ? termEl.innerText.replace(/\s+/g, ' ').trim().slice(0, 400) : null;

      // Porcentajes en sub-página (pueden ser más precisos que en hub card)
      const pctNums = [...allText.matchAll(/(\d{1,3})\s*%/g)]
        .map(m => parseInt(m[1])).filter(n => n > 0 && n <= 70);
      const pctMax = pctNums.length ? Math.max(...pctNums) : null;

      return {
        tarjLines:  tarjLines.slice(0, 5),
        imgAlts:    [...new Set(imgAlts)],
        termText,
        pctMax,
      };
    });
  } catch (_) {
    return null;
  }
}

// ── Diagnóstico ───────────────────────────────────────────────────────────────
async function diag(page) {
  console.log('=== MODO DIAGNÓSTICO v4 — Scotiabank Uruguay ===\n');

  const status = await goto(page, HUB);
  console.log(`Hub status: ${status}`);
  await scrollToEnd(page);
  saveHtml('scotiabank-hub', await page.content());

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

  const totalCards = await page.evaluate(() => {
    const all     = document.querySelectorAll('.benefit-card');
    const visible = [...all].filter(el => {
      const st = window.getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden';
    });
    return { total: all.length, visible: visible.length };
  });
  console.log(`\nTotal .benefit-card en DOM: ${totalCards.total} (visibles: ${totalCards.visible})`);

  if (selectInfo[0]?.options?.length > 1) {
    const firstOpt = selectInfo[0].options[1];
    console.log(`\nProbando seleccionar "${firstOpt.label}" (value="${firstOpt.value}")...`);
    const cards = await selectCategoryAndCollect(page, firstOpt.value, firstOpt.label);
    console.log(`  → ${cards.length} cards visibles tras seleccionar categoría`);
    saveHtml(`scotiabank-cat-${firstOpt.value}`, await page.content());
    cards.slice(0, 5).forEach((c, i) =>
      console.log(`  [${i+1}] "${c.nombre}"  pct=${c.pctMax}  tarj="${c.tarjetas?.slice(0, 60)}"`)
    );
  }

  // Diagnóstico de sub-páginas conocidas
  console.log('\n=== Sub-páginas conocidas ===');
  for (const url of KNOWN_SUBPAGES) {
    console.log(`\n--- ${url} ---`);
    const extra = await enrichFromSubPage(page, url);
    if (!extra) { console.log('  ERROR: no se pudo cargar'); continue; }
    saveHtml('scotiabank-sub-' + url.split('/').pop(), await page.content());
    console.log(`  pctMax: ${extra.pctMax}`);
    console.log(`  tarjLines (${extra.tarjLines.length}):`);
    extra.tarjLines.forEach(l => console.log(`    • "${l}"`));
    console.log(`  imgAlts (${extra.imgAlts.length}):`);
    extra.imgAlts.forEach(a => console.log(`    • "${a}"`));
    if (extra.termText) console.log(`  termText: "${extra.termText.slice(0, 120)}"`);
  }
}

// ── Producción: iterar categorías + enriquecer sub-páginas ───────────────────
async function scrapeAllCategories(page) {
  const status = await goto(page, HUB);
  console.log(`Hub: ${status}`);
  if (status !== 200 && status !== 304) return [];

  await scrollToEnd(page);

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

  const seen  = new Set();
  const cards = [];

  // 1. Cards destacadas del hub
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

  // 3. Enriquecer con sub-páginas
  // Agregar sub-páginas conocidas que no están cubiertas por cards del hub
  const cardUrls = new Set(cards.filter(c => c.url).map(c => c.url));
  for (const knownUrl of KNOWN_SUBPAGES) {
    if (!cardUrls.has(knownUrl)) {
      // Crear card fantasma si la sub-página no está en ninguna hub card
      cards.push({ nombre: null, url: knownUrl, _phantomSub: true });
    }
  }

  const withUrl = cards.filter(c => c.url);
  console.log(`\n  Enriqueciendo ${withUrl.length} cards desde sub-páginas...`);

  // Datos de phantoms para aplicar a cards del hub que matcheen por nombre
  const phantomData = {};  // urlSlug → { tarjetas, pctMax }

  for (const c of withUrl) {
    await sleep(DELAY_MS);
    const extra = await enrichFromSubPage(page, c.url);
    if (!extra) {
      console.log(`    ${c.nombre || c.url}: skip (error)`);
      continue;
    }

    const specificBrand = /amex|american\s*express|platinum|infinite|mastercard|visa\s+(?:platinum|infinite|gold|premium)/i;
    const bestLine = extra.tarjLines.find(s => specificBrand.test(s)) || extra.tarjLines[0];
    const tarjResult = bestLine || (extra.imgAlts.length ? extra.imgAlts.join(' · ').slice(0, 200) : null);

    if (c._phantomSub) {
      // Card fantasma: guardar datos para aplicar a cards reales por nombre
      const slug = c.url.split('/').pop().toLowerCase();
      phantomData[slug] = { tarjetas: tarjResult, pctMax: extra.pctMax };
    } else {
      // Card real: aplicar directamente
      if (!c.tarjetas && tarjResult) c.tarjetas = tarjResult;
      if (extra.pctMax && (!c.pctMax || extra.pctMax > c.pctMax)) c.pctMax = extra.pctMax;
    }

    const tarjShort = (tarjResult || '—').slice(0, 70);
    const imgsShort = extra.imgAlts.join(', ').slice(0, 60);
    console.log(`    ${c.nombre || '(phantom ' + c.url.split('/').pop() + ')'}: tarj="${tarjShort}"  imgs=[${imgsShort}]`);
  }

  // Aplicar datos de phantoms a cards reales que matcheen por slug en el nombre
  for (const [slug, data] of Object.entries(phantomData)) {
    const keyword = slug.replace(/-/g, ' ');
    const matching = cards.filter(c => !c._phantomSub && c.nombre &&
      c.nombre.toLowerCase().replace(/-/g, ' ').includes(keyword.split(' ')[0]));
    for (const m of matching) {
      if (!m.tarjetas && data.tarjetas) { m.tarjetas = data.tarjetas; console.log(`    → aplicado "${slug}" → "${m.nombre}"`); }
      if (data.pctMax && (!m.pctMax || data.pctMax > m.pctMax)) m.pctMax = data.pctMax;
    }
  }

  // Overrides manuales para cards donde el descuento es más restrictivo que el texto
  // genérico de la sub-página (el hub dice "VISA/AMEX/MC" para contratar el tag,
  // pero el descuento en sí es exclusivo de The Platinum Card AMEX según T&C legales).
  const MANUAL_OVERRIDES = {
    'COMBUSTIBLE Y TELEPEAJE': {
      tarjetas: 'The Platinum Card American Express (excl. ConnectMiles)',
      desc: '50% en telepeajes todos los días · 10% en combustible jueves y domingos. Tope $1.200/mes.',
    },
    'TELEPEAJE': {
      tarjetas: 'The Platinum Card American Express (excl. ConnectMiles)',
      desc: '50% de ahorro todos los días en telepeajes. Tope $1.200/mes.',
    },
  };
  for (const c of cards.filter(c => c.nombre)) {
    const ov = MANUAL_OVERRIDES[c.nombre];
    if (ov) { Object.assign(c, ov); console.log(`    override manual: "${c.nombre}"`); }
  }

  // Eliminar cards fantasma que no se pudieron resolver como card real
  return cards.filter(c => c.nombre);
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

  console.log('=== Scraping beneficios Scotiabank Uruguay ===');
  const allCards = await scrapeAllCategories(page);
  await browser.close();

  const beneficios = allCards.map(c => ({
    nombre:     c.nombre,
    url:        c.url || null,
    categoria:  c.categoria || null,
    pctMax:     c.pctMax,
    descuentos: c.descuentos || [],
    vigencia:   c.vigencia || null,
    tarjetas:   c.tarjetas || null,
    desc:       c.desc || null,
    exclusivo:  false,
  }));

  beneficios.forEach((b, i) =>
    console.log(`  [${i+1}] ${b.nombre} — ${b.pctMax ?? '?'}%  tarj="${(b.tarjetas || '—').slice(0, 60)}"`));

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
