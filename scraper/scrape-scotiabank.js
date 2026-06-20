// Scraper de beneficios Scotiabank Uruguay para FinPro — v1.
//
// El sitio devuelve 403 a fetch/curl simples; se usa Puppeteer + stealth.
// URL hub: /Personas/Tarjetas/Beneficios/default
// Sub-páginas: /Personas/Tarjetas/Beneficios/{Categoria}/{slug}
//
// Salida: data/beneficios-scotiabank.json

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

const HUB    = 'https://www.scotiabank.com.uy/Personas/Tarjetas/Beneficios/default';
const ORIGIN = 'https://www.scotiabank.com.uy';
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

function slugToName(slug) {
  return slug.replace(/-+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

// ── Diagnóstico hub ───────────────────────────────────────────────────────────
async function diagHub(page) {
  const status = await goto(page, HUB);
  console.log(`Hub status: ${status}`);
  if (status !== 200 && status !== 304) { console.log('  ✗ No se pudo cargar el hub'); return; }

  const html = await page.content();
  saveHtml('scotiabank-hub', html);

  // Clases frecuentes
  const classGroups = await page.evaluate(() => {
    const counts = {};
    document.querySelectorAll('*').forEach(el => {
      [...el.classList].forEach(c => { counts[c] = (counts[c] || 0) + 1; });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([c, n]) => `${n}x  .${c}`);
  });
  console.log('\nClases más frecuentes:');
  classGroups.forEach(l => console.log('  ' + l));

  // Links a sub-páginas de beneficios
  const links = await page.evaluate((origin) => {
    return [...document.querySelectorAll('a[href]')]
      .map(a => a.href)
      .filter(h => h.includes('/Beneficios/') && !h.endsWith('/default') && !h.includes('#'))
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 20);
  }, ORIGIN);
  console.log(`\nLinks a sub-páginas (muestra 20 de ${links.length}):`);
  links.forEach(l => console.log('  ' + l));

  // Muestra de cards con texto relevante
  const cards = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('article, li, [class*="card"], [class*="benefit"], [class*="item"], [class*="promo"]')]
      .filter(el => {
        const t = (el.innerText || '').trim();
        return t.length > 15 && t.length < 500 && !el.closest('nav, header, footer, script');
      });
    return candidates.slice(0, 8).map(el => ({
      tag: el.tagName,
      cls: [...el.classList].join('.'),
      txt: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      links: [...el.querySelectorAll('a[href]')].map(a => a.href).slice(0, 3),
    }));
  });
  console.log('\nMuestra de cards/items:');
  cards.forEach((c, i) => {
    console.log(`  [${i+1}] <${c.tag}>.${c.cls}`);
    console.log(`       "${c.txt}"`);
    if (c.links.length) console.log(`       links: ${c.links.join(', ')}`);
  });

  // Muestra de elementos con %
  const pctEls = await page.evaluate(() => {
    return [...document.querySelectorAll('*')]
      .filter(el => {
        const t = (el.childNodes.length === 1 && el.firstChild.nodeType === 3)
          ? (el.innerText || '').trim()
          : '';
        return /^\d+\s*%/.test(t) && t.length < 20;
      })
      .slice(0, 10)
      .map(el => ({
        tag: el.tagName,
        cls: [...el.classList].join('.'),
        txt: (el.innerText || '').trim(),
        parentCls: [...(el.parentElement?.classList || [])].join('.'),
      }));
  });
  console.log('\nElementos con % (texto hoja):');
  pctEls.forEach((e, i) => console.log(`  [${i+1}] <${e.tag}>.${e.cls} (padre:.${e.parentCls}) → "${e.txt}"`));
}

// ── Diagnóstico sub-página ────────────────────────────────────────────────────
async function diagDetail(page, url) {
  console.log(`\nDiag sub-página: ${url}`);
  const status = await goto(page, url);
  console.log(`  status: ${status}`);
  if (status !== 200 && status !== 304) return;

  const html = await page.content();
  const slug = url.split('/').pop();
  saveHtml(`scotiabank-det-${slug}`, html);

  const info = await page.evaluate(() => {
    const title    = document.querySelector('title')?.textContent?.trim() || '';
    const ogTitle  = document.querySelector('meta[property="og:title"]')?.content?.trim() || '';
    const ogDesc   = document.querySelector('meta[property="og:description"]')?.content?.trim() || '';
    const h1s      = [...document.querySelectorAll('h1,h2,h3')]
      .filter(h => !h.closest('nav,[role="navigation"]'))
      .map(h => `<${h.tagName}> "${(h.innerText||'').trim().slice(0,80)}"`)
      .slice(0, 5);
    const pcts     = [...document.body.innerText.matchAll(/(\d{1,3})\s*%/g)].map(m => m[1]).slice(0, 6);
    const tarjetas = [...document.querySelectorAll('*')]
      .filter(el => /tarjeta|cr[eé]dito|d[eé]bito|visa|mastercard|gold|platinum|infinite/i.test(el.innerText||'')
        && (el.innerText||'').length < 300 && !el.closest('nav,header,footer'))
      .slice(0, 3)
      .map(el => (el.innerText||'').replace(/\s+/g,' ').trim().slice(0,150));
    return { title, ogTitle, ogDesc, h1s, pcts, tarjetas };
  });

  console.log(`  title:    "${info.title}"`);
  console.log(`  ogTitle:  "${info.ogTitle}"`);
  console.log(`  ogDesc:   "${info.ogDesc}"`);
  console.log(`  headings: ${info.h1s.join(' | ')}`);
  console.log(`  pcts:     [${info.pcts.join(', ')}]`);
  console.log(`  tarjetas: ${JSON.stringify(info.tarjetas)}`);
}

// ── Descubrir links del hub ───────────────────────────────────────────────────
async function discoverLinks(page) {
  const status = await goto(page, HUB);
  console.log(`Hub status: ${status}`);
  if (status !== 200 && status !== 304) return [];

  // Scroll para cargar lazy-loaded cards
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let lastHeight = document.body.scrollHeight;
      let stableCount = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 600);
        const newHeight = document.body.scrollHeight;
        if (newHeight > lastHeight) { lastHeight = newHeight; stableCount = 0; }
        else { stableCount++; if (stableCount >= 8) { clearInterval(timer); resolve(); } }
      }, 300);
      setTimeout(() => { clearInterval(timer); resolve(); }, 45000);
    });
  });
  await sleep(2000);

  if (DIAG_MODE) saveHtml('scotiabank-hub-scrolled', await page.content());

  // Extraer links a sub-páginas + nombre/pct del hub
  const cards = await page.evaluate((origin) => {
    const seen = new Set();
    const out  = [];

    // Buscar todos los <a> que apunten a /Beneficios/{cat}/{slug}
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href || '';
      if (!href.includes('/Beneficios/') || href.endsWith('/default') || href.includes('#')) return;
      if (seen.has(href)) return;
      seen.add(href);

      // Subir en el DOM para encontrar el container de la card
      let container = a.closest('article, li, [class*="card"], [class*="item"], [class*="benefit"], [class*="promo"]');
      if (!container || container.tagName === 'A') {
        let el = a.parentElement;
        let depth = 0;
        while (el && el !== document.body && depth < 8) {
          if (el.querySelector('img') || (el.innerText || '').length > 20) { container = el; break; }
          el = el.parentElement;
          depth++;
        }
        if (!container) container = a.parentElement || a;
      }

      const fullText = (container?.innerText || a.innerText || '').replace(/\s+/g, ' ').trim();

      // Nombre desde link text o container h2/h3
      let hubNombre = '';
      const hEl = container?.querySelector('h2, h3, h4, [class*="title"], [class*="name"]');
      if (hEl) hubNombre = (hEl.innerText || '').replace(/\s+/g, ' ').trim();
      if (!hubNombre) {
        const linkText = (a.innerText || '').trim();
        if (linkText && linkText.length > 2 && !/ver|m[aá]s|detalle/i.test(linkText)) hubNombre = linkText;
      }

      // Porcentaje
      const pctMs = [...fullText.matchAll(/(\d{1,3})\s*%/g)].map(m => parseInt(m[1])).filter(n => n > 0 && n <= 70);
      const pctMax = pctMs.length ? Math.max(...pctMs) : null;

      // Categoría desde URL: /Beneficios/{cat}/{slug}
      const parts = href.split('/');
      const bIdx  = parts.findIndex(p => p === 'Beneficios');
      const cat   = bIdx >= 0 && parts[bIdx + 1] ? parts[bIdx + 1] : null;
      const slug  = parts[parts.length - 1];

      out.push({ url: href, hubNombre, pctMax, cat, slug, hubText: fullText.slice(0, 200) });
    });

    return out;
  }, ORIGIN);

  console.log(`  ${cards.length} links encontrados en el hub`);
  return cards;
}

// ── Parsear sub-página de detalle ─────────────────────────────────────────────
async function parseDetail(page, hubCard) {
  const status = await goto(page, hubCard.url);
  if (status !== 200 && status !== 304) return null;

  const data = await page.evaluate((hubNombre, hubPct) => {
    // Nombre
    let nombre = hubNombre;

    // <title>: "Farmacity | Scotiabank Uruguay" → "Farmacity"
    if (!nombre) {
      const titleEl = document.querySelector('title');
      const titleText = (titleEl?.textContent || '').trim();
      if (titleText && !/^(scotiabank|beneficio|beneficios)/i.test(titleText)) {
        nombre = titleText.replace(/\s*[\|\-]\s*Scotiabank.*/i, '').trim();
      }
    }

    // og:title
    if (!nombre) {
      const og = document.querySelector('meta[property="og:title"]')?.content?.trim() || '';
      if (og && !/^(scotiabank|beneficio)/i.test(og)) nombre = og.replace(/\s*[\|\-]\s*Scotiabank.*/i, '').trim();
    }

    // h1/h2/h3 (no en nav)
    if (!nombre) {
      const allH = [...document.querySelectorAll('h1,h2,h3')];
      const contentH = allH.find(h => {
        const text = (h.innerText || '').trim();
        return text.length > 2
          && !/navegaci[oó]n|principal|men[uú]|inicio|contacto|beneficios$/i.test(text)
          && !h.closest('nav,[role="navigation"]');
      });
      if (contentH) nombre = (contentH.innerText || '').trim();
    }

    // Porcentajes
    const allText = document.body.innerText || '';
    const pctMs   = [...allText.matchAll(/(\d{1,3})\s*%/g)]
      .map(m => parseInt(m[1])).filter(n => n > 0 && n <= 70);
    const pctMax  = pctMs.length ? Math.max(...pctMs) : hubPct;
    const descuentos = [...new Set(pctMs)].map(p => ({ pct: p, texto: `${p}%` }));

    // og:description como desc
    const ogDesc  = document.querySelector('meta[property="og:description"]')?.content?.trim() || '';

    // Tarjetas
    const lines = allText.split('\n').map(l => l.trim()).filter(Boolean);
    const tarjLine = lines.find(l =>
      /tarjeta|cr[eé]dito|d[eé]bito|visa|mastercard|gold|platinum|infinite/i.test(l)
      && l.length < 250 && !/(nav|men[uú])/i.test(l)
    );

    // Vigencia
    const vigLine = lines.find(l => /vigencia|v[aá]lid[ao]|hasta el/i.test(l) && l.length < 120);

    return { nombre, pctMax, descuentos, tarjetas: tarjLine || null, vigencia: vigLine || null, desc: ogDesc };
  }, hubCard.hubNombre, hubCard.pctMax);

  return data;
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
    console.log('=== MODO DIAGNÓSTICO — Scotiabank Uruguay ===\n');
    await diagHub(page);

    // Diagnosticar 3 sub-páginas de ejemplo
    const links = await discoverLinks(page);
    const sample = links.slice(0, 3);
    for (const c of sample) {
      await sleep(DELAY_MS);
      await diagDetail(page, c.url);
    }
    await browser.close();
    return;
  }

  // Modo producción
  console.log('=== Scraping beneficios Scotiabank Uruguay ===');
  const hubCards = await discoverLinks(page);

  if (!hubCards.length) {
    console.log('✗ No se encontraron links de beneficios en el hub.');
    await browser.close();
    return;
  }

  const seen      = new Set();
  const beneficios = [];

  for (const card of hubCards) {
    await sleep(DELAY_MS);
    const det = await parseDetail(page, card);
    if (!det) continue;

    const nombre = (det.nombre || card.hubNombre || slugToName(card.slug)).trim();
    if (!nombre || nombre.length < 2) continue;

    const key = nombre.toLowerCase().slice(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);

    beneficios.push({
      nombre,
      url:       card.url,
      categoria: card.cat || null,
      pctMax:    det.pctMax,
      descuentos: det.descuentos,
      vigencia:  det.vigencia,
      tarjetas:  det.tarjetas,
      desc:      det.desc || null,
      exclusivo: false,
    });

    process.stdout.write(`  [${beneficios.length}] ${nombre} — ${det.pctMax ?? '?'}%\n`);
  }

  await browser.close();

  const payload = {
    fuente:     'scotiabank.com.uy',
    actualizado: new Date().toISOString(),
    total:      beneficios.length,
    beneficios,
  };

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'beneficios-scotiabank.json'), JSON.stringify(payload, null, 2));
  console.log(`\n✓ data/beneficios-scotiabank.json — ${beneficios.length} beneficios`);
})();
