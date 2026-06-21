// Scraper de beneficios OCA Uruguay para FinPro — v1 (diagnóstico).
//
// Modo diag  (--diag): guarda HTML de hub + sub-páginas como artifacts, no escribe JSON.
// Modo prod  (default): extrae beneficios y escribe data/beneficios-oca.json
//
// Salida: data/beneficios-oca.json
// { fuente:"OCA", actualizado:"YYYY-MM-DD", beneficios:[...] }

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

// Candidatos de URL — el scraper prueba cada uno y usa el primero que carga (status 200)
const HUB_CANDIDATES = [
  'https://www.oca.com.uy/beneficios',
  'https://www.oca.com.uy/descuentos-y-beneficios',
  'https://www.oca.com.uy/personas/beneficios',
  'https://www.oca.com.uy/promociones',
  'https://www.oca.com.uy',
];
const ORIGIN = 'https://www.oca.com.uy';
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
    if (t === 'font' || t === 'media') req.abort();
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
  const file = path.join(dir, `oca-${name}.html`);
  fs.writeFileSync(file, html);
  console.log(`  → ${file} (${(html.length / 1024).toFixed(1)} KB)`);
}

async function scrollToEnd(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let last = document.body.scrollHeight;
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

// ── Diagnóstico: detectar URL correcta e imprimir estructura ─────────────────
async function diagMode(browser) {
  const page = await newPage(browser);
  let hubUrl = null;

  console.log('\n[DIAG] Probando URLs candidatas…');
  for (const url of HUB_CANDIDATES) {
    console.log(`  GET ${url}`);
    try {
      const status = await goto(page, url);
      console.log(`  → status ${status} | title: ${await page.title()}`);
      if (status && status < 400) { hubUrl = url; break; }
    } catch (e) {
      console.log(`  → ERROR: ${e.message}`);
    }
  }

  if (!hubUrl) {
    console.log('[DIAG] Ninguna URL candidata respondió correctamente.');
    console.log('[DIAG] Guardando HTML del último intento de todas formas…');
    hubUrl = HUB_CANDIDATES[0];
  }

  console.log(`\n[DIAG] URL activa: ${hubUrl}`);
  await scrollToEnd(page);

  const html = await page.content();
  saveHtml('hub', html);

  // Imprimir estructura: tags únicos, clases relevantes
  const estructura = await page.evaluate(() => {
    const clases = new Set();
    document.querySelectorAll('[class]').forEach(el => {
      (el.className || '').split(/\s+/).forEach(c => {
        if (c && /benefic|descuent|promo|card|item|oferta|tarjeta|categ/i.test(c))
          clases.add(c);
      });
    });

    // Contar posibles cards de beneficios
    const candidatos = [
      'article', '.card', '.benefit', '.beneficio', '.promo',
      '[class*="card"]', '[class*="beneficio"]', '[class*="item"]',
    ];
    const counts = {};
    candidatos.forEach(sel => {
      try { counts[sel] = document.querySelectorAll(sel).length; } catch(e) {}
    });

    // Primeras 5 anchor tags con texto sustancial
    const links = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const txt = (a.textContent || '').trim().replace(/\s+/g, ' ');
      if (txt.length > 3 && txt.length < 80 && links.length < 20)
        links.push({ href: a.getAttribute('href'), txt });
    });

    // IDs de secciones
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
  estructura.links.slice(0, 15).forEach(l => console.log(`  "${l.txt}" → ${l.href}`));

  // Guardar también texto visible para inspección manual
  const texto = await page.evaluate(() => document.body.innerText.slice(0, 5000));
  const txtFile = path.join(__dirname, 'output', 'oca-hub-text.txt');
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  fs.writeFileSync(txtFile, texto);
  console.log(`\n[DIAG] Texto visible (primeros 5000 chars) → ${txtFile}`);

  await page.close();
}

// ── Extracción de cards del hub ───────────────────────────────────────────────
// NOTA: Esta función se completará después del diagnóstico cuando conozcamos
//       los selectores reales de OCA.
async function extractCards(page) {
  // Forzar render de elementos con content-visibility:auto
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

    // Selectores candidatos — se expanden en v2 una vez conocida la estructura real
    const CARD_SELS = [
      '.beneficio-item', '.benefit-card', '.card-beneficio', '.promo-card',
      '[class*="beneficio"]', '[class*="benefit"]', '[class*="promo-item"]',
      'article.card', '.oferta-item',
    ];

    let cards = [];
    for (const sel of CARD_SELS) {
      const found = [...document.querySelectorAll(sel)];
      if (found.length > cards.length) cards = found;
    }

    if (cards.length === 0) {
      // Fallback: buscar todos los <a> que parezcan links de beneficios
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
      const pctMax = pctMatch ? parseInt(pctMatch[1]) : null;

      // Categoría desde la URL de la card
      let categoria = null;
      if (url) {
        try {
          const parts = new URL(url).pathname.split('/').filter(Boolean);
          if (parts.length >= 2) categoria = parts[parts.length - 2];
        } catch(e) {}
      }

      results.push({ nombre, pctMax, url: url || null, categoria, tarjetas: null, vigencia: null, desc: null });
    });

    return results;
  }, ORIGIN);
}

// ── Enriquecimiento desde sub-página ─────────────────────────────────────────
async function enrichFromSubPage(page, url) {
  try {
    const status = await goto(page, url);
    if (!status || status >= 400) return {};
    await scrollToEnd(page);

    return await page.evaluate(() => {
      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(Boolean);

      // Cortar en "También te puede interesar" o "Otros beneficios"
      const stopPats = /también te puede interesar|otros beneficios|ver más beneficios/i;
      const stopIdx = lines.findIndex(l => stopPats.test(l));
      const relevant = stopIdx > 0 ? lines.slice(0, stopIdx) : lines;

      // Vigencia: líneas con días o fechas
      const vigPat = /todos los d[ií]as|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|vigencia|hasta el|válido/i;
      const vigLines = relevant.filter(l => vigPat.test(l));
      const vigencia = vigLines[0] || null;

      // Tarjetas: líneas con tipo de tarjeta
      const tarjPat = /visa|mastercard|american express|amex|oca\s|tarjeta|crédito|débito|gold|platinum|black|infinite|classic/i;
      const tarjLines = relevant.filter(l => tarjPat.test(l) && l.length < 200);
      const tarjeta = tarjLines[0] || null;

      // Descripción: primera línea de contenido sustancial (no título, no vigencia, no tarjeta)
      const skipPat = /menú|inicio|home|beneficios|descuentos|buscar|carrito/i;
      const descLine = relevant.find(l =>
        l.length > 15 && l.length < 300 &&
        !vigPat.test(l) && !tarjPat.test(l) && !skipPat.test(l)
      );

      // Porcentaje desde subpágina (más preciso que el hub)
      const pctMatch = relevant.join(' ').match(/(\d{1,3})\s*%/);

      return {
        tarjetas: tarjeta,
        vigencia: vigencia ? vigencia.replace(/^vigencia:\s*/i, '') : null,
        desc: descLine || null,
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

  // Detectar URL correcta
  for (const url of HUB_CANDIDATES) {
    try {
      const status = await goto(page, url);
      if (status && status < 400) { hubUrl = url; break; }
    } catch(e) {}
  }

  if (!hubUrl) {
    console.error('[ERROR] No se pudo cargar ninguna URL de OCA. Abortando.');
    await page.close();
    return;
  }

  console.log(`[OCA] Hub: ${hubUrl}`);
  await scrollToEnd(page);

  // Intentar expandir categorías si hay filtros/tabs
  await page.evaluate(async () => {
    // Click en todas las categorías/tabs visibles
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

  // Enriquecer con sub-páginas
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

  // Limpiar categoria (slug → legible)
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
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
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
