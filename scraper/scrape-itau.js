// Scraper de beneficios Itaú Uruguay para FinPro — v2.
//
// Diagnóstico confirmó que la estructura es distinta a BBVA/Santander:
//  - Hub: /inst/beneficios.html → 142 cards directamente, sin páginas de detalle.
//  - Secundario: /inst/beneficiosexclusivos.html → beneficios exclusivos.
//  - Los links internos no siguen patrón /inst/beneficios/<slug>.html.
//  - Estrategia: parsear las cards del hub sin visitar sub-páginas.
//
// Salida: data/beneficios-itau.json

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

const HUBS = [
  { url: 'https://www.itau.com.uy/inst/beneficios.html',           exclusivo: false },
  { url: 'https://www.itau.com.uy/inst/beneficiosexclusivos.html', exclusivo: true  },
];
const ORIGIN = 'https://www.itau.com.uy';
const UA     = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DIAG_MODE = process.argv.includes('--diag');
const DELAY_MS  = 600;
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

// ── Parsear cards directamente del hub ───────────────────────────────────────
async function parseHub(page, hubUrl, exclusivo) {
  const status = await goto(page, hubUrl);
  console.log(`Hub ${hubUrl} → status: ${status}`);
  if (status !== 200 && status !== 304) return [];

  const html = await page.content();
  if (DIAG_MODE) {
    const slug = hubUrl.split('/').pop().replace('.html', '');
    saveHtml(`itau-${slug}`, html);
  }

  const isExclusivos = hubUrl.includes('exclusivos');

  // Esperar al selector correcto según la página
  try {
    const sel = isExclusivos ? 'h2.font-bold.font-display' : '[class*="card"], article';
    await page.waitForSelector(sel, { timeout: 5000 });
  } catch (_) {}

  const cards = await page.evaluate((excl, isExcl) => {
    const out = [];
    const seen = new Set();

    if (isExcl) {
      // beneficiosexclusivos.html: estructura confirmada por diagnóstico
      // Hay 3 secciones: H2 (categoría) → DIV.font-display.mb-8 (descuento) → DIV.grid (logos-imagen)
      // Hay 2 layouts (desktop visible + mobile .hidden) — excluimos el .hidden
      const h2Els = [...document.querySelectorAll('h2.font-bold.font-display')]
        .filter(el => !el.closest('.hidden') && !el.closest('nav, header, footer'));

      h2Els.forEach(h2 => {
        const nombre = (h2.innerText || '').replace(/\s+/g, ' ').trim();
        if (!nombre || nombre.length < 3) return;

        // Skip deal descriptions mistakenly captured as H2 (not a commerce name)
        if (/^\d+%/i.test(nombre.trim())) return;

        const key = nombre.toLowerCase().slice(0, 60);
        if (seen.has(key)) return;
        seen.add(key);

        // Buscar el siguiente hermano .font-display.mb-8 para info del descuento
        let discText = '';
        let sib = h2.nextElementSibling;
        while (sib && !discText) {
          if ([...sib.classList].includes('font-display') && [...sib.classList].includes('mb-8')) {
            discText = (sib.innerText || '').replace(/\s+/g, ' ').trim();
          }
          sib = sib.nextElementSibling;
        }

        const pctMatches = [...(discText || nombre).matchAll(/(\d{1,3})\s*%/g)]
          .map(m => parseInt(m[1], 10)).filter(n => n > 0 && n <= 70);
        const pctMax = pctMatches.length ? Math.max(...pctMatches) : null;

        const tarjLine = discText.split(/[\n|]/).map(l => l.trim()).find(l =>
          /tarjeta|cr[eé]dito|d[eé]bito|platinum|infinite|black|personal/i.test(l)
          && l.length < 200);

        if (!pctMax) return; // descartar H2s sin descuento (otras secciones de la página)
        out.push({ nombre, pctMax, tarjetas: tarjLine || null, vigencia: null, url: null, exclusivo: excl });
      });

      return out;
    }

    // beneficios.html: selector confirmado .card.-item (19 cards)
    const cardEls = [...document.querySelectorAll('.card.-item')];

    cardEls.forEach(el => {
      const fullText = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (fullText.length < 10) return;

      // Título desde .card-title (guardado completo como desc)
      const titleEl = el.querySelector('.card-title, [class*="card-title"]');
      let titulo = (titleEl?.innerText || fullText).replace(/\s+/g, ' ').trim();
      titulo = titulo.replace(/\s+ver\s+m[aá]s\s*$/i, '').trim().slice(0, 120);
      if (!titulo || titulo.length < 5) return;

      // Extraer nombre real del comercio del patrón "menos en [Comercio]"
      // El título completo queda como desc para mostrar en el detalle
      let nombre = titulo;
      // Handles both "menos en X" and "menos y N cuotas en X"
      const menosEnM = titulo.match(/menos(?:\s+y\s+\d+\s+cuotas?)?\s+en\s+(.+)/i);
      const milasM   = !menosEnM && titulo.match(/^(?:Millas?)[^e]+\ben\s+(.+)$/i);
      if (menosEnM) {
        let c = menosEnM[1]
          .replace(/\s+en\s+(?:bebidas?|todas?|los\s|las\s|el\s|la\s).*$/i, '')
          .replace(/\s+y\s+\d+\s+cuotas.*/i, '')
          .trim();
        // "la compra de X" → product deal, not a store name (iPlace already covered separately)
        if (/^la\s+(compra|adquisici[oó]n)\s+de\s+/i.test(c)) return;
        if (c.length >= 3 && c.length <= 60) nombre = c;
      } else if (milasM) {
        nombre = milasM[1].trim().slice(0, 60);
      }

      // Skip when nombre is still the full title and looks like a deal description
      if (nombre === titulo && /^\d+%/i.test(titulo.trim())) return;

      // Skip generic category names — not actionable without a specific commerce
      const GENERIC_CATS = ['moda', 'restaurantes', 'gastronomia', 'gastronomía', 'turismo', 'salud', 'deporte'];
      if (GENERIC_CATS.some(g => nombre.toLowerCase() === g)) return;

      const key = nombre.toLowerCase().slice(0, 60);
      if (seen.has(key)) return;
      seen.add(key);

      // Porcentaje
      const pctMatches = [...fullText.matchAll(/(\d{1,3})\s*%/g)]
        .map(m => parseInt(m[1], 10)).filter(n => n > 0 && n <= 70);
      const pctMax = pctMatches.length ? Math.max(...pctMatches) : null;

      // Link
      const anchor = el.querySelector('.card-link, a[href]') || (el.tagName === 'A' ? el : null);
      const url = anchor?.href || null;

      // Tarjetas mencionadas
      const lines = fullText.split(/[\n|]/).map(l => l.trim()).filter(Boolean);
      const tarjLine = lines.find(l =>
        /tarjeta|cr[eé]dito|d[eé]bito|platinum|infinite|black|personal/i.test(l)
        && l.length < 200 && !/(art\.|ley)/i.test(l)
      );

      // Vigencia
      const vigLine = lines.find(l => /vigencia|v[aá]lid[ao]|hasta el/i.test(l) && l.length < 100);

      out.push({ nombre, desc: titulo, pctMax, tarjetas: tarjLine || null, vigencia: vigLine || null, url, exclusivo: excl });
    });

    return out;
  }, exclusivo, isExclusivos);

  console.log(`  ${cards.length} cards extraídas`);

  if (DIAG_MODE && cards.length > 0) {
    console.log('\n  Muestra primeras 5 cards:');
    cards.slice(0, 5).forEach((c, i) =>
      console.log(`  [${i+1}] "${c.nombre}"  pct=${c.pctMax}  tarj="${c.tarjetas?.slice(0,50)}"  url=${c.url}`));
  }

  return cards;
}

// ── Diagnóstico extra: volcar clases y estructura de cards ───────────────────
async function diagCardClasses(page, url) {
  await goto(page, url);
  const info = await page.evaluate(() => {
    const classGroups = {};
    document.querySelectorAll('[class*="card"], [class*="benefit"], [class*="promo"], article, li').forEach(el => {
      const cls = [...el.classList].join('.');
      if (!cls) return;
      classGroups[cls] = (classGroups[cls] || 0) + 1;
    });
    return Object.entries(classGroups)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([cls, n]) => `${n}x  .${cls}`);
  });
  console.log(`\nClases frecuentes en ${url}:`);
  info.forEach(l => console.log(`  ${l}`));

  // Muestra el innerText de los primeros elementos con texto sustancial
  const samples = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('li, article, [class*="item"], [class*="benefit"], [class*="promo"], p, h1, h2, h3, h4, [class*="text-muted"], [class*="title"], [class*="desc"]')]
      .filter(el => (el.innerText || '').trim().length > 20 && (el.innerText || '').trim().length < 400
        && !el.closest('nav, header, footer'));
    return candidates.slice(0, 8).map(el => ({
      tag: el.tagName,
      cls: [...el.classList].join('.'),
      parent: [...(el.parentElement?.classList || [])].join('.'),
      txt: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 250),
    }));
  });
  console.log('\n  Muestra elementos de contenido (excluyendo nav/header/footer):');
  samples.forEach((s, i) => console.log(`  [${i+1}] <${s.tag}>.${s.cls} (padre:.${s.parent})\n      "${s.txt}"`));

  // Dump crudo de cards .font-display.mb-8 y sus padres (para exclusivos)
  if (url.includes('exclusivos')) {
    const rawCards = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.font-display.mb-8')];
      return cards.slice(0, 4).map((el, i) => {
        const parent = el.parentElement;
        const grandParent = parent?.parentElement;
        const parentChildren = [...(parent?.children || [])].map(c => ({
          tag: c.tagName,
          cls: [...c.classList].join('.'),
          txt: (c.innerText || '').trim().slice(0, 150),
        }));
        return {
          i,
          cls: [...el.classList].join('.'),
          parentCls: [...(parent?.classList || [])].join('.'),
          parentTxt: (parent?.innerText || '').slice(0, 400),
          grandParentCls: [...(grandParent?.classList || [])].join('.'),
          parentChildren,
        };
      });
    });
    console.log('\n  === Dump padre de .font-display.mb-8 ===');
    rawCards.forEach(c => {
      console.log(`\n  [${c.i}] .${c.cls} → padre:.${c.parentCls} (abuelo:.${c.grandParentCls})`);
      console.log(`    parentText: ${JSON.stringify(c.parentTxt.slice(0, 300))}`);
      c.parentChildren.forEach((ch, j) =>
        console.log(`    hermano[${j}] <${ch.tag}>.${ch.cls} → "${ch.txt}"`));
    });

    // Dump .text-muted.text-center
    const mutedEls = await page.evaluate(() =>
      [...document.querySelectorAll('.text-muted.text-center')].map(el => ({
        cls: [...el.classList].join('.'),
        parentCls: [...(el.parentElement?.classList || [])].join('.'),
        txt: (el.innerText || '').trim().slice(0, 200),
      }))
    );
    console.log('\n  === .text-muted.text-center (6 elementos) ===');
    mutedEls.forEach((e, i) => console.log(`  [${i}] padre:.${e.parentCls}\n      "${e.txt}"`));
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox',
           '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  const page = await newPage(browser);

  if (DIAG_MODE) {
    console.log('=== MODO DIAGNÓSTICO v2 ===\n');
    for (const hub of HUBS) {
      await diagCardClasses(page, hub.url);
      await sleep(DELAY_MS);
    }
    for (const hub of HUBS) {
      console.log(`\n=== Hub: ${hub.url} ===`);
      await parseHub(page, hub.url, hub.exclusivo);
      await sleep(DELAY_MS);
    }
    await browser.close();
    return;
  }

  // Modo producción
  console.log('=== Scraping beneficios Itaú Uruguay ===');
  const seen = new Set();
  const beneficios = [];

  for (const hub of HUBS) {
    console.log(`\nHub: ${hub.url}`);
    const cards = await parseHub(page, hub.url, hub.exclusivo);
    for (const c of cards) {
      const key = c.nombre.toLowerCase().slice(0, 50);
      if (seen.has(key)) continue;
      seen.add(key);
      beneficios.push({
        nombre:    c.nombre,
        url:       c.url,
        categoria: c.categoria,
        pctMax:    c.pctMax,
        descuentos: c.pctMax ? [{ pct: c.pctMax, texto: `${c.pctMax}%` }] : [],
        vigencia:  c.vigencia,
        tarjetas:  c.tarjetas,
        desc:      c.desc,
        exclusivo: c.exclusivo,
      });
    }
    await sleep(DELAY_MS);
  }

  await browser.close();

  const payload = {
    fuente: 'itau.com.uy',
    actualizado: new Date().toISOString(),
    total: beneficios.length,
    beneficios,
  };

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'beneficios-itau.json'), JSON.stringify(payload, null, 2));

  console.log(`\n✓ data/beneficios-itau.json — ${beneficios.length} beneficios`);
  beneficios.slice(0, 5).forEach(b =>
    console.log(`  • [${b.categoria || '?'}] ${b.nombre} — ${b.pctMax ?? '?'}%`));
})();
