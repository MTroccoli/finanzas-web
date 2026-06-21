// Scraper de beneficios OCA Uruguay para FinPro — v2 (non-headless + Xvfb).
//
// Modo diag  (--diag): guarda HTML de hub + sub-páginas como artifacts, no escribe JSON.
// Modo prod  (default): extrae beneficios y escribe data/beneficios-oca.json
//
// Requiere: DISPLAY=:99 (Xvfb) + CHROME_PATH=/usr/bin/google-chrome en CI.
// Salida: data/beneficios-oca.json
// { fuente:"OCA", actualizado:"YYYY-MM-DD", beneficios:[...] }

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

// Candidatos de URL: se prueban en orden, se usa el primero con contenido real
const HUB_CANDIDATES = [
  'https://www.oca.com.uy/beneficios',
  'https://www.oca.com.uy/promociones',
  'https://www.oca.com.uy/descuentos-y-beneficios',
  'https://www.oca.com.uy/personas/beneficios',
  'https://www.oca.com.uy/personas/promociones',
  'https://www.oca.com.uy/',
];
const ORIGIN = 'https://www.oca.com.uy';
const UA     = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DIAG_MODE   = process.argv.includes('--diag');
const DELAY_MS    = 800;
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
  // Wait extra for JS WAF challenges to complete
  await sleep(3000);
  return resp ? resp.status() : null;
}

// Returns true if the page is a WAF rejection (Imperva "Request Rejected")
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

// Scan a loaded page for links that look like beneficios/descuentos pages
async function findBenefLinks(page) {
  return page.evaluate((origin) => {
    const results = [];
    const seen = new Set();
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      const full = href.startsWith('/') ? origin + href : (href.startsWith('http') ? href : null);
      if (!full || seen.has(full)) return;
      if (/benefic|descuent|promo|oferta/i.test(href)) {
        seen.add(full);
        const txt = (a.textContent || '').trim().replace(/\s+/g, ' ');
        results.push({ url: full, txt });
      }
    });
    return results;
  }, ORIGIN);
}

// ── Diagnóstico ───────────────────────────────────────────────────────────────
async function diagMode(browser) {
  const page = await newPage(browser);
  let hubUrl = null;

  console.log('\n[DIAG] Probando URLs candidatas…');
  for (const url of HUB_CANDIDATES) {
    console.log(`  GET ${url}`);
    try {
      const status = await goto(page, url);
      const title  = await page.title().catch(() => '');
      const blocked = await isWafBlocked(page);
      console.log(`  → status ${status} | title: "${title}" | waf-blocked: ${blocked}`);
      if (status && status < 400 && !blocked) { hubUrl = url; break; }
    } catch (e) {
      console.log(`  → ERROR: ${e.message}`);
    }
  }

  if (!hubUrl) {
    console.log('[DIAG] Todas las URLs bloqueadas o con error.');
    console.log('[DIAG] Guardando HTML del último intento…');
    const html = await page.content().catch(() => '');
    saveHtml('hub', html);
    const texto = await page.evaluate(() => document.body?.innerText?.slice(0, 5000) || '').catch(() => '');
    const txtFile = path.join(__dirname, 'output', 'oca-hub-text.txt');
    fs.writeFileSync(txtFile, texto);
    console.log(`[DIAG] Texto visible → ${txtFile}`);
    await page.close();
    return;
  }

  console.log(`\n[DIAG] URL activa: ${hubUrl}`);

  // If it's the homepage, look for links to beneficios pages
  if (hubUrl === ORIGIN + '/' || hubUrl === ORIGIN) {
    const links = await findBenefLinks(page);
    console.log('\n[DIAG] Links de beneficios encontrados en homepage:');
    links.forEach(l => console.log(`  "${l.txt}" → ${l.url}`));
  }

  await scrollToEnd(page);

  const html = await page.content();
  saveHtml('hub', html);

  const estructura = await page.evaluate(() => {
    const clases = new Set();
    document.querySelectorAll('[class]').forEach(el => {
      (el.className || '').split(/\s+/).forEach(c => {
        if (c && /benefic|descuent|promo|card|item|oferta|tarjeta|categ/i.test(c))
          clases.add(c);
      });
    });

    const candidatos = [
      'article', '.card', '.benefit', '.beneficio', '.promo',
      '[class*="card"]', '[class*="beneficio"]', '[class*="item"]',
      '[class*="promo"]', '[class*="oferta"]',
    ];
    const counts = {};
    candidatos.forEach(sel => {
      try { counts[sel] = document.querySelectorAll(sel).length; } catch(e) {}
    });

    const links = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const txt = (a.textContent || '').trim().replace(/\s+/g, ' ');
      if (txt.length > 3 && txt.length < 80 && links.length < 25)
        links.push({ href: a.getAttribute('href'), txt });
    });

    const ids = [];
    document.querySelectorAll('[id]').forEach(el => {
      if (/benefic|descuent|promo|categ|card|oferta/i.test(el.id)) ids.push(el.id);
    });

    return { clases: [...clases].sort(), counts, links, ids };
  });

  console.log('\n[DIAG] Clases CSS relevantes encontradas:');
  console.log(' ', estructura.clases.join(', ') || '(ninguna)');

  console.log('\n[DIAG] Conteo de elementos candidatos:');
  Object.entries(estructura.counts).forEach(([sel, n]) => n > 0 && console.log(`  ${sel}: ${n}`));

  console.log('\n[DIAG] IDs relevantes:', estructura.ids.join(', ') || '(ninguno)');

  console.log('\n[DIAG] Primeros links:');
  estructura.links.forEach(l => console.log(`  "${l.txt}" → ${l.href}`));

  const texto = await page.evaluate(() => document.body?.innerText?.slice(0, 5000) || '');
  const txtFile = path.join(__dirname, 'output', 'oca-hub-text.txt');
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  fs.writeFileSync(txtFile, texto);
  console.log(`\n[DIAG] Texto visible (primeros 5000 chars) → ${txtFile}`);

  await page.close();
}

// ── Extracción de cards del hub ───────────────────────────────────────────────
async function extractCards(page) {
  await page.evaluate(() => {
    ['[content-visibility]', '[class*="card"]', '[class*="item"]', '[class*="beneficio"]']
      .forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => {
            el.style.contentVisibility = 'visible';
          });
        } catch(e) {}
      });
  });
  await sleep(500);

  return await page.evaluate((origin) => {
    const results = [];
    const seen = new Set();

    const CARD_SELS = [
      '.beneficio-item', '.benefit-card', '.card-beneficio', '.promo-card',
      '[class*="beneficio"]', '[class*="benefit"]', '[class*="promo-item"]',
      'article.card', '.oferta-item', '[class*="oferta"]', '[class*="descuento"]',
    ];

    let cards = [];
    for (const sel of CARD_SELS) {
      const found = [...document.querySelectorAll(sel)];
      if (found.length > cards.length) cards = found;
    }

    if (cards.length === 0) {
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (/beneficio|descuento|promo|oferta/i.test(href)) {
          const nombre = (a.textContent || a.querySelector('img')?.alt || '').trim().replace(/\s+/g, ' ');
          if (!nombre || seen.has(nombre)) return;
          seen.add(nombre);
          let url = href;
          if (url.startsWith('/')) url = origin + url;
          if (url.startsWith('//')) url = 'https:' + url;
          const pctMatch = nombre.match(/(\d{1,3})\s*%/);
          results.push({ nombre, pctMax: pctMatch ? parseInt(pctMatch[1]) : null, url, categoria: null, tarjetas: null, vigencia: null, desc: null });
        }
      });
      return results;
    }

    cards.forEach(card => {
      const anchor = card.querySelector('a[href]');
      const imgEl  = card.querySelector('img');
      const nombre = (imgEl?.alt || card.querySelector('h2,h3,h4,.title,.nombre,.comercio')?.textContent || '').trim().replace(/\s+/g, ' ');
      if (!nombre || nombre.length < 2 || seen.has(nombre)) return;
      seen.add(nombre);

      let url = anchor ? anchor.getAttribute('href') : null;
      if (url && url.startsWith('/')) url = origin + url;
      if (url && url.startsWith('//')) url = 'https:' + url;

      const texto = (card.textContent || '').replace(/\s+/g, ' ').trim();
      const pctMatch = texto.match(/(\d{1,3})\s*%/);

      let categoria = null;
      if (url) {
        try {
          const parts = new URL(url).pathname.split('/').filter(Boolean);
          if (parts.length >= 2) categoria = parts[parts.length - 2];
        } catch(e) {}
      }

      results.push({ nombre, pctMax: pctMatch ? parseInt(pctMatch[1]) : null, url: url || null, categoria, tarjetas: null, vigencia: null, desc: null });
    });

    return results;
  }, ORIGIN);
}

// ── Enriquecimiento desde sub-página ─────────────────────────────────────────
async function enrichFromSubPage(page, url) {
  try {
    const status = await goto(page, url);
    if (!status || status >= 400 || await isWafBlocked(page)) return {};
    await scrollToEnd(page);

    return await page.evaluate(() => {
      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(Boolean);

      const stopPats = /también te puede interesar|otros beneficios|ver más beneficios/i;
      const stopIdx = lines.findIndex(l => stopPats.test(l));
      const relevant = stopIdx > 0 ? lines.slice(0, stopIdx) : lines;

      const vigPat  = /todos los d[ií]as|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|vigencia|hasta el|válido/i;
      const vigLines = relevant.filter(l => vigPat.test(l));
      const vigencia = vigLines[0] || null;

      const tarjPat  = /visa|mastercard|american express|amex|oca\s|tarjeta|crédito|débito|gold|platinum|black|infinite|classic/i;
      const tarjLines = relevant.filter(l => tarjPat.test(l) && l.length < 200);
      const tarjeta  = tarjLines[0] || null;

      const skipPat  = /menú|inicio|home|beneficios|descuentos|buscar|carrito/i;
      const descLine = relevant.find(l =>
        l.length > 15 && l.length < 300 &&
        !vigPat.test(l) && !tarjPat.test(l) && !skipPat.test(l)
      );

      const pctMatch = relevant.join(' ').match(/(\d{1,3})\s*%/);

      return {
        tarjetas: tarjeta,
        vigencia: vigencia ? vigencia.replace(/^vigencia:\s*/i, '') : null,
        desc:     descLine || null,
        pctFromSub: pctMatch ? parseInt(pctMatch[1]) : null,
      };
    });
  } catch(e) {
    console.log(`  ⚠ sub-page error: ${e.message}`);
    return {};
  }
}

// ── Producción ────────────────────────────────────────────────────────────────
async function prodMode(browser) {
  const page = await newPage(browser);
  let hubUrl = null;

  for (const url of HUB_CANDIDATES) {
    try {
      const status = await goto(page, url);
      const blocked = await isWafBlocked(page);
      if (status && status < 400 && !blocked) { hubUrl = url; break; }
      if (status && status < 400 && !blocked && url.includes(ORIGIN)) { hubUrl = url; break; }
    } catch(e) {}
  }

  if (!hubUrl) {
    console.error('[ERROR] No se pudo cargar ninguna URL de OCA (WAF bloqueó todo). Abortando.');
    await page.close();
    return;
  }

  console.log(`[OCA] Hub: ${hubUrl}`);

  // If we landed on homepage, try to navigate to beneficios from there
  if (hubUrl === ORIGIN + '/' || hubUrl === ORIGIN) {
    const links = await findBenefLinks(page);
    if (links.length > 0) {
      console.log(`[OCA] Navegando a beneficios desde homepage: ${links[0].url}`);
      const status = await goto(page, links[0].url);
      const blocked = await isWafBlocked(page);
      if (status < 400 && !blocked) hubUrl = links[0].url;
    }
  }

  await scrollToEnd(page);

  // Click category tabs to expand all
  await page.evaluate(async () => {
    const tabs = document.querySelectorAll('[class*="categ"] a, [class*="tab"] a, .categoria, .filtro');
    for (const tab of tabs) {
      tab.click();
      await new Promise(r => setTimeout(r, 400));
    }
  });
  await sleep(1000);
  await scrollToEnd(page);

  let cards = await extractCards(page);
  console.log(`[OCA] Cards extraídas del hub: ${cards.length}`);

  if (cards.length === 0) {
    console.log('[OCA] Sin cards. Guardando HTML de diagnóstico…');
    saveHtml('hub-prod', await page.content());
    await page.close();
    return;
  }

  const subPage = await newPage(browser);
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (!c.url) continue;
    console.log(`  [${i + 1}/${cards.length}] ${c.nombre}`);
    const extra = await enrichFromSubPage(subPage, c.url);
    if (extra.tarjetas)   c.tarjetas = extra.tarjetas;
    if (extra.vigencia)   c.vigencia = extra.vigencia;
    if (extra.desc)       c.desc = extra.desc;
    if (extra.pctFromSub && !c.pctMax) c.pctMax = extra.pctFromSub;
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

  cards = cards.map(c => {
    const raw = (c.categoria || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
    const catLabel = Object.entries(CAT_LABELS).find(([k]) => raw.includes(k))?.[1] || c.categoria || null;
    return { ...c, categoria: catLabel };
  });

  const out = {
    fuente: 'OCA',
    actualizado: new Date().toISOString().slice(0, 10),
    beneficios: cards,
  };

  const outPath = path.join(__dirname, '..', 'data', 'beneficios-oca.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n[OCA] ✓ ${cards.length} beneficios escritos en ${outPath}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  // Use non-headless + real Chrome when DISPLAY is set (CI with Xvfb)
  // Fall back to headless:new for local development without DISPLAY
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
