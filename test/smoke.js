// Smoke test de FinPro — renderiza las 15 rutas de la app con la DB mockeada
// y falla si alguna lanza una excepción o queda en blanco. También verifica
// la interacción de las tarjetas del Resumen de gastos (cambio de vista sin
// re-fetch, usando el caché).
//
// Uso:
//   cd scraper && npm install        (una sola vez — trae puppeteer)
//   node test/smoke.js
//
// Chrome: usa PUPPETEER_EXECUTABLE_PATH o CHROME_PATH si están definidos;
// si no, el Chromium que descarga puppeteer.
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8917;

let puppeteer;
try { puppeteer = require(path.join(ROOT, 'scraper', 'node_modules', 'puppeteer-extra')); }
catch { puppeteer = require('puppeteer'); }

const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const srv = await startServer();
  const browser = await puppeteer.launch({
    headless: 'new',
    ...(CHROME ? { executablePath: CHROME } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const pageErrors = [];
  page.on('pageerror', e => {
    const m = e.message || String(e);
    // Ruido esperado del sandbox: los CDN (supabase/plotly) no cargan acá
    if (/supabase is not defined|ServiceWorker/i.test(m)) return;
    pageErrors.push(m);
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(500);

  const results = await page.evaluate(async () => {
    // ── Datos representativos ──
    const CATS = [
      { id: 1, nombre: 'Supermercado', icono: '🛒', activo: 1 },
      { id: 2, nombre: 'Restaurantes', icono: '🍽️', activo: 1 },
      { id: 5, nombre: 'Beneficios',   icono: '🎁', activo: 1 },
    ];
    const TIPOS_ING = [{ id: 1, nombre: 'Salario', activo: 1 }];
    const hoy = new Date(); const y = hoy.getFullYear(), m = hoy.getMonth();
    const f = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const GASTOS = [
      { id: 1, fecha: f(new Date(y, m, 3)),  monto: 2500,  moneda: 'UYU', comercio: 'DISCO 44',    categoria_id: 1, cuota_actual: null, cuotas_totales: null, banco_tarjeta: 'BBVA Visa',   tipo_gasto: 'casual',     titular_adicional: null,   incluido_en_gastos: true,  dividido_entre: 1, notas: null, importacion_id: 7 },
      { id: 2, fecha: f(new Date(y, m, 5)),  monto: 120,   moneda: 'USD', comercio: 'NETFLIX',      categoria_id: 2, cuota_actual: null, cuotas_totales: null, banco_tarjeta: 'BBVA Visa',   tipo_gasto: 'recurrente', titular_adicional: null,   incluido_en_gastos: true,  dividido_entre: 1, notas: null, importacion_id: null },
      { id: 3, fecha: f(new Date(y, m, 8)),  monto: 5000,  moneda: 'UYU', comercio: 'ZARA 3/6',     categoria_id: 2, cuota_actual: 3,    cuotas_totales: 6,    banco_tarjeta: 'Itaú Master', tipo_gasto: 'cuota',      titular_adicional: null,   incluido_en_gastos: true,  dividido_entre: 1, notas: null, importacion_id: 7 },
      { id: 4, fecha: f(new Date(y, m, 9)),  monto: -300,  moneda: 'UYU', comercio: 'Benef. DISCO', categoria_id: 5, cuota_actual: null, cuotas_totales: null, banco_tarjeta: 'BBVA Visa',   tipo_gasto: 'casual',     titular_adicional: null,   incluido_en_gastos: true,  dividido_entre: 1, notas: null, importacion_id: 7 },
      { id: 5, fecha: f(new Date(y, m-1, 20)), monto: 1800, moneda: 'UYU', comercio: 'FARMASHOP',   categoria_id: 1, cuota_actual: null, cuotas_totales: null, banco_tarjeta: null,          tipo_gasto: 'casual',     titular_adicional: 'Cami', incluido_en_gastos: false, dividido_entre: 1, notas: null, importacion_id: null },
    ];
    const INGRESOS = [{ id: 1, fecha: f(new Date(y, m, 1)), monto: 5000, moneda: 'USD', descripcion: 'Salario', tipo_id: 1, recurrente: 0, notas: null }];
    const OPS = [{ id: 1, ticker: 'SPY', tipo: 'compra', cantidad: 10, precio_unitario: 500, comision: 1, monto_total: 5001, moneda: 'USD', tipo_cambio_usd: 1, fecha: f(new Date(y, m-2, 10)), fuente: 'manual', notas: null }];
    const ACTIVOS = [{ ticker: 'SPY', nombre: 'SPDR S&P 500', tipo: 'etf', sector: null, industria: null, pais: 'USA', moneda: 'USD', activo: 1 }];
    const PRECIOS = Array.from({ length: 40 }, (_, i) => ({ ticker: 'SPY', fecha: f(new Date(y, m, -i)), cierre: 700 - i, cierre_orig: 700 - i, moneda: 'USD', apertura: 699, maximo: 702, minimo: 695, volumen: 1000 }));
    const MIS_TARJETAS = [{ id: 1, banco: 'BBVA', red: 'Visa', nivel: 'Oro', cobranding: null, created_at: '2026-06-01' }];
    const CONFIG = { tipo_cambio: '40', gastos_tc: '40', moneda_vista: 'ORIGEN', benefit_categories: '5', benchmark_ticker: 'SPY', modules_enabled: null, user_nombre: 'Test', onboarding_done: 'true', tema: 'dark' };
    const TABLES = {
      categorias_gastos: CATS, tipos_ingreso: TIPOS_ING, gastos: GASTOS, ingresos: INGRESOS,
      operaciones: OPS, activos: ACTIVOS, precios_historicos: PRECIOS, mis_tarjetas: MIS_TARJETAS,
      merchant_categorias: [], importaciones: [], tarjeta_periodos: [], dividendos: [],
      presupuestos: [], metas_ahorro: [],
    };

    // ── Mock de Supabase client (chainable + thenable) con contador de queries ──
    window.__queryCount = 0;
    const mkQuery = (table) => {
      window.__queryCount++;
      const state = { table };
      const rows = () => {
        if (table === 'configuracion') {
          if (state.eqClave) {
            const v = CONFIG[state.eqClave];
            return v == null ? [] : [{ clave: state.eqClave, valor: v }];
          }
          return Object.entries(CONFIG).filter(([, v]) => v != null).map(([clave, valor]) => ({ clave, valor }));
        }
        return TABLES[table] || [];
      };
      const q = {};
      const chain = () => q;
      ['gte','lte','gt','lt','not','or','order','limit','in','is','neq','ilike','like','range'].forEach(k => q[k] = chain);
      q.select = chain; q.insert = chain; q.update = chain; q.upsert = chain; q.delete = chain;
      q.eq = (col, val) => { if (col === 'clave') state.eqClave = val; return q; };
      q.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
      q.single = q.maybeSingle;
      q.then = (res, rej) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(res, rej);
      q.catch = () => q; q.finally = () => q;
      return q;
    };
    window.getDB = () => ({
      from: mkQuery,
      rpc: async () => ({ data: null, error: { message: 'mock' } }),
      auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 't@t.com' } } }) },
      storage: { from: () => ({ list: async () => ({ data: [] }), upload: async () => ({}) }) },
    });
    // Plotly stub (CDN no disponible en el sandbox del test)
    window.Plotly = { newPlot: id => { const el = typeof id === 'string' ? document.getElementById(id) : id; if (el) el.on = () => {}; }, purge: () => {} };
    window.Auth = window.Auth || {}; window.Auth._user = { id: 'u1', email: 't@t.com' }; window.Auth._nombre = 'Test';
    window.APP_MODULES = null;
    document.getElementById('auth-screen')?.remove();
    document.querySelectorAll('#onboarding-screen,#onb-guide').forEach(e => e.remove());

    const out = [];
    const run = async (name, fn, extraCheck) => {
      const content = document.getElementById('content');
      content.innerHTML = '';
      try {
        await fn();
        await new Promise(r => setTimeout(r, 350));
        const text = content.innerText.trim();
        const gc = document.getElementById('g-content');
        const gcEmpty = gc ? gc.innerHTML.trim() === '' || !!gc.querySelector('.loading') : false;
        const extra = extraCheck ? await extraCheck() : null;
        out.push({ name, ok: !gcEmpty && !(extra && extra.fail), chars: text.length, note: extra?.note || (gcEmpty ? 'contenido vacío' : '') });
      } catch (e) {
        out.push({ name, ok: false, note: (e && e.message) || String(e) });
      }
    };

    // ── Las 15 rutas ──
    await run('dashboard',               () => window.Mods.dashboard.render());
    await run('inversiones/portafolio',  () => window.Mods.inversiones.render('portafolio'));
    await run('inversiones/mercado',     () => window.Mods.inversiones.render('mercado'));
    await run('inversiones/operaciones', () => window.Mods.inversiones.render('operaciones'));
    await run('gastos/resumen',   () => { window.Mods.gastos._tab = 'resumen';  return window.Mods.gastos.render(); });
    await run('gastos/detalle',   () => { window.Mods.gastos._tab = 'detalle';  return window.Mods.gastos.render(); });
    await run('gastos/cuotas',    () => { window.Mods.gastos._tab = 'cuotas';   return window.Mods.gastos.render(); });
    await run('gastos/importar',  () => { window.Mods.gastos._tab = 'importar'; return window.Mods.gastos.render(); });
    await run('gastos/manual',    () => { window.Mods.gastos._tab = 'manual';   return window.Mods.gastos.render(); });
    await run('tarjetas/descuentos',   () => window.Mods.tarjetas.render('descuentos'));
    await run('tarjetas/comercios',    () => window.Mods.tarjetas.render('comercios'));
    await run('tarjetas/adicional',    () => window.Mods.tarjetas.render('adicional'));
    await run('tarjetas/mis-tarjetas', () => window.Mods.tarjetas.render('mis-tarjetas'));
    await run('ingresos',        () => window.Mods.ingresos.render());
    await run('configuracion',   () => window.Mods.configuracion.render());

    // ── Interacción: tarjetas del Resumen sin re-fetch (caché) ──
    await run('resumen: card cuotas usa caché', async () => {
      window.Mods.gastos._tab = 'resumen';
      window.Mods.gastos._resView = 'gastos';
      await window.Mods.gastos.render();
      await new Promise(r => setTimeout(r, 250));
      const before = window.__queryCount;
      document.getElementById('r-card-cuotas')?.click();
      await new Promise(r => setTimeout(r, 350));
      window.__cuotasQueries = window.__queryCount - before;
    }, async () => {
      const nq = window.__cuotasQueries;
      const drew = !!document.getElementById('g-bar-chart');
      if (nq > 0) return { fail: true, note: `la vista cuotas re-fetcheó (${nq} queries) — debería usar caché` };
      if (!drew)  return { fail: true, note: 'no se dibujó el gráfico de cuotas' };
      return { note: '0 queries al cambiar de vista ✓' };
    });

    return out;
  });

  let failed = 0;
  for (const r of results) {
    if (r.ok) console.log(`OK   ${r.name}${r.note ? '  · ' + r.note : ''}`);
    else { failed++; console.log(`FAIL ${r.name}: ${r.note}`); }
  }
  if (pageErrors.length) {
    failed++;
    console.log('\nErrores de página no esperados:');
    pageErrors.forEach(e => console.log('  ', e));
  }
  await browser.close();
  srv.close();
  console.log(failed ? `\n✗ ${failed} fallo(s)` : '\n✓ Todo OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
