// Scraper de beneficios BROU para FinPro — v4.
//
// Hallazgos del diagnóstico v3:
//  - 70 cards extraídas correctamente con content-visibility fix.
//  - enrichFromSubPage: los selectores CSS (.tarjeta, etc.) no existen en BROU.
//    La info útil está en innerText.split('\n') — hay que cortar en "También te
//    puede interesar" para no capturar el sidebar de beneficios relacionados.
//  - tarjLines con allText comprimido pegaba bloques enteros de nav; usando
//    split('\n') cada línea es independiente y filtra mucho mejor.
//  - vigencia: aparece como línea propia ("Todos los días", "Lunes a viernes", etc.)
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
  // Forzar renderizado (content-visibility:auto omite items fuera del viewport)
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

      let rawUrl = anchor ? anchor.getAttribute('href') : null;
      if (rawUrl && rawUrl.startsWith('//')) rawUrl = 'https:' + rawUrl;
      else if (rawUrl && !rawUrl.startsWith('http')) rawUrl = 'https://beneficios.brou.com.uy' + rawUrl;
      const url = rawUrl;

      const texto = (el.textContent || '').replace(/\s+/g, ' ').trim();

      // Porcentaje: primer número seguido de %
      const pctMatch = texto.match(/(\d{1,3})\s*%/);
      const pctMax = pctMatch ? parseInt(pctMatch[1]) : null;

      // Categoría desde la URL
      let categoria = null;
      if (url) {
        try {
          const parts = new URL(url).pathname.split('/').filter(Boolean);
          if (parts.length >= 2) categoria = parts[0];
        } catch (_) {}
      }

      // Slug: último segmento de la URL
      let slug = null;
      if (url) {
        try { slug = new URL(url).pathname.split('/').filter(Boolean).pop() || null; }
        catch (_) {}
      }

      cards.push({ nombre, pctMax, url, slug, tarjetas: null, vigencia: null, desc: null, categoria });
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
      // Usar innerText split por líneas para no mezclar bloques de nav
      const rawLines = (document.body.innerText || '').split('\n')
        .map(s => s.trim()).filter(s => s.length > 2);

      // Cortar en "También te puede interesar" — lo que sigue es sidebar/relacionados
      const stopIdx = rawLines.findIndex(l => /también te puede interesar/i.test(l));
      const lines = stopIdx > 0 ? rawLines.slice(0, stopIdx) : rawLines;

      // Líneas con info de tarjetas (excluir nav)
      const tarjLines = lines.filter(s =>
        /visa|mastercard|d[eé]bito|cr[eé]dito|prepago|maestro|cabal|tarjeta|amex|american\s*express|brou\s+recompensa|mi\s+brou/i.test(s) &&
        !/solicit[áa]\s+tu\s+tarjeta/i.test(s) &&
        s.length > 8
      ).map(s => s.slice(0, 200));

      // Vigencia: líneas que mencionen días u horario
      const vigLines = lines.filter(s =>
        /todos los d[ií]as|lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado|domingo|diario|semana|vigencia/i.test(s) &&
        s.length < 120
      );
      const vigencia = vigLines.length ? vigLines[0].slice(0, 100) : null;

      // descLarga: primera línea de contenido significativo (no nav, no breadcrumb, no solo %)
      const NAV_PATS = /^(solicitá|sorteos|contacto|rueda\s+celeste|inicio|beneficios|espectáculos|moda|gastronom|hogar|transporte|ense[nñ]anza|salud|turismo|tecnolog)/i;
      const descLines = lines.filter(s =>
        s.length > 20 &&
        !NAV_PATS.test(s) &&
        !/^(\d{1,3}\s*%|2x1|\d{4}\s+\d{4}|uy\/)/.test(s)
      );
      const descLarga = descLines.length ? descLines[0].slice(0, 400) : null;

      // Porcentaje máximo en el contenido (excluyendo sidebar)
      const allContent = lines.join(' ');
      const pctNums = [...allContent.matchAll(/(\d{1,3})\s*%/g)]
        .map(m => parseInt(m[1])).filter(n => n > 0 && n <= 80);
      const pctMax = pctNums.length ? Math.max(...pctNums) : null;

      return { descLarga, tarjetas: null, tarjetasArr: [], vigencia, pctMax, tarjLines: tarjLines.slice(0, 6) };
    });
  } catch (_) {
    return null;
  }
}

// Seleccionar la mejor línea de tarjetas (evitar nav junk)
function pickBestTarjLine(tarjLines) {
  if (!tarjLines || !tarjLines.length) return null;
  // Preferir líneas que mencionen VISA, Mastercard, débito, crédito — no solo "tarjeta"
  const specific = tarjLines.find(s =>
    /visa|mastercard|d[eé]bito|cr[eé]dito|amex|american|brou\s+recompensa|mi\s+brou/i.test(s)
  );
  return (specific || tarjLines[0]).trim();
}

// ── Diagnóstico ───────────────────────────────────────────────────────────────
async function diag(page) {
  console.log('=== MODO DIAGNÓSTICO v4 — BROU Beneficios ===\n');

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
    console.log(`  [${i}] "${c.nombre}"  pct=${c.pctMax}  cat=${c.categoria}  url=${c.slug}`)
  );

  // Enriquecer las primeras 5 cards con sub-página
  console.log('\n--- Sub-páginas de las primeras 5 cards ---');
  for (const c of cards.slice(0, 5).filter(c => c.url)) {
    console.log(`\n  ${c.nombre} → ${c.url}`);
    const extra = await enrichFromSubPage(page, c.url);
    if (!extra) { console.log('    ERROR'); continue; }
    const bestTarj = pickBestTarjLine(extra.tarjLines);
    console.log(`    pctMax: ${extra.pctMax}`);
    console.log(`    vigencia: "${extra.vigencia}"`);
    console.log(`    descLarga: "${extra.descLarga?.slice(0, 120) ?? 'null'}"`);
    console.log(`    tarjLines (${extra.tarjLines.length}):`);
    extra.tarjLines.forEach((l, i) => console.log(`      [${i}] "${l}"`));
    console.log(`    → bestTarjLine: "${bestTarj}"`);
    saveHtml('brou-sub-' + c.slug, await page.content());
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

    const bestTarj = pickBestTarjLine(extra.tarjLines);
    if (!c.tarjetas && bestTarj) c.tarjetas = bestTarj;
    if (!c.desc && extra.descLarga) c.desc = extra.descLarga;
    if (extra.vigencia) c.vigencia = extra.vigencia;
    // Preferir pctMax de sub-página si el hub lo tenía null o si es más específico (menor)
    if (extra.pctMax && (!c.pctMax || extra.pctMax < c.pctMax)) c.pctMax = extra.pctMax;

    console.log(`    ${c.nombre}: pct=${c.pctMax}  tarj="${(c.tarjetas || '—').slice(0, 70)}"  vig="${c.vigencia || '—'}"`);
  }

  // Eliminar campo interno slug del output final
  return unique.map(({ slug: _slug, ...rest }) => rest);
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
        fuente: 'BROU',
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
