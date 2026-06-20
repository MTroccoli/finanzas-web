// Scraper de beneficios Santander Uruguay para FinPro.
//
// Santander sirve 403 a curl/fetch simples; usamos Puppeteer + stealth.
//
// Fase 1 (diagnóstico): carga el hub /beneficios, guarda HTML renderizado
// y lista los links encontrados. Necesaria para mapear la estructura antes
// de construir el parser definitivo.
//
// Fase 2 (producción): una vez conocida la estructura, parsea todos los
// beneficios y escribe data/beneficios-santander.json.
//
// Salida: scraper/output/santander-hub.html  (diagnóstico hub)
//         scraper/output/santander-det-*.html (diagnóstico detalle × 3)
//         data/beneficios-santander.json      (producción)

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

const HUB    = 'https://www.santander.com.uy/beneficios';
const ORIGIN = 'https://www.santander.com.uy';
const UA     = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DIAG_MODE = process.argv.includes('--diag');   // node scrape-santander.js --diag

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

// ── Guardar HTML diagnóstico ──────────────────────────────────────────────────
function saveHtml(name, html) {
  const dir = path.join(__dirname, 'output');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.html`);
  fs.writeFileSync(file, html);
  console.log(`  → ${file} (${(html.length / 1024).toFixed(1)} KB)`);
}

// ── Descubrir links de beneficios desde el hub ────────────────────────────────
async function discoverLinks(page) {
  const status = await goto(page, HUB);
  console.log(`Hub status: ${status}`);

  const html = await page.content();
  if (DIAG_MODE) saveHtml('santander-hub', html);

  // Busca links internos que parezcan páginas de beneficio individual
  const links = await page.evaluate(origin => {
    const seen = new Set();
    const out  = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href || '';
      if (!href.startsWith(origin)) return;
      const path = href.replace(origin, '');
      // /beneficios/<algo> pero no /beneficios sólo
      if (/^\/beneficios\/[^/]+/.test(path) && !seen.has(href)) {
        seen.add(href);
        out.push({
          href,
          text: (a.innerText || a.title || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        });
      }
    });
    return out;
  }, ORIGIN);

  console.log(`\nLinks de beneficio encontrados en el hub: ${links.length}`);
  links.forEach(l => console.log(`  ${l.href}  "${l.text}"`));

  // También vuelca todos los textos visibles para entender la estructura
  if (DIAG_MODE) {
    const texto = await page.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter(el => el.children.length === 0 && (el.innerText || '').trim().length > 0)
        .map(el => `[${el.tagName}.${el.className.split(' ').slice(0,2).join('.')}] ${el.innerText.trim().slice(0,120)}`)
        .join('\n')
    );
    saveHtml('santander-hub-text', `<pre>${texto}</pre>`);
  }

  return links;
}

// ── Parsear una página de detalle ─────────────────────────────────────────────
// NOTA: esta función asume una estructura hipotética; ajustar tras ver el HTML
// diagnóstico. Los selectores son genéricos para que funcionen en la mayoría
// de CMS Santander.
async function parseDetail(page, url) {
  const status = await goto(page, url);
  if (status !== 200) {
    console.log(`  [skip] ${url} → HTTP ${status}`);
    return null;
  }

  const html = await page.content();
  if (DIAG_MODE) {
    const slug = url.split('/').pop().replace(/[^a-z0-9-]/g, '') || 'det';
    saveHtml(`santander-det-${slug}`, html);
  }

  return page.evaluate(urlStr => {
    const txt  = (document.body.innerText || '').split('\n')
      .map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

    const title = document.querySelector('h1,h2,.title,.promo-title,.benefit-title')?.innerText?.trim()
                  || document.title.replace(/\s*\|.*$/, '').trim();

    // Porcentaje de descuento: busca "NN% de descuento" o "NN% Off"
    const pctMatches = txt.map(l => l.match(/(\d{1,3})\s*%/g)).flat().filter(Boolean)
      .map(m => parseInt(m, 10)).filter(n => n > 0 && n <= 99);
    const pctMax = pctMatches.length ? Math.max(...pctMatches) : null;

    // Vigencia / validez
    const vigLine = txt.find(l => /vigencia|válido|v[aá]lida|hasta|desde|periodo/i.test(l));
    const vigencia = vigLine ? vigLine.slice(0, 120) : null;

    // Tarjetas aplicables
    const tarjLine = txt.find(l => /tarjeta|credit|d[eé]bito|visa|master|amex|select|infinite|black|platinum/i.test(l));
    const tarjetas = tarjLine ? tarjLine.slice(0, 200) : null;

    // Descripción principal (primer párrafo largo)
    const desc = txt.find(l => l.length > 50 && !/cookie|privac|©/i.test(l)) || null;

    // Imagen del comercio (og:image o primer img)
    const ogImg = document.querySelector('meta[property="og:image"]')?.content || null;

    return {
      nombre: title,
      url: urlStr,
      pctMax,
      pctRaw: pctMatches,
      vigencia,
      tarjetas,
      desc: desc?.slice(0, 200),
      img: ogImg,
    };
  }, url);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox',
           '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  const page = await newPage(browser);

  if (DIAG_MODE) console.log('=== MODO DIAGNÓSTICO — guardando HTMLs ===\n');

  // 1. Descubrir links de beneficio
  console.log('=== Explorando hub de beneficios ===');
  const links = await discoverLinks(page);

  if (links.length === 0) {
    console.log('\n⚠️  No se encontraron links. Revisar santander-hub.html para ajustar selectores.');
    if (!DIAG_MODE) console.log('Tip: correlo con --diag para guardar el HTML.');
    await browser.close();
    return;
  }

  // 2. En modo diagnóstico: parsea sólo los primeros 3 para ver la estructura
  const sample = DIAG_MODE ? links.slice(0, 3) : links;
  console.log(`\n=== Parseando ${sample.length} páginas de detalle${DIAG_MODE ? ' (muestra)' : ''} ===`);

  const beneficios = [];
  let ok = 0, fail = 0;
  for (let i = 0; i < sample.length; i++) {
    const l = sample[i];
    process.stdout.write(`  [${i + 1}/${sample.length}] ${l.href.split('/').pop()} … `);
    try {
      const d = await parseDetail(page, l.href);
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
    await sleep(700);
  }

  await browser.close();

  if (DIAG_MODE) {
    console.log('\n=== Muestra de datos parseados ===');
    beneficios.forEach(b => console.log(JSON.stringify(b, null, 2)));
    console.log('\nRevisá scraper/output/ para ajustar selectores en parseDetail().');
    return;
  }

  // 3. Producción: escribir JSON
  const payload = {
    fuente: 'santander.com.uy',
    actualizado: new Date().toISOString(),
    total: beneficios.length,
    beneficios,
  };

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const outFile = path.join(dataDir, 'beneficios-santander.json');
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));

  console.log(`\n✓ data/beneficios-santander.json — ${beneficios.length} beneficios (ok=${ok}, fail=${fail})`);
  beneficios.slice(0, 5).forEach(b =>
    console.log(`  • ${b.nombre} — ${b.pctMax ?? '?'}%`));
})();
