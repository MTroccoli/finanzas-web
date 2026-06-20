// Scraper de beneficios Scotiabank Uruguay para FinPro — v2.
//
// Hallazgos del diagnóstico v1:
//  - Hub carga OK con Puppeteer + stealth (status 200).
//  - Cards en hub: .benefit-card > .card-comercio (nombre) + .card-descuento-item > .pct (%)
//  - Hub muestra solo ~6 promos destacadas; catálogo completo en sub-páginas por categoría.
//  - Sub-páginas: nombre en <title> y <h1>; porcentajes en imágenes (no texto) → no disponibles.
//  - Estrategia: parsear .benefit-card del hub + visitar save-the-week + categorías descubiertas.
//
// Salida: data/beneficios-scotiabank.json

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

const HUB       = 'https://www.scotiabank.com.uy/Personas/Tarjetas/Beneficios/default';
const SAVE_WEEK = 'https://www.scotiabank.com.uy/Personas/Tarjetas/Beneficios/Especiales/save-the-week';
const ORIGIN    = 'https://www.scotiabank.com.uy';
const UA        = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DIAG_MODE = process.argv.includes('--diag');
const DELAY_MS  = 700;
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

function slugToName(slug) {
  return slug.replace(/-+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

// ── Scroll hasta estabilidad ──────────────────────────────────────────────────
async function scrollToEnd(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let lastHeight = document.body.scrollHeight;
      let stableCount = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 600);
        const newHeight = document.body.scrollHeight;
        if (newHeight > lastHeight) { lastHeight = newHeight; stableCount = 0; }
        else { stableCount++; if (stableCount >= 8) { clearInterval(timer); resolve(); } }
      }, 300);
      setTimeout(() => { clearInterval(timer); resolve(); }, 45000);
    });
  });
  await sleep(2000);
}

// ── Parsear benefit-cards directamente de una página ─────────────────────────
async function parsePageCards(page, url, categoria) {
  const status = await goto(page, url);
  console.log(`  ${url} → status: ${status}`);
  if (status !== 200 && status !== 304) return [];

  await scrollToEnd(page);
  if (DIAG_MODE) {
    const slug = url.split('/').pop();
    saveHtml(`scotiabank-${slug}`, await page.content());
  }

  const cards = await page.evaluate((cat) => {
    const out  = [];
    const seen = new Set();

    // Parsear .benefit-card con estructura confirmada
    document.querySelectorAll('.benefit-card').forEach(card => {
      const comercioEl = card.querySelector('.card-comercio');
      let nombre = (comercioEl?.innerText || '').replace(/\s+/g, ' ').trim();

      if (!nombre) {
        // Fallback: cualquier heading dentro de la card
        const h = card.querySelector('h2,h3,h4,[class*="title"]');
        nombre = (h?.innerText || '').replace(/\s+/g, ' ').trim();
      }
      if (!nombre || nombre.length < 2) return;

      const key = nombre.toLowerCase().slice(0, 50);
      if (seen.has(key)) return;
      seen.add(key);

      // Porcentajes desde .pct (confirmado en diagnóstico)
      const pctEls  = [...card.querySelectorAll('.pct, [class*="pct"], [class*="descuento"]')];
      const pctNums = pctEls
        .map(el => (el.innerText || '').match(/(\d{1,3})\s*%/))
        .filter(Boolean)
        .map(m => parseInt(m[1]))
        .filter(n => n > 0 && n <= 70);
      // También buscar en el texto completo del card
      const allText   = (card.innerText || '').replace(/\s+/g, ' ');
      const allPctMs  = [...allText.matchAll(/(\d{1,3})\s*%/g)].map(m => parseInt(m[1])).filter(n => n > 0 && n <= 70);
      const allPcts   = [...new Set([...pctNums, ...allPctMs])];
      const pctMax    = allPcts.length ? Math.max(...allPcts) : null;
      const descuentos = allPcts.map(p => ({ pct: p, texto: `${p}% de ahorro` }));

      // Días / vigencia desde .card-badge-dias
      const diasEl  = card.querySelector('.card-badge-dias, [class*="dias"], [class*="badge"]');
      const vigencia = diasEl ? (diasEl.innerText || '').replace(/\s+/g, ' ').trim() : null;

      // Link a sub-página
      const anchor = card.querySelector('a[href*="/Beneficios/"]');
      const url_   = anchor?.href || null;

      // Descripción desde .card-body o .card-descuento-item
      const bodyEl = card.querySelector('.card-body, .card-descuento-item');
      const desc   = (bodyEl?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;

      out.push({ nombre, pctMax, descuentos, vigencia, url: url_, desc, categoria: cat });
    });

    return out;
  }, categoria);

  console.log(`    → ${cards.length} cards`);
  if (DIAG_MODE) {
    cards.forEach((c, i) => console.log(`    [${i+1}] "${c.nombre}"  pct=${c.pctMax}  dias="${c.vigencia}"  url=${c.url}`));
  }
  return cards;
}

// ── Diagnóstico detallado ─────────────────────────────────────────────────────
async function diagPage(page, url, label) {
  console.log(`\n=== Diag: ${label} ===`);
  const status = await goto(page, url);
  console.log(`Status: ${status}`);
  if (status !== 200 && status !== 304) return;

  await scrollToEnd(page);
  saveHtml(`scotiabank-diag-${label}`, await page.content());

  const info = await page.evaluate(() => {
    // benefit-cards
    const benefitCards = [...document.querySelectorAll('.benefit-card')].map(card => ({
      nombre:   (card.querySelector('.card-comercio')?.innerText || '').replace(/\s+/g,' ').trim(),
      pcts:     [...card.querySelectorAll('.pct')].map(el => (el.innerText||'').trim()),
      dias:     (card.querySelector('.card-badge-dias')?.innerText||'').trim(),
      bodyText: (card.querySelector('.card-body')?.innerText||'').replace(/\s+/g,' ').trim().slice(0,100),
      link:     (card.querySelector('a[href*="/Beneficios/"]')?.href) || null,
      descItems: [...card.querySelectorAll('.card-descuento-item')].map(li => (li.innerText||'').replace(/\s+/g,' ').trim()),
    }));

    // Categorías/filtros
    const catLinks = [...document.querySelectorAll('a[href]')]
      .map(a => a.href)
      .filter(h => h.includes('/Beneficios/') && !h.endsWith('/default') && !h.includes('#'))
      .filter((v, i, arr) => arr.indexOf(v) === i);

    // Links de navegación que incluyan "beneficio" o categorías
    const navLinks = [...document.querySelectorAll('a[href]')]
      .map(a => ({ href: a.href, txt: (a.innerText||'').trim().slice(0,40) }))
      .filter(a => /beneficio|categor|ver tod|descuento/i.test(a.txt || a.href))
      .filter((v, i, arr) => arr.findIndex(x => x.href === v.href) === i)
      .slice(0, 20);

    // Elementos que tengan texto de categoría
    const filterEls = [...document.querySelectorAll('[class*="filter"], [class*="category"], [class*="tab"], [class*="nav"]')]
      .filter(el => !el.closest('nav.main, header') && (el.innerText||'').trim().length > 2)
      .map(el => ({ cls: [...el.classList].join('.'), txt: (el.innerText||'').replace(/\s+/g,' ').trim().slice(0,80) }))
      .slice(0, 10);

    return { benefitCards, catLinks, navLinks, filterEls };
  });

  console.log(`\n  benefit-cards (${info.benefitCards.length}):`);
  info.benefitCards.forEach((c, i) =>
    console.log(`  [${i+1}] "${c.nombre}" | pcts:[${c.pcts.join(',')}] | dias:"${c.dias}" | body:"${c.bodyText}" | link:${c.link}\n       descItems: ${JSON.stringify(c.descItems)}`));

  console.log(`\n  Links a sub-páginas (${info.catLinks.length}):`);
  info.catLinks.forEach(l => console.log('    ' + l));

  console.log(`\n  Links con "beneficio/categoría" en texto/URL:`);
  info.navLinks.forEach(l => console.log(`    "${l.txt}" → ${l.href}`));

  console.log(`\n  Elementos filtro/categoría:`);
  info.filterEls.forEach(el => console.log(`    .${el.cls}: "${el.txt}"`));
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
    console.log('=== MODO DIAGNÓSTICO v2 — Scotiabank Uruguay ===\n');
    await diagPage(page, HUB, 'hub');
    await sleep(DELAY_MS);
    await diagPage(page, SAVE_WEEK, 'save-the-week');
    await browser.close();
    return;
  }

  // Modo producción
  console.log('=== Scraping beneficios Scotiabank Uruguay ===');

  const seen      = new Set();
  const beneficios = [];

  const addCards = (cards) => {
    for (const c of cards) {
      const key = c.nombre.toLowerCase().slice(0, 50);
      if (seen.has(key)) continue;
      seen.add(key);
      beneficios.push({
        nombre:    c.nombre,
        url:       c.url,
        categoria: c.categoria,
        pctMax:    c.pctMax,
        descuentos: c.descuentos,
        vigencia:  c.vigencia,
        tarjetas:  null,
        desc:      c.desc,
        exclusivo: false,
      });
      process.stdout.write(`  [${beneficios.length}] ${c.nombre} — ${c.pctMax ?? '?'}%\n`);
    }
  };

  // 1. Hub principal
  console.log('\n1. Hub:');
  addCards(await parsePageCards(page, HUB, 'Especiales'));

  // 2. Save-the-week (promos rotativas)
  await sleep(DELAY_MS);
  console.log('\n2. Save the Week:');
  addCards(await parsePageCards(page, SAVE_WEEK, 'Especiales'));

  // 3. Categorías adicionales descubiertas en el diagnóstico
  const EXTRA_CATS = [
    { url: `${ORIGIN}/Personas/Tarjetas/Beneficios/Supermercados/default`, cat: 'Supermercados' },
    { url: `${ORIGIN}/Personas/Tarjetas/Beneficios/Restaurantes/default`,  cat: 'Restaurantes'  },
    { url: `${ORIGIN}/Personas/Tarjetas/Beneficios/Farmacia/default`,       cat: 'Farmacias'     },
    { url: `${ORIGIN}/Personas/Tarjetas/Beneficios/Moda/default`,           cat: 'Moda'          },
    { url: `${ORIGIN}/Personas/Tarjetas/Beneficios/Automovil/default`,      cat: 'Automovil'     },
    { url: `${ORIGIN}/Personas/Tarjetas/Beneficios/Tecnologia/default`,     cat: 'Tecnología'    },
    { url: `${ORIGIN}/Personas/Tarjetas/Beneficios/Viajes/default`,         cat: 'Viajes'        },
    { url: `${ORIGIN}/Personas/Tarjetas/Beneficios/Salud/default`,          cat: 'Salud'         },
    { url: `${ORIGIN}/Personas/Tarjetas/Beneficios/Perfumeria/default`,     cat: 'Perfumería'    },
  ];

  console.log('\n3. Categorías:');
  for (const cat of EXTRA_CATS) {
    await sleep(DELAY_MS);
    addCards(await parsePageCards(page, cat.url, cat.cat));
  }

  await browser.close();

  const payload = {
    fuente:     'scotiabank.com.uy',
    actualizado: new Date().toISOString(),
    total:      beneficios.length,
    beneficios,
  };

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'beneficios-scotiabank.json'), JSON.stringify(payload, null, 2));
  console.log(`\n✓ data/beneficios-scotiabank.json — ${beneficios.length} beneficios`);
})();
