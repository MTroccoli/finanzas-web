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

  // ── Mercado — búsqueda live ──────────────────────────────────────────
  async renderMercado() {
    const c = document.getElementById('content');
    const guardados = await dbFetch('precios_historicos', {
      order: { col: 'fecha', asc: false }, limit: 200,
    });
    const lastByTicker = {};
    for (const r of guardados) {
      if (!lastByTicker[r.ticker]) lastByTicker[r.ticker] = r;
    }
    const rows = Object.values(lastByTicker);

    c.innerHTML = `
      <h1>Mercado</h1>
      <p class="page-subtitle">Precios en tiempo real</p>

      <div class="form-card">
        <h3>Buscar ticker</h3>
        <div style="display:flex;gap:10px;align-items:flex-end">
          <div class="form-group" style="flex:1;margin:0">
            <label>Símbolo</label>
            <input id="ticker-input" type="text" placeholder="AAPL, MSFT, BMA.BA..."
              style="text-transform:uppercase" autocomplete="off">
          </div>
          <button id="btn-buscar" class="btn btn-primary" style="height:38px">Buscar</button>
          <button id="btn-guardar" class="btn btn-ghost" style="height:38px;display:none">
            💾 Guardar en Supabase
          </button>
        </div>
        <div id="ticker-result" style="margin-top:16px"></div>
      </div>

      <div class="table-wrap">
        <div class="table-header">
          <span class="table-title">Precios guardados en Supabase</span>
        </div>
        ${rows.length === 0 ? `
          <div class="empty">
            <div class="empty-icon">📡</div>
            <div class="empty-text">Buscá un ticker y guardalo, o corré <code>actualizar_precios.py</code></div>
          </div>
        ` : `
          <table>
            <thead>
              <tr><th>Ticker</th><th>Fecha</th><th>Cierre</th><th>Apertura</th><th>Máx</th><th>Mín</th></tr>
            </thead>
            <tbody id="precios-tbody">
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

    let _lastInfo = null;

    const buscar = async () => {
      const ticker = document.getElementById('ticker-input').value.trim().toUpperCase();
      if (!ticker) return;
      const res = document.getElementById('ticker-result');
      const btnGuardar = document.getElementById('btn-guardar');
      res.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
      btnGuardar.style.display = 'none';
      _lastInfo = null;
      try {
        const info = await this.fetchYahooPrice(ticker);
        _lastInfo = info;
        const plCls = info.change >= 0 ? 'pos' : 'neg';
        const sign  = info.change >= 0 ? '+' : '';
        res.innerHTML = `
          <div class="metrics-row" style="margin:0">
            <div class="metric-card">
              <div class="metric-label">${info.name}</div>
              <div class="metric-value">${fmtUSD(info.price)}</div>
              <div class="metric-delta ${plCls}">${sign}${fmtUSD(info.change)} (${sign}${fmt(info.pct)}%)</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Apertura</div>
              <div class="metric-value" style="font-size:1.4rem">${fmtUSD(info.open)}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Máx / Mín</div>
              <div class="metric-value" style="font-size:1.2rem">${fmtUSD(info.high)}</div>
              <div class="metric-delta neu">${fmtUSD(info.low)}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Cierre anterior</div>
              <div class="metric-value" style="font-size:1.4rem">${fmtUSD(info.prev)}</div>
            </div>
          </div>
        `;
        btnGuardar.style.display = 'inline-flex';
      } catch(e) {
        res.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">${e.message}</div></div>`;
      }
    };

    document.getElementById('btn-buscar').addEventListener('click', buscar);
    document.getElementById('ticker-input').addEventListener('keydown', e => { if (e.key === 'Enter') buscar(); });

    document.getElementById('btn-guardar').addEventListener('click', async () => {
      if (!_lastInfo) return;
      try {
        await dbUpsert('activos', { ticker: _lastInfo.ticker, tipo: 'accion' });
        await dbUpsert('precios_historicos', {
          ticker:         _lastInfo.ticker,
          fecha:          new Date().toISOString().slice(0, 10),
          cierre:         _lastInfo.price,
          apertura:       _lastInfo.open,
          maximo:         _lastInfo.high,
          minimo:         _lastInfo.low,
          cierre_ajustado: _lastInfo.price,
        });
        toast('✅ Precio guardado en Supabase');
        document.getElementById('btn-guardar').style.display = 'none';
      } catch(e) {
        toast('❌ ' + e.message, 'err');
      }
    });
  },

  async fetchYahooPrice(ticker) {
    const urls = [
      `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
      `https://corsproxy.io/?${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`)}`,
    ];
    for (const url of urls) {
      try {
        const res  = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        const r    = json.chart?.result?.[0];
        if (!r) continue;
        const meta  = r.meta;
        const price = meta.regularMarketPrice;
        const prev  = meta.previousClose ?? meta.chartPreviousClose ?? price;
        return {
          ticker:   meta.symbol,
          name:     meta.shortName ?? meta.symbol,
          price,
          prev,
          open:     meta.regularMarketOpen   ?? price,
          high:     meta.regularMarketDayHigh ?? price,
          low:      meta.regularMarketDayLow  ?? price,
          change:   price - prev,
          pct:      prev ? ((price - prev) / prev) * 100 : 0,
          currency: meta.currency,
        };
      } catch (_) { /* intenta siguiente */ }
    }
    throw new Error('No se pudo obtener el precio. Verificá el ticker.');
  },

  // ── Portafolio ───────────────────────────────────────────────────────
  async renderPortafolio() {
    const c = document.getElementById('content');
    try {
      const [allOps, precios] = await Promise.all([
        dbFetch('operaciones', { order: { col: 'fecha', asc: true } }),
        dbFetch('precios_historicos', { order: { col: 'fecha', asc: false }, limit: 500 }),
      ]);

      // Último precio por ticker
      const lastPrice = {};
      for (const r of precios) {
        if (!lastPrice[r.ticker]) lastPrice[r.ticker] = parseFloat(r.cierre);
      }

      // Calcular posiciones — con parseFloat explícito para tipos NUMERIC de Postgres
      const pos = {};
      for (const op of allOps) {
        const qty   = parseFloat(op.cantidad);
        const price = parseFloat(op.precio_unitario);
        if (!pos[op.ticker]) pos[op.ticker] = { ticker: op.ticker, qty: 0, costBasis: 0 };
        const p = pos[op.ticker];
        if (op.tipo === 'compra') {
          p.costBasis = (p.costBasis * p.qty + price * qty) / (p.qty + qty);
          p.qty += qty;
        } else {
          p.qty -= qty;
        }
      }

      const positions   = Object.values(pos).filter(p => p.qty > 0.0001);
      const totalCost   = positions.reduce((s, p) => s + p.costBasis * p.qty, 0);
      const totalMarket = positions.reduce((s, p) => s + (lastPrice[p.ticker] ?? p.costBasis) * p.qty, 0);
      const totalPL     = totalMarket - totalCost;

      c.innerHTML = `
        <h1>Portafolio</h1>
        <p class="page-subtitle">Posiciones abiertas · ${positions.length} ticker${positions.length !== 1 ? 's' : ''}</p>

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
          <div class="metric-card">
            <div class="metric-label">P&L %</div>
            <div class="metric-value ${plClass(totalPL)}" style="font-size:1.5rem">
              ${totalCost ? `${plSign(totalPL)}${fmt((totalPL / totalCost) * 100)}%` : '—'}
            </div>
          </div>
        </div>

        <div class="table-wrap">
          <div class="table-header">
            <span class="table-title">Posiciones</span>
            <a href="#inversiones/operaciones" class="btn btn-ghost" style="font-size:.7rem;padding:6px 12px">+ Nueva operación</a>
          </div>
          ${positions.length === 0 ? `
            <div class="empty">
              <div class="empty-icon">📋</div>
              <div class="empty-text">Sin posiciones · cargá operaciones primero</div>
            </div>
          ` : `
            <table>
              <thead>
                <tr>
                  <th>Ticker</th><th>Cantidad</th><th>Precio prom.</th>
                  <th>Precio actual</th><th>Valor</th><th>P&L</th><th>P&L %</th>
                </tr>
              </thead>
              <tbody>
                ${positions.map(p => {
                  const current = lastPrice[p.ticker] ?? p.costBasis;
                  const value   = current * p.qty;
                  const pl      = (current - p.costBasis) * p.qty;
                  const plPct   = p.costBasis ? ((current - p.costBasis) / p.costBasis) * 100 : 0;
                  const hasPx   = !!lastPrice[p.ticker];
                  return `
                    <tr>
                      <td><strong>${p.ticker}</strong></td>
                      <td>${fmt(p.qty, 4)}</td>
                      <td>${fmtUSD(p.costBasis)}</td>
                      <td>${hasPx ? fmtUSD(current) : '<span class="neu">sin precio</span>'}</td>
                      <td>${hasPx ? fmtUSD(value) : '—'}</td>
                      <td class="${hasPx ? plClass(pl) : 'neu'}">${hasPx ? plSign(pl) + fmtUSD(pl) : '—'}</td>
                      <td class="${hasPx ? plClass(plPct) : 'neu'}">${hasPx ? plSign(plPct) + fmt(plPct) + '%' : '—'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          `}
        </div>
        ${positions.length > 0 && Object.keys(lastPrice).length === 0 ? `
          <p style="font-family:'DM Mono',monospace;font-size:.7rem;color:var(--text-sec);text-align:center">
            💡 Buscá los tickers en Mercado y guardalos para ver el P&L actualizado
          </p>
        ` : ''}
      `;
    } catch(e) {
      c.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">Error: ${e.message}</div></div>`;
    }
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
            <input id="op-notas" type="text" placeholder="Compra DCA mensual...">
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
              <tr><th>Fecha</th><th>Ticker</th><th>Tipo</th><th>Cantidad</th><th>Precio</th><th>Monto</th><th>Comisión</th></tr>
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
        await dbUpsert('activos', { ticker, tipo: 'accion' });
        await dbInsert('operaciones', {
          ticker, tipo, fecha, cantidad: qty,
          precio_unitario: precio, comision: com,
          notas: notas || null,
        });
        toast('✅ Operación registrada');
        e.target.reset();
        document.getElementById('op-fecha').value = new Date().toISOString().slice(0,10);
        const newOps = await dbFetch('operaciones', { order: { col: 'fecha', asc: false }, limit: 50 });
        const tbody  = document.getElementById('ops-tbody');
        if (tbody) tbody.innerHTML = newOps.map(op => this._opRow(op)).join('');
      } catch(err) { toast('❌ ' + err.message, 'err'); }
    });
  },

  _opRow(op) {
    const monto = op.monto_total ?? (parseFloat(op.cantidad) * parseFloat(op.precio_unitario) + parseFloat(op.comision || 0));
    return `<tr>
      <td>${fmtDate(op.fecha)}</td>
      <td><strong>${op.ticker}</strong></td>
      <td><span class="tag ${op.tipo === 'compra' ? 'tag-buy' : 'tag-sell'}">${op.tipo}</span></td>
      <td>${fmt(parseFloat(op.cantidad), 4)}</td>
      <td>${fmtUSD(parseFloat(op.precio_unitario))}</td>
      <td>${fmtUSD(monto)}</td>
      <td>${op.comision ? fmtUSD(parseFloat(op.comision)) : '—'}</td>
    </tr>`;
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
