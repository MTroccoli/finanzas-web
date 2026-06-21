// Scraper de beneficios OCA Uruguay para FinPro — v4 (producción con ocablue.uy).
//
// Modo diag  (--diag): guarda HTML de hub + sub-páginas como artifacts, no escribe JSON.
// Modo prod  (default): extrae beneficios y escribe data/beneficios-oca.json
//
// Hub real: https://ocablue.uy/beneficios.html
// Requiere: DISPLAY=:99 (Xvfb) + CHROME_PATH=/usr/bin/google-chrome en CI.
// Salida: data/beneficios-oca.json
// { fuente:"OCA", actualizado:"YYYY-MM-DD", beneficios:[...] }

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

const HUB_URL     = 'https://ocablue.uy/beneficios.html';
const HUB_ORIGIN  = 'https://ocablue.uy';
const OCA_HOME    = 'https://www.oca.com.uy/';   // fallback para descubrir URL actual
const UA          = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DIAG_MODE   = process.argv.includes('--diag');
const DELAY_MS    = 600;
const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const HAS_DISPLAY = !!process.env.DISPLAY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Browser helpers ───────────────────────────────────────────────────────────
async function newPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1366, height: 900 });
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'es-UY,es;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const t = req.resourceType();
    if (t === 'font' || t === 'media') req.abort();
    else req.continue();
  });
  return page;
}

async function goto(page, url) {
  const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
  return resp ? resp.status() : null;
}

async function isWafBlocked(page) {
  const title   = await page.title().catch(() => '');
  const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0);
  return /request rejected|access denied|forbidden/i.test(title) || bodyLen < 200;
}

function saveHtml(name, html) {
  const dir = path.join(__dirname, 'output');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `oca-${name}.html`);
  fs.writeFileSync(file, html);
  console.log(`  → ${file} (${(html.length / 1024).toFixed(1)} KB)`);
}

async function scrollToEnd(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let last  = document.body.scrollHeight;
      let stable = 0;
      const t = setInterval(() => {
        window.scrollBy(0, 600);
        const h = document.body.scrollHeight;
        if (h > last) { last = h; stable = 0; }
        else { stable++; if (stable >= 6) { clearInterval(t); resolve(); } }
      }, 300);
      setTimeout(() => { clearInterval(t); resolve(); }, 30000);
    });
  });
  await sleep(800);
}

// Resolve the correct hub URL (ocablue.uy; fallback: discover from oca.com.uy homepage)
async function resolveHubUrl(page) {
  // Try direct
  const st = await goto(page, HUB_URL);
  if (st && st < 400 && !await isWafBlocked(page)) return HUB_URL;

  // Try root of ocablue.uy
  const st2 = await goto(page, HUB_ORIGIN + '/');
  if (st2 && st2 < 400 && !await isWafBlocked(page)) {
    // Look for benefit links on their homepage
    const benefLink = await page.evaluate(() => {
      for (const a of document.querySelectorAll('a[href]')) {
        if (/beneficio/i.test(a.href)) return a.href;
      }
      return null;
    });
    if (benefLink) return benefLink;
  }

  // Fallback: load OCA homepage and find ocablue.uy links
  const st3 = await goto(page, OCA_HOME);
  if (st3 && st3 < 400 && !await isWafBlocked(page)) {
    const blueLink = await page.evaluate(() => {
      for (const a of document.querySelectorAll('a[href]')) {
        if (/ocablue\.uy.*beneficio/i.test(a.href)) return a.href;
      }
      // Also try the first ocablue.uy link and append /beneficios.html
      for (const a of document.querySelectorAll('a[href]')) {
        if (/ocablue\.uy/i.test(a.href)) {
          return new URL('/beneficios.html', a.href).href;
        }
      }
      return null;
    });
    if (blueLink) {
      const st4 = await goto(page, blueLink);
      if (st4 && st4 < 400 && !await isWafBlocked(page)) return blueLink;
    }
  }

  return null;
}

// ── Diagnóstico ───────────────────────────────────────────────────────────────
async function diagMode(browser) {
  const page = await newPage(browser);

  console.log('\n[DIAG] Resolviendo URL del hub…');
  const hubUrl = await resolveHubUrl(page);

  if (!hubUrl) {
    console.log('[DIAG] No se pudo cargar ninguna URL. Guardando HTML del último estado…');
    saveHtml('hub', await page.content().catch(() => ''));
    await page.close();
    return;
  }

  console.log(`[DIAG] Hub: ${hubUrl}`);
  await scrollToEnd(page);

  const html = await page.content();
  saveHtml('hub', html);

  const info = await page.evaluate(() => {
    // Fix SVGAnimatedString
    const getClass = el => typeof el.className === 'string' ? el.className : (el.className.baseVal || '');

    const clases = new Set();
    document.querySelectorAll('[class]').forEach(el => {
      getClass(el).split(/\s+/).forEach(c => {
        if (c && /benefic|descuent|promo|card|item|oferta|tarjeta|categ/i.test(c))
          clases.add(c);
      });
    });

    const candidatos = [
      '#listadoBeneficios a[href*="id="]',
      '#listadoBeneficios [class*="item"]',
      '[class*="item"]', 'article', '.card',
    ];
    const counts = {};
    candidatos.forEach(sel => {
      try { counts[sel] = document.querySelectorAll(sel).length; } catch(e) {}
    });

    const links = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const txt = (a.textContent || '').trim().replace(/\s+/g, ' ');
      if (txt.length > 3 && txt.length < 120 && links.length < 25)
        links.push({ href: a.getAttribute('href'), txt: txt.slice(0, 100) });
    });

    const ids = [];
    document.querySelectorAll('[id]').forEach(el => {
      if (/benefic|descuent|promo|categ|card|oferta|nombre|descrip|listado/i.test(el.id))
        ids.push(el.id);
    });

    return { clases: [...clases].sort(), counts, links, ids };
  });

  console.log('\n[DIAG] Clases CSS relevantes:');
  console.log(' ', info.clases.join(', ') || '(ninguna)');

  console.log('\n[DIAG] Conteo de elementos candidatos:');
  Object.entries(info.counts).forEach(([sel, n]) => n > 0 && console.log(`  ${sel}: ${n}`));

  console.log('\n[DIAG] IDs relevantes:', info.ids.join(', ') || '(ninguno)');

  console.log('\n[DIAG] Primeros links:');
  info.links.forEach(l => console.log(`  "${l.txt}" → ${l.href}`));

  const texto = await page.evaluate(() => document.body?.innerText?.slice(0, 5000) || '');
  const txtFile = path.join(__dirname, 'output', 'oca-hub-text.txt');
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  fs.writeFileSync(txtFile, texto);
  console.log(`\n[DIAG] Texto visible → ${txtFile}`);

  await page.close();
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

// "TipodeCambioOCABlue" → "Tipo de Cambio OCA Blue"
// "BurguerKing" → "Burguer King"
// "tienda-en-tu-ciudad" → "Tienda en tu ciudad"
function parseName(raw) {
  if (!raw) return '';
  // Handle kebab-case
  if (raw.includes('-')) {
    const words = raw.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    return words.join(' ');
  }
  // CamelCase split: insert space before each uppercase letter that follows a lowercase letter or a letter followed by lowercase
  return raw
    .replace(/([a-záéíóúüñ])([A-ZÁÉÍÓÚÜÑ])/g, '$1 $2')
    .replace(/([A-ZÁÉÍÓÚÜÑ]{2,})([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ])/g, '$1 $2')
    .trim();
}

// Extract pct, vigencia, desc from raw anchor text (text of "Ver condiciones" link card)
// Text is typically: "[desc][vigencia]Ver condiciones"
function parseCardText(raw) {
  const text = raw.replace(/Ver condiciones\.?/gi, '').trim();

  const pctMatch = text.match(/(\d{1,3})\s*%/);
  const pctMax = pctMatch ? parseInt(pctMatch[1]) : null;

  // Vigencia patterns: "Del X/XX/XX al X/XX/XX", "Hasta el X/XX/XX", "Todos los días...", "Los días..."
  const vigPat  = /(del\s+\d[\d/]+\s+al\s+\d[\d/]+|hasta\s+el\s+[\d/]+|todos\s+los\s+días[^.]*|los\s+días\s+que[^.]*)/i;
  const vigMatch = text.match(vigPat);
  const vigencia = vigMatch ? vigMatch[1].trim() : null;

  // Remove vigencia from text to get the promo description
  const desc = (vigencia ? text.replace(vigMatch[1], '') : text)
    .replace(/\s{2,}/g, ' ')
    .trim() || null;

  return { pctMax, vigencia, desc };
}

// ── Extracción de benefits desde el hub ─────────────────────────────────────
async function extractBenefits(page) {
  await scrollToEnd(page);

  return page.evaluate((hubOrigin) => {
    const results = [];
    const seen = new Set();

    // Primary: anchors with id= in href inside the benefit list
    const anchors = [...document.querySelectorAll('#listadoBeneficios a[href*="id="]')];
    // Fallback: any anchor with id= param on the page
    const allAnchors = anchors.length > 0 ? anchors
      : [...document.querySelectorAll('a[href*="id="]')];

    allAnchors.forEach(a => {
      const href = a.getAttribute('href') || '';
      const txt  = (a.textContent || '').trim().replace(/\s+/g, ' ');
      if (!href || seen.has(href)) return;
      seen.add(href);

      let url = href;
      if (url.startsWith('/')) url = hubOrigin + url;
      if (!url.startsWith('http'))  url = hubOrigin + '/' + url;

      // Extract id and name from URL params
      let id = null, nameParam = null;
      try {
        const params = new URL(url).searchParams;
        id = params.get('id');
        nameParam = params.get('name');
      } catch(e) {}

      results.push({ id, nameParam, href: url, rawText: txt });
    });

    return results;
  }, HUB_ORIGIN);
}

// Load a benefit detail page and extract nombre + description from the modal
async function enrichBenefit(page, url) {
  try {
    const st = await goto(page, url);
    if (!st || st >= 400 || await isWafBlocked(page)) return {};

    // Wait for modal / nombre element to appear
    try {
      await page.waitForSelector('#nombreBeneficio', { timeout: 8000 });
    } catch(e) {}

    return page.evaluate(() => {
      const nombre = (document.getElementById('nombreBeneficio')?.textContent || '').trim() || null;
      const desc   = (document.getElementById('descripBeneficio')?.textContent || '').trim() || null;
      const img    = document.getElementById('imgBeneficio')?.src || null;

      // Try to get category from any visible category element
      const catEl  = document.querySelector('[class*="categ"], [class*="categoria"]');
      const categoria = catEl ? (catEl.textContent || '').trim() : null;

      // Tarjetas text
      const tarjEl = document.querySelector('[class*="tarjeta"], [class*="card"]');
      const tarjetas = tarjEl ? (tarjEl.textContent || '').trim() : null;

      return { nombre, desc, img, categoria, tarjetas };
    });
  } catch(e) {
    return {};
  }
}

// ── Producción ────────────────────────────────────────────────────────────────
async function prodMode(browser) {
  const page = await newPage(browser);

  console.log('[OCA] Cargando hub de beneficios…');
  const hubUrl = await resolveHubUrl(page);

  if (!hubUrl) {
    console.error('[ERROR] No se pudo acceder al hub de OCA. Abortando.');
    await page.close();
    return;
  }
  console.log(`[OCA] Hub: ${hubUrl}`);

  const rawCards = await extractBenefits(page);
  console.log(`[OCA] Cards encontradas: ${rawCards.length}`);

  if (rawCards.length === 0) {
    console.log('[OCA] Sin cards. Guardando HTML de diagnóstico…');
    saveHtml('hub-prod', await page.content());
    await page.close();
    return;
  }

  // Enrich each benefit with detail page data
  const subPage = await newPage(browser);
  const benefits = [];

  for (let i = 0; i < rawCards.length; i++) {
    const raw = rawCards[i];
    const { pctMax, vigencia, desc: descHint } = parseCardText(raw.rawText);
    const nameFromParam = parseName(raw.nameParam);

    console.log(`  [${i + 1}/${rawCards.length}] ${nameFromParam || raw.nameParam}`);

    let nombre = nameFromParam;
    let desc = descHint;
    let categoria = null;
    let tarjetas = null;

    // Try to enrich from detail page
    const extra = await enrichBenefit(subPage, raw.href);
    if (extra.nombre) nombre = extra.nombre;
    if (extra.desc && (!desc || extra.desc.length > desc.length)) desc = extra.desc;
    if (extra.categoria) categoria = extra.categoria;
    if (extra.tarjetas) tarjetas = extra.tarjetas;

    if (!nombre) nombre = nameFromParam;

    benefits.push({
      nombre,
      pctMax,
      url: raw.href,
      categoria,
      tarjetas,
      vigencia,
      desc,
    });

    await sleep(DELAY_MS);
  }

  await subPage.close();
  await page.close();

  const CAT_LABELS = {
    gastronomia: 'Gastronomía', restaurantes: 'Gastronomía',
    moda: 'Moda', vestimenta: 'Moda',
    hogar: 'Hogar', electrodomesticos: 'Hogar',
    salud: 'Salud', farmacia: 'Salud', estetica: 'Salud',
    turismo: 'Viajes', viajes: 'Viajes',
    tecnologia: 'Tecnología', electronica: 'Tecnología',
    entretenimiento: 'Entretenimiento', espectaculos: 'Entretenimiento',
    educacion: 'Educación', libreria: 'Librerías',
    deportes: 'Deportes', supermercados: 'Supermercados',
    combustible: 'Combustible', automovil: 'Automóvil',
    joyeria: 'Joyerías', optica: 'Salud',
  };

  const mapped = benefits.map(b => {
    const raw = (b.categoria || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
    const catLabel = Object.entries(CAT_LABELS).find(([k]) => raw.includes(k))?.[1] || b.categoria || null;
    return { ...b, categoria: catLabel };
  });

  const out = {
    fuente: 'OCA',
    actualizado: new Date().toISOString().slice(0, 10),
    beneficios: mapped,
  };

  const outPath = path.join(__dirname, '..', 'data', 'beneficios-oca.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n[OCA] ✓ ${mapped.length} beneficios escritos en ${outPath}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const useHeadless = !HAS_DISPLAY;
  console.log(`[OCA] Chrome: ${CHROME_PATH} | headless: ${useHeadless} | DISPLAY: ${process.env.DISPLAY || 'none'}`);

  const browser = await puppeteer.launch({
    headless: useHeadless,
    executablePath: CHROME_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--window-size=1366,900',
    ],
  });

  try {
    if (DIAG_MODE) {
      await diagMode(browser);
    } else {
      await prodMode(browser);
    }
  } finally {
    await browser.close();
  }
})();
