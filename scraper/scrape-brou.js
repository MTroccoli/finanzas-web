// Scraper de beneficios BROu para FinPro — v3.
//
// Hallazgos del diagnóstico v2:
//  - 70 .beneficio-item en el DOM. content-visibility:auto hace que 34 fuera del
//    viewport tengan innerText vacío. Fix: forzar contentVisibility='visible'.
//  - Estructura: .beneficio-item > a[href] > img[alt=nombre] + texto con %
//  - URL pattern: //beneficios.brou.com.uy/{categoria}/{slug}
//  - Clase .tarjeta existe en el DOM (dentro de cada card)
//  - Sub-páginas contienen detalle completo (tarjeta, vigencia, condiciones)
//
// Salida: data/beneficios-brou.json

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

const HUB    = 'https://beneficios.brou.com.uy/beneficios';
const ORIGIN = 'https://beneficios.brou.com.uy';
const UA     = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DIAG_MODE = process.argv.includes('--diag');
const DELAY_MS  = 600;
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
  const fullUrl = url.startsWith('//') ? 'https:' + url : url;
  const resp = await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 60000 });
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

// ── Extraer todas las cards del hub ──────────────────────────────────────────
async function extractHubCards(page) {
  // Forzar renderizado de todos los items (content-visibility:auto los omite fuera del viewport)
  await page.evaluate(() => {
    document.querySelectorAll('.beneficio-item').forEach(el => {
      el.style.contentVisibility = 'visible';
    });
  });
  await sleep(500);

  return await page.evaluate((origin) => {
    const cards = [];
    document.querySelectorAll('.beneficio-item').forEach(el => {
      const anchor  = el.querySelector('a[href]');
      const imgEl   = el.querySelector('img[alt]');
      const nombre  = (imgEl?.alt || '').trim();
      if (!nombre || nombre.length < 2) return;

      const url = anchor ? ('https:' + anchor.getAttribute('href').replace(/^https?:/, '')).replace('https://https:', 'https:') : null;
      const texto = (el.textContent || '').replace(/\s+/g, ' ').trim();

      // Porcentaje: primer número seguido de %
      const pctMatch = texto.match(/(\d{1,3})\s*%/);
      const pctMax = pctMatch ? parseInt(pctMatch[1]) : null;

      // Tipo tarjeta si hay elemento .tarjeta
      const tarjEl = el.querySelector('.tarjeta, [class*="tarjeta"]');
      const tarjetas = tarjEl ? tarjEl.textContent.replace(/\s+/g, ' ').trim() : null;

      // Categoría desde la URL (primer segmento del path)
      let categoria = null;
      if (url) {
        try {
          const parts = new URL(url).pathname.split('/').filter(Boolean);
          if (parts.length >= 2) categoria = parts[0];
        } catch (_) {}
      }

      // Descripción: texto excluyendo el porcentaje y el nombre
      const desc = texto
        .replace(/^\d{1,3}\s*%\s*/, '')
        .replace(nombre, '')
        .trim()
        .slice(0, 200) || null;

      cards.push({ nombre, pctMax, url, tarjetas, categoria, desc });
    });
    return cards;
  }, ORIGIN);
}

// ── Enriquecer desde sub-página ───────────────────────────────────────────────
async function enrichFromSubPage(page, url) {
  try {
    const status = await goto(page, url);
    if (status !== 200 && status !== 304) return null;
    await scrollToEnd(page);

    return await page.evaluate(() => {
      // Descripción larga
      const descEl = document.querySelector(
        '[class*="descripcion"], [class*="description"], [class*="detalle"], [class*="detail"], [class*="beneficio-text"], [class*="ben-desc"], .card-body p, main p'
      );
      const descLarga = descEl ? descEl.innerText.replace(/\s+/g, ' ').trim().slice(0, 400) : null;

      // Tarjeta(s) — buscar elemento con class tarjeta o texto que mencione tipo
      const tarjEls = [...document.querySelectorAll('.tarjeta, [class*="tarjeta"], [class*="medio-pago"], [class*="mediopago"]')];
      const tarjetasArr = tarjEls.map(el => el.innerText.replace(/\s+/g, ' ').trim()).filter(t => t.length > 1);
      const tarjetas = tarjetasArr.length ? [...new Set(tarjetasArr)].join(' · ').slice(0, 200) : null;

      // Vigencia / días
      const vigEl = document.querySelector('[class*="vigencia"], [class*="vigenc"], [class*="dias"], [class*="dia-semana"], [class*="schedule"]');
      const vigencia = vigEl ? vigEl.innerText.replace(/\s+/g, ' ').trim().slice(0, 100) : null;

      // Porcentaje en la sub-página (puede ser más específico)
      const allText = document.body.innerText.replace(/\s+/g, ' ');
      const pctNums = [...allText.matchAll(/(\d{1,3})\s*%/g)]
        .map(m => parseInt(m[1])).filter(n => n > 0 && n <= 80);
      const pctMax = pctNums.length ? Math.max(...pctNums) : null;

      // Texto completo de la página para tarjeta info si los selectores no encontraron nada
      const tarjLines = allText.split(/[.\n!]/).map(s => s.trim()).filter(s =>
        s.length > 5 &&
        /visa|mastercard|d[eé]bito|cr[eé]dito|prepago|maestro|cabal|tarjeta/i.test(s) &&
        !/^personas\s+banca/i.test(s)
      ).map(s => s.slice(0, 160));

      return { descLarga, tarjetas, tarjetasArr, vigencia, pctMax, tarjLines: tarjLines.slice(0, 5) };
    });
  } catch (_) {
    return null;
  }
}

// ── Diagnóstico ───────────────────────────────────────────────────────────────
async function diag(page) {
  console.log('=== MODO DIAGNÓSTICO v3 — BROu Beneficios ===\n');

  const status = await goto(page, HUB);
  console.log(`Hub status: ${status}`);

  console.log('Esperando que los cards carguen...');
  try {
    await page.waitForFunction(
      () => {
        const items = document.querySelectorAll('.beneficio-item');
        return items.length > 0 && (items[0].textContent || '').trim().length > 5;
      },
      { timeout: 20000 }
    );
    console.log('OK.');
  } catch (_) { console.log('Timeout.'); }

  await scrollToEnd(page);
  const cards = await extractHubCards(page);
  saveHtml('brou-hub', await page.content());

  console.log(`\nCards extraídas: ${cards.length}`);
  console.log('\n--- Primeras 8 cards ---');
  cards.slice(0, 8).forEach((c, i) =>
    console.log(`  [${i}] "${c.nombre}"  pct=${c.pctMax}  cat=${c.categoria}  tarj="${c.tarjetas?.slice(0,50)}"  url=${c.url?.split('/').pop()}`)
  );

  // Enriquecer las primeras 3 cards con sub-página
  console.log('\n--- Sub-páginas de las primeras 3 cards ---');
  for (const c of cards.slice(0, 3).filter(c => c.url)) {
    console.log(`\n  ${c.nombre} → ${c.url}`);
    const extra = await enrichFromSubPage(page, c.url);
    if (!extra) { console.log('    ERROR'); continue; }
    console.log(`    pctMax: ${extra.pctMax}`);
    console.log(`    tarjetas: "${extra.tarjetas}"`);
    console.log(`    tarjetasArr: ${JSON.stringify(extra.tarjetasArr)}`);
    console.log(`    vigencia: "${extra.vigencia}"`);
    console.log(`    descLarga: "${extra.descLarga?.slice(0, 100)}"`);
    console.log(`    tarjLines: ${JSON.stringify(extra.tarjLines)}`);
    saveHtml('brou-sub-' + c.url.split('/').pop(), await page.content());
  }
}

// ── Producción ────────────────────────────────────────────────────────────────
async function scrapeAll(page) {
  const status = await goto(page, HUB);
  console.log(`Hub: ${status}`);
  if (status !== 200 && status !== 304) return [];

  try {
    await page.waitForFunction(
      () => document.querySelectorAll('.beneficio-item').length > 0 &&
            (document.querySelector('.beneficio-item')?.textContent || '').trim().length > 5,
      { timeout: 20000 }
    );
  } catch (_) { console.log('Timeout esperando cards.'); }

  await scrollToEnd(page);
  const cards = await extractHubCards(page);
  console.log(`  Hub: ${cards.length} cards`);

  // Deduplicar por nombre
  const seen = new Set();
  const unique = cards.filter(c => {
    const k = c.nombre.toLowerCase().slice(0, 50);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  console.log(`  Únicos: ${unique.length}`);

  // Enriquecer desde sub-páginas
  const withUrl = unique.filter(c => c.url);
  console.log(`\n  Enriqueciendo ${withUrl.length} sub-páginas...`);

  for (const c of withUrl) {
    await sleep(DELAY_MS);
    const extra = await enrichFromSubPage(page, c.url);
    if (!extra) { console.log(`    ${c.nombre}: skip`); continue; }

    if (!c.tarjetas && extra.tarjetas) c.tarjetas = extra.tarjetas;
    if (!c.tarjetas && extra.tarjLines.length) c.tarjetas = extra.tarjLines[0];
    if (!c.desc && extra.descLarga) c.desc = extra.descLarga;
    if (extra.vigencia) c.vigencia = extra.vigencia;
    if (extra.pctMax && (!c.pctMax || extra.pctMax < c.pctMax)) c.pctMax = extra.pctMax; // sub-page más específico

    console.log(`    ${c.nombre}: tarj="${(c.tarjetas||'—').slice(0,60)}"  vig="${c.vigencia||'—'}"`);
  }

  return unique;
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
      const beneficios = await scrapeAll(page);
      if (!beneficios.length) { console.log('Sin datos.'); return; }

      const out = {
        fuente: 'BROu',
        url: HUB,
        fecha: new Date().toISOString().slice(0, 10),
        total: beneficios.length,
        beneficios,
      };

      const outPath = path.join(__dirname, '..', 'data', 'beneficios-brou.json');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
      console.log(`\nEscrito: ${outPath} (${beneficios.length} beneficios)`);
    }
  } finally {
    await browser.close();
  }
})();
