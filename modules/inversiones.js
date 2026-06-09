window.Mods = window.Mods || {};
window.Mods.inversiones = {

  async render(sub = 'mercado') {
    switch (sub) {
      case 'portafolio':   return this.renderPortafolio();
      case 'operaciones':  return this.renderOperaciones();
      case 'rentabilidad': return this.renderRentabilidad();
      default:             return this.renderMercado();
    }
  },

  // ── Mercado ──────────────────────────────────────────────────────────
  async renderMercado() {
    const c = document.getElementById('content');
    const precios = await dbFetch('precios_historicos', {
      order: { col: 'fecha', asc: false },
      limit: 200,
    });

    // Last price per ticker
    const map = {};
    for (const r of precios) {
      if (!map[r.ticker]) map[r.ticker] = r;
    }
    const rows = Object.values(map);

    c.innerHTML = `
      <h1>Mercado</h1>
      <p class="page-subtitle">Últimos precios registrados · actualizar con <code>python actualizar_precios.py</code></p>
      <div class="table-wrap">
        <div class="table-header">
          <span class="table-title">Precios</span>
        </div>
        ${rows.length === 0 ? `
          <div class="empty">
            <div class="empty-icon">📡</div>
            <div class="empty-text">Sin datos · corré el script de precios</div>
          </div>
        ` : `
          <table>
            <thead>
              <tr>
                <th>Ticker</th><th>Fecha</th><th>Cierre</th><th>Apertura</th><th>Máx</th><th>Mín</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td><strong>${r.ticker}</strong></td>
                  <td>${fmtDate(r.fecha)}</td>
                  <td><strong>${fmtUSD(r.cierre)}</strong></td>
                  <td>${fmtUSD(r.apertura)}</td>
                  <td>${fmtUSD(r.maximo)}</td>
                  <td>${fmtUSD(r.minimo)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;
  },

  // ── Portafolio ───────────────────────────────────────────────────────
  async renderPortafolio() {
    const c = document.getElementById('content');

    // Calcular posiciones desde operaciones
    const ops = await dbFetch('operaciones', { order: { col: 'fecha', asc: true } });
    const precios = await dbFetch('precios_historicos', { order: { col: 'fecha', asc: false }, limit: 500 });

    // Last price per ticker
    const lastPrice = {};
    for (const r of precios) {
      if (!lastPrice[r.ticker]) lastPrice[r.ticker] = r.cierre;
    }

    // Aggregate positions (FIFO simplified: just track quantity & avg cost)
    const pos = {};
    for (const op of ops) {
      if (!pos[op.ticker]) pos[op.ticker] = { ticker: op.ticker, qty: 0, costBasis: 0 };
      const p = pos[op.ticker];
      if (op.tipo === 'compra') {
        p.costBasis = (p.costBasis * p.qty + op.precio_unitario * op.cantidad) / (p.qty + op.cantidad);
        p.qty += parseFloat(op.cantidad);
      } else {
        p.qty -= parseFloat(op.cantidad);
      }
    }

    const positions = Object.values(pos).filter(p => p.qty > 0.0001);
    const totalCost   = positions.reduce((s, p) => s + p.costBasis * p.qty, 0);
    const totalMarket = positions.reduce((s, p) => s + (lastPrice[p.ticker] ?? p.costBasis) * p.qty, 0);
    const totalPL     = totalMarket - totalCost;

    c.innerHTML = `
      <h1>Portafolio</h1>
      <p class="page-subtitle">Posiciones abiertas</p>
      <div class="metrics-row">
        <div class="metric-card">
          <div class="metric-label">Valor de mercado</div>
          <div class="metric-value">${fmtUSD(totalMarket)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Costo base</div>
          <div class="metric-value">${fmtUSD(totalCost)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">P&L no realizado</div>
          <div class="metric-value ${plClass(totalPL)}">${plSign(totalPL)}${fmtUSD(totalPL)}</div>
        </div>
      </div>
      <div class="table-wrap">
        <div class="table-header"><span class="table-title">Posiciones</span></div>
        ${positions.length === 0 ? `
          <div class="empty">
            <div class="empty-icon">📋</div>
            <div class="empty-text">Sin posiciones abiertas</div>
          </div>
        ` : `
          <table>
            <thead>
              <tr>
                <th>Ticker</th><th>Cantidad</th><th>Precio prom.</th><th>Precio actual</th><th>Valor</th><th>P&L</th><th>P&L %</th>
              </tr>
            </thead>
            <tbody>
              ${positions.map(p => {
                const current = lastPrice[p.ticker] ?? p.costBasis;
                const value   = current * p.qty;
                const pl      = (current - p.costBasis) * p.qty;
                const plPct   = ((current - p.costBasis) / p.costBasis) * 100;
                return `
                  <tr>
                    <td><strong>${p.ticker}</strong></td>
                    <td>${fmt(p.qty, 4)}</td>
                    <td>${fmtUSD(p.costBasis)}</td>
                    <td>${fmtUSD(current)}</td>
                    <td>${fmtUSD(value)}</td>
                    <td class="${plClass(pl)}">${plSign(pl)}${fmtUSD(pl)}</td>
                    <td class="${plClass(plPct)}">${plSign(plPct)}${fmt(plPct)}%</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;
  },

  // ── Operaciones ──────────────────────────────────────────────────────
  async renderOperaciones() {
    const c = document.getElementById('content');
    const ops = await dbFetch('operaciones', { order: { col: 'fecha', asc: false }, limit: 50 });

    c.innerHTML = `
      <h1>Operaciones</h1>
      <p class="page-subtitle">Registrar compras y ventas</p>

      <div class="form-card">
        <h3>Nueva operación</h3>
        <form id="form-op">
          <div class="form-grid">
            <div class="form-group">
              <label>Ticker</label>
              <input id="op-ticker" type="text" placeholder="AAPL" style="text-transform:uppercase" required>
            </div>
            <div class="form-group">
              <label>Tipo</label>
              <select id="op-tipo">
                <option value="compra">Compra</option>
                <option value="venta">Venta</option>
              </select>
            </div>
            <div class="form-group">
              <label>Fecha</label>
              <input id="op-fecha" type="date" value="${new Date().toISOString().slice(0,10)}" required>
            </div>
            <div class="form-group">
              <label>Cantidad</label>
              <input id="op-cantidad" type="number" step="0.0001" min="0.0001" placeholder="10" required>
            </div>
            <div class="form-group">
              <label>Precio unitario (USD)</label>
              <input id="op-precio" type="number" step="0.01" min="0.01" placeholder="150.00" required>
            </div>
            <div class="form-group">
              <label>Comisión (USD)</label>
              <input id="op-comision" type="number" step="0.01" min="0" placeholder="0" value="0">
            </div>
          </div>
          <div class="form-group" style="margin-bottom:16px">
            <label>Notas (opcional)</label>
            <input id="op-notas" type="text" placeholder="Compra por DCA mensual...">
          </div>
          <button type="submit" class="btn btn-primary">✚ Registrar operación</button>
        </form>
      </div>

      <div class="table-wrap">
        <div class="table-header"><span class="table-title">Últimas 50 operaciones</span></div>
        ${ops.length === 0 ? `
          <div class="empty">
            <div class="empty-icon">🔄</div>
            <div class="empty-text">Sin operaciones registradas</div>
          </div>
        ` : `
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Ticker</th><th>Tipo</th><th>Cantidad</th><th>Precio</th><th>Monto</th><th>Comisión</th>
              </tr>
            </thead>
            <tbody id="ops-tbody">
              ${ops.map(op => this._opRow(op)).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;

    document.getElementById('form-op').addEventListener('submit', async (e) => {
      e.preventDefault();
      const ticker = document.getElementById('op-ticker').value.trim().toUpperCase();
      const tipo   = document.getElementById('op-tipo').value;
      const fecha  = document.getElementById('op-fecha').value;
      const qty    = parseFloat(document.getElementById('op-cantidad').value);
      const precio = parseFloat(document.getElementById('op-precio').value);
      const com    = parseFloat(document.getElementById('op-comision').value) || 0;
      const notas  = document.getElementById('op-notas').value.trim();

      try {
        // Upsert activo si no existe
        await dbUpsert('activos', { ticker, tipo: 'accion' });

        // Insertar operación
        await dbInsert('operaciones', { ticker, tipo, fecha, cantidad: qty, precio_unitario: precio, comision: com, notas: notas || null });

        toast('✅ Operación registrada');
        e.target.reset();
        document.getElementById('op-fecha').value = new Date().toISOString().slice(0,10);

        // Refrescar tabla
        const newOps = await dbFetch('operaciones', { order: { col: 'fecha', asc: false }, limit: 50 });
        const tbody = document.getElementById('ops-tbody');
        if (tbody) {
          tbody.innerHTML = newOps.map(op => this._opRow(op)).join('');
        }
      } catch(err) {
        toast('❌ ' + err.message, 'err');
      }
    });
  },

  _opRow(op) {
    const monto = op.monto_total ?? (op.cantidad * op.precio_unitario + (op.comision || 0));
    return `
      <tr>
        <td>${fmtDate(op.fecha)}</td>
        <td><strong>${op.ticker}</strong></td>
        <td><span class="tag ${op.tipo === 'compra' ? 'tag-buy' : 'tag-sell'}">${op.tipo}</span></td>
        <td>${fmt(op.cantidad, 4)}</td>
        <td>${fmtUSD(op.precio_unitario)}</td>
        <td>${fmtUSD(monto)}</td>
        <td>${op.comision ? fmtUSD(op.comision) : '—'}</td>
      </tr>
    `;
  },

  // ── Rentabilidad ─────────────────────────────────────────────────────
  async renderRentabilidad() {
    document.getElementById('content').innerHTML = `
      <div class="placeholder-mod">
        <div class="ph-icon">📊</div>
        <div class="ph-title">Rentabilidad</div>
        <div class="ph-text">Próximamente · requiere historial de snapshots</div>
      </div>
    `;
  },
};
