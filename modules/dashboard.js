window.Mods = window.Mods || {};
window.Mods.dashboard = {
  _mode:       localStorage.getItem('panorama_mode') || 'UYU',
  _tc:         null,
  _cuotasOpen:  false,
  _recurOpen:   false,
  _casualOpen:  false,
  _cache:       null,

  async render() {
    const c = document.getElementById('content');
    const now  = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;
    const start12 = new Date(curY, curM - 13, 1);
    const desde12 = `${start12.getFullYear()}-${String(start12.getMonth()+1).padStart(2,'0')}-01`;
    const start6  = new Date(curY, curM - 6, 1);
    const desde6  = `${start6.getFullYear()}-${String(start6.getMonth()+1).padStart(2,'0')}-01`;

    const [gastosRes, ingresosRes, cuotasRes, tcCfg, tiposIngRes] = await Promise.all([
      getDB().from('gastos').select('fecha,monto,moneda,tipo_gasto,incluido_en_gastos,cuotas_totales,cuota_actual,comercio,banco_tarjeta')
        .gte('fecha', desde12).order('fecha', {ascending: true}),
      getDB().from('ingresos').select('fecha,monto,moneda,tipo_id,descripcion')
        .gte('fecha', desde6).order('fecha', {ascending: true}),
      getDB().from('gastos').select('comercio,monto,moneda,cuota_actual,cuotas_totales,fecha')
        .not('cuotas_totales', 'is', null).order('fecha', {ascending: false}),
      getConfig('tipo_cambio'),
      getDB().from('tipos_ingreso').select('id,nombre'),
    ]);

    this._cache = {
      gastos:    gastosRes.data   || [],
      ingresos:  ingresosRes.data || [],
      allCuotas: cuotasRes.data   || [],
      tiposIng:  tiposIngRes.data || [],
    };
    if (this._tc === null) this._tc = parseFloat(tcCfg) || 42;
    this._redraw();
  },

  _redraw() {
    const c = document.getElementById('content');
    if (!this._cache) return;
    const { gastos, ingresos, allCuotas, tiposIng } = this._cache;
    const mode = this._mode;
    const tc   = this._tc;
    const now  = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;
    const curYM = `${curY}-${String(curM).padStart(2,'0')}`;

    const toDisp = (n, mon) => {
      const v = parseFloat(n) || 0;
      if (mode === 'USD') return mon === 'USD' ? v : v / tc;
      return mon === 'UYU' ? v : v * tc;
    };
    const fmtD = (n) => {
      if (mode === 'USD') return fmtUSD(n);
      const dec = Math.abs(n) >= 100 ? 0 : 2;
      return '$U ' + fmt(n, dec);
    };

    // Build 6-month grid for trend chart (5 past months + current)
    const months6 = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(curY, curM - 1 - i, 1);
      months6.push({
        ym:    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        label: d.toLocaleDateString('es-AR', {month: 'short', year: '2-digit'}),
      });
    }
    const byMonth6 = {};
    months6.forEach(m => { byMonth6[m.ym] = {ing: 0, gas: 0}; });

    gastos.filter(g => byMonth6[g.fecha.slice(0,7)] !== undefined && g.fecha.slice(0,7) !== curYM)
      .forEach(g => { byMonth6[g.fecha.slice(0,7)].gas += toDisp(g.monto, g.moneda || 'UYU'); });
    ingresos.forEach(i => {
      const ym = i.fecha.slice(0,7);
      if (byMonth6[ym] !== undefined) byMonth6[ym].ing += toDisp(i.monto, i.moneda || 'UYU');
    });

    const prev = byMonth6[months6[4].ym];

    // Active cuota plans — same deduplication key as _drawCuotas() in gastos.js
    const planMap = {};
    allCuotas.forEach(r => {
      const key = `${r.comercio||''}|${r.cuotas_totales}|${Math.round(parseFloat(r.monto))}|${r.moneda}`;
      if (!planMap[key] || r.cuota_actual > planMap[key].cuota_actual) planMap[key] = r;
    });
    const activePlans = Object.values(planMap).filter(p => p.cuota_actual < p.cuotas_totales);

    // Build cuota schedule using actual fecha (same approach as Gastos module)
    const cuotaSchedule = {};
    for (const p of activePlans) {
      const rem = p.cuotas_totales - p.cuota_actual;
      const [yr, mo] = p.fecha.split('-').map(Number);
      const base = new Date(yr, mo - 1, 1);
      for (let k = 1; k <= rem; k++) {
        const d = new Date(base.getFullYear(), base.getMonth() + k, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        cuotaSchedule[ym] = (cuotaSchedule[ym] || 0) + toDisp(p.monto, p.moneda || 'UYU');
      }
    }

    // Recurrentes: use last closed month's actual amount (not an average)
    const lastClosedYM = months6[4].ym;
    const recAvg = gastos
      .filter(g => g.tipo_gasto === 'recurrente' && g.fecha.slice(0,7) === lastClosedYM)
      .reduce((s, g) => s + toDisp(g.monto, g.moneda || 'UYU'), 0);
    const ingAvg = months6.slice(2, 5).reduce((s, m) => s + (byMonth6[m.ym]?.ing || 0), 0) / 3;

    // Casual avg — last 12 months excluding current month (rolling year)
    const all12YMs = new Set();
    for (let i = 12; i >= 1; i--) {
      const d = new Date(curY, curM - 1 - i, 1);
      all12YMs.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    }
    const isCasual = g => g.tipo_gasto !== 'recurrente' && (g.cuotas_totales || 1) <= 1;
    const casualRows = gastos.filter(g => isCasual(g) && all12YMs.has(g.fecha.slice(0,7)));
    const casualMonthsWithData = new Set(casualRows.map(g => g.fecha.slice(0,7)));
    const casualTotal = casualRows.reduce((s, g) => s + toDisp(g.monto, g.moneda || 'UYU'), 0);
    const casualAvg   = casualMonthsWithData.size > 0 ? casualTotal / casualMonthsWithData.size : 0;

    // Current month: use projection instead of partial actuals
    const cuotasCurMonth = cuotaSchedule[curYM] || 0;
    const curProjGas = recAvg + casualAvg + cuotasCurMonth;

    const totalCuotasPending = activePlans.reduce((s, p) => {
      const rem = p.cuotas_totales - p.cuota_actual;
      return s + toDisp(p.monto, p.moneda || 'UYU') * rem;
    }, 0);
    const recurRows = gastos
      .filter(g => g.tipo_gasto === 'recurrente' && g.fecha.slice(0,7) === lastClosedYM)
      .sort((a, b) => toDisp(b.monto, b.moneda || 'UYU') - toDisp(a.monto, a.moneda || 'UYU'));
    const recurTotal = recurRows.reduce((s, g) => s + toDisp(g.monto, g.moneda || 'UYU'), 0);
    byMonth6[curYM].gas = curProjGas;

    const cur     = byMonth6[curYM];
    const balance = cur.ing - cur.gas;
    const prevBal = prev.ing - prev.gas;
    const tasa     = cur.ing  > 0 ? Math.round(balance  / cur.ing  * 100) : 0;
    const prevTasa = prev.ing > 0 ? Math.round(prevBal / prev.ing * 100) : 0;

    // 3-month projection (next months use cuotaSchedule for accuracy)
    const proj = Array.from({length: 3}, (_, idx) => {
      const i = idx + 1;
      const d = new Date(curY, curM - 1 + i, 1);
      const projYM = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const cuotasProy = cuotaSchedule[projYM] || 0;
      const totalGasto = recAvg + casualAvg + cuotasProy;
      return {
        label:      d.toLocaleDateString('es-AR', {month: 'long'}),
        ingAvg, recAvg, casualAvg, cuotasProy,
        totalGasto, margen: ingAvg - totalGasto,
        pctComp:    ingAvg > 0 ? Math.min(100, totalGasto / ingAvg * 100) : 0,
      };
    });

    const dIng  = cur.ing - prev.ing;
    const delta = (v, posIsGood = true) => {
      const good  = posIsGood ? v >= 0 : v <= 0;
      const color = good ? 'var(--green)' : 'var(--red)';
      const sign  = v >= 0 ? '+' : '';
      return `<span style="font-size:.65rem;font-family:'DM Mono',monospace;margin-top:5px;display:block;color:${color}">${sign}${fmtD(v)} vs mes ant.</span>`;
    };

    const monthTitle = now.toLocaleDateString('es-AR', {month: 'long', year: 'numeric'});

    // Current month ingresos breakdown by tipo
    const tiposMap = Object.fromEntries((tiposIng || []).map(t => [t.id, t.nombre]));
    const curIngRows = ingresos.filter(i => i.fecha.slice(0,7) === curYM);
    const ingByTipo = {};
    curIngRows.forEach(i => {
      const key = tiposMap[i.tipo_id] || i.descripcion || 'Otros';
      ingByTipo[key] = (ingByTipo[key] || 0) + toDisp(i.monto, i.moneda || 'UYU');
    });
    const ingEntries = Object.entries(ingByTipo).sort((a, b) => b[1] - a[1]);

    // In-app reminder: show if early in month and last closed month has few records
    const lastMonthRecords = gastos.filter(g => g.fecha.slice(0,7) === lastClosedYM).length;
    const dayOfMonth = now.getDate();
    const reminderKey = `edcReminder_${lastClosedYM}`;
    const lastMonthName = new Date(lastClosedYM + '-15').toLocaleDateString('es-AR', {month: 'long', year: 'numeric'});
    const showReminder = !sessionStorage.getItem(reminderKey) && dayOfMonth <= 12 && lastMonthRecords < 5;

    c.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:1rem">
        <div>
          <h1>Análisis</h1>
          <p class="page-subtitle">${monthTitle} · flujo de caja proyectado</p>
        </div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button id="pan-usd" class="g-tab${mode==='USD'?' active':''}" onclick="window.Mods.dashboard._setMode('USD')">USD</button>
          <button id="pan-uyu" class="g-tab${mode==='UYU'?' active':''}" onclick="window.Mods.dashboard._setMode('UYU')">UYU</button>
        </div>
      </div>

      ${showReminder ? `
        <div id="dash-reminder" style="background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.28);border-radius:10px;padding:12px 16px;margin-bottom:16px">
          <div style="display:flex;align-items:flex-start;gap:10px">
            <span style="font-size:1rem;flex-shrink:0;margin-top:1px">📋</span>
            <div style="flex:1;min-width:0">
              <div style="color:rgba(251,191,36,.95);font-size:.8rem;font-weight:600;margin-bottom:3px">Datos de ${lastMonthName} sin cargar</div>
              <div style="color:var(--text-sec);font-size:.74rem;line-height:1.45">El análisis usa proyecciones. Cargá los gastos del mes para tener los números reales.</div>
              <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
                <a href="#gastos/importar" style="font-size:.75rem;padding:5px 12px;background:var(--accent);color:#fff;border-radius:6px;text-decoration:none;font-family:'DM Sans',sans-serif">Importar EDC</a>
                <a href="#gastos/manual" style="font-size:.75rem;padding:5px 12px;border:1px solid var(--border);color:var(--text);border-radius:6px;text-decoration:none;font-family:'DM Sans',sans-serif">Nuevo gasto</a>
                <button id="dash-reminder-dismiss" style="margin-left:auto;background:none;border:none;color:var(--text-sec);cursor:pointer;font-size:.74rem;padding:4px 6px;font-family:inherit;opacity:.7">Ignorar</button>
              </div>
            </div>
          </div>
        </div>
      ` : ''}

      <div class="metrics-row" style="margin-top:16px">
        <div class="metric-card">
          <div class="metric-label">Ingresos · ${now.toLocaleDateString('es-AR',{month:'short'})}</div>
          <div class="metric-value pos" style="margin:4px 0 6px">${fmtD(cur.ing)}</div>
          ${ingEntries.length > 0 ? `<div style="display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--border);padding-top:6px">
            ${ingEntries.map(([tipo, monto]) => `<div style="display:flex;justify-content:space-between;font-size:.63rem;font-family:'DM Mono',monospace">
              <span style="color:var(--text-sec)">${tipo}</span>
              <span style="color:var(--green)">${fmtD(monto)}</span>
            </div>`).join('')}
          </div>` : ''}
        </div>
        <div class="metric-card" style="border-color:rgba(46,142,200,.35);background:linear-gradient(160deg,var(--surface),rgba(46,142,200,.06))">
          <div class="metric-label">Gastos proyectados</div>
          <div class="metric-value" style="color:var(--accent)">${fmtD(curProjGas)}</div>
          <div style="margin-top:6px;display:flex;flex-direction:column;gap:2px">
            <div style="display:flex;justify-content:space-between;font-size:.63rem;font-family:'DM Mono',monospace">
              <span style="color:var(--text-sec)">Casual</span>
              <span style="color:var(--text-sec)">${fmtD(casualAvg)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:.63rem;font-family:'DM Mono',monospace">
              <span style="color:var(--text-sec)">Cuotas</span>
              <span style="color:var(--gold)">${fmtD(cuotasCurMonth)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:.63rem;font-family:'DM Mono',monospace">
              <span style="color:var(--text-sec)">Fijos</span>
              <span style="color:#a78bfa">${fmtD(recAvg)}</span>
            </div>
          </div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Balance estimado</div>
          <div class="metric-value ${plClass(balance)}">${plSign(balance)}${fmtD(balance)}</div>
          <span style="font-size:.63rem;font-family:'DM Mono',monospace;margin-top:6px;display:block;color:${tasa>=20?'var(--green)':tasa>=0?'var(--text-sec)':'var(--red)'}">Tasa ahorro: ${tasa>0?'+':''}${tasa}%</span>
        </div>
      </div>

      <div class="chart-card">
        <div style="font-family:'DM Mono',monospace;font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;color:var(--text-sec);margin-bottom:10px">
          Flujo de caja · últimos 6 meses (${mode}) · mes actual = estimado
        </div>
        <div id="pan-trend" style="height:220px"></div>
      </div>

      <div style="font-family:'DM Mono',monospace;font-size:.68rem;text-transform:uppercase;letter-spacing:.12em;color:var(--text-sec);margin:4px 0 10px">
        Proyección · próximos 3 meses
      </div>
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:24px">
        <div style="display:grid;grid-template-columns:repeat(3,minmax(165px,1fr));gap:12px">
          ${proj.map(p => `
            <div class="card" style="padding:16px 14px">
              <div style="font-family:'Bebas Neue',sans-serif;font-size:1.25rem;letter-spacing:.06em;margin-bottom:10px;text-transform:capitalize">${p.label}</div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">
                <span style="font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">Ing. esperados</span>
                <span style="font-size:.82rem;color:var(--green);white-space:nowrap">${fmtD(p.ingAvg)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
                <span style="font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">Fijos</span>
                <span style="font-size:.82rem;color:var(--text-sec);white-space:nowrap">${fmtD(p.recAvg)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
                <span style="font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">Casual</span>
                <span style="font-size:.82rem;color:var(--text-sec);white-space:nowrap">${fmtD(p.casualAvg)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
                <span style="font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">Cuotas</span>
                <span style="font-size:.82rem;color:var(--gold);white-space:nowrap">${fmtD(p.cuotasProy)}</span>
              </div>
              <div style="height:3px;background:rgba(255,255,255,.07);border-radius:2px;margin-bottom:10px;overflow:hidden">
                <div style="height:100%;width:${p.pctComp.toFixed(1)}%;background:${p.margen>=0?'var(--accent)':'var(--red)'};border-radius:2px"></div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;padding-top:8px;border-top:1px solid var(--border)">
                <span style="font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">Margen libre</span>
                <span style="font-size:.95rem;font-weight:600;white-space:nowrap;color:${p.margen>=0?'var(--green)':'var(--red)'}">
                  ${plSign(p.margen)}${fmtD(p.margen)}
                </span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      ${activePlans.length > 0 || recurRows.length > 0 || casualAvg > 0 ? `
        <div class="form-card" style="padding:14px 16px;margin-bottom:24px">
          ${activePlans.length > 0 ? `
            <details class="dash-cuotas-det" ${this._cuotasOpen ? 'open' : ''}>
              <summary style="list-style:none;cursor:pointer;user-select:none;padding:2px 2px 8px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="display:flex;align-items:center;gap:5px">
                    <span class="dash-arr-c" style="display:inline-block;font-size:.6rem;transition:transform .15s;color:var(--text-sec)">▶</span>
                    <span style="font-size:.68rem;color:var(--gold);text-transform:uppercase;font-weight:500;letter-spacing:.06em">📅 Cuotas activas · ${activePlans.length} planes</span>
                  </span>
                  <span style="font-family:'DM Mono',monospace;font-size:.78rem;color:var(--gold)">${fmtD(totalCuotasPending)}</span>
                </div>
              </summary>
              <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
                <table style="width:100%;min-width:360px;border-collapse:collapse">
                  <thead><tr>
                    <th style="text-align:left;padding:7px 6px;border-bottom:1px solid var(--border);font-size:.72rem;color:var(--text-sec);text-transform:uppercase;font-weight:500">Comercio</th>
                    <th style="text-align:left;padding:7px 6px;border-bottom:1px solid var(--border);font-size:.72rem;color:var(--text-sec);text-transform:uppercase;font-weight:500">Progreso</th>
                    <th style="text-align:right;padding:7px 6px;border-bottom:1px solid var(--border);font-size:.72rem;color:var(--text-sec);text-transform:uppercase;font-weight:500">Mensual</th>
                    <th style="text-align:right;padding:7px 6px;border-bottom:1px solid var(--border);font-size:.72rem;color:var(--text-sec);text-transform:uppercase;font-weight:500">Pendiente</th>
                  </tr></thead>
                  <tbody>
                    ${activePlans
                      .sort((a, b) => (b.cuotas_totales - b.cuota_actual) - (a.cuotas_totales - a.cuota_actual))
                      .map(p => {
                        const rem   = p.cuotas_totales - p.cuota_actual;
                        const cuota = toDisp(p.monto, p.moneda || 'UYU');
                        return `<tr>
                          <td style="padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.04);font-size:.8rem">${p.comercio || '—'}</td>
                          <td style="padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.04);font-size:.75rem;font-family:'DM Mono',monospace;color:var(--text)">${p.cuota_actual}/${p.cuotas_totales} · ${rem} rest.</td>
                          <td style="padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.04);font-size:.8rem;text-align:right;font-family:'DM Mono',monospace;color:var(--gold)">${fmtD(cuota)}</td>
                          <td style="padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.04);font-size:.8rem;text-align:right;font-family:'DM Mono',monospace;color:var(--text-sec)">${fmtD(cuota * rem)}</td>
                        </tr>`;
                      }).join('')}
                  </tbody>
                  <tfoot><tr>
                    <td colspan="3" style="padding:8px 6px;border-top:1px solid var(--border);font-size:.72rem;font-weight:600;color:var(--text-sec);text-transform:uppercase">Total pendiente</td>
                    <td style="padding:8px 6px;border-top:1px solid var(--border);font-size:.78rem;font-weight:600;text-align:right;font-family:'DM Mono',monospace;color:var(--gold)">${fmtD(totalCuotasPending)}</td>
                  </tr></tfoot>
                </table>
              </div>
            </details>
          ` : ''}
          ${casualAvg > 0 ? `
            <details class="dash-casual-det" ${this._casualOpen ? 'open' : ''} style="${activePlans.length > 0 || recurRows.length > 0 ? 'margin-top:10px' : ''}">
              <summary style="list-style:none;cursor:pointer;user-select:none;padding:2px 2px 8px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="display:flex;align-items:center;gap:5px">
                    <span class="dash-arr-cas" style="display:inline-block;font-size:.6rem;transition:transform .15s;color:var(--text-sec)">▶</span>
                    <span style="font-size:.68rem;color:var(--text);text-transform:uppercase;font-weight:500;letter-spacing:.06em">💳 Gasto casual · promedio 12m</span>
                  </span>
                  <span style="font-family:'DM Mono',monospace;font-size:.78rem;color:var(--text)">${fmtD(casualAvg)}</span>
                </div>
              </summary>
              <div style="padding:10px 6px 4px;font-size:.78rem;color:var(--text-sec);line-height:1.6">
                <p style="margin:0 0 8px">
                  Promedio mensual de gastos <em>no recurrentes y sin cuotas</em>
                  (tipo_gasto ≠ recurrente y cuotas = 1) del último año.
                </p>
                <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-family:'DM Mono',monospace;font-size:.73rem">
                  <span style="color:var(--text-sec)">Meses con datos</span>
                  <span style="color:var(--text)">${casualMonthsWithData.size} / 12</span>
                  <span style="color:var(--text-sec)">Total en esos meses</span>
                  <span style="color:var(--text)">${fmtD(casualTotal)}</span>
                  <span style="color:var(--text-sec)">Promedio mensual</span>
                  <span style="color:var(--text);font-weight:600">${fmtD(casualAvg)}</span>
                </div>
                <p style="margin:8px 0 0;font-size:.7rem;color:rgba(200,210,230,.45)">
                  Los meses sin ningún gasto casual no se incluyen en el denominador.
                </p>
              </div>
            </details>
          ` : ''}
          ${recurRows.length > 0 ? `
            <details class="dash-recur-det" ${this._recurOpen ? 'open' : ''} style="${activePlans.length > 0 || casualAvg > 0 ? 'margin-top:10px' : ''}">
              <summary style="list-style:none;cursor:pointer;user-select:none;padding:2px 2px 8px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="display:flex;align-items:center;gap:5px">
                    <span class="dash-arr-r" style="display:inline-block;font-size:.6rem;transition:transform .15s;color:var(--text-sec)">▶</span>
                    <span style="font-size:.68rem;color:#a78bfa;text-transform:uppercase;font-weight:500;letter-spacing:.06em">🔁 Recurrentes · ${lastClosedYM}</span>
                  </span>
                  <span style="font-family:'DM Mono',monospace;font-size:.78rem;color:#a78bfa">${fmtD(recurTotal)}</span>
                </div>
              </summary>
              <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
                <table style="width:100%;min-width:300px;border-collapse:collapse">
                  <thead><tr>
                    <th style="text-align:left;padding:7px 6px;border-bottom:1px solid var(--border);font-size:.72rem;color:var(--text-sec);text-transform:uppercase;font-weight:500">Comercio</th>
                    <th style="text-align:left;padding:7px 6px;border-bottom:1px solid var(--border);font-size:.72rem;color:var(--text-sec);text-transform:uppercase;font-weight:500">Medio de pago</th>
                    <th style="text-align:right;padding:7px 6px;border-bottom:1px solid var(--border);font-size:.72rem;color:var(--text-sec);text-transform:uppercase;font-weight:500">Monto</th>
                  </tr></thead>
                  <tbody>
                    ${recurRows.map(g => `<tr>
                      <td style="padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.04);font-size:.8rem">${g.comercio || '—'}</td>
                      <td style="padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.04);font-size:.72rem;color:var(--text-sec)">${g.banco_tarjeta || '—'}</td>
                      <td style="padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.04);font-size:.8rem;text-align:right;font-family:'DM Mono',monospace;color:#a78bfa">${fmtD(toDisp(g.monto, g.moneda || 'UYU'))}</td>
                    </tr>`).join('')}
                  </tbody>
                  <tfoot><tr>
                    <td colspan="2" style="padding:8px 6px;border-top:1px solid var(--border);font-size:.72rem;font-weight:600;color:var(--text-sec);text-transform:uppercase">Total recurrentes</td>
                    <td style="padding:8px 6px;border-top:1px solid var(--border);font-size:.78rem;font-weight:600;text-align:right;font-family:'DM Mono',monospace;color:#a78bfa">${fmtD(recurTotal)}</td>
                  </tr></tfoot>
                </table>
              </div>
            </details>
          ` : ''}
        </div>
      ` : ''}
    `;

    // Trend chart — current month bar slightly translucent to signal "estimated"
    const tickpfx = mode === 'USD' ? '$' : '$U ';
    const pt = plotlyTheme();
    Plotly.newPlot('pan-trend', [
      {
        x: months6.map(m => m.label),
        y: months6.map(m => byMonth6[m.ym].ing),
        name: 'Ingresos', type: 'bar',
        marker: {color: 'rgba(41,217,133,.75)'},
        hovertemplate: `${tickpfx}%{y:,.0f}<extra></extra>`,
      },
      {
        x: months6.map(m => m.label),
        y: months6.map(m => byMonth6[m.ym].gas),
        name: 'Gastos (est. mes actual)', type: 'bar',
        marker: {
          color: months6.map((m, i) =>
            i === 5 ? 'rgba(46,127,217,.45)' : 'rgba(46,127,217,.7)'
          ),
        },
        hovertemplate: `${tickpfx}%{y:,.0f}<extra></extra>`,
      },
    ], {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor:  'rgba(0,0,0,0)',
      font: {color: pt.font, family: 'DM Sans, sans-serif', size: 11},
      dragmode: false,
      barmode: 'group',
      bargap: 0.25,
      bargroupgap: 0.08,
      margin: {t: 10, r: 10, b: 50, l: 65},
      legend: {orientation: 'h', y: -0.28, x: 0.5, xanchor: 'center', font: {size: 11}},
      xaxis: {fixedrange: true, gridcolor: pt.grid},
      yaxis: {fixedrange: true, gridcolor: pt.grid, tickprefix: tickpfx},
    }, {displayModeBar: false, responsive: true, scrollZoom: false});

    // Reminder dismiss
    document.getElementById('dash-reminder-dismiss')?.addEventListener('click', () => {
      sessionStorage.setItem(reminderKey, '1');
      document.getElementById('dash-reminder')?.remove();
    });

    // Accordion arrow bindings
    [{sel: '.dash-cuotas-det',  key: '_cuotasOpen',  arrSel: '.dash-arr-c'},
     {sel: '.dash-recur-det',   key: '_recurOpen',   arrSel: '.dash-arr-r'},
     {sel: '.dash-casual-det',  key: '_casualOpen',  arrSel: '.dash-arr-cas'}].forEach(({sel, key, arrSel}) => {
      const det = document.querySelector(sel);
      if (!det) return;
      const arr = det.querySelector(arrSel);
      const upd = () => { if (arr) arr.style.transform = det.open ? 'rotate(90deg)' : 'rotate(0deg)'; };
      upd();
      det.addEventListener('toggle', () => { this[key] = det.open; upd(); });
    });
  },

  _setMode(mode) {
    this._mode = mode;
    localStorage.setItem('panorama_mode', mode);
    if (this._cache) this._redraw(); else this.render();
  },

  async _saveTc() {
    const input = document.getElementById('pan-tc');
    const val   = parseFloat(input?.value);
    if (!val || val <= 0) return;
    this._tc = val;
    await setConfig('tipo_cambio', String(val));
    toast('Tipo de cambio actualizado');
    if (this._cache) this._redraw(); else this.render();
  },
};
