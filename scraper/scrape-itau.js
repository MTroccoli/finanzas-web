// Scraper de beneficios Itaú Uruguay para FinPro — v1 (diagnóstico).
//
// Itaú puede servir 403 a curl/fetch simples; usamos Puppeteer + stealth.
//
// Modo --diag: guarda HTMLs y muestra cards descubiertas (sin escribir JSON).
// Modo producción: escribe data/beneficios-itau.json
//
// Salida: data/beneficios-itau.json

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

const HUB    = 'https://www.itau.com.uy/inst/beneficios.html';
const ORIGIN = 'https://www.itau.com.uy';
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

function slugToName(slug) {
  return slug.replace(/-+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

// ── Diagnóstico general: inspecciona el hub y descarga HTML ──────────────────
async function diagHub(page) {
  const status = await goto(page, HUB);
  console.log(`Hub status: ${status}`);
  const html = await page.content();
  saveHtml('itau-hub', html);

  // Mostrar estructura de links internos que parezcan de beneficios
  const links = await page.evaluate(origin => {
    const seen = new Set();
    const out = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href || '';
      if (!href.startsWith(origin)) return;
      const rel = href.replace(origin, '');
      if (seen.has(href)) return;
      seen.add(href);
      const text = (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      out.push({ rel, text });
    });
    return out;
  }, ORIGIN);

  console.log(`\nLinks internos encontrados: ${links.length}`);
  // Filtrar los que parecen relevantes (beneficios, descuentos, promociones)
  const relevant = links.filter(l =>
    /beneficio|descuento|promo|tarjeta|ventaja|oferta/i.test(l.rel + l.text)
  );
  console.log(`Links relevantes (beneficio/descuento/promo):`);
  relevant.slice(0, 30).forEach(l => console.log(`  ${l.rel}  "${l.text}"`));

  if (relevant.length === 0) {
    console.log('\n  (ninguno — mostrando primeros 20 links internos)');
    links.slice(0, 20).forEach(l => console.log(`  ${l.rel}  "${l.text}"`));
  }

  // Inspeccionar estructura de cards/artículos en la página
  const structure = await page.evaluate(() => {
    const selectors = [
      'article', '[class*="card"]', '[class*="benefit"]', '[class*="promo"]',
      '[class*="descuento"]', '[class*="item"]', 'li[class]',
    ];
    const found = [];
    selectors.forEach(sel => {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) found.push(`${sel}: ${els.length} elementos`);
    });
    return found;
  });
  console.log('\nEstructura de la página:');
  structure.forEach(s => console.log(`  ${s}`));

  return links;
}

// ── Descubrir cards de beneficios ────────────────────────────────────────────
async function discoverCards(page) {
  const status = await goto(page, HUB);
  console.log(`Hub status: ${status}`);

  const html = await page.content();
  if (DIAG_MODE) saveHtml('itau-hub', html);

  const cards = await page.evaluate(origin => {
    const seen = new Set();
    const out  = [];

    // Estrategia A: links /beneficios/<slug>
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href || '';
      if (!href.startsWith(origin)) return;
      const relPath = href.replace(origin, '');
      // Patrones conocidos de Itaú Uruguay:
      // /inst/beneficios/<slug>.html  o  /beneficio/<slug>  o variantes
      if (!/\/(inst\/)?beneficio(s)?\/[^/]+/.test(relPath)) return;
      if (seen.has(href)) return;
      seen.add(href);

      const slug = relPath.split('/').filter(Boolean).pop();

      let container = a.closest('article, li, [class*="card"], [class*="item"], [class*="benefit"], [class*="promo"]');
      if (!container) container = a.parentElement?.parentElement || a.parentElement;

      const containerText = container?.innerText || '';
      let nombre = containerText.replace(/ver\s+m[aá]s(\s+detalles)?/gi, '').replace(/\s+/g, ' ').trim();
      const firstPct = nombre.search(/\d{1,3}\s*%/);
      if (firstPct > 0) nombre = nombre.slice(0, firstPct).trim();
      nombre = nombre.slice(0, 80) || null;

      const pctMatches = [...containerText.matchAll(/(\d{1,3})\s*%/g)]
        .map(m => parseInt(m[1], 10)).filter(n => n > 0 && n <= 70);
      const pctMax = pctMatches.length ? Math.max(...pctMatches) : null;

      // Buscar categoría en el container o en un elemento padre con header/título
      let categoria = null;
      const catEl = container?.closest('[class*="category"], [class*="section"]')
        ?.querySelector('h2,h3,[class*="title"],[class*="heading"]');
      if (catEl) categoria = (catEl.innerText || '').trim().slice(0, 60) || null;

      out.push({ href, slug, nombre, pctHub: pctMax, categoria });
    });

    return out;
  }, ORIGIN);

  console.log(`Links encontrados en hub: ${cards.length}`);
  if (DIAG_MODE) {
    cards.slice(0, 15).forEach(c =>
      console.log(`  ${c.slug}  nombre="${c.nombre}"  pct=${c.pctHub}  cat="${c.categoria}"`));
  }
  return cards;
}

// ── Parsear página de detalle ─────────────────────────────────────────────────
async function parseDetail(page, card) {
  const url = card.href;
  const status = await goto(page, url);
  if (status !== 200) return null;

  try {
    await page.waitForSelector('main, article, [class*="content"], [class*="benefit"]', { timeout: 4000 });
  } catch (_) {}
  await sleep(400);

  if (DIAG_MODE) {
    const html = await page.content();
    saveHtml(`itau-det-${card.slug}`, html);
  }

  return page.evaluate((urlStr, hubNombre, hubPct, hubCat) => {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim();
    const ogDesc  = document.querySelector('meta[property="og:description"]')?.content?.trim();

    // Nombre
    let nombre = null;
    if (ogTitle && !/^(ita[uú]|beneficio|principal|navegaci)/i.test(ogTitle)) {
      nombre = ogTitle.replace(/\s*[\|\-]\s*.*Ita[uú].*/i, '').trim();
    }
    if (!nombre) {
      const allH = [...document.querySelectorAll('h1,h2')];
      const contentH = allH.find(h => {
        const text = h.innerText?.trim() || '';
        return text.length > 2
          && !/navegaci[oó]n|principal|menú|inicio|contacto/i.test(text)
          && !h.closest('nav,header,[role="navigation"]');
      });
      if (contentH) nombre = contentH.innerText.trim();
    }
    nombre = nombre || hubNombre || urlStr.split('/').pop().replace(/-/g, ' ');

    // Porcentaje
    let pctMax = hubPct;
    if (!pctMax) {
      const descPcts = [...(ogDesc || '').matchAll(/(\d{1,3})\s*%/g)]
        .map(m => parseInt(m[1], 10)).filter(n => n > 0 && n <= 70);
      if (descPcts.length) pctMax = Math.max(...descPcts);
    }
    if (!pctMax) {
      const allEls = [...document.querySelectorAll('*')].filter(e => e.children.length === 0);
      for (const el of allEls) {
        const t = (el.innerText || el.textContent || '').trim();
        const m = t.match(/^(\d{1,3})\s*%$/) || t.match(/(\d{1,3})\s*%\s*(de\s+)?descuento/i);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > 0 && n <= 70 && (!pctMax || n > pctMax)) pctMax = n;
        }
      }
    }

    // Descuentos estructurados (líneas "NN% ...")
    const bodyLines = (document.body.innerText || '')
      .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const descuentos = [];
    bodyLines.forEach(l => {
      const m = l.match(/^(\d{1,3})\s*%\s*(off|de descuento|dscto)[\s\S]*$/i);
      if (m) {
        const pct = parseInt(m[1], 10);
        if (pct > 0 && pct <= 70) descuentos.push({ pct, texto: l.slice(0, 150) });
      }
    });

    // Vigencia
    const vigencia = bodyLines.find(l => /^vigencia/i.test(l) && l.length < 120)
                  || bodyLines.find(l => /v[aá]lid[ao]?\s+(hasta|al)/i.test(l) && l.length < 120)
                  || null;

    // Descripción
    const mainEl = document.querySelector('main, article') || document.body;
    const mainLines = (mainEl.innerText || '').split('\n').map(l => l.trim()).filter(l =>
      l.length > 25 && !/menú|navegaci|contacto|cookie|privac|©|\+598/i.test(l)
    );
    const desc = mainLines[0]?.slice(0, 200) || ogDesc?.slice(0, 200) || null;

    // Tarjetas
    const tarjLine = bodyLines.find(l =>
      /tarjeta|cr[eé]dito|d[eé]bito/i.test(l) && l.length < 200
      && !/(art\.|ley|banco\s+ita[uú])/i.test(l)
    );

    return {
      nombre,
      url: urlStr,
      categoria: hubCat,
      pctMax: pctMax || (descuentos.length ? Math.max(...descuentos.map(d => d.pct)) : null),
      descuentos,
      vigencia,
      tarjetas: tarjLine || null,
      desc,
    };
  }, url, card.nombre, card.pctHub, card.categoria);
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
    console.log('=== MODO DIAGNÓSTICO ===\n');
    console.log('=== Inspeccionando hub de beneficios ===');
    await diagHub(page);
    console.log('\n=== Intentando descubrir cards ===');
    const cards = await discoverCards(page);
    if (cards.length > 0) {
      console.log('\n=== Muestra de primeros 3 detalles ===');
      for (const c of cards.slice(0, 3)) {
        console.log(`\n--- ${c.slug} ---`);
        try {
          const d = await parseDetail(page, c);
          console.log(JSON.stringify(d, null, 2));
        } catch (e) {
          console.log(`ERROR: ${e.message}`);
        }
        await sleep(DELAY_MS);
      }
    }
    await browser.close();
    return;
  }

  // Modo producción
  console.log('=== Explorando hub de beneficios Itaú ===');
  const cards = await discoverCards(page);

  if (cards.length === 0) {
    console.log('\n⚠️  No se encontraron cards. Ejecutar con --diag para inspeccionar.');
    await browser.close();
    return;
  }

  console.log(`\n=== Parseando ${cards.length} páginas de detalle ===`);
  const beneficios = [];
  let ok = 0, fail = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    process.stdout.write(`  [${i + 1}/${cards.length}] ${c.slug} … `);
    try {
      const d = await parseDetail(page, c);
      if (d) {
        beneficios.push(d);
        console.log(`OK — ${d.pctMax ?? '?'}% "${d.nombre}"`);
        ok++;
      } else {
        console.log('skip (status != 200)');
        fail++;
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      fail++;
    }
    if ((i + 1) % 30 === 0) console.log(`  ...${i + 1}/${cards.length}`);
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

  console.log(`\n✓ data/beneficios-itau.json — ${beneficios.length} beneficios (ok=${ok}, fail=${fail})`);
  beneficios.slice(0, 5).forEach(b =>
    console.log(`  • [${b.categoria || '?'}] ${b.nombre} — ${b.pctMax ?? '?'}%`));
})();
