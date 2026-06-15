window.Mods = window.Mods || {};
window.Mods.dashboard = {
  _mode: localStorage.getItem('panorama_mode') || 'UYU',
  _tc:   null,

  async render() {
    const c = document.getElementById('content');
    const mode = this._mode;
    const now  = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;
    const curYM = `${curY}-${String(curM).padStart(2,'0')}`;

    // 12-month window for casual avg; 6-month for trend chart
    const start12 = new Date(curY, curM - 13, 1);
    const desde12 = `${start12.getFullYear()}-${String(start12.getMonth()+1).padStart(2,'0')}-01`;
    const start6  = new Date(curY, curM - 6, 1);
    const desde6  = `${start6.getFullYear()}-${String(start6.getMonth()+1).padStart(2,'0')}-01`;

    const [gastosRes, ingresosRes, cuotasRes, tcCfg] = await Promise.all([
      getDB().from('gastos').select('fecha,monto,moneda,tipo_gasto,incluido_en_gastos,cuotas_totales,cuota_actual,comercio')
        .gte('fecha', desde12).order('fecha', {ascending: true}),
      getDB().from('ingresos').select('fecha,monto,moneda')
        .gte('fecha', desde6).order('fecha', {ascending: true}),
      getDB().from('gastos').select('comercio,monto,moneda,cuota_actual,cuotas_totales,fecha')
        .eq('tipo_gasto', 'cuota').order('fecha', {ascending: false}),
      getConfig('tipo_cambio'),
    ]);

    const gastos    = gastosRes.data   || [];
    const ingresos  = ingresosRes.data  || [];
    const allCuotas = cuotasRes.data    || [];

    // TC: use saved override, then config, then fallback
    if (this._tc === null) this._tc = parseFloat(tcCfg) || 42;
    const tc = this._tc;

    const toDisp = (n, mon) => {
      const v = parseFloat(n) || 0;
      if (mode === 'USD') return mon === 'USD' ? v : v / tc;
      return mon === 'UYU' ? v : v * tc;
    };
    const fmtD = (n) => {
      if (mode === 'USD') return fmtUSD(n);
      const dec = Math.abs(n) >= 100 ? 0 : 2;
      return '$U ' + fmt(n, dec);
    };

    // Build 6-month grid for trend chart
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

    gastos.filter(g => g.incluido_en_gastos !== false && byMonth6[g.fecha.slice(0,7)] !== undefined)
      .forEach(g => { byMonth6[g.fecha.slice(0,7)].gas += toDisp(g.monto, g.moneda || 'UYU'); });
    ingresos.forEach(i => {
      const ym = i.fecha.slice(0,7);
      if (byMonth6[ym] !== undefined) byMonth6[ym].ing += toDisp(i.monto, i.moneda || 'UYU');
    });

    const cur  = byMonth6[curYM];
    const prev = byMonth6[months6[4].ym];
    const balance = cur.ing - cur.gas;
    const prevBal = prev.ing - prev.gas;
    const tasa     = cur.ing  > 0 ? Math.round(balance  / cur.ing  * 100) : 0;
    const prevTasa = prev.ing > 0 ? Math.round(prevBal / prev.ing * 100) : 0;

    // Active cuota plans
    const planMap = {};
    allCuotas.forEach(r => {
      const key = `${(r.comercio||'').slice(0,30)}|${r.cuotas_totales}|${Math.round(parseFloat(r.monto))}|${r.moneda}`;
      if (!planMap[key] || r.cuota_actual > planMap[key].cuota_actual) planMap[key] = r;
    });
    // Also pick up cuota plans embedded in casual gastos (cuotas_totales > 1)
    gastos.filter(g => (g.cuotas_totales || 1) > 1).forEach(r => {
      const key = `${(r.comercio||'').slice(0,30)}|${r.cuotas_totales}|${Math.round(parseFloat(r.monto))}|${r.moneda}`;
      if (!planMap[key] || r.cuota_actual > planMap[key].cuota_actual) planMap[key] = r;
    });
    const activePlans = Object.values(planMap).filter(p => p.cuota_actual < p.cuotas_totales);

    // Averages from last 3 complete months (months6[2..4])
    const last3 = months6.slice(2, 5).map(m => m.ym);
    const recAvg = gastos
      .filter(g => g.tipo_gasto === 'recurrente' && last3.includes(g.fecha.slice(0,7)) && g.incluido_en_gastos !== false)
      .reduce((s, g) => s + toDisp(g.monto, g.moneda || 'UYU'), 0) / 3;
    const ingAvg = last3.reduce((s, ym) => s + (byMonth6[ym]?.ing || 0), 0) / 3;

    // Casual avg — last 12 months excluding current month (rolling year)
    const all12YMs = new Set();
    for (let i = 12; i >= 1; i--) {
      const d = new Date(curY, curM - 1 - i, 1);
      all12YMs.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    }
    const isCasual = g => g.tipo_gasto !== 'recurrente' && (g.cuotas_totales || 1) <= 1 && g.incluido_en_gastos !== false;
    const casualRows = gastos.filter(g => isCasual(g) && all12YMs.has(g.fecha.slice(0,7)));
    const casualMonthsWithData = new Set(casualRows.map(g => g.fecha.slice(0,7)));
    const casualTotal = casualRows.reduce((s, g) => s + toDisp(g.monto, g.moneda || 'UYU'), 0);
    const casualAvg   = casualMonthsWithData.size > 0 ? casualTotal / casualMonthsWithData.size : 0;

    // 3-month projection
    const proj = Array.from({length: 3}, (_, idx) => {
      const i = idx + 1;
      const d = new Date(curY, curM - 1 + i, 1);
      const cuotasProy = activePlans
        .filter(p => (p.cuotas_totales - p.cuota_actual) >= i)
        .reduce((s, p) => s + toDisp(p.monto, p.moneda || 'UYU'), 0);
      const totalGasto = recAvg + casualAvg + cuotasProy;
      return {
        label:      d.toLocaleDateString('es-AR', {month: 'long'}),
        ingAvg, recAvg, casualAvg, cuotasProy,
        totalGasto, margen: ingAvg - totalGasto,
        pctComp:    ingAvg > 0 ? Math.min(100, totalGasto / ingAvg * 100) : 0,
      };
    });

    const dIng  = cur.ing - prev.ing;
    const dGas  = cur.gas - prev.gas;
    const dTasa = tasa - prevTasa;
    const sym   = mode === 'USD' ? '$' : '$U';

    const delta = (v, posIsGood = true) => {
      const good  = posIsGood ? v >= 0 : v <= 0;
      const color = good ? 'var(--green)' : 'var(--red)';
      const sign  = v >= 0 ? '+' : '';
      return `<span style="font-size:.65rem;font-family:'DM Mono',monospace;margin-top:5px;display:block;color:${color}">${sign}${fmtD(v)} vs mes ant.</span>`;
    };

    const monthTitle = now.toLocaleDateString('es-AR', {month: 'long', year: 'numeric'});
    const inp = 'background:var(--surface-alt);border:1px solid var(--border-strong);border-radius:8px;color:var(--text);padding:7px 10px;font-size:.82rem;font-family:DM Mono,monospace;outline:none';

    c.innerHTML = `
      <div class="g-sticky-header">
        <h1>Panorama</h1>
        <p class="page-subtitle">${monthTitle} · flujo de caja</p>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-bottom:8px">
          <div style="display:flex;gap:6px">
            <button id="pan-usd" class="g-tab${mode==='USD'?' active':''}" onclick="window.Mods.dashboard._setMode('USD')">USD</button>
            <button id="pan-uyu" class="g-tab${mode==='UYU'?' active':''}" onclick="window.Mods.dashboard._setMode('UYU')">UYU</button>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-family:'DM Mono',monospace;font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">TC $U/$</span>
            <input id="pan-tc" type="number" value="${tc}" min="1" step="0.5" style="${inp};width:72px">
            <button class="btn btn-ghost" style="padding:6px 12px;font-size:.72rem" onclick="window.Mods.dashboard._saveTc()">Aplicar</button>
          </div>
        </div>
      </div>

      <div class="metrics-row" style="margin-top:16px">
        <div class="metric-card">
          <div class="metric-label">Ingresos · jun.</div>
          <div class="metric-value pos">${fmtD(cur.ing)}</div>
          ${delta(dIng, true)}
        </div>
        <div class="metric-card">
          <div class="metric-label">Gastos · jun. <span style="font-size:.55rem;color:var(--text-sec)">(en curso)</span></div>
          <div class="metric-value">${fmtD(cur.gas)}</div>
          ${delta(dGas, false)}
        </div>
        <div class="metric-card">
          <div class="metric-label">Balance</div>
          <div class="metric-value ${plClass(balance)}">${plSign(balance)}${fmtD(balance)}</div>
          ${delta(balance - prevBal, true)}
        </div>
        <div class="metric-card">
          <div class="metric-label">Tasa de ahorro</div>
          <div class="metric-value ${plClass(tasa)}">${tasa}%</div>
          <span style="font-size:.65rem;font-family:'DM Mono',monospace;margin-top:5px;display:block;color:${dTasa>=0?'var(--green)':'var(--red)'}">
            ${dTasa>=0?'+':''}${dTasa}pp vs mes ant.
          </span>
        </div>
      </div>

      <div class="chart-card">
        <div style="font-family:'DM Mono',monospace;font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;color:var(--text-sec);margin-bottom:10px">
          Flujo de caja · últimos 6 meses (${mode})
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
                <span style="font-size:.82rem;color:var(--green)">${fmtD(p.ingAvg)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
                <span style="font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">Recurrentes</span>
                <span style="font-size:.82rem;color:var(--text-sec)">${fmtD(p.recAvg)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
                <span style="font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">Promedio casual</span>
                <span style="font-size:.82rem;color:var(--text-sec)">${fmtD(p.casualAvg)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
                <span style="font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">Cuotas</span>
                <span style="font-size:.82rem;color:var(--gold)">${fmtD(p.cuotasProy)}</span>
              </div>
              <div style="height:3px;background:rgba(255,255,255,.07);border-radius:2px;margin-bottom:10px;overflow:hidden">
                <div style="height:100%;width:${p.pctComp.toFixed(1)}%;background:${p.margen>=0?'var(--accent)':'var(--red)'};border-radius:2px"></div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;padding-top:8px;border-top:1px solid var(--border)">
                <span style="font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">Margen libre</span>
                <span style="font-size:.95rem;font-weight:600;color:${p.margen>=0?'var(--green)':'var(--red)'}">
                  ${plSign(p.margen)}${fmtD(p.margen)}
                </span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      ${activePlans.length > 0 ? `
        <div class="table-wrap">
          <div class="table-header">
            <span class="table-title">Cuotas activas · ${activePlans.length} planes</span>
          </div>
          <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
            <table style="min-width:360px">
              <thead><tr>
                <th>Comercio</th><th>Progreso</th><th>Mensual</th><th>Pendiente total</th>
              </tr></thead>
              <tbody>
                ${activePlans
                  .sort((a, b) => (b.cuotas_totales - b.cuota_actual) - (a.cuotas_totales - a.cuota_actual))
                  .map(p => {
                    const rem   = p.cuotas_totales - p.cuota_actual;
                    const cuota = toDisp(p.monto, p.moneda || 'UYU');
                    return `<tr>
                      <td>${p.comercio || '—'}</td>
                      <td style="color:var(--gold);font-family:'DM Mono',monospace;font-size:.75rem">${p.cuota_actual}/${p.cuotas_totales} · ${rem} rest.</td>
                      <td>${fmtD(cuota)}</td>
                      <td class="neg">${fmtD(cuota * rem)}</td>
                    </tr>`;
                  }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    `;

    // Trend chart
    const tickpfx = mode === 'USD' ? '$' : '$U ';
    Plotly.newPlot('pan-trend', [
      {
        x: months6.map(m => m.label),
        y: months6.map(m => byMonth6[m.ym].ing),
        name: 'Ingresos', type: 'bar',
        marker: {color: 'rgba(41,217,133,.75)'},
      },
      {
        x: months6.map(m => m.label),
        y: months6.map(m => byMonth6[m.ym].gas),
        name: 'Gastos', type: 'bar',
        marker: {color: 'rgba(46,127,217,.7)'},
      },
    ], {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor:  'rgba(0,0,0,0)',
      font: {color: '#cfcfcf', family: 'DM Sans, sans-serif', size: 11},
      dragmode: false,
      barmode: 'group',
      bargap: 0.25,
      bargroupgap: 0.08,
      margin: {t: 10, r: 10, b: 50, l: 65},
      xaxis: {fixedrange: true, gridcolor: 'rgba(255,255,255,.05)'},
      yaxis: {fixedrange: true, gridcolor: 'rgba(255,255,255,.05)', tickprefix: tickpfx},
      legend: {orientation: 'h', y: -0.28, x: 0.5, xanchor: 'center', font: {size: 11}},
    }, {displayModeBar: false, responsive: true, scrollZoom: false});
  },

  _setMode(mode) {
    this._mode = mode;
    localStorage.setItem('panorama_mode', mode);
    this.render();
  },

  async _saveTc() {
    const input = document.getElementById('pan-tc');
    const val   = parseFloat(input?.value);
    if (!val || val <= 0) return;
    this._tc = val;
    await setConfig('tipo_cambio', String(val));
    toast('Tipo de cambio actualizado');
    this.render();
  },
};
