// Scraper de beneficios BBVA Uruguay para FinPro.
//
// BBVA sirve 403 a fetch/curl simples (anti-bot tipo Akamai), por eso usamos
// Puppeteer + stealth para simular un navegador real.
//
// Esta es la versión v1 DIAGNÓSTICA: además de un parse best-effort, vuelca la
// estructura real del DOM en los logs y guarda el HTML renderizado como artifact,
// para poder escribir selectores precisos en la siguiente iteración (no podemos
// ver el DOM de BBVA localmente porque su anti-bot bloquea los fetches).

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');

const TARGETS = [
  { slug: 'descuentos',  url: 'https://www.bbva.com.uy/personas/productos/tarjetas/descuentos.html' },
  { slug: 'gastronomia', url: 'https://www.bbva.com.uy/personas/productos/tarjetas/descuentos/gastronomia.html' },
  { slug: 'otros',       url: 'https://www.bbva.com.uy/personas/productos/tarjetas/descuentos/otros.html' },
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrapePage(browser, target) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1366, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8' });

  const record = { slug: target.slug, url: target.url, status: null };

  try {
    const resp = await page.goto(target.url, { waitUntil: 'networkidle2', timeout: 60000 });
    record.status = resp ? resp.status() : null;
    console.log(`\n========== [${target.slug}] HTTP ${record.status} ==========`);
    console.log(target.url);

    // Dejar que el JS dinámico termine de pintar
    await sleep(3500);

    // Guardar HTML renderizado (se sube como artifact del workflow)
    const outDir = path.join(__dirname, 'output');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${target.slug}.html`), await page.content());

    // Diagnóstico de estructura del DOM
    const diag = await page.evaluate(() => {
      const out = { title: document.title, candidates: {} };
      const selectors = [
        '[class*="descuento"]', '[class*="beneficio"]', '[class*="card"]',
        '[class*="promo"]', '[class*="cmp"]', 'article', 'li',
      ];
      for (const s of selectors) out.candidates[s] = document.querySelectorAll(s).length;
      out.bodyTextSample = (document.body.innerText || '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .slice(0, 4000);
      return out;
    });
    record.title = diag.title;
    console.log(`title = "${diag.title}"`);
    console.log('candidatos por selector:', JSON.stringify(diag.candidates));
    console.log('--- TEXTO RENDERIZADO (muestra) ---');
    console.log(diag.bodyTextSample);
    console.log('--- FIN MUESTRA ---');

    // Parse best-effort: textos de nodos hoja que contienen un porcentaje
    const pctTexts = await page.evaluate(() => {
      const pctRe = /\d{1,3}\s?%/;
      const found = [];
      document.querySelectorAll('*').forEach((el) => {
        if (el.children.length) return; // solo hojas
        const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (txt && txt.length < 220 && pctRe.test(txt)) found.push(txt);
      });
      return [...new Set(found)].slice(0, 80);
    });
    record.rawPctTexts = pctTexts;
    console.log(`textos con % (${pctTexts.length}):`);
    pctTexts.forEach((t) => console.log('  •', t));
  } catch (e) {
    record.error = e.message;
    console.error(`[${target.slug}] ERROR: ${e.message}`);
  } finally {
    await page.close();
  }

  return record;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });

  const paginas = [];
  for (const target of TARGETS) {
    paginas.push(await scrapePage(browser, target));
  }

  await browser.close();

  const payload = {
    fuente: 'bbva.com.uy',
    actualizado: new Date().toISOString(),
    nota: 'v1 diagnóstica — rawPctTexts es extracción cruda, no estructurada aún',
    paginas,
  };

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const outFile = path.join(dataDir, 'beneficios-bbva-raw.json');
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`\n✓ Escrito data/beneficios-bbva-raw.json`);

  const ok = paginas.filter((p) => p.status === 200).length;
  console.log(`\nResumen: ${ok}/${paginas.length} páginas con HTTP 200`);
  if (ok === 0) {
    console.log('⚠ Ninguna página devolvió 200 — el anti-bot bloqueó el acceso.');
    process.exitCode = 0; // no fallar el job; queremos ver los logs igual
  }
})();
