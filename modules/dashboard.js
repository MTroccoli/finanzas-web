window.Mods = window.Mods || {};
window.Mods.dashboard = {
  async render() {
    const c = document.getElementById('content');
    const now  = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;
    const curYM = `${curY}-${String(curM).padStart(2,'0')}`;

    const start6 = new Date(curY, curM - 6, 1);
    const desde6 = `${start6.getFullYear()}-${String(start6.getMonth()+1).padStart(2,'0')}-01`;

    const [gastosRes, ingresosRes, cuotasRes, tcRaw] = await Promise.all([
      getDB().from('gastos')
        .select('fecha,monto,moneda,tipo_gasto,incluido_en_gastos,comercio,cuota_actual,cuotas_totales')
        .gte('fecha', desde6).order('fecha', {ascending:true}),
      getDB().from('ingresos')
        .select('fecha,monto,moneda')
        .gte('fecha', desde6).order('fecha', {ascending:true}),
      getDB().from('gastos')
        .select('comercio,monto,moneda,cuota_actual,cuotas_totales,fecha')
        .eq('tipo_gasto','cuota').order('fecha', {ascending:false}),
      getConfig('tipo_cambio'),
    ]);

    const gastos    = gastosRes.data   || [];
    const ingresos  = ingresosRes.data  || [];
    const allCuotas = cuotasRes.data    || [];
    const tc        = parseFloat(tcRaw) || 42;

    const toUSD = (n, mon) => {
      const v = parseFloat(n) || 0;
      return mon === 'USD' ? v : v / tc;
    };

    // 6-month grid
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(curY, curM - 1 - i, 1);
      months.push({
        ym:    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        label: d.toLocaleDateString('es-AR', {month:'short', year:'2-digit'}),
      });
    }

    const byMonth = {};
    months.forEach(m => { byMonth[m.ym] = { ing: 0, gas: 0 }; });

    gastos.filter(g => g.incluido_en_gastos !== false).forEach(g => {
      const ym = g.fecha.slice(0,7);
      if (byMonth[ym]) byMonth[ym].gas += toUSD(g.monto, g.moneda || 'UYU');
    });
    ingresos.forEach(i => {
      const ym = i.fecha.slice(0,7);
      if (byMonth[ym]) byMonth[ym].ing += toUSD(i.monto, i.moneda || 'USD');
    });

    const cur     = byMonth[curYM];
    const prev    = byMonth[months[4].ym];
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
    const activePlans = Object.values(planMap).filter(p => p.cuota_actual < p.cuotas_totales);

    // Averages from last 3 complete months
    const last3 = months.slice(2, 5).map(m => m.ym);
    const recAvg = gastos
      .filter(g => g.tipo_gasto === 'recurrente' && last3.includes(g.fecha.slice(0,7)) && g.incluido_en_gastos !== false)
      .reduce((s, g) => s + toUSD(g.monto, g.moneda || 'UYU'), 0) / 3;
    const ingAvg = last3.reduce((s, ym) => s + (byMonth[ym]?.ing || 0), 0) / 3;

    // 3-month projection
    const proj = Array.from({length: 3}, (_, idx) => {
      const i = idx + 1;
      const d = new Date(curY, curM - 1 + i, 1);
      const cuotasUSD = activePlans
        .filter(p => (p.cuotas_totales - p.cuota_actual) >= i)
        .reduce((s, p) => s + toUSD(p.monto, p.moneda || 'UYU'), 0);
      const compromisos = recAvg + cuotasUSD;
      return {
        label:     d.toLocaleDateString('es-AR', {month:'long'}),
        ingAvg, cuotasUSD, recAvg, compromisos,
        margen:    ingAvg - compromisos,
        pctComp:   ingAvg > 0 ? Math.min(100, compromisos / ingAvg * 100) : 0,
      };
    });

    const dIng  = cur.ing - prev.ing;
    const dGas  = cur.gas - prev.gas;
    const dTasa = tasa - prevTasa;

    const delta = (v, posIsGood = true) => {
      const good  = posIsGood ? v >= 0 : v <= 0;
      const color = good ? 'var(--green)' : 'var(--red)';
      const sign  = v >= 0 ? '+' : '';
      return `<span style="font-size:.65rem;font-family:'DM Mono',monospace;margin-top:5px;display:block;color:${color}">${sign}${fmtUSD(v)} vs mes ant.</span>`;
    };

    const monthTitle = now.toLocaleDateString('es-AR', {month:'long', year:'numeric'});

    c.innerHTML = `
      <div class="g-sticky-header">
        <h1>Panorama</h1>
        <p class="page-subtitle">${monthTitle} · flujo de caja</p>
      </div>

      <div class="metrics-row" style="margin-top:16px">
        <div class="metric-card">
          <div class="metric-label">Ingresos del mes</div>
          <div class="metric-value pos">${fmtUSD(cur.ing)}</div>
          ${delta(dIng, true)}
        </div>
        <div class="metric-card">
          <div class="metric-label">Gastos del mes</div>
          <div class="metric-value">${fmtUSD(cur.gas)}</div>
          ${delta(dGas, false)}
        </div>
        <div class="metric-card">
          <div class="metric-label">Balance</div>
          <div class="metric-value ${plClass(balance)}">${plSign(balance)}${fmtUSD(balance)}</div>
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
          Flujo de caja · últimos 6 meses (USD)
        </div>
        <div id="pan-trend" style="height:220px"></div>
      </div>

      <div style="font-family:'DM Mono',monospace;font-size:.68rem;text-transform:uppercase;letter-spacing:.12em;color:var(--text-sec);margin:4px 0 10px">
        Proyección · próximos 3 meses
      </div>
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:24px">
        <div style="display:grid;grid-template-columns:repeat(3,minmax(155px,1fr));gap:12px">
          ${proj.map(p => `
            <div class="card" style="padding:16px 14px">
              <div style="font-family:'Bebas Neue',sans-serif;font-size:1.25rem;letter-spacing:.06em;margin-bottom:10px;text-transform:capitalize">${p.label}</div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">
                <span style="font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">Ing. esperados</span>
                <span style="font-size:.82rem;color:var(--green)">${fmtUSD(p.ingAvg)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
                <span style="font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">Recurrentes</span>
                <span style="font-size:.82rem;color:var(--text-sec)">${fmtUSD(p.recAvg)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
                <span style="font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">Cuotas</span>
                <span style="font-size:.82rem;color:var(--gold)">${fmtUSD(p.cuotasUSD)}</span>
              </div>
              <div style="height:3px;background:rgba(255,255,255,.07);border-radius:2px;margin-bottom:10px;overflow:hidden">
                <div style="height:100%;width:${p.pctComp.toFixed(1)}%;background:${p.margen>=0?'var(--accent)':'var(--red)'};border-radius:2px"></div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;padding-top:8px;border-top:1px solid var(--border)">
                <span style="font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-sec)">Margen libre</span>
                <span style="font-size:.95rem;font-weight:600;color:${p.margen>=0?'var(--green)':'var(--red)'}">
                  ${plSign(p.margen)}${fmtUSD(p.margen)}
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
                    const rem  = p.cuotas_totales - p.cuota_actual;
                    const cuota = toUSD(p.monto, p.moneda || 'UYU');
                    return `<tr>
                      <td>${p.comercio || '—'}</td>
                      <td style="color:var(--gold);font-family:'DM Mono',monospace;font-size:.75rem">${p.cuota_actual}/${p.cuotas_totales} · ${rem} rest.</td>
                      <td>${fmtUSD(cuota)}</td>
                      <td class="neg">${fmtUSD(cuota * rem)}</td>
                    </tr>`;
                  }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    `;

    Plotly.newPlot('pan-trend', [
      {
        x: months.map(m => m.label),
        y: months.map(m => byMonth[m.ym].ing),
        name: 'Ingresos', type: 'bar',
        marker: { color: 'rgba(41,217,133,.75)' },
      },
      {
        x: months.map(m => m.label),
        y: months.map(m => byMonth[m.ym].gas),
        name: 'Gastos', type: 'bar',
        marker: { color: 'rgba(46,127,217,.7)' },
      },
    ], {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor:  'rgba(0,0,0,0)',
      font: { color: '#cfcfcf', family: 'DM Sans, sans-serif', size: 11 },
      dragmode: false,
      barmode: 'group',
      bargap: 0.25,
      bargroupgap: 0.08,
      margin: { t: 10, r: 10, b: 50, l: 55 },
      xaxis: { fixedrange: true, gridcolor: 'rgba(255,255,255,.05)' },
      yaxis: { fixedrange: true, gridcolor: 'rgba(255,255,255,.05)', tickprefix: '$' },
      legend: { orientation: 'h', y: -0.28, x: 0.5, xanchor: 'center', font: {size:11} },
      showlegend: true,
    }, { displayModeBar: false, responsive: true, scrollZoom: false });
  },
};
