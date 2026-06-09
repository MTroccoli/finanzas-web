window.Mods = window.Mods || {};
window.Mods.dashboard = {
  async render() {
    const c = document.getElementById('content');
    const now   = new Date();
    const y     = now.getFullYear();
    const m     = String(now.getMonth() + 1).padStart(2, '0');
    const desde = `${y}-${m}-01`;

    const [ops, gastosMes, ingresosMes] = await Promise.all([
      dbFetch('operaciones', { order: { col: 'fecha', asc: false }, limit: 5 }),
      dbFetch('gastos',    { order: { col: 'fecha', asc: false }, limit: 200 }),
      dbFetch('ingresos',  { order: { col: 'fecha', asc: false }, limit: 200 }),
    ]);

    const gastosMesTotal   = gastosMes.filter(g => g.fecha >= desde).reduce((s, g) => s + parseFloat(g.monto), 0);
    const ingresosMesTotal = ingresosMes.filter(i => i.fecha >= desde).reduce((s, i) => s + parseFloat(i.monto), 0);
    const balance          = ingresosMesTotal - gastosMesTotal;

    // Portfolio value from last ops
    const pos = {};
    const allOps = await dbFetch('operaciones', { order: { col: 'fecha', asc: true } });
    for (const op of allOps) {
      if (!pos[op.ticker]) pos[op.ticker] = { qty: 0, costBasis: 0 };
      const p = pos[op.ticker];
      if (op.tipo === 'compra') {
        p.costBasis = (p.costBasis * p.qty + op.precio_unitario * op.cantidad) / (p.qty + op.cantidad);
        p.qty += parseFloat(op.cantidad);
      } else {
        p.qty -= parseFloat(op.cantidad);
      }
    }
    const positions = Object.values(pos).filter(p => p.qty > 0.0001);
    const portfolioCost = positions.reduce((s, p) => s + p.costBasis * p.qty, 0);

    c.innerHTML = `
      <h1>Dashboard</h1>
      <p class="page-subtitle">${now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</p>

      <div class="metrics-row">
        <div class="metric-card">
          <div class="metric-label">Portafolio (costo base)</div>
          <div class="metric-value">${fmtUSD(portfolioCost)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Gastos del mes</div>
          <div class="metric-value neg">${fmtUSD(gastosMesTotal)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Ingresos del mes</div>
          <div class="metric-value pos">${fmtUSD(ingresosMesTotal)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Balance del mes</div>
          <div class="metric-value ${plClass(balance)}">${plSign(balance)}${fmtUSD(balance)}</div>
        </div>
      </div>

      ${ops.length > 0 ? `
        <div class="table-wrap">
          <div class="table-header">
            <span class="table-title">Últimas operaciones</span>
            <a href="#inversiones/operaciones" class="btn btn-ghost" style="font-size:.7rem;padding:6px 12px">Ver todas →</a>
          </div>
          <table>
            <thead><tr><th>Fecha</th><th>Ticker</th><th>Tipo</th><th>Monto</th></tr></thead>
            <tbody>
              ${ops.map(op => `
                <tr>
                  <td>${fmtDate(op.fecha)}</td>
                  <td><strong>${op.ticker}</strong></td>
                  <td><span class="tag ${op.tipo === 'compra' ? 'tag-buy' : 'tag-sell'}">${op.tipo}</span></td>
                  <td>${fmtUSD(op.cantidad * op.precio_unitario)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    `;
  },
};
