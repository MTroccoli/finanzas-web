// Scraper de beneficios BBVA Uruguay para FinPro — v2 (listados + detalle).
//
// BBVA sirve 403 a fetch/curl simples (anti-bot tipo Akamai); usamos
// Puppeteer + stealth para simular un navegador real.
//
// Estructura confirmada por las corridas diagnósticas:
//  - Categorías: links <a href="/.../descuentos/<slug>.html"> en la página hub.
//  - Listado por categoría: <article class="promocard__base"> con link al detalle.
//  - Paginación: <slug>.pag-N.html (links <a> reales).
//  - Detalle: labels semánticos "Vigencia:", "Descuentos:", "Local:" y líneas
//    "NN% Off con Tarjetas ...".
//
// Salida: data/beneficios.json estructurado para cruzar con el historial de gastos.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const { parseCardScope, parseBBVADescuento } = require('./lib/parse-card-scope');

const HUB = 'https://www.bbva.com.uy/personas/productos/tarjetas/descuentos.html';
const ORIGIN = 'https://www.bbva.com.uy';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MAX_PAGES_PER_CAT = 20;   // tope de seguridad
const DELAY_MS = 700;           // cortesía entre requests

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1366, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8' });
  // Bloquear recursos pesados para acelerar (imágenes, fuentes, media)
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (type === 'image' || type === 'font' || type === 'media') req.abort();
    else req.continue();
  });
  return page;
}

async function goto(page, url) {
  const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);
  return resp ? resp.status() : null;
}

// ── Descubre las URLs de categoría desde el hub ───────────────────────────────
async function discoverCategories(page) {
  await goto(page, HUB);
  const cats = await page.evaluate(() => {
    const set = {};
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      // categoría = /descuentos/<slug>.html  (un solo segmento, sin subcarpeta)
      const m = href.match(/\/personas\/productos\/tarjetas\/descuentos\/([^/]+)\.html$/);
      if (m && !/\.pag-/.test(href)) {
        const slug = m[1];
        set[slug] = (a.innerText || slug).replace(/\s+/g, ' ').trim();
      }
    });
    return set;
  });
  return cats; // { slug: nombreVisible }
}

// ── Recolecta los comercios (con link a detalle) de una categoría paginada ────
async function collectCategory(page, slug) {
  const merchants = [];
  for (let n = 1; n <= MAX_PAGES_PER_CAT; n++) {
    const url = n === 1
      ? `${ORIGIN}/personas/productos/tarjetas/descuentos/${slug}.html`
      : `${ORIGIN}/personas/productos/tarjetas/descuentos/${slug}.pag-${n}.html`;
    const status = await goto(page, url);
    if (status !== 200) break;

    const { rows, hasNext } = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('article.promocard__base')].map((a) => {
        const link = a.querySelector('a[href]');
        const parts = (a.innerText || '').replace(/\s+/g, ' ').trim()
          .replace(/\s*Quiero saber m[áa]s\s*$/i, '').split('·').map((s) => s.trim());
        // El innerText viene como "Categoría Descripción Nombre" sin separadores fiables;
        // nos quedamos con el texto completo y el href; el detalle aporta los campos finos.
        return {
          href: link ? link.href : null,
          listingText: (a.innerText || '').replace(/\s+/g, ' ').replace(/Quiero saber m[áa]s/i, '').trim(),
        };
      }).filter((r) => r.href);
      const hasNext = [...document.querySelectorAll('a')]
        .some((el) => /siguiente/i.test(el.innerText || ''));
      return { rows, hasNext };
    });

    merchants.push(...rows);
    console.log(`  [${slug}] pág ${n}: ${rows.length} comercios (hasNext=${hasNext})`);
    if (!hasNext || rows.length === 0) break;
    await sleep(DELAY_MS);
  }
  return merchants;
}

// ── Extrae los datos finos de una página de detalle ───────────────────────────
async function parseDetail(page, url) {
  const status = await goto(page, url);
  if (status !== 200) return null;

  return page.evaluate(() => {
    const lines = (document.body.innerText || '')
      .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

    const get = (label) => {
      const l = lines.find((x) => x.toLowerCase().startsWith(label.toLowerCase()));
      return l ? l.slice(label.length).replace(/^[:\s]+/, '').trim() : null;
    };

    const nombre = document.title.replace(/\s*\|\s*BBVA.*$/i, '').trim();
    const vigencia = get('Vigencia');

    // Descuentos: líneas "NN% Off con Tarjetas ..." (entre "Descuentos:" y siguiente label)
    const descuentos = [];
    let capt = false;
    for (const l of lines) {
      if (/^descuentos:?$/i.test(l)) { capt = true; continue; }
      if (capt) {
        if (/^(local|redes sociales|env[íi]os|ubicaci[óo]n|t[ée]rminos)/i.test(l)) break;
        const m = l.match(/^(\d{1,3})\s*%\s*Off\s+con\s+(.+)$/i);
        if (m) descuentos.push({ pct: parseInt(m[1], 10), tarjetas: m[2].trim(), texto: l });
        else if (descuentos.length && !/%/.test(l)) break;
      }
    }

    // Local / dirección
    const localIdx = lines.findIndex((l) => /^local:?$/i.test(l));
    const local = localIdx >= 0 && lines[localIdx + 1]
      ? lines[localIdx + 1].replace(/\s*\(ir\)\s*$/i, '').trim() : null;

    // Tope (de la letra chica)
    const topeLine = lines.find((l) => /tope/i.test(l) && /\d|sin/i.test(l) && l.length < 200);

    const pctMax = descuentos.length ? Math.max(...descuentos.map((d) => d.pct)) : null;

    return { nombre, vigencia, descuentos, pctMax, local, tope: topeLine || null };
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox',
           '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });

  const page = await newPage(browser);

  console.log('=== Descubriendo categorías ===');
  const cats = await discoverCategories(page);
  // Excluir "todos" (es el agregado) si aparece
  delete cats.todos;
  console.log('Categorías:', Object.keys(cats).join(', '));

  // 1. Recolectar comercios de todas las categorías
  const seen = new Set();
  const merchants = [];
  for (const [slug, nombre] of Object.entries(cats)) {
    console.log(`\n=== Categoría: ${nombre} (${slug}) ===`);
    const rows = await collectCategory(page, slug);
    for (const r of rows) {
      if (seen.has(r.href)) continue;
      seen.add(r.href);
      merchants.push({ categoria: nombre, slug, ...r });
    }
  }
  console.log(`\nTotal comercios únicos: ${merchants.length}`);

  // 2. Entrar a cada detalle
  const beneficios = [];
  let ok = 0, fail = 0;
  for (let i = 0; i < merchants.length; i++) {
    const m = merchants[i];
    try {
      const d = await parseDetail(page, m.href);
      if (d) {
        // Enriquecer cada descuento con isDebit + niveles
        const descuentos = (d.descuentos || []).map(desc => {
          const { isDebit, niveles } = parseBBVADescuento(desc.tarjetas);
          return { ...desc, isDebit, niveles };
        });
        const scope = parseCardScope('BBVA', { descuentos });
        beneficios.push({
          comercio: d.nombre || m.listingText,
          categoria: m.categoria,
          url: m.href,
          vigencia: d.vigencia,
          local: d.local,
          descuentos,
          pctMax: d.pctMax,
          tope: d.tope,
          red:        scope.red,
          niveles:    scope.niveles,
          cobranding: scope.cobranding,
        });
        ok++;
      } else { fail++; }
    } catch (e) {
      fail++;
      console.error(`  detalle ERROR (${m.href}): ${e.message}`);
    }
    if ((i + 1) % 25 === 0) console.log(`  ...detalle ${i + 1}/${merchants.length}`);
    await sleep(DELAY_MS);
  }

  await browser.close();

  const payload = {
    fuente: 'bbva.com.uy',
    actualizado: new Date().toISOString(),
    total: beneficios.length,
    categorias: Object.values(cats),
    beneficios,
  };

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'beneficios.json'), JSON.stringify(payload, null, 2));
  // Limpiar el raw diagnóstico viejo si existe
  const rawOld = path.join(dataDir, 'beneficios-bbva-raw.json');
  if (fs.existsSync(rawOld)) fs.unlinkSync(rawOld);

  console.log(`\n✓ data/beneficios.json — ${beneficios.length} beneficios (ok=${ok}, fail=${fail})`);
  // Muestra de control
  beneficios.slice(0, 5).forEach((b) =>
    console.log(`  • [${b.categoria}] ${b.comercio} — ${b.pctMax ?? '?'}% (${b.descuentos.length} desc.)`));
})();
