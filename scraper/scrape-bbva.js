// Scraper de beneficios BBVA Uruguay para FinPro.
//
// BBVA sirve 403 a fetch/curl simples (anti-bot tipo Akamai), por eso usamos
// Puppeteer + stealth para simular un navegador real.
//
// === v1.5 DIAGNÓSTICA DE DETALLE ===
// La v1 confirmó que cada beneficio es un <article> en los listados, pero el %
// real vive en la página de detalle (link "Quiero saber más"). Esta corrida:
//   1. Extrae de un listado los <article> con su href de detalle.
//   2. Inspecciona el mecanismo de paginación (¿links <a href> o botones JS?).
//   3. Entra a 2-3 páginas de detalle y vuelca su estructura/texto.
// Con eso escribimos el parser preciso de la v2 (listados + detalle completos).

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');

const LISTING = 'https://www.bbva.com.uy/personas/productos/tarjetas/descuentos/gastronomia.html';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1366, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8' });
  return page;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox',
           '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });

  const diag = { listing: LISTING, articles: [], pagination: null, detalles: [] };

  // ---- 1. Listado: artículos + hrefs + paginación ----
  const page = await newPage(browser);
  const resp = await page.goto(LISTING, { waitUntil: 'networkidle2', timeout: 60000 });
  console.log(`\n===== LISTADO gastronomia — HTTP ${resp && resp.status()} =====`);
  await sleep(3500);

  const listingData = await page.evaluate(() => {
    const arts = [...document.querySelectorAll('article')].map((a) => {
      const link = a.querySelector('a[href]');
      return {
        href: link ? link.href : null,
        text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        html: a.outerHTML.slice(0, 600),
      };
    });

    // Paginación: buscar contenedor con números / "Siguiente"
    let pag = null;
    const sig = [...document.querySelectorAll('a, button')]
      .find((el) => /siguiente/i.test(el.innerText || ''));
    if (sig) {
      pag = {
        tag: sig.tagName, href: sig.getAttribute('href'),
        outer: sig.outerHTML.slice(0, 300),
        parentOuter: sig.parentElement ? sig.parentElement.outerHTML.slice(0, 700) : null,
      };
    }
    return { arts, pag };
  });

  diag.articles = listingData.arts;
  diag.pagination = listingData.pag;

  console.log(`\nArtículos encontrados: ${listingData.arts.length}`);
  listingData.arts.slice(0, 4).forEach((a, i) => {
    console.log(`\n--- article[${i}] ---`);
    console.log('href:', a.href);
    console.log('text:', a.text);
    console.log('html:', a.html);
  });

  console.log('\n===== PAGINACIÓN =====');
  console.log(JSON.stringify(listingData.pag, null, 2));

  // ---- 2. Detalle: entrar a las primeras 3 páginas con href válido ----
  const detailHrefs = [...new Set(
    listingData.arts.map((a) => a.href).filter((h) => h && /bbva\.com\.uy/.test(h))
  )].slice(0, 3);

  console.log(`\n===== ENTRANDO A ${detailHrefs.length} PÁGINAS DE DETALLE =====`);

  for (const href of detailHrefs) {
    const dp = await newPage(browser);
    try {
      const r = await dp.goto(href, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(2500);
      const d = await dp.evaluate(() => ({
        title: document.title,
        text: (document.body.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').slice(0, 3000),
        pctNodes: [...document.querySelectorAll('*')]
          .filter((el) => !el.children.length && /\d{1,3}\s?%/.test(el.innerText || ''))
          .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
          .filter((t, i, arr) => t && arr.indexOf(t) === i)
          .slice(0, 30),
      }));
      console.log(`\n########## DETALLE: ${href}`);
      console.log(`HTTP ${r && r.status()} — title="${d.title}"`);
      console.log('--- % detectados ---');
      d.pctNodes.forEach((t) => console.log('  •', t));
      console.log('--- TEXTO DETALLE (muestra) ---');
      console.log(d.text);
      console.log('--- FIN DETALLE ---');
      diag.detalles.push({ href, title: d.title, pctNodes: d.pctNodes });
    } catch (e) {
      console.error(`detalle ERROR (${href}): ${e.message}`);
    } finally {
      await dp.close();
    }
  }

  await browser.close();

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'beneficios-bbva-raw.json'),
    JSON.stringify({ fuente: 'bbva.com.uy', modo: 'diagnostico-detalle',
                     actualizado: new Date().toISOString(), ...diag }, null, 2));
  console.log('\n✓ Escrito data/beneficios-bbva-raw.json (diagnóstico)');
})();
