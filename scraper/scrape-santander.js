// Scraper de beneficios Santander Uruguay para FinPro — v2.
//
// Santander sirve 403 a curl/fetch simples; usamos Puppeteer + stealth.
//
// Hallazgos del diagnóstico (v1):
//  - Hub: links a /beneficios/<slug> con texto "Ver más detalles" — el nombre
//    del comercio está en el container del card, no en el <a>.
//  - Detalle: h1 devuelve "Navegación principal" (nav skip-link) → usar og:title
//    o derivar el nombre del slug + el nombre captado en el hub.
//  - Porcentaje: el % está en el texto de la card del hub ("20% de descuento")
//    o en el og:description de la detail page; NO como texto suelto en el body.
//  - Categorías: se infieren del texto de cada card en el hub.
//
// Salida: data/beneficios-santander.json

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');
const { parseCardScope } = require('./lib/parse-card-scope');

const HUB    = 'https://www.santander.com.uy/beneficios';
const ORIGIN = 'https://www.santander.com.uy';
const UA     = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
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

// Convierte "cafe-salvo" → "Cafe Salvo"
function slugToName(slug) {
  return slug.replace(/-+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

// ── Descubrir links + nombre/categoría desde el hub ──────────────────────────
async function discoverCards(page) {
  const status = await goto(page, HUB);
  console.log(`Hub status: ${status}`);

  // Scroll gradual hasta que la altura deje de crecer (lazy-loading)
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let lastHeight = document.body.scrollHeight;
      let stableCount = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 600);
        const newHeight = document.body.scrollHeight;
        if (newHeight > lastHeight) {
          lastHeight = newHeight;
          stableCount = 0;
        } else {
          stableCount++;
          if (stableCount >= 8) { clearInterval(timer); resolve(); }
        }
      }, 300);
      setTimeout(() => { clearInterval(timer); resolve(); }, 45000);
    });
  });
  await sleep(2000);

  const html = await page.content();
  if (DIAG_MODE) saveHtml('santander-hub', html);

  const cards = await page.evaluate((origin, diagMode) => {
    const seen = new Set();
    const out  = [];

    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href || '';
      if (!href.startsWith(origin)) return;
      const relPath = href.replace(origin, '');
      if (!/^\/beneficios\/[^/]+$/.test(relPath)) return;
      if (seen.has(href)) return;
      seen.add(href);

      const slug = relPath.split('/').pop();

      // Encontrar el contenedor real de la card.
      // NOTA: NO usar [class*="item"] — "align-items-center" matchea el <a> mismo.
      let container = a.closest('article, li, [class*="card"], [class*="benefit"], [class*="promo"]');
      // Si closest devolvió el <a> mismo u otro <a>, lo ignoramos y subimos buscando img
      if (!container || container.tagName === 'A') {
        container = null;
        let el = a.parentElement;
        let depth = 0;
        while (el && el !== document.body && depth < 10) {
          // Elemento con imagen hermana o hija → es el card container
          if (el.querySelector('img')) { container = el; break; }
          el = el.parentElement;
          depth++;
        }
        if (!container) container = a.parentElement || a;
      }

      // Nombre: tomar el texto del container sin el CTA, luego cortar antes del "NN%"
      const containerText = (container?.innerText || '').replace(/ver\s+m[aá]s\s+detalles/gi, '').replace(/\s+/g, ' ').trim();
      let nombre = containerText;
      const firstPct = nombre.search(/\d{1,3}\s*%/);
      if (firstPct > 0) nombre = nombre.slice(0, firstPct).trim();
      nombre = nombre.slice(0, 60) || null;

      // Nombre desde alt de imagen (para cards sin texto)
      if (!nombre && container) {
        const img = container.querySelector('img');
        const alt = img?.alt?.trim();
        if (alt && alt.length > 2 && alt.length < 80 && !/logo/i.test(alt)) nombre = alt;
      }

      // % del texto del container o del innerText de la imagen alt
      const pctSrc = containerText + ' ' + (container?.querySelector('img')?.alt || '');
      const pctMatches = [...pctSrc.matchAll(/(\d{1,3})\s*%/g)].map(m => parseInt(m[1], 10)).filter(n => n > 0 && n <= 70);
      let pctMax = pctMatches.length ? Math.max(...pctMatches) : null;

      const containerHtml = diagMode && !pctMax ? (container?.outerHTML?.slice(0, 800) || '') : '';
      out.push({ href, slug, nombre, pctHub: pctMax, containerHtml });
    });

    return out;
  }, ORIGIN, DIAG_MODE);

  console.log(`Links encontrados en hub: ${cards.length}`);
  if (DIAG_MODE) {
    cards.slice(0, 12).forEach((c, i) => console.log(`  [${i}] ${c.slug}  nombre="${c.nombre}"  pct=${c.pctHub}`));
    const nullCards = cards.filter(c => !c.pctHub).slice(0, 2);
    nullCards.forEach(c => console.log(`  [containerHtml:${c.slug}] ${c.containerHtml || '(vacío)'}`));
  }

  return cards;
}

// ── Parsear página de detalle ─────────────────────────────────────────────────
async function parseDetail(page, card) {
  const url = card.href;
  const status = await goto(page, url);
  if (status !== 200) return null;

  // Espera extra por si el CMS renderiza el contenido dinámicamente
  try {
    await page.waitForSelector('main, article, [class*="content"], [class*="benefit"]', { timeout: 4000 });
  } catch (_) {}
  await sleep(400);

  if (DIAG_MODE) {
    const html = await page.content();
    saveHtml(`santander-det-${card.slug}`, html);
    const pctDump = await page.evaluate(() => {
      // Buscar % en HTML crudo (incluyendo atributos, data-*, etc.)
      const bodyHtml = document.body.innerHTML || '';
      const htmlPcts = [...bodyHtml.matchAll(/(\d{1,3})\s*%/g)]
        .map(m => { const n = parseInt(m[1], 10); return n > 0 && n <= 70 ? { val: n, ctx: bodyHtml.slice(Math.max(0,m.index-40), m.index+60) } : null; })
        .filter(Boolean).slice(0, 5);
      // Texto visible del body (primeros 600 chars)
      const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600);
      // JSON-LD
      const jsonLd = document.querySelector('script[type="application/ld+json"]')?.textContent?.slice(0, 300) || '';
      // h1/h2 visible
      const headings = [...document.querySelectorAll('h1,h2,h3')]
        .filter(h => !h.closest('nav,header'))
        .map(h => h.innerText?.trim()).filter(Boolean).slice(0, 5);
      return { htmlPcts, bodyText, jsonLd, headings };
    });
    console.log(`  [diag:${card.slug}] bodyText="${pctDump.bodyText.slice(0, 200)}"`);
    console.log(`  [diag:${card.slug}] headings=${JSON.stringify(pctDump.headings)}`);
    if (pctDump.htmlPcts.length) pctDump.htmlPcts.forEach(p => console.log(`  [diag:${card.slug}] html-pct ${p.val}%: "${p.ctx}"`));
    else console.log(`  [diag:${card.slug}] NO hay % en body HTML`);
    if (pctDump.jsonLd) console.log(`  [diag:${card.slug}] jsonLd="${pctDump.jsonLd.slice(0, 150)}"`);
  }

  return page.evaluate((urlStr, hubNombre, hubPct) => {
    // ── Nombre ───────────────────────────────────────────────────────────────
    // Prioridad: og:title > og:description heading > slug derivado desde hub
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim();
    const ogDesc  = document.querySelector('meta[property="og:description"]')?.content?.trim();

    // Prioridad: og:title → <title> → h1 (incluyendo en header) → hub → slug
    let nombre = null;
    if (ogTitle && !/^(santander|beneficio|beneficios|principal|navegaci)/i.test(ogTitle)) {
      nombre = ogTitle.replace(/\s*[\|\-]\s*.*Santander.*/i, '').trim();
    }
    // <title> tag: "NombreComercio | Santander Uruguay"
    if (!nombre) {
      const titleEl = document.querySelector('title');
      const titleText = (titleEl?.textContent || '').trim();
      if (titleText && !/^(santander|beneficio|beneficios)/i.test(titleText)) {
        nombre = titleText.replace(/\s*[\|\-]\s*Santander.*/i, '').trim();
      }
    }
    // h1/h2 — acepta los que están en header también (Santander los pone ahí)
    if (!nombre) {
      const allH = [...document.querySelectorAll('h1,h2,h3')];
      const contentH = allH.find(h => {
        const text = h.innerText?.trim() || '';
        return text.length > 2
          && !/navegaci[oó]n|principal|menú|inicio|contacto|beneficios$/i.test(text)
          && !h.closest('nav,[role="navigation"]');
      });
      if (contentH) nombre = contentH.innerText.trim();
    }
    nombre = nombre || hubNombre || urlStr.split('/').pop().replace(/-/g, ' ');

    // ── Porcentaje ───────────────────────────────────────────────────────────
    // Si ya lo tenemos del hub, usarlo; si no, intentar extraerlo de og:description
    // o del texto del body
    let pctMax = hubPct;
    if (!pctMax) {
      // Buscar en og:description
      const descPcts = [...(ogDesc || '').matchAll(/(\d{1,3})\s*%/g)].map(m => parseInt(m[1], 10)).filter(n => n > 0 && n <= 70);
      if (descPcts.length) pctMax = Math.max(...descPcts);
    }
    if (!pctMax) {
      // Buscar elementos leaf con texto "NN%" o "NN% de descuento"
      const allEls = [...document.querySelectorAll('*')].filter(e => e.children.length === 0);
      for (const el of allEls) {
        const t = (el.innerText || el.textContent || '').trim();
        const m = t.match(/^(\d{1,3})\s*%$/) || t.match(/(\d{1,3})\s*%\s*(de\s+)?descuento/i);
        if (m) { const n = parseInt(m[1], 10); if (n > 0 && n <= 70 && (!pctMax || n > pctMax)) pctMax = n; }
      }
    }

    // ── Vigencia ─────────────────────────────────────────────────────────────
    const bodyLines = (document.body.innerText || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const vigencia = bodyLines.find(l => /^vigencia/i.test(l) && l.length < 120)
                  || bodyLines.find(l => /v[aá]lid[ao]?\s+(hasta|al)/i.test(l) && l.length < 120)
                  || null;

    // ── Descripción ──────────────────────────────────────────────────────────
    const mainEl = document.querySelector('main, article') || document.body;
    const mainLines = (mainEl.innerText || '').split('\n').map(l => l.trim()).filter(l =>
      l.length > 25 && !/menú|navegaci|contacto|cookie|privac|©|132|4411|\+598/i.test(l)
    );
    const desc = mainLines[0]?.slice(0, 200) || ogDesc?.slice(0, 200) || null;

    // ── Tarjetas aplicables ──────────────────────────────────────────────────
    const allBodyText = bodyLines.join(' ');
    const tarjLine = bodyLines.find(l => /tarjeta|cr[eé]dito|d[eé]bito|amex|american\s*express|advantage/i.test(l)
                                          && l.length < 200
                                          && !/(art\.|ley|banco\s+sant)/i.test(l));
    // Also check if Advantage is mentioned anywhere in body (for Amex Advantage benefits)
    const hasAdvantage = /\badvantage\b/i.test(allBodyText);
    const hasAmex      = /\bamex\b|\bamerican\s*express\b/i.test(allBodyText);
    let tarjetas = tarjLine || null;
    if (!tarjetas && hasAdvantage) tarjetas = 'Amex Advantage';
    else if (!tarjetas && hasAmex)  tarjetas = 'American Express';

    return { nombre, url: urlStr, pctMax, vigencia, tarjetas, desc };
  }, url, card.nombre, card.pctHub);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox',
           '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  const page = await newPage(browser);

  if (DIAG_MODE) console.log('=== MODO DIAGNÓSTICO ===\n');

  console.log('=== Explorando hub de beneficios ===');
  const cards = await discoverCards(page);

  if (cards.length === 0) {
    console.log('\n⚠️  No se encontraron cards. Revisar santander-hub.html.');
    await browser.close();
    return;
  }

  const sample = DIAG_MODE ? cards.slice(0, 5) : cards;
  console.log(`\n=== Parseando ${sample.length} páginas de detalle${DIAG_MODE ? ' (muestra)' : ''} ===`);

  const beneficios = [];
  let ok = 0, fail = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i];
    process.stdout.write(`  [${i + 1}/${sample.length}] ${c.slug} … `);
    try {
      const d = await parseDetail(page, c);
      if (d) {
        beneficios.push(d);
        console.log(`OK — ${d.pctMax ?? '?'}% "${d.nombre}"`);
        ok++;
      } else {
        console.log('skip');
        fail++;
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      fail++;
    }
    if ((i + 1) % 30 === 0) console.log(`  ...${i + 1}/${sample.length}`);
    await sleep(DELAY_MS);
  }

  await browser.close();

  if (DIAG_MODE) {
    console.log('\n=== Muestra de datos parseados ===');
    beneficios.forEach(b => console.log(JSON.stringify(b, null, 2)));
    return;
  }

  beneficios.forEach(b => {
    const scope = parseCardScope('Santander', { tarjetas: b.tarjetas, nombre: b.nombre, desc: b.desc });
    b.red       = scope.red;
    b.niveles   = scope.niveles;
    b.cobranding = scope.cobranding;
  });

  const payload = {
    fuente: 'santander.com.uy',
    actualizado: new Date().toISOString(),
    total: beneficios.length,
    beneficios,
  };

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'beneficios-santander.json'), JSON.stringify(payload, null, 2));

  console.log(`\n✓ data/beneficios-santander.json — ${beneficios.length} beneficios (ok=${ok}, fail=${fail})`);
  beneficios.slice(0, 5).forEach(b =>
    console.log(`  • [${b.categoria || '?'}] ${b.nombre} — ${b.pctMax ?? '?'}%`));
})();
