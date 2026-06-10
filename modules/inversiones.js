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

    const guardados = await dbFetch('precios_historicos', { order: { col: 'fecha', asc: false }, limit: 200 });
    const lastByTicker = {};
    for (const r of guardados) { if (!lastByTicker[r.ticker]) lastByTicker[r.ticker] = r; }
    const savedRows = Object.values(lastByTicker);

    const PERIODS = [
      { label: '1D',  value: '1d',  interval: '5m'  },
      { label: '5D',  value: '5d',  interval: '1h'  },
      { label: '1M',  value: '1mo', interval: '1d'  },
      { label: '6M',  value: '6mo', interval: '1d'  },
      { label: '1A',  value: '1y',  interval: '1wk' },
      { label: '5A',  value: '5y',  interval: '1wk' },
      { label: '10A', value: '10y', interval: '1mo' },
    ];

    const TYPE_BADGE = {
      equity: '🟩 Acción', etf: '🟦 ETF', mutualfund: '🟪 Fondo',
      cryptocurrency: '🟨 Crypto', index: '⬛ Índice',
    };

    const fmtVol = n => {
      if (!n) return '—';
      if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
      return n.toLocaleString();
    };

    const fmtCap = n => {
      if (!n) return null;
      if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
      if (n >= 1e9)  return '$' + (n / 1e9).toFixed(1) + 'B';
      if (n >= 1e6)  return '$' + (n / 1e6).toFixed(0) + 'M';
      return '$' + n.toLocaleString();
    };

    c.innerHTML = `
      <h1>Mercado</h1>
      <p class="page-subtitle">Cotizaciones en tiempo real · multi-moneda</p>

      <div class="form-card">
        <h3>Buscar activo</h3>
        <div style="display:flex;gap:10px;align-items:flex-end">
          <div class="form-group" style="flex:1;margin:0">
            <input id="mkt-q" type="text"
              placeholder="AAPL, Apple, Shell, BMA.BA, Bitcoin..." autocomplete="off">
          </div>
          <button id="btn-mkt-search" class="btn btn-primary" style="height:38px">Buscar</button>
        </div>
        <div id="mkt-results" style="margin-top:12px"></div>
      </div>

      <!-- Detalle del activo seleccionado -->
      <div id="mkt-detail" class="hidden">

        <!-- Card con precio + todas las métricas -->
        <div class="form-card" id="mkt-price-card"></div>

        <!-- Card con selector de período + gráfico -->
        <div class="form-card" id="mkt-chart-card" style="padding-bottom:8px">
          <div id="mkt-period-btns" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div>
          <div style="position:relative">
            <div id="mkt-chart-overlay" style="
              display:none;position:absolute;inset:0;z-index:5;border-radius:4px;
              align-items:center;justify-content:center;
              background:rgba(4,15,32,.65)">
              <div class="spinner"></div>
            </div>
            <div id="mkt-chart" style="width:100%;height:280px"></div>
          </div>
        </div>
      </div>

      <!-- Precios guardados -->
      <div class="table-wrap">
        <div class="table-header">
          <span class="table-title">Historial de precios guardados</span>
          <span style="font-size:.68rem;color:var(--text-sec);font-family:'DM Mono',monospace">
            Usado por el Portafolio para P&L
          </span>
        </div>
        ${savedRows.length === 0 ? `
          <div class="empty">
            <div class="empty-icon">📡</div>
            <div class="empty-text">Buscá un ticker, abrí su detalle y usá "Guardar P&L" para registrar el precio</div>
          </div>
        ` : `
          <table>
            <thead><tr><th>Ticker</th><th>Fecha</th><th>Cierre</th><th>Apertura</th><th>Máx</th><th>Mín</th></tr></thead>
            <tbody>
              ${savedRows.map(r => {
                const mon  = r.moneda || 'USD';
                const isUSD = mon === 'USD';
                const fmtP = (orig, usd) => orig != null
                  ? (isUSD ? fmtUSD(orig) : `${fmt(orig)} <span style="font-size:.65rem;color:var(--text-sec)">${mon}</span>`)
                  : fmtUSD(usd);
                return `
                  <tr>
                    <td><strong style="cursor:pointer;color:var(--accent)"
                      onclick="document.getElementById('mkt-q').value='${r.ticker}';
                               document.getElementById('btn-mkt-search').click()"
                    >${r.ticker}</strong></td>
                    <td>${fmtDate(r.fecha)}</td>
                    <td><strong>${fmtP(r.cierre_orig, r.cierre)}</strong></td>
                    <td>${fmtP(r.apertura_orig, r.apertura)}</td>
                    <td>${fmtP(r.maximo_orig, r.maximo)}</td>
                    <td>${fmtP(r.minimo_orig, r.minimo)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;

    let _activePeriod = '1mo';
    let _activeInfo   = null;

    // ── Gráfico — fix: usar overlay + Plotly.newPlot (no react) ──────
    const loadChart = async (ticker, period) => {
      const pd = PERIODS.find(p => p.value === period) || PERIODS[2];

      // Actualizar botones de período
      document.querySelectorAll('.mkt-period-btn').forEach(b => {
        const on = b.dataset.period === period;
        b.style.background  = on ? 'var(--accent)' : 'transparent';
        b.style.color       = on ? '#fff' : 'var(--text-sec)';
        b.style.borderColor = on ? 'var(--accent)' : 'rgba(255,255,255,.15)';
      });

      // Mostrar overlay SIN tocar el div del gráfico
      const overlay  = document.getElementById('mkt-chart-overlay');
      const chartDiv = document.getElementById('mkt-chart');
      if (!chartDiv) return;
      if (overlay) overlay.style.display = 'flex';

      try {
        const { dates, prices } = await this.fetchYahooChart(ticker, period, pd.interval);

        if (overlay) overlay.style.display = 'none';

        if (!prices.length) {
          try { Plotly.purge('mkt-chart'); } catch(_) {}
          chartDiv.innerHTML = '<div class="empty" style="height:200px;display:flex;align-items:center;justify-content:center"><div class="empty-text">Sin datos para este período</div></div>';
          return;
        }

        const first  = prices[0], last = prices[prices.length - 1];
        const chgPct = first ? ((last - first) / first) * 100 : 0;
        const isUp   = chgPct >= 0;
        const color  = isUp ? '#26a69a' : '#ef5350';
        const cur    = _activeInfo?.currency || 'USD';

        // Formato de fecha adaptado al período seleccionado
        const xTickFmt = period === '1d'  ? '%H:%M'
          : ['5d','1mo','3mo'].includes(period) ? '%d %b'
          : '%b %y';

        try { Plotly.purge('mkt-chart'); } catch(_) {}
        Plotly.newPlot('mkt-chart', [{
          x: dates, y: prices,
          type: 'scatter', mode: 'lines',
          fill: 'tozeroy',
          fillcolor: isUp ? 'rgba(38,166,154,0.12)' : 'rgba(239,83,80,0.12)',
          line: { color, width: 2 },
          hovertemplate: `%{y:,.0f} ${cur}<extra></extra>`,
          hoverlabel: {
            bgcolor: color, bordercolor: 'rgba(0,0,0,0)',
            font: { color: '#fff', size: 11, family: "'DM Mono', monospace" },
            namelength: 0,
          },
        }], {
          height: 280,
          margin: { l: 50, r: 8, t: 32, b: 28 },
          plot_bgcolor:  '#071E3D',
          paper_bgcolor: 'rgba(0,0,0,0)',
          font: { color: '#8096b0', size: 11, family: "'DM Mono', monospace" },
          title: {
            text: `${isUp ? '▲' : '▼'} ${Math.abs(chgPct).toFixed(2)}% en ${pd.label}`,
            font: { size: 12, color }, x: 0.01,
          },
          dragmode: false,
          xaxis: {
            showgrid: false, color: '#3d5568',
            tickformat: xTickFmt, hoverformat: '%d %b',
            tickfont: { size: 10, color: '#6a88a0', family: "'DM Sans', sans-serif" },
            showspikes: true, spikemode: 'across',
            spikecolor: '#546272', spikethickness: 1, spikedash: 'dot',
            showline: false, zeroline: false,
          },
          yaxis: {
            showgrid: true, gridcolor: '#0d2848', griddash: 'dot', color: '#3d5568',
            tickfont: { size: 10, color: '#6a88a0', family: "'DM Mono', monospace" },
            nticks: 5,
            showspikes: false, showline: false, zeroline: false,
            range: [Math.min(...prices) * 0.995, Math.max(...prices) * 1.005],
            tickformat: ',.2f',
          },
          hovermode: 'x', showlegend: false,
        }, { responsive: true, displayModeBar: false, scrollZoom: false });

        // Bloquear pinch-zoom directamente en el elemento — se agrega una sola vez
        if (!chartDiv.dataset.noZoom) {
          chartDiv.dataset.noZoom = '1';
          ['touchstart','touchmove'].forEach(t =>
            chartDiv.addEventListener(t, e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false })
          );
          ['gesturestart','gesturechange','gestureend'].forEach(t =>
            chartDiv.addEventListener(t, e => e.preventDefault(), { passive: false })
          );
        }

      } catch(e) {
        if (overlay) overlay.style.display = 'none';
        try { Plotly.purge('mkt-chart'); } catch(_) {}
        chartDiv.innerHTML = `<div class="empty" style="height:180px;display:flex;align-items:center;justify-content:center"><div class="empty-text">⚠️ ${e.message}</div></div>`;
      }
    };

    // ── Detalle del activo ────────────────────────────────────────────
    const renderDetail = async (ticker, nombre, exchange, tipo) => {
      _activeInfo = null;
      const detail = document.getElementById('mkt-detail');
      detail.classList.remove('hidden');
      document.getElementById('mkt-price-card').innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;color:var(--text-sec);
          font-family:'DM Mono',monospace;font-size:.75rem">
          <div class="spinner" style="width:16px;height:16px;border-width:2px;flex-shrink:0"></div>
          Cargando ${ticker}...
        </div>
      `;
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      try {
        // Precio base + datos financieros en paralelo (best-effort)
        const [info, quote] = await Promise.all([
          this.fetchYahooPrice(ticker),
          this.fetchYahooQuote(ticker).catch(() => null),
        ]);
        _activeInfo = info;

        const { moneda: monedaNorm, factor } = this.normalizarMoneda(info.currency);
        const priceDisp = info.price;
        const priceNorm = priceDisp * factor;
        let priceUSD = priceNorm, tc = 1.0;

        if (monedaNorm !== 'USD') {
          try { const fx = await this.fetchFXRate(monedaNorm); tc = fx.tc; } catch(_) {}
          priceUSD = priceNorm * tc;
        }

        const plCls = info.change >= 0 ? 'pos' : 'neg';
        const sign  = info.change >= 0 ? '+' : '';
        const dec   = info.currency === 'USD' ? 2 : 4;

        // Barra de posición en rango 52 semanas
        const w52bar = (info.w52high && info.w52low && info.w52high > info.w52low) ? (() => {
          const pct = Math.min(100, Math.max(0, (priceDisp - info.w52low) / (info.w52high - info.w52low) * 100));
          return `
            <div style="margin:14px 0 4px">
              <div style="display:flex;justify-content:space-between;margin-bottom:5px;
                font-family:'DM Mono',monospace;font-size:.66rem;color:var(--text-sec)">
                <span>Mín 52W: ${fmt(info.w52low, dec)}</span>
                <span style="color:var(--accent);font-weight:500">Rango 52 semanas</span>
                <span>Máx 52W: ${fmt(info.w52high, dec)}</span>
              </div>
              <div style="height:4px;border-radius:2px;background:rgba(255,255,255,.1);position:relative">
                <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;
                  background:linear-gradient(90deg,#ef5350,#26a69a);border-radius:2px"></div>
                <div style="position:absolute;left:${pct}%;top:-4px;
                  transform:translateX(-50%);width:10px;height:10px;border-radius:50%;
                  background:var(--accent);border:2px solid var(--bg)"></div>
              </div>
            </div>
          `;
        })() : '';

        // Fila de datos financieros (best-effort del quote endpoint)
        const finRow = quote ? (() => {
          const items = [
            quote.marketCap  && { label: 'Mkt Cap',    value: fmtCap(quote.marketCap) },
            quote.pe         && { label: 'P/E (trail.)',value: fmt(quote.pe, 1) },
            quote.forwardPE  && { label: 'P/E (forw.)', value: fmt(quote.forwardPE, 1) },
            quote.divYield   && { label: 'Div. Yield',  value: fmt(quote.divYield * 100, 2) + '%' },
            quote.beta       && { label: 'Beta',        value: fmt(quote.beta, 2) },
            quote.eps        && { label: 'EPS (trail.)', value: fmtUSD(quote.eps) },
          ].filter(Boolean);
          if (!items.length) return '';
          return `
            <div style="display:flex;gap:20px;flex-wrap:wrap;padding-top:12px;margin-top:12px;
              border-top:1px solid rgba(255,255,255,.06);font-family:'DM Mono',monospace;font-size:.75rem">
              ${items.map(i => `
                <div>
                  <div style="color:var(--text-sec);font-size:.65rem;margin-bottom:2px">${i.label}</div>
                  <div style="color:var(--text);font-weight:500">${i.value}</div>
                </div>
              `).join('')}
            </div>
          `;
        })() : '';

        document.getElementById('mkt-price-card').innerHTML = `
          <!-- Header -->
          <div style="display:flex;justify-content:space-between;align-items:flex-start;
            flex-wrap:wrap;gap:10px;margin-bottom:14px">
            <div>
              <div style="font-size:1.35rem;font-weight:600;letter-spacing:.4px">${ticker}</div>
              <div style="font-size:.83rem;color:var(--text-sec);margin-top:2px">${nombre}</div>
              <div style="font-size:.68rem;color:var(--text-sec);margin-top:3px">
                ${exchange} · ${TYPE_BADGE[tipo] || '⬜ Otro'}
              </div>
            </div>
            <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:flex-start">
              <button id="btn-save-price" class="btn btn-ghost"
                style="font-size:.7rem;padding:5px 10px"
                title="Guarda el precio como snapshot histórico (el P&L del Portafolio ya usa precios live)">
                💾 Snapshot
              </button>
              <button id="btn-reg-compra" class="btn btn-primary" style="font-size:.78rem">
                ➕ Registrar compra
              </button>
            </div>
          </div>

          <!-- Métricas principales -->
          <div class="metrics-row" style="margin:0">
            <div class="metric-card">
              <div class="metric-label">Precio (${info.currency})</div>
              <div class="metric-value">${fmt(priceDisp, dec)}</div>
              <div class="metric-delta ${plCls}">
                ${sign}${fmt(info.change, dec)} (${sign}${fmt(info.pct)}%)
              </div>
            </div>

            ${monedaNorm !== 'USD' ? `
            <div class="metric-card">
              <div class="metric-label">Equiv. USD</div>
              <div class="metric-value">${fmtUSD(priceUSD)}</div>
              <div class="metric-delta neu" style="font-size:.65rem;line-height:1.5">
                ${monedaNorm}/USD: ${fmt(tc, 4)}${factor < 1 ? '<br>×0.01 (GBp→GBP)' : ''}
              </div>
            </div>
            ` : ''}

            <div class="metric-card">
              <div class="metric-label">Apertura / Ant.</div>
              <div class="metric-value" style="font-size:1.2rem">${fmt(info.open, dec)}</div>
              <div class="metric-delta neu">${fmt(info.prev, dec)}</div>
            </div>

            <div class="metric-card">
              <div class="metric-label">Máx / Mín día</div>
              <div class="metric-value" style="font-size:1.2rem">${fmt(info.high, dec)}</div>
              <div class="metric-delta neu">${fmt(info.low, dec)}</div>
            </div>

            <div class="metric-card">
              <div class="metric-label">Volumen</div>
              <div class="metric-value" style="font-size:1.2rem">${fmtVol(info.volume)}</div>
            </div>
          </div>

          <!-- Barra 52 semanas -->
          ${w52bar}

          <!-- Datos financieros (best-effort) -->
          ${finRow}
        `;

        document.getElementById('btn-save-price').addEventListener('click', async () => {
          try {
            await dbUpsert('activos', { ticker, nombre, tipo: this._mapTipo(tipo), moneda: monedaNorm });
            await dbUpsert('precios_historicos', {
              ticker,
              fecha:           new Date().toISOString().slice(0, 10),
              moneda:          info.currency,
              cierre:          priceUSD,
              cierre_orig:     priceDisp,
              apertura:        info.open * factor * tc,
              apertura_orig:   info.open,
              maximo:          info.high * factor * tc,
              maximo_orig:     info.high,
              minimo:          info.low  * factor * tc,
              minimo_orig:     info.low,
              cierre_ajustado: priceUSD,
            });
            toast('✅ Snapshot guardado para ' + ticker);
          } catch(e) { toast('❌ ' + e.message, 'err'); }
        });

        document.getElementById('btn-reg-compra').addEventListener('click', () => {
          window._precompra = { ticker, nombre, exchange, currency: info.currency, tipo };
          window.location.hash = '#inversiones/operaciones';
        });

        // Botones de período
        const pbDiv = document.getElementById('mkt-period-btns');
        pbDiv.innerHTML = PERIODS.map(p => `
          <button class="mkt-period-btn" data-period="${p.value}" style="
            padding:4px 13px;border-radius:6px;
            border:1px solid ${p.value === _activePeriod ? 'var(--accent)' : 'rgba(255,255,255,.15)'};
            background:${p.value === _activePeriod ? 'var(--accent)' : 'transparent'};
            color:${p.value === _activePeriod ? '#fff' : 'var(--text-sec)'};
            cursor:pointer;font-family:'DM Mono',monospace;font-size:.75rem;transition:all .15s">
            ${p.label}
          </button>
        `).join('');

        pbDiv.querySelectorAll('.mkt-period-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            _activePeriod = btn.dataset.period;
            await loadChart(ticker, _activePeriod);
          });
        });

        await loadChart(ticker, _activePeriod);

      } catch(e) {
        document.getElementById('mkt-price-card').innerHTML = `
          <div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">${e.message}</div></div>
        `;
      }
    };

    // ── Búsqueda ──────────────────────────────────────────────────────
    const doSearch = async () => {
      const query = document.getElementById('mkt-q').value.trim();
      if (!query) return;
      const res = document.getElementById('mkt-results');
      res.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
      try {
        const results = await this.searchTickers(query);
        if (!results.length) {
          res.innerHTML = `<div class="empty" style="padding:12px"><div class="empty-text">Sin resultados. Probá con el ticker exacto.</div></div>`;
          return;
        }
        res.innerHTML = `<div style="display:flex;flex-direction:column;gap:5px">
          ${results.slice(0, 8).map((r, i) => `
            <div class="search-result-row" data-idx="${i}" style="
              display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;
              cursor:pointer;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);
              transition:background .15s">
              <span style="font-size:.9rem;flex-shrink:0">${TYPE_BADGE[r.tipo]?.slice(0,2) || '⬜'}</span>
              <strong style="min-width:76px;color:var(--accent);font-size:.88rem">${r.ticker}</strong>
              <span style="flex:1;color:var(--text);font-size:.82rem">${r.nombre}</span>
              <span style="font-size:.68rem;color:var(--text-sec);flex-shrink:0">${r.exchange}</span>
            </div>
          `).join('')}
        </div>`;
        res.querySelectorAll('.search-result-row').forEach(el => {
          el.addEventListener('mouseenter', () => el.style.background = 'rgba(46,127,217,.12)');
          el.addEventListener('mouseleave', () => el.style.background = 'rgba(255,255,255,.04)');
          el.addEventListener('click', () => {
            const r = results[parseInt(el.dataset.idx)];
            res.innerHTML = '';
            document.getElementById('mkt-q').value = '';
            renderDetail(r.ticker, r.nombre, r.exchange, r.tipo);
          });
        });
      } catch(e) {
        res.innerHTML = `<div class="empty" style="padding:12px"><div class="empty-text">⚠️ ${e.message}</div></div>`;
      }
    };

    document.getElementById('btn-mkt-search').addEventListener('click', doSearch);
    document.getElementById('mkt-q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

    // Auto-search si viene desde Portafolio
    if (window._mktAutoSearch) {
      const ticker = window._mktAutoSearch;
      window._mktAutoSearch = null;
      document.getElementById('mkt-q').value = ticker;
      doSearch();
    }
  },

  // ── Portafolio ───────────────────────────────────────────────────────
  async renderPortafolio() {
    const c = document.getElementById('content');

    c.innerHTML = `
      <h1>Portafolio</h1>
      <p class="page-subtitle" style="color:var(--text-sec)">Cargando posiciones y precios…</p>
      <div class="loading" style="height:100px"><div class="spinner"></div></div>
    `;

    try {
      const allOps = await dbFetch('operaciones', { order: { col: 'fecha', asc: true } });

      const pos = {};
      for (const op of allOps) {
        const qty      = parseFloat(op.cantidad);
        const priceUSD = parseFloat(op.precio_unitario);
        const tc       = parseFloat(op.tipo_cambio_usd) || 1.0;
        const moneda   = op.moneda || 'USD';
        const { moneda: monedaNorm, factor } = this.normalizarMoneda(moneda);
        // precio en moneda origen al momento de la operación
        const priceOrig = monedaNorm === 'USD' ? priceUSD : priceUSD / (factor * tc);

        if (!pos[op.ticker]) {
          pos[op.ticker] = { ticker: op.ticker, qty: 0, costBasis: 0, costBasisOrig: 0, tcAvg: 1.0, moneda, factor };
        }
        const p = pos[op.ticker];
        if (op.tipo === 'compra') {
          const newQty = p.qty + qty;
          p.costBasis     = (p.costBasis     * p.qty + priceUSD  * qty) / newQty;
          p.costBasisOrig = (p.costBasisOrig * p.qty + priceOrig * qty) / newQty;
          p.tcAvg         = (p.tcAvg         * p.qty + tc        * qty) / newQty;
          p.qty = newQty;
          p.moneda = moneda;
          p.factor = factor;
        } else {
          p.qty -= qty;
        }
      }
      const positions = Object.values(pos).filter(p => p.qty > 0.0001);

      if (!positions.length) {
        c.innerHTML = `
          <h1>Portafolio</h1>
          <p class="page-subtitle">Sin posiciones abiertas</p>
          <div class="empty">
            <div class="empty-icon">📋</div>
            <div class="empty-text">Registrá operaciones para ver el portafolio</div>
          </div>
        `;
        return;
      }

      const tickers = positions.map(p => p.ticker);

      const [liveData, savedRows] = await Promise.all([
        this.fetchLivePrices(tickers).catch(() => ({})),
        dbFetch('precios_historicos', { order: { col: 'fecha', asc: false }, limit: 500 }).catch(() => []),
      ]);

      const savedPrices = {};
      for (const r of savedRows) {
        if (!savedPrices[r.ticker]) savedPrices[r.ticker] = parseFloat(r.cierre);
      }

      // priceData[ticker] = { priceUSD, priceOrig, currency, factor, tc, isLive }
      const priceData = {};
      for (const ticker of tickers) {
        if (liveData[ticker]) {
          priceData[ticker] = { ...liveData[ticker], isLive: true };
        } else if (savedPrices[ticker]) {
          priceData[ticker] = { priceUSD: savedPrices[ticker], priceOrig: savedPrices[ticker], currency: 'USD', factor: 1, tc: 1, isLive: false };
        }
      }

      const liveCount  = tickers.filter(t => priceData[t]?.isLive).length;
      const failedTkrs = tickers.filter(t => !priceData[t]?.isLive);

      let statusLabel;
      if (liveCount === tickers.length) {
        statusLabel = '<span style="color:#26a69a">● Precios en tiempo real</span>';
      } else if (liveCount > 0) {
        statusLabel = `<span style="color:#ffca28">● ${liveCount}/${tickers.length} en tiempo real · sin datos: ${failedTkrs.join(', ')}</span>`;
      } else {
        statusLabel = `<span style="color:#ef5350">● Sin precios live (Ctrl+Shift+R) · tickers: ${failedTkrs.join(', ')}</span>`;
      }

      const totalCost   = positions.reduce((s, p) => s + p.costBasis * p.qty, 0);
      const totalMarket = positions.reduce((s, p) => s + (priceData[p.ticker]?.priceUSD ?? p.costBasis) * p.qty, 0);
      const totalPL     = totalMarket - totalCost;

      // Pre-compute per-position data for table rendering and sorting
      const computedPositions = positions.map(p => {
        const pd     = priceData[p.ticker];
        const hasPx  = pd != null;
        const priceUSD = pd?.priceUSD ?? 0;
        const value  = priceUSD * p.qty;
        const pl     = (priceUSD - p.costBasis) * p.qty;
        const plPct  = p.costBasis ? ((priceUSD - p.costBasis) / p.costBasis) * 100 : 0;
        const hasTC  = hasPx && pd.isLive && p.factor != null && p.tcAvg != null;
        const plTC   = hasTC ? p.qty * p.factor * p.costBasisOrig * (pd.tc - p.tcAvg) : null;
        const peso   = hasPx && totalMarket > 0 ? (value / totalMarket * 100) : 0;
        return { ...p, pd, hasPx, priceUSD, value, pl, plPct, plTC, peso };
      });

      const renderRows = (rows) => rows.map(p => {
        const { pd, hasPx, value, pl, plPct, plTC, peso } = p;
        return `
          <tr>
            <td><strong class="port-ticker-link" data-ticker="${p.ticker}"
              style="cursor:pointer;color:var(--accent)">${p.ticker}</strong></td>
            <td>${Math.abs(p.qty - Math.round(p.qty)) < 0.001 ? fmt(Math.round(p.qty), 0) : fmt(p.qty, 4)}</td>
            <td>${this._fmtOrig(p.costBasisOrig, p.moneda)}</td>
            <td>
              ${hasPx ? this._fmtOrig(pd.priceOrig, pd.currency) : '<span class="neu">—</span>'}
              ${pd?.isLive ? '<span title="Tiempo real" style="color:#26a69a;font-size:.65rem;margin-left:2px">●</span>'
                           : (hasPx ? '<span title="Guardado" style="color:#8096b0;font-size:.65rem;margin-left:2px">○</span>' : '')}
            </td>
            <td>${hasPx ? fmtUSD(value) : '—'}</td>
            <td style="color:var(--text-sec)">${hasPx ? fmt(peso, 1) + '%' : '—'}</td>
            <td class="${hasPx ? plClass(pl) : 'neu'}">${hasPx ? plSign(pl) + fmtUSD(pl) : '—'}</td>
            <td class="${plTC != null ? plClass(plTC) : 'neu'}">
              ${plTC != null ? (Math.abs(plTC) < 0.005 ? '<span class="neu">$0</span>' : plSign(plTC) + fmtUSD(plTC)) : '—'}
            </td>
            <td class="${hasPx ? plClass(plPct) : 'neu'}">${hasPx ? plSign(plPct) + fmt(plPct) + '%' : '—'}</td>
          </tr>
        `;
      }).join('');

      c.innerHTML = `
        <h1>Portafolio</h1>
        <p class="page-subtitle" style="font-size:.78rem">
          ${positions.length} ticker${positions.length !== 1 ? 's' : ''} ·
          <span style="font-family:'DM Mono',monospace">${statusLabel}</span>
        </p>

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

        <!-- Gráfico evolución del portafolio -->
        <div class="form-card" id="port-chart-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
            <span style="font-weight:500;font-size:.9rem">Evolución de la cartera</span>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${[['1mo','1M'],['3mo','3M'],['6mo','6M'],['1y','1A'],['2y','2A'],['5y','5A'],['10y','10A']].map(([v,l]) => `
                <button class="port-period-btn" data-period="${v}" style="
                  padding:4px 13px;border-radius:6px;font-size:.75rem;cursor:pointer;
                  font-family:'DM Mono',monospace;transition:all .15s;
                  border:1px solid ${v==='6mo'?'var(--accent)':'rgba(255,255,255,.15)'};
                  background:${v==='6mo'?'var(--accent)':'transparent'};
                  color:${v==='6mo'?'#fff':'var(--text-sec)'};
                ">${l}</button>`).join('')}
            </div>
          </div>
          <div style="position:relative">
            <div id="port-chart-overlay" style="display:none;position:absolute;inset:0;z-index:5;
              align-items:center;justify-content:center;background:rgba(4,15,32,.65);border-radius:4px">
              <div class="spinner"></div>
            </div>
            <div id="port-chart" style="width:100%;height:260px"></div>
          </div>
        </div>

        <!-- Tabla de posiciones -->
        <div class="table-wrap">
          <div class="table-header">
            <span class="table-title">Posiciones abiertas</span>
            <a href="#inversiones/operaciones" class="btn btn-ghost"
               style="font-size:.7rem;padding:6px 12px">+ Nueva operación</a>
          </div>
          <div style="overflow:auto;max-height:65vh">
            <table>
              <thead style="position:sticky;top:0;z-index:2">
                <tr>
                  <th>Ticker</th><th>Cantidad</th><th>Costo prom.</th><th>Precio actual</th><th>Valor USD</th>
                  <th class="sort-th" data-sort="peso" style="cursor:pointer;user-select:none;white-space:nowrap">
                    Peso <span class="sort-arrow" style="opacity:.5">↕</span>
                  </th>
                  <th class="sort-th" data-sort="pl" style="cursor:pointer;user-select:none;white-space:nowrap">
                    P&L USD <span class="sort-arrow" style="opacity:.5">↕</span>
                  </th>
                  <th title="Ganancia/pérdida por variación del tipo de cambio">P&L TC</th>
                  <th class="sort-th" data-sort="plPct" style="cursor:pointer;user-select:none;white-space:nowrap">
                    P&L % <span class="sort-arrow" style="opacity:.5">↕</span>
                  </th>
                </tr>
              </thead>
              <tbody id="port-tbody">
                ${renderRows(computedPositions)}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // ── Sort ─────────────────────────────────────────────────────────────
      let sortCol = null, sortDir = -1;

      const attachTickerLinks = () => {
        document.querySelectorAll('.port-ticker-link').forEach(el => {
          el.addEventListener('click', () => {
            window._mktAutoSearch = el.dataset.ticker;
            window.location.hash = '#inversiones/mercado';
          });
        });
      };

      document.querySelectorAll('.sort-th').forEach(th => {
        th.addEventListener('click', () => {
          const col = th.dataset.sort;
          if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = -1; }
          const sorted = [...computedPositions].sort((a, b) => ((a[col] ?? -Infinity) - (b[col] ?? -Infinity)) * sortDir);
          document.getElementById('port-tbody').innerHTML = renderRows(sorted);
          document.querySelectorAll('.sort-th').forEach(h => {
            h.querySelector('.sort-arrow').textContent = h.dataset.sort === sortCol ? (sortDir === 1 ? '↑' : '↓') : '↕';
            h.querySelector('.sort-arrow').style.opacity = h.dataset.sort === sortCol ? '1' : '.5';
          });
          attachTickerLinks();
        });
      });

      attachTickerLinks();

      document.querySelectorAll('.port-period-btn').forEach(btn => {
        btn.addEventListener('click', () => this._loadPortfolioChart(allOps, btn.dataset.period));
      });

      await this._loadPortfolioChart(allOps, '6mo');

    } catch(e) {
      c.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">Error: ${e.message}</div></div>`;
    }
  },

  async _loadPortfolioChart(allOps, period) {
    document.querySelectorAll('.port-period-btn').forEach(b => {
      const on = b.dataset.period === period;
      b.style.background  = on ? 'var(--accent)' : 'transparent';
      b.style.color       = on ? '#fff' : 'var(--text-sec)';
      b.style.borderColor = on ? 'var(--accent)' : 'rgba(255,255,255,.15)';
    });

    const chartDiv = document.getElementById('port-chart');
    const overlay  = document.getElementById('port-chart-overlay');
    if (!chartDiv) return;
    if (overlay) overlay.style.display = 'flex';

    try {
      const history = await this._buildPortfolioHistory(allOps, period);
      if (overlay) overlay.style.display = 'none';

      if (!history || !history.dates.length) {
        try { Plotly.purge('port-chart'); } catch(_) {}
        chartDiv.innerHTML = '<div class="empty" style="height:180px"><div class="empty-text">Sin datos históricos para este período</div></div>';
        return;
      }

      const { dates, values } = history;
      const first = values[0], last = values[values.length - 1];
      const chgPct = first ? ((last - first) / first) * 100 : 0;
      const isUp   = chgPct >= 0;
      const color  = isUp ? '#26a69a' : '#ef5350';

      const xTickFmt = ['1mo','3mo'].includes(period) ? '%d %b' : '%b %y';

      try { Plotly.purge('port-chart'); } catch(_) {}
      Plotly.newPlot('port-chart', [{
        x: dates, y: values,
        type: 'scatter', mode: 'lines',
        fill: 'tozeroy',
        fillcolor: isUp ? 'rgba(38,166,154,0.12)' : 'rgba(239,83,80,0.12)',
        line: { color, width: 2 },
        hovertemplate: '$%{y:,.0f}<extra></extra>',
        hoverlabel: {
          bgcolor: color, bordercolor: 'rgba(0,0,0,0)',
          font: { color: '#fff', size: 11, family: "'DM Mono', monospace" },
          namelength: 0,
        },
      }], {
        height: 260,
        margin: { l: 58, r: 8, t: 36, b: 28 },
        plot_bgcolor:  '#071E3D',
        paper_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#8096b0', size: 11, family: "'DM Mono', monospace" },
        title: { text: `${isUp ? '▲' : '▼'} ${Math.abs(chgPct).toFixed(2)}%`, font: { size: 12, color }, x: 0.01 },
        dragmode: false,
        xaxis: {
          showgrid: false, color: '#3d5568',
          tickformat: xTickFmt, hoverformat: '%d %b',
          tickfont: { size: 10, color: '#6a88a0', family: "'DM Sans', sans-serif" },
          showspikes: true, spikemode: 'across',
          spikecolor: '#546272', spikethickness: 1, spikedash: 'dot',
          showline: false, zeroline: false,
        },
        yaxis: {
          showgrid: true, gridcolor: '#0d2848', griddash: 'dot', color: '#3d5568',
          tickfont: { size: 10, color: '#6a88a0', family: "'DM Mono', monospace" },
          nticks: 5,
          showspikes: false, showline: false, zeroline: false,
          range: [Math.min(...values) * 0.97, Math.max(...values) * 1.03],
          tickprefix: '$', tickformat: ',.0f',
        },
        hovermode: 'x', showlegend: false,
      }, { responsive: true, displayModeBar: false, scrollZoom: false });

      if (!chartDiv.dataset.noZoom) {
        chartDiv.dataset.noZoom = '1';
        ['touchstart','touchmove'].forEach(t =>
          chartDiv.addEventListener(t, e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false })
        );
        ['gesturestart','gesturechange','gestureend'].forEach(t =>
          chartDiv.addEventListener(t, e => e.preventDefault(), { passive: false })
        );
      }

    } catch(e) {
      if (overlay) overlay.style.display = 'none';
      try { Plotly.purge('port-chart'); } catch(_) {}
      chartDiv.innerHTML = '<div class="empty" style="height:160px;display:flex;align-items:center;justify-content:center"><div class="empty-text">⚠️ No se pudo cargar el gráfico</div></div>';
    }
  },

  async _buildPortfolioHistory(allOps, period) {
    const rangeMap = { '1mo':'1mo','3mo':'3mo','6mo':'6mo','1y':'1y','2y':'2y','5y':'5y','10y':'10y' };
    const range    = rangeMap[period] || '6mo';
    const interval = ['10y'].includes(period) ? '1mo'
                   : ['1y','2y','5y'].includes(period) ? '1wk'
                   : '1d';

    const activeTickers = [...new Set(allOps.map(op => op.ticker))];

    const settled = await Promise.allSettled(activeTickers.map(async ticker => {
      const [chart, priceInfo] = await Promise.all([
        this.fetchYahooChart(ticker, range, interval),
        this.fetchYahooPrice(ticker),
      ]);
      const { moneda, factor } = this.normalizarMoneda(priceInfo.currency);
      let tc = 1.0;
      if (moneda !== 'USD') {
        try { tc = (await this.fetchFXRate(moneda)).tc; } catch(_) {}
      }
      return { ticker, dates: chart.dates, prices: chart.prices, factor, tc };
    }));

    const tickerCharts = {};
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value.prices.length) tickerCharts[r.value.ticker] = r.value;
    }
    if (!Object.keys(tickerCharts).length) return null;

    // Indexar precios por fecha (convertidos a USD)
    const priceMaps = {};
    const allDateSet = new Set();
    for (const [ticker, data] of Object.entries(tickerCharts)) {
      const map = {};
      for (let i = 0; i < data.dates.length; i++) {
        const d = data.dates[i].toISOString().slice(0, 10);
        map[d] = data.prices[i] * data.factor * data.tc;
        allDateSet.add(d);
      }
      priceMaps[ticker] = map;
    }

    const sortedDates = [...allDateSet].sort();

    // Forward-fill para cubrir fines de semana y feriados por diferencias de mercado
    const filledMaps = {};
    for (const [ticker, map] of Object.entries(priceMaps)) {
      let last = null;
      const filled = {};
      for (const d of sortedDates) {
        if (map[d] != null) last = map[d];
        if (last != null) filled[d] = last;
      }
      filledMaps[ticker] = filled;
    }

    // Simular operaciones acumuladas en cada fecha y calcular valor total del portafolio
    const portfolioDates = [];
    const portfolioValues = [];

    for (const dateStr of sortedDates) {
      const opsToDate = allOps.filter(op => op.fecha <= dateStr);
      const qtys = {};
      for (const op of opsToDate) {
        if (!qtys[op.ticker]) qtys[op.ticker] = 0;
        const q = parseFloat(op.cantidad);
        qtys[op.ticker] += op.tipo === 'compra' ? q : -q;
      }

      let total = 0, hasData = false;
      for (const [ticker, qty] of Object.entries(qtys)) {
        if (qty < 0.0001) continue;
        const p = filledMaps[ticker]?.[dateStr];
        if (p != null) { total += qty * p; hasData = true; }
      }

      if (hasData && total > 0) {
        portfolioDates.push(new Date(dateStr + 'T12:00:00'));
        portfolioValues.push(total);
      }
    }

    return portfolioDates.length ? { dates: portfolioDates, values: portfolioValues } : null;
  },

  // ── Operaciones — flujo 3 pasos ──────────────────────────────────────
  async renderOperaciones() {
    const c   = document.getElementById('content');
    const ops = await dbFetch('operaciones', { order: { col: 'fecha', asc: false }, limit: 50 });
    const today = new Date().toISOString().slice(0, 10);

    // Estado del formulario multi-paso
    const st = {
      ticker: null, nombre: null, exchange: '', tipoActivo: 'equity',
      moneda: 'USD', monedaNorm: 'USD', factor: 1.0, tc: 1.0,
      _preview: null,
    };

    c.innerHTML = `
      <h1>Operaciones</h1>
      <p class="page-subtitle">Compras y ventas con detección de moneda y tipo de cambio</p>

      <!-- Paso 1: Búsqueda de activo -->
      <div class="form-card" id="sec-search">
        <h3>Paso 1 — Buscar activo</h3>
        <div style="display:flex;gap:10px;align-items:flex-end">
          <div class="form-group" style="flex:1;margin:0">
            <label>Nombre o ticker (ej: Apple, AAPL, BMA.BA, Shell...)</label>
            <input id="op-search" type="text" placeholder="Buscá por nombre o símbolo" autocomplete="off">
          </div>
          <button id="btn-op-search" class="btn btn-primary" style="height:38px">Buscar</button>
        </div>
        <div id="op-search-results" style="margin-top:12px"></div>
        <div id="op-selected" style="margin-top:10px"></div>
      </div>

      <!-- Paso 2: Datos de la operación -->
      <div class="form-card hidden" id="sec-form">
        <h3>Paso 2 — Datos de la operación</h3>
        <div class="form-grid">
          <div class="form-group">
            <label>Tipo</label>
            <select id="op-tipo">
              <option value="compra">Compra</option>
              <option value="venta">Venta</option>
            </select>
          </div>
          <div class="form-group">
            <label>Fecha</label>
            <input id="op-fecha" type="date" value="${today}" required>
          </div>
          <div class="form-group">
            <label>Cantidad</label>
            <input id="op-cantidad" type="number" step="0.0001" min="0.0001" placeholder="10" required>
          </div>
          <div class="form-group">
            <label id="op-precio-label">Precio unitario</label>
            <input id="op-precio" type="number" step="0.0001" min="0.0001" placeholder="150.00" required>
          </div>
          <div class="form-group">
            <label id="op-comision-label">Comisión</label>
            <input id="op-comision" type="number" step="0.01" min="0" placeholder="0" value="0">
          </div>
          <div class="form-group">
            <label>Notas (opcional)</label>
            <input id="op-notas" type="text" placeholder="DCA mensual, cambio de estrategia...">
          </div>
        </div>
        <div id="op-fx-info" style="margin:4px 0 16px;font-family:'DM Mono',monospace;font-size:.73rem;
          color:var(--text-sec);line-height:1.6;background:rgba(255,255,255,.03);
          border-radius:6px;padding:8px 12px"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button id="btn-preview" class="btn btn-primary">Ver resumen →</button>
          <button id="btn-back-search" class="btn btn-ghost">← Cambiar activo</button>
        </div>
      </div>

      <!-- Paso 3: Confirmación -->
      <div class="form-card hidden" id="sec-preview">
        <h3>Paso 3 — Confirmar operación</h3>
        <div id="op-preview-content"></div>
        <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
          <button id="btn-confirm" class="btn btn-primary">✅ Confirmar y guardar</button>
          <button id="btn-back-form" class="btn btn-ghost">← Editar datos</button>
        </div>
      </div>

      <!-- Historial -->
      <div class="table-wrap" id="ops-table-wrap">
        <div class="table-header"><span class="table-title">Últimas 50 operaciones</span></div>
        ${ops.length === 0 ? `
          <div class="empty">
            <div class="empty-icon">🔄</div>
            <div class="empty-text">Sin operaciones registradas aún</div>
          </div>
        ` : `
          <div style="overflow-x:auto">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th><th>Ticker</th><th>Tipo</th><th>Cantidad</th>
                  <th>Precio</th><th>Moneda</th><th>TC</th><th>Monto</th><th>Com.</th><th></th>
                </tr>
              </thead>
              <tbody id="ops-tbody">
                ${ops.map(op => this._opRow(op)).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;

    // ── Paso 1: Búsqueda ─────────────────────────────────────────────
    const doSearch = async () => {
      const query = document.getElementById('op-search').value.trim();
      if (!query) return;
      const resDiv = document.getElementById('op-search-results');
      resDiv.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
      try {
        const results = await this.searchTickers(query);
        if (!results.length) {
          resDiv.innerHTML = `<div class="empty" style="padding:16px"><div class="empty-text">Sin resultados. Intentá con el ticker exacto (ej: AAPL).</div></div>`;
          return;
        }
        resDiv.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">
          ${results.slice(0, 8).map((r, i) => `
            <div class="search-result-row" data-idx="${i}" style="
              display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;
              cursor:pointer;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);
              transition:background .15s">
              <strong style="min-width:76px;color:var(--accent);font-size:.9rem">${r.ticker}</strong>
              <span style="flex:1;color:var(--text);font-size:.85rem">${r.nombre}</span>
              <span style="font-size:.7rem;color:var(--text-sec)">${r.exchange}</span>
              <span class="tag" style="font-size:.65rem;margin-left:4px">${r.tipo}</span>
            </div>
          `).join('')}
        </div>`;
        resDiv.querySelectorAll('.search-result-row').forEach(el => {
          el.addEventListener('mouseenter', () => el.style.background = 'rgba(46,127,217,.12)');
          el.addEventListener('mouseleave', () => el.style.background = 'rgba(255,255,255,.04)');
          el.addEventListener('click', () => selectTicker(results[parseInt(el.dataset.idx)]));
        });
        resDiv._results = results;
      } catch(e) {
        resDiv.innerHTML = `<div class="empty" style="padding:16px"><div class="empty-text">⚠️ ${e.message}</div></div>`;
      }
    };

    const selectTicker = async (r) => {
      st.ticker      = r.ticker;
      st.nombre      = r.nombre;
      st.exchange    = r.exchange;
      st.tipoActivo  = r.tipo || 'equity';
      st.moneda      = r.currency || 'USD';

      // Si el resultado no traía moneda, la buscamos del endpoint de precio
      if (!r.currency) {
        try {
          const info = await this.fetchYahooPrice(r.ticker);
          st.moneda = info.currency || 'USD';
        } catch(_) {}
      }

      // Normalizar GBX/GBp
      const norm    = this.normalizarMoneda(st.moneda);
      st.monedaNorm = norm.moneda;
      st.factor     = norm.factor;

      // Actualizar UI
      document.getElementById('op-search-results').innerHTML = '';
      document.getElementById('op-selected').innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;
          background:rgba(46,127,217,.1);border:1px solid rgba(46,127,217,.25)">
          <strong style="color:var(--accent);font-size:1.05rem">${st.ticker}</strong>
          <span style="color:var(--text)">${st.nombre}</span>
          <span style="font-size:.75rem;color:var(--text-sec)">${st.exchange}</span>
          <span class="tag" style="font-size:.7rem">${st.moneda}${st.factor < 1 ? ' → ' + st.monedaNorm + ' ×0.01' : ''}</span>
        </div>
      `;

      document.getElementById('op-precio-label').textContent  = `Precio unitario (${st.moneda})`;
      document.getElementById('op-comision-label').textContent = `Comisión (${st.moneda})`;

      const fxDiv = document.getElementById('op-fx-info');
      if (st.monedaNorm !== 'USD') {
        const note = st.factor < 1
          ? `Moneda: ${st.moneda} (se divide por 100 → ${st.monedaNorm}). `
          : `Moneda: ${st.moneda}. `;
        fxDiv.innerHTML = `ℹ️ ${note}Al generar el resumen se buscará el tipo de cambio ${st.monedaNorm}/USD para la fecha seleccionada.`;
      } else {
        fxDiv.innerHTML = `ℹ️ Moneda: USD — sin conversión necesaria.`;
      }

      document.getElementById('sec-form').classList.remove('hidden');
      document.getElementById('sec-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    document.getElementById('btn-op-search').addEventListener('click', doSearch);
    document.getElementById('op-search').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

    // ── Volver a búsqueda ────────────────────────────────────────────
    document.getElementById('btn-back-search').addEventListener('click', () => {
      document.getElementById('sec-form').classList.add('hidden');
      document.getElementById('sec-preview').classList.add('hidden');
      document.getElementById('op-selected').innerHTML = '';
      document.getElementById('op-search').value = '';
      Object.assign(st, { ticker: null, nombre: null, tipoActivo: 'equity', moneda: 'USD', monedaNorm: 'USD', factor: 1.0, tc: 1.0, _preview: null });
    });

    // ── Paso 2 → Paso 3: Preview ─────────────────────────────────────
    document.getElementById('btn-preview').addEventListener('click', async () => {
      if (!st.ticker) { toast('❌ Buscá y seleccioná un activo primero', 'err'); return; }

      const tipo     = document.getElementById('op-tipo').value;
      const fecha    = document.getElementById('op-fecha').value;
      const cantidad = parseFloat(document.getElementById('op-cantidad').value);
      const precio   = parseFloat(document.getElementById('op-precio').value);
      const comision = parseFloat(document.getElementById('op-comision').value) || 0;
      const notas    = document.getElementById('op-notas').value.trim();

      if (!fecha || !cantidad || isNaN(cantidad) || !precio || isNaN(precio)) {
        toast('❌ Completá todos los campos obligatorios', 'err');
        return;
      }

      const btn = document.getElementById('btn-preview');
      btn.textContent = 'Calculando...';
      btn.disabled = true;

      try {
        // Obtener tipo de cambio en la fecha
        if (st.monedaNorm !== 'USD') {
          const fxInfo = await this.fetchFXRate(st.monedaNorm);
          st.tc = fxInfo.tc;
        } else {
          st.tc = 1.0;
        }

        // Conversión
        const precioNorm  = precio   * st.factor;          // precio en monedaNorm (GBX→GBP)
        const precioUSD   = precioNorm * st.tc;             // precio en USD
        const comisionNorm = comision * st.factor;
        const comisionUSD = comisionNorm * st.tc;
        const montoOrigen = precio * cantidad + comision;   // en moneda original
        const montoUSD    = precioUSD * cantidad + comisionUSD;

        st._preview = { tipo, fecha, cantidad, precio, precioUSD, comision, comisionUSD, montoOrigen, montoUSD, notas };

        document.getElementById('op-preview-content').innerHTML = `
          <div class="metrics-row" style="margin-bottom:14px">
            <div class="metric-card">
              <div class="metric-label">Activo</div>
              <div class="metric-value" style="font-size:1.2rem">${st.ticker}</div>
              <div class="metric-delta neu" style="font-size:.7rem">${st.nombre}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Tipo · Fecha</div>
              <div class="metric-value" style="font-size:1rem;margin-top:4px">
                <span class="tag ${tipo === 'compra' ? 'tag-buy' : 'tag-sell'}">${tipo}</span>
              </div>
              <div class="metric-delta neu">${fmtDate(fecha)}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Cantidad · Precio ${st.moneda}</div>
              <div class="metric-value" style="font-size:1.1rem">${Math.round(cantidad)}</div>
              <div class="metric-delta neu">${fmt(precio, 2)} ${st.moneda}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Monto (USD)</div>
              <div class="metric-value">${fmtUSD(montoUSD)}</div>
              ${st.monedaNorm !== 'USD' ? `<div class="metric-delta neu">TC: ${fmt(st.tc, 4)}</div>` : ''}
            </div>
          </div>
          <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:14px 16px;
            font-family:'DM Mono',monospace;font-size:.78rem;line-height:2">
            <div>Cantidad: <strong>${Math.round(cantidad)}</strong></div>
            <div>Precio unitario (${st.moneda}): <strong>${fmt(precio, 2)} ${st.moneda}</strong></div>
            ${st.moneda !== st.monedaNorm ? `<div>Factor normalización: <strong>×${st.factor}</strong> (${st.moneda}→${st.monedaNorm})</div>` : ''}
            ${st.monedaNorm !== 'USD' ? `<div>Tipo de cambio ${st.monedaNorm}/USD: <strong>${fmt(st.tc, 6)}</strong></div>` : ''}
            <div>Comisión: <strong>${fmtUSD(comisionUSD)}</strong></div>
            <hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:6px 0">
            <div style="font-size:.88rem">Monto total (USD): <strong style="color:var(--accent)">${fmtUSD(montoUSD)}</strong></div>
          </div>
        `;

        document.getElementById('sec-preview').classList.remove('hidden');
        document.getElementById('sec-preview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch(e) {
        toast('❌ Error al calcular: ' + e.message, 'err');
      } finally {
        btn.textContent = 'Ver resumen →';
        btn.disabled = false;
      }
    });

    document.getElementById('btn-back-form').addEventListener('click', () => {
      document.getElementById('sec-preview').classList.add('hidden');
    });

    // ── Paso 3: Confirmar ────────────────────────────────────────────
    document.getElementById('btn-confirm').addEventListener('click', async () => {
      if (!st.ticker || !st._preview) return;
      const btn = document.getElementById('btn-confirm');
      btn.textContent = 'Guardando...';
      btn.disabled = true;
      const pv = st._preview;
      try {
        await dbUpsert('activos', {
          ticker: st.ticker, nombre: st.nombre,
          tipo: this._mapTipo(st.tipoActivo), moneda: st.monedaNorm,
        });
        await dbInsert('operaciones', {
          ticker:          st.ticker,
          tipo:            pv.tipo,
          fecha:           pv.fecha,
          cantidad:        pv.cantidad,
          precio_unitario: pv.precioUSD,    // siempre en USD
          comision:        pv.comisionUSD,  // siempre en USD
          moneda:          st.moneda,       // moneda original del ticker
          tipo_cambio_usd: st.tc,
          notas:           pv.notas || null,
        });
        toast('✅ Operación registrada');
        this._resetForm(st, today);
        await this._refreshTable();
      } catch(e) {
        toast('❌ ' + e.message, 'err');
      } finally {
        btn.textContent = '✅ Confirmar y guardar';
        btn.disabled = false;
      }
    });

    this._attachDeleteHandlers();

    // Si viene desde Mercado → "Registrar compra", pre-seleccionar el activo
    if (window._precompra) {
      const pc = window._precompra;
      window._precompra = null;
      await selectTicker(pc);
    }
  },

  _resetForm(st, today) {
    document.getElementById('sec-form').classList.add('hidden');
    document.getElementById('sec-preview').classList.add('hidden');
    document.getElementById('op-selected').innerHTML = '';
    document.getElementById('op-search').value = '';
    document.getElementById('op-search-results').innerHTML = '';
    ['op-cantidad', 'op-precio', 'op-notas'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = id === 'op-notas' ? '' : '';
    });
    const com = document.getElementById('op-comision');
    if (com) com.value = '0';
    const fecha = document.getElementById('op-fecha');
    if (fecha) fecha.value = today || new Date().toISOString().slice(0, 10);
    Object.assign(st, { ticker: null, nombre: null, tipoActivo: 'equity', moneda: 'USD', monedaNorm: 'USD', factor: 1.0, tc: 1.0, _preview: null });
  },

  async _refreshTable() {
    const newOps = await dbFetch('operaciones', { order: { col: 'fecha', asc: false }, limit: 50 });
    const wrap   = document.getElementById('ops-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="table-header"><span class="table-title">Últimas 50 operaciones</span></div>
      ${newOps.length === 0 ? `
        <div class="empty"><div class="empty-icon">🔄</div><div class="empty-text">Sin operaciones registradas aún</div></div>
      ` : `
        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Ticker</th><th>Tipo</th><th>Cantidad</th>
                <th>Precio USD</th><th>Moneda orig.</th><th>TC</th><th>Monto USD</th><th>Com.</th><th></th>
              </tr>
            </thead>
            <tbody id="ops-tbody">
              ${newOps.map(op => this._opRow(op)).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
    this._attachDeleteHandlers();
  },

  _attachDeleteHandlers() {
    document.querySelectorAll('.btn-op-delete').forEach(btn => {
      btn.replaceWith(btn.cloneNode(true)); // quitar handlers duplicados
    });
    document.querySelectorAll('.btn-op-delete').forEach(btn => {
      btn.addEventListener('click', e => {
        const { id, ticker, tipo } = e.currentTarget.dataset;
        this._deleteOperation(parseInt(id), ticker, tipo);
      });
    });
  },

  async _deleteOperation(id, ticker, tipo) {
    if (!confirm(`¿Eliminar operación de ${tipo} de ${ticker}?\nEsta acción no se puede deshacer.`)) return;
    try {
      if (tipo === 'compra') {
        try { await dbDelete('lotes', { operacion_id: id }); } catch(_) {}
      } else {
        try { await dbDelete('operaciones_cerradas', { operacion_venta_id: id }); } catch(_) {}
      }
      await dbDelete('operaciones', { id });
      toast('✅ Operación eliminada');
      await this._refreshTable();
    } catch(e) {
      toast('❌ ' + e.message, 'err');
    }
  },

  _fmtOrig(n, moneda = 'USD') {
    if (n == null) return '—';
    const NORM = { GBX: 'GBP', GBp: 'GBP' };
    const currency = NORM[moneda] || moneda || 'USD';
    const dec = Math.abs(n) >= 1000 ? 0 : 2;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: dec,
        maximumFractionDigits: dec,
      }).format(n);
    } catch {
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec,
      }).format(n) + ' ' + moneda;
    }
  },

  _opRow(op) {
    const qty    = parseFloat(op.cantidad);
    const price  = parseFloat(op.precio_unitario);
    const com    = parseFloat(op.comision || 0);
    const monto  = op.monto_total != null ? parseFloat(op.monto_total) : qty * price + com;
    const moneda = op.moneda || 'USD';
    const tc     = parseFloat(op.tipo_cambio_usd) || 1.0;
    const showTC = moneda !== 'USD' && tc !== 1.0;
    // precio_unitario está guardado en USD → convertir a moneda origen
    const priceOrig = price / tc;
    const montoOrig = monto / tc;
    const comOrig   = com   / tc;
    return `<tr>
      <td>${fmtDate(op.fecha)}</td>
      <td><strong>${op.ticker}</strong></td>
      <td><span class="tag ${op.tipo === 'compra' ? 'tag-buy' : 'tag-sell'}">${op.tipo}</span></td>
      <td>${Math.round(qty)}</td>
      <td>${this._fmtOrig(priceOrig, moneda)}</td>
      <td style="font-size:.75rem;color:var(--text-sec)">${moneda !== 'USD' ? moneda : '—'}</td>
      <td style="font-size:.75rem;color:var(--text-sec)">${showTC ? fmt(tc, 4) : '—'}</td>
      <td>${fmtUSD(monto)}</td>
      <td>${com > 0 ? fmtUSD(com) : '—'}</td>
      <td>
        <button class="btn-op-delete" data-id="${op.id}" data-ticker="${op.ticker}" data-tipo="${op.tipo}"
          style="background:none;border:none;cursor:pointer;color:#e05454;font-size:.95rem;
          padding:2px 4px;opacity:.7;transition:opacity .15s"
          title="Eliminar operación"
          onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=.7">🗑️</button>
      </td>
    </tr>`;
  },

  // ── Rentabilidad ─────────────────────────────────────────────────────
  async renderRentabilidad() {
    document.getElementById('content').innerHTML = `
      <div class="placeholder-mod">
        <div class="ph-icon">📊</div>
        <div class="ph-title">Rentabilidad</div>
        <div class="ph-text">Próximamente · análisis por moneda, benchmark y período</div>
      </div>
    `;
  },

  // ── Helpers de market data ───────────────────────────────────────────
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
          open:     meta.regularMarketOpen    ?? price,
          high:     meta.regularMarketDayHigh ?? price,
          low:      meta.regularMarketDayLow  ?? price,
          change:   price - prev,
          pct:      prev ? ((price - prev) / prev) * 100 : 0,
          currency: meta.currency ?? 'USD',
          volume:   meta.regularMarketVolume  ?? null,
          w52high:  meta.fiftyTwoWeekHigh     ?? null,
          w52low:   meta.fiftyTwoWeekLow      ?? null,
        };
      } catch (_) {}
    }
    throw new Error('No se pudo obtener el precio. Verificá el ticker.');
  },

  async fetchYahooChart(ticker, period = '1mo', interval = '1d') {
    const urls = [
      `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${period}`,
      `https://corsproxy.io/?${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${period}`)}`,
    ];
    for (const url of urls) {
      try {
        const res  = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        const r    = json.chart?.result?.[0];
        if (!r) continue;
        const ts     = r.timestamp || [];
        const closes = r.indicators?.quote?.[0]?.close || [];
        const dates = [], prices = [];
        for (let i = 0; i < ts.length; i++) {
          if (closes[i] != null) {
            dates.push(new Date(ts[i] * 1000));
            prices.push(closes[i]);
          }
        }
        return { dates, prices };
      } catch(_) {}
    }
    throw new Error('No se pudieron obtener datos históricos.');
  },

  async searchTickers(query) {
    const q = encodeURIComponent(query);
    const urls = [
      `https://query2.finance.yahoo.com/v1/finance/search?q=${q}&quotesCount=10&newsCount=0&lang=en-US`,
      `https://corsproxy.io/?${encodeURIComponent(`https://query1.finance.yahoo.com/v1/finance/search?q=${query}&quotesCount=10&newsCount=0&lang=en-US`)}`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        if (!json.quotes?.length) continue;
        return json.quotes
          .filter(r => r.symbol && r.quoteType !== 'OPTION')
          .map(r => ({
            ticker:   r.symbol,
            nombre:   r.longname || r.shortname || r.symbol,
            tipo:     (r.quoteType || 'equity').toLowerCase(),
            exchange: r.exchDisp || r.exchange || '',
            currency: r.currency || null,
          }));
      } catch(_) {}
    }
    throw new Error('No se pudo buscar. Verificá tu conexión o ingresá el ticker exacto.');
  },

  // Precios live en USD para múltiples tickers
  // Precios actuales para múltiples tickers — devuelve { ticker: { priceOrig, currency, priceUSD, factor, tc } }
  async fetchLivePrices(tickers) {
    if (!tickers.length) return {};

    const settled = await Promise.allSettled(tickers.map(t => this.fetchYahooPrice(t)));

    const infos = {};
    const nonUSD = new Set();
    for (let i = 0; i < tickers.length; i++) {
      if (settled[i].status === 'fulfilled') {
        const info = settled[i].value;
        infos[tickers[i]] = info;
        const { moneda } = this.normalizarMoneda(info.currency);
        if (moneda !== 'USD') nonUSD.add(moneda);
      }
    }
    if (!Object.keys(infos).length) return {};

    const fxRates = {};
    await Promise.all([...nonUSD].map(async cur => {
      try { fxRates[cur] = (await this.fetchFXRate(cur)).tc; }
      catch(_) { fxRates[cur] = 1.0; }
    }));

    const result = {};
    for (const [ticker, info] of Object.entries(infos)) {
      const { moneda, factor } = this.normalizarMoneda(info.currency);
      const tc = moneda === 'USD' ? 1.0 : (fxRates[moneda] ?? 1.0);
      result[ticker] = {
        priceOrig: info.price,
        currency:  info.currency,
        priceUSD:  info.price * factor * tc,
        factor,
        tc,
      };
    }
    return result;
  },

  // Datos financieros básicos (best-effort — falla silenciosamente)
  async fetchYahooQuote(ticker) {
    const urls = [
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`,
      `https://corsproxy.io/?${encodeURIComponent(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`)}`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        const q = json.quoteResponse?.result?.[0];
        if (!q) continue;
        return {
          marketCap: q.marketCap                   ?? null,
          pe:        q.trailingPE                  ?? null,
          forwardPE: q.forwardPE                   ?? null,
          beta:      q.beta                        ?? null,
          eps:       q.epsTrailingTwelveMonths     ?? null,
          divYield:  q.trailingAnnualDividendYield ?? q.dividendYield ?? null,
        };
      } catch(_) {}
    }
    return null;
  },

  // Mapea quoteType de Yahoo Finance → valor válido para activos.tipo
  _mapTipo(yahooType) {
    const m = { equity: 'accion', etf: 'etf', mutualfund: 'fondo', cryptocurrency: 'otro', index: 'otro' };
    return m[(yahooType || '').toLowerCase()] || 'otro';
  },

  // Normaliza GBX/GBp/GBx → GBP con factor 0.01
  normalizarMoneda(moneda) {
    const m = (moneda || '').trim();
    if (['GBX', 'GBx', 'GBp', 'GBP_'].includes(m)) return { moneda: 'GBP', factor: 0.01 };
    return { moneda: m.toUpperCase() || 'USD', factor: 1.0 };
  },

  // Obtiene tipo de cambio vs USD
  async fetchFXRate(monedaNorm) {
    if (!monedaNorm || monedaNorm === 'USD') return { tc: 1.0 };
    try {
      const info = await this.fetchYahooPrice(`${monedaNorm}USD=X`);
      return { tc: info.price };
    } catch(_) {
      toast('⚠️ No se pudo obtener el tipo de cambio, se usará 1.0', 'warn');
      return { tc: 1.0 };
    }
  },
};
