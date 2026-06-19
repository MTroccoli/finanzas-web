window.Mods = window.Mods || {};
window.Mods.inversiones = {
  _portfolioCache: null,

  async render(sub = 'portafolio') {
    switch (sub) {
      case 'portafolio':   return this.renderPortafolio();
      case 'operaciones':  return this.renderOperaciones();
      case 'rentabilidad': return this.renderPortafolio();
      default:             return this.renderMercado();
    }
  },

  // ── Mercado ──────────────────────────────────────────────────────────
  async renderMercado() {
    const c = document.getElementById('content');

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
        const priceFmt = last < 100 ? ',.2f' : ',.0f';

        // Formato de fecha adaptado al período seleccionado
        const xTickFmt = period === '1d'  ? '%H:%M'
          : ['5d','1mo','3mo'].includes(period) ? '%d %b'
          : '%b %y';
        const hoverFmt = period === '1d' ? '%H:%M' : '%d %b';

        try { Plotly.purge('mkt-chart'); } catch(_) {}
        Plotly.newPlot('mkt-chart', [{
          x: dates, y: prices,
          type: 'scatter', mode: 'lines',
          fill: 'tozeroy',
          fillcolor: isUp ? 'rgba(38,166,154,0.12)' : 'rgba(239,83,80,0.12)',
          line: { color, width: 2 },
          hovertemplate: `%{y:${priceFmt}} ${cur}<extra></extra>`,
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
            tickformat: xTickFmt, hoverformat: hoverFmt,
            tickfont: { size: 10, color: '#6a88a0', family: "'DM Sans', sans-serif" },
            fixedrange: true, showspikes: true, spikemode: 'across',
            spikecolor: '#546272', spikethickness: 1, spikedash: 'dot',
            showline: false, zeroline: false,
          },
          yaxis: {
            showgrid: true, gridcolor: '#0d2848', griddash: 'dot', color: '#3d5568',
            tickfont: { size: 10, color: '#6a88a0', family: "'DM Mono', monospace" },
            nticks: 5,
            showspikes: false, showline: false, zeroline: false,
            range: [Math.min(...prices) * 0.995, Math.max(...prices) * 1.005],
            fixedrange: true,
            tickformat: priceFmt,
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
      let allOps;
      if (this._portfolioCache) {
        allOps = this._portfolioCache.allOps;
      } else {
        allOps = await dbFetch('operaciones', { order: { col: 'fecha', asc: true } });
      }
      const allUniqueTickers = [...new Set(allOps.map(op => op.ticker))].sort();

      const pos = {}, realByTicker = {};
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
          const sq = Math.min(qty, p.qty);
          const rP = sq * p.factor * (priceOrig - p.costBasisOrig) * tc;
          const rT = sq * p.factor * p.costBasisOrig * (tc - p.tcAvg);
          if (!realByTicker[op.ticker]) realByTicker[op.ticker] = { total: 0, precio: 0, tc: 0 };
          realByTicker[op.ticker].precio += rP;
          realByTicker[op.ticker].tc     += rT;
          realByTicker[op.ticker].total  += rP + rT;
          p.qty -= sq;
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

      let liveData, savedRows;
      if (this._portfolioCache) {
        savedRows = this._portfolioCache.savedRows;
        liveData  = await this.fetchLivePrices(tickers).catch(() => ({}));
      } else {
        [liveData, savedRows] = await Promise.all([
          this.fetchLivePrices(tickers).catch(() => ({})),
          dbFetch('precios_historicos', { order: { col: 'fecha', asc: false }, limit: 500 }).catch(() => []),
        ]);
        this._portfolioCache = { allOps, savedRows };
      }

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

      // For non-USD tickers using saved prices, fetch current FX rate so P&L TC can be computed
      const savedNonUSD = tickers.filter(t => priceData[t] && !priceData[t].isLive && pos[t]?.moneda && pos[t].moneda !== 'USD');
      if (savedNonUSD.length) {
        const uniqueMonedas = [...new Set(savedNonUSD.map(t => this.normalizarMoneda(pos[t].moneda).moneda))];
        const fxNow = {};
        await Promise.all(uniqueMonedas.map(async m => {
          try { fxNow[m] = (await this.fetchFXRate(m)).tc; } catch(_) {}
        }));
        for (const ticker of savedNonUSD) {
          const { moneda, factor } = this.normalizarMoneda(pos[ticker].moneda);
          const tc = fxNow[moneda] ?? 1.0;
          const priceUSD = priceData[ticker].priceUSD;
          priceData[ticker] = { ...priceData[ticker], currency: pos[ticker].moneda, factor, tc,
            priceOrig: priceUSD / (factor * tc) };
        }
      }

      // Auto-backup live prices → precios_historicos (fire-and-forget, no bloquea render)
      {
        const today = new Date().toISOString().slice(0, 10);
        Promise.all(
          tickers.filter(t => priceData[t]?.isLive).map(t => {
            const pd = priceData[t];
            return dbUpsert('precios_historicos', {
              ticker: t, fecha: today,
              moneda: pd.currency,
              cierre: pd.priceUSD,
              cierre_orig: pd.priceOrig,
            }).catch(() => {});
          })
        );
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

      const totalCost      = positions.reduce((s, p) => s + p.costBasis * p.qty, 0);
      const totalMarket    = positions.reduce((s, p) => s + (priceData[p.ticker]?.priceUSD ?? p.costBasis) * p.qty, 0);
      const totalPL        = totalMarket - totalCost;
      const totalRealizado = Object.values(realByTicker).reduce((s, r) => s + r.total, 0);

      // Pre-compute per-position data
      const computedPositions = positions.map(p => {
        const pd       = priceData[p.ticker];
        const hasPx    = pd != null;
        const priceUSD = pd?.priceUSD ?? 0;
        const value    = priceUSD * p.qty;
        const pl       = (priceUSD - p.costBasis) * p.qty;
        const plPct    = p.costBasis ? ((priceUSD - p.costBasis) / p.costBasis) * 100 : 0;
        const hasTC    = hasPx && p.moneda !== 'USD' && p.tcAvg != null;
        const plTC     = hasTC ? p.qty * p.factor * p.costBasisOrig * (pd.tc - p.tcAvg) : null;
        const plPrecio = hasPx ? pl - (plTC ?? 0) : 0;
        const peso     = hasPx && totalMarket > 0 ? (value / totalMarket * 100) : 0;
        const rb       = realByTicker[p.ticker] || { total: 0, precio: 0, tc: 0 };
        return { ...p, pd, hasPx, priceUSD, value, pl, plPct, plTC, plPrecio, peso, rb };
      });

      const totalTC = computedPositions.reduce((s, p) => s + (p.plTC ?? 0), 0)
                    + Object.values(realByTicker).reduce((s, r) => s + r.tc, 0);

      // Market status dot — green=REGULAR, red=any closed state, grey=no live data
      const mktDot = (pd) => {
        if (!pd?.isLive) return '<span class="mkt-dot mkt-unknown" title="Sin conexión">●</span>';
        const s = (pd.marketState ?? '').toUpperCase();
        if (s === 'REGULAR') return '<span class="mkt-dot mkt-open" title="Mercado abierto">●</span>';
        if (s === '') return '<span class="mkt-dot mkt-unknown" title="Sin datos de mercado">●</span>';
        return '<span class="mkt-dot mkt-closed" title="Mercado cerrado">●</span>';
      };

      // Fetch dividends in parallel (best-effort)
      const dividendos = await dbFetch('dividendos', { order: { col: 'fecha', asc: false } }).catch(() => []);
      const totalDividendos = dividendos.reduce((s, d) => s + parseFloat(d.monto_usd), 0);
      const divByTicker = {};
      for (const d of dividendos) divByTicker[d.ticker] = (divByTicker[d.ticker] ?? 0) + parseFloat(d.monto_usd);

      // Shared P&L component row helper
      const compRow = (label, val, barPct, showTC) =>
        (val !== 0 || !showTC) ? `
          <div class="pl-component">
            <span class="pl-comp-label">${label}</span>
            <div class="pl-comp-bar"><div class="pl-comp-bar-fill ${plClass(val)}" style="width:${barPct.toFixed(1)}%"></div></div>
            <span class="pl-comp-val ${plClass(val)}">${plSign(val)}${fmtUSD(val)}</span>
          </div>` : '';

      const maxGrand = Math.max(...computedPositions.map(p => Math.abs((p.pl ?? 0) + p.rb.total)), 0.01);

      const accItem = (p) => {
        const qtyStr      = Math.abs(p.qty - Math.round(p.qty)) < 0.001 ? fmt(Math.round(p.qty), 0) : fmt(p.qty, 4);
        const grandTotal  = (p.pl ?? 0) + p.rb.total;
        const totalBarPct = Math.abs(grandTotal) / maxGrand * 92;
        const showTC      = p.moneda !== 'USD';
        const unrealAbs   = Math.abs(p.plPrecio) + Math.abs(p.plTC ?? 0);
        const realAbs     = Math.abs(p.rb.precio) + Math.abs(p.rb.tc);
        const precioPct   = unrealAbs > 0 ? Math.abs(p.plPrecio)  / unrealAbs * 100 : 100;
        const tcPct       = unrealAbs > 0 ? Math.abs(p.plTC ?? 0) / unrealAbs * 100 : 0;
        const rPrecioPct  = realAbs   > 0 ? Math.abs(p.rb.precio) / realAbs   * 100 : 100;
        const rTcPct      = realAbs   > 0 ? Math.abs(p.rb.tc)     / realAbs   * 100 : 0;
        const divAmt      = divByTicker[p.ticker] ?? 0;
        const divPct      = p.costBasis * p.qty > 0 ? (divAmt / (p.costBasis * p.qty)) * 100 : 0;
        const headerPL    = (p.pl ?? 0) + divAmt;
        const headerPct   = p.costBasis * p.qty > 0 ? (headerPL / (p.costBasis * p.qty)) * 100 : p.plPct;

        return `
          <div class="port-acc-item" data-ticker="${p.ticker}">
            <div class="port-acc-header">
              <div class="port-acc-main">
                <div>
                  ${mktDot(p.pd)}
                  <strong class="port-ticker-link" data-ticker="${p.ticker}"
                    style="color:var(--accent)">${p.ticker}</strong>
                </div>
                <div class="port-acc-price">
                  ${p.hasPx ? this._fmtOrig(p.pd.priceOrig, p.pd.currency) : this._fmtOrig(p.costBasisOrig, p.moneda)}
                </div>
              </div>
              <div class="port-acc-peso">
                <span>${p.hasPx ? fmt(p.peso, 1) + '%' : ''}</span>
                <div class="pos-weight-bar-bg">
                  <div class="pos-weight-bar" style="width:${p.hasPx ? p.peso.toFixed(1) : 0}%"></div>
                </div>
              </div>
              <div class="port-acc-vals">
                <div style="font-weight:600;font-size:.9rem">${p.hasPx ? fmtUSD(p.value) : '—'}</div>
                <div class="${p.hasPx ? plClass(headerPL) : 'neu'}" style="font-size:.75rem">
                  ${p.hasPx ? plSign(headerPL) + fmtUSD(headerPL) + ' (' + plSign(headerPct) + fmt(headerPct, 1) + '%)' : ''}
                </div>
              </div>
              <span class="port-acc-chevron">›</span>
            </div>
            <div class="port-acc-body">
              <div class="port-acc-detail-grid">
                <div>
                  <div class="port-acc-detail-label">Precio actual</div>
                  <div style="font-size:.85rem">${p.hasPx ? this._fmtOrig(p.pd.priceOrig, p.pd.currency) : '—'}</div>
                </div>
                <div>
                  <div class="port-acc-detail-label">Precio prom.</div>
                  <div style="font-size:.85rem">${this._fmtOrig(p.costBasisOrig, p.moneda)}</div>
                </div>
                <div>
                  <div class="port-acc-detail-label">Cantidad</div>
                  <div style="font-size:.85rem">${qtyStr} ud.</div>
                </div>
              </div>
              <div class="pl-bar-wrap" style="margin:12px 0 10px">
                <div class="pl-bar-fill ${plClass(grandTotal)}" style="width:${totalBarPct.toFixed(1)}%"></div>
              </div>
              <div class="pl-sections">
                <div class="pl-section">
                  <div class="pl-section-title">No realizado</div>
                  <div class="pl-section-total ${p.hasPx ? plClass(p.pl) : 'neu'}">
                    ${p.hasPx ? plSign(p.pl) + fmtUSD(p.pl) : '—'}
                  </div>
                  ${p.hasPx ? compRow('Valuación', p.plPrecio, precioPct, showTC) : ''}
                  ${p.hasPx && showTC ? compRow('T. cambio', p.plTC ?? 0, tcPct, showTC) : ''}
                </div>
                <div class="pl-section pl-section-right">
                  <div class="pl-section-title">Realizado</div>
                  <div class="pl-section-total ${plClass(p.rb.total)}">
                    ${p.rb.total !== 0 ? plSign(p.rb.total) + fmtUSD(p.rb.total) : '<span class="neu">—</span>'}
                  </div>
                  ${p.rb.total !== 0 ? compRow('Valuación', p.rb.precio, rPrecioPct, showTC) : ''}
                  ${p.rb.total !== 0 && showTC ? compRow('T. cambio', p.rb.tc, rTcPct, showTC) : ''}
                </div>
              </div>
              ${divAmt > 0 ? `
              <div class="pl-div-row">
                <span class="pl-div-label">Dividendos</span>
                <span class="pl-div-amount pos">+${fmtUSD(divAmt)}</span>
                <span class="pl-div-pct">(+${fmt(divPct, 1)}% sobre costo)</span>
              </div>` : ''}
            </div>
          </div>`;
      };

      const accSorted = [...computedPositions].sort((a, b) => b.peso - a.peso);

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
            <div class="metric-delta ${plClass(totalPL)}">${totalCost ? plSign(totalPL) + fmt((totalPL / totalCost) * 100, 1) + '%' : ''}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">P&L Realizado</div>
            <div class="metric-value ${plClass(totalRealizado)}">${plSign(totalRealizado)}${fmtUSD(totalRealizado)}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">P&L Tipo de cambio</div>
            <div class="metric-value ${plClass(totalTC)}">${plSign(totalTC)}${fmtUSD(totalTC)}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Dividendos</div>
            <div class="metric-value pos">${totalDividendos > 0 ? '+' + fmtUSD(totalDividendos) : fmtUSD(0)}</div>
          </div>
        </div>

        <!-- Gráfico evolución del portafolio -->
        <div class="form-card" id="port-chart-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
            <span style="font-weight:500;font-size:.9rem">Evolución de la cartera</span>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${[['1d','1D'],['5d','1S'],['1mo','1M'],['3mo','3M'],['6mo','6M'],['1y','1A'],['2y','2A'],['5y','5A'],['10y','10A']].map(([v,l]) => `
                <button class="port-period-btn" data-period="${v}" style="
                  padding:4px 13px;border-radius:6px;font-size:.75rem;cursor:pointer;
                  font-family:'DM Mono',monospace;transition:all .15s;
                  border:1px solid ${v==='1mo'?'var(--accent)':'rgba(255,255,255,.15)'};
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

        <!-- Posiciones acordeón -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin:1.5rem 0 .5rem">
          <span style="font-weight:600;font-size:.9rem">Posiciones · ${accSorted.length} activos</span>
          <a href="#inversiones/operaciones" class="btn btn-ghost"
             style="font-size:.7rem;padding:5px 11px">+ Nueva operación</a>
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:.6rem">
          <div style="position:relative;display:inline-flex;align-items:center;flex:1;max-width:220px">
            <input id="pos-filter" type="text" placeholder="Buscar ticker…"
              style="width:100%;font-size:.8rem;padding:5px 10px;padding-right:28px;border-radius:6px;
                border:1px solid var(--border);background:var(--surface);color:var(--text);
                font-family:'DM Mono',monospace;outline:none">
            <button id="pos-filter-clear"
              style="position:absolute;right:6px;background:none;border:none;cursor:pointer;
                color:var(--text-sec);padding:0;font-size:.9rem;line-height:1;visibility:hidden">✕</button>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:.75rem">
          <button class="sort-btn active" data-sort="peso">Peso</button>
          <button class="sort-btn" data-sort="pl_total">P&L Total</button>
          <button class="sort-btn" data-sort="pl_pct">P&L %</button>
        </div>
        <div class="port-accordion">
          ${accSorted.map(p => accItem(p)).join('')}
        </div>

        <!-- Dividendos -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin:1.5rem 0 .75rem">
          <span style="font-weight:600;font-size:.9rem">Dividendos</span>
          <button class="btn btn-ghost" id="div-add-btn" style="font-size:.7rem;padding:5px 11px">+ Registrar</button>
        </div>
        <div id="div-form-wrap" style="display:none;margin-bottom:1rem">
          <div class="form-card" style="margin-bottom:0">
            <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
              <div class="form-group">
                <label>Fecha</label>
                <input id="div-fecha" type="date" value="${new Date().toISOString().slice(0,10)}">
              </div>
              <div class="form-group">
                <label>Ticker</label>
                <select id="div-ticker">
                  <option value="">Seleccionar...</option>
                  ${allUniqueTickers.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Monto (USD)</label>
                <input id="div-monto" type="number" step="0.01" placeholder="0.00">
              </div>
              <div class="form-group">
                <label>Descripción</label>
                <input id="div-desc" type="text" placeholder="Dividendo trimestral">
              </div>
            </div>
            <button class="btn btn-primary" id="div-save-btn">Guardar</button>
          </div>
        </div>
        ${dividendos.length ? `
        <div class="form-card" style="padding:0;overflow:hidden">
          <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.8rem;color:var(--text-sec)">Total recibido</span>
            <strong class="pos">${fmtUSD(totalDividendos)}</strong>
          </div>
          <div style="overflow:auto;max-height:280px">
            <table>
              <thead><tr><th>Fecha</th><th>Ticker</th><th>Monto</th><th>Descripción</th><th></th></tr></thead>
              <tbody id="div-tbody">
                ${dividendos.map(d => `<tr>
                  <td>${fmtDate(d.fecha)}</td>
                  <td><strong>${d.ticker}</strong></td>
                  <td class="pos">+${fmtUSD(parseFloat(d.monto_usd))}</td>
                  <td style="color:var(--text-sec);font-size:.8rem">${d.descripcion || '—'}</td>
                  <td><button class="btn-op-delete div-del-btn" data-id="${d.id}" style="font-size:.75rem">🗑️</button></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : `<div class="empty" style="padding:2rem 0">
          <div class="empty-icon">💰</div>
          <div class="empty-text">Sin dividendos registrados · usá "+ Registrar" para agregar</div>
        </div>`}
      `;

      // Sort buttons
      const sortFns = {
        peso:     (a, b) => b.peso - a.peso,
        pl_total: (a, b) => ((b.pl ?? 0) + b.rb.total) - ((a.pl ?? 0) + a.rb.total),
        pl_pct:   (a, b) => (b.plPct ?? 0) - (a.plPct ?? 0),
      };
      document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b === btn));
          const container = document.querySelector('.port-accordion');
          [...container.querySelectorAll('.port-acc-item')]
            .sort((a, b) => {
              const pa = computedPositions.find(p => p.ticker === a.dataset.ticker);
              const pb = computedPositions.find(p => p.ticker === b.dataset.ticker);
              return sortFns[btn.dataset.sort](pa, pb);
            })
            .forEach(item => container.appendChild(item));
        });
      });

      // Filtro de posiciones
      document.getElementById('pos-filter').addEventListener('input', e => {
        const q = e.target.value.trim().toUpperCase();
        document.getElementById('pos-filter-clear').style.visibility = q ? 'visible' : 'hidden';
        document.querySelectorAll('.port-acc-item').forEach(el => {
          el.style.display = (q && !el.dataset.ticker.includes(q)) ? 'none' : '';
        });
      });
      document.getElementById('pos-filter-clear').addEventListener('click', () => {
        document.getElementById('pos-filter').value = '';
        document.getElementById('pos-filter-clear').style.visibility = 'hidden';
        document.querySelectorAll('.port-acc-item').forEach(el => { el.style.display = ''; });
      });

      // Accordion toggle
      document.querySelectorAll('.port-acc-header').forEach(header => {
        header.addEventListener('click', (e) => {
          if (e.target.closest('.port-ticker-link')) return;
          const item = header.closest('.port-acc-item');
          const body = item.querySelector('.port-acc-body');
          const open = item.classList.toggle('is-open');
          body.style.display = open ? 'block' : 'none';
        });
      });

      // Ticker links → abre en Mercado
      document.querySelectorAll('.port-ticker-link').forEach(el => {
        el.addEventListener('click', () => {
          window._mktAutoSearch = el.dataset.ticker;
          window.location.hash = '#inversiones/mercado';
        });
      });

      // Dividendos
      document.getElementById('div-add-btn').addEventListener('click', () => {
        const wrap = document.getElementById('div-form-wrap');
        wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
      });
      document.getElementById('div-save-btn').addEventListener('click', async () => {
        const fecha  = document.getElementById('div-fecha').value;
        const ticker = document.getElementById('div-ticker').value;
        const monto  = parseFloat(document.getElementById('div-monto').value);
        const desc   = document.getElementById('div-desc').value.trim();
        if (!fecha || !ticker || isNaN(monto) || monto <= 0) { toast('Completá todos los campos', 'err'); return; }
        try {
          await dbInsert('dividendos', { fecha, ticker, monto_usd: monto, descripcion: desc || null });
          toast('Dividendo guardado');
          this.renderPortafolio();
        } catch(e) { toast('Error: ' + e.message, 'err'); }
      });
      document.querySelectorAll('.div-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('¿Eliminar este dividendo?')) return;
          await dbDelete('dividendos', { id: parseInt(btn.dataset.id) });
          toast('Eliminado');
          this.renderPortafolio();
        });
      });

      document.querySelectorAll('.port-period-btn').forEach(btn => {
        btn.addEventListener('click', () => this._loadPortfolioChart(allOps, btn.dataset.period));
      });

      await this._loadPortfolioChart(allOps, '1mo');

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

      const minY   = Math.min(...values);
      const maxY   = Math.max(...values);
      let floorY, padY;
      if (['1d', '5d'].includes(period)) {
        // Intraday / 1-week: zoom tight around actual range
        floorY = minY;
        const spread = maxY - minY;
        padY = spread > 0 ? spread * 0.12 : maxY * 0.002;
      } else {
        // Longer periods: clip bottom 10% so portfolio-building-from-zero doesn't crush the scale
        const sortedVals = [...values].sort((a, b) => a - b);
        const p10idx = Math.max(0, Math.floor(sortedVals.length * 0.10) - 1);
        floorY = sortedVals[p10idx];
        const spanY = maxY - floorY;
        padY = spanY * 0.06 || maxY * 0.05;
      }

      const xTickFmt = period === '1d' ? '%H:%M'
        : ['5d','1mo','3mo'].includes(period) ? '%d %b' : '%b %y';
      const hoverFmt = period === '1d' ? '%H:%M' : '%d %b';

      try { Plotly.purge('port-chart'); } catch(_) {}
      Plotly.newPlot('port-chart', [
        // Baseline invisible — ancla el fill en el percentil 10 (no en cero)
        {
          x: dates, y: new Array(dates.length).fill(floorY - padY),
          type: 'scatter', mode: 'lines',
          line: { width: 0 }, hoverinfo: 'skip', showlegend: false,
        },
        // Línea principal — fill hasta la baseline
        {
          x: dates, y: values,
          type: 'scatter', mode: 'lines',
          fill: 'tonexty',
          fillcolor: isUp ? 'rgba(38,166,154,0.12)' : 'rgba(239,83,80,0.12)',
          line: { color, width: 2 },
          hovertemplate: '$%{y:,.0f}<extra></extra>',
          hoverlabel: {
            bgcolor: color, bordercolor: 'rgba(0,0,0,0)',
            font: { color: '#fff', size: 11, family: "'DM Mono', monospace" },
            namelength: 0,
          },
        },
      ], {
        height: 260,
        margin: { l: 58, r: 8, t: 36, b: 28 },
        plot_bgcolor:  '#071E3D',
        paper_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#8096b0', size: 11, family: "'DM Mono', monospace" },
        title: { text: `${isUp ? '▲' : '▼'} ${Math.abs(chgPct).toFixed(2)}%`, font: { size: 12, color }, x: 0.01 },
        dragmode: false,
        xaxis: {
          showgrid: false, color: '#3d5568',
          tickformat: xTickFmt, hoverformat: hoverFmt,
          tickfont: { size: 10, color: '#6a88a0', family: "'DM Sans', sans-serif" },
          fixedrange: true, showspikes: true, spikemode: 'across',
          spikecolor: '#546272', spikethickness: 1, spikedash: 'dot',
          showline: false, zeroline: false,
        },
        yaxis: {
          showgrid: true, gridcolor: '#0d2848', griddash: 'dot', color: '#3d5568',
          tickfont: { size: 10, color: '#6a88a0', family: "'DM Mono', monospace" },
          nticks: 5,
          showspikes: false, showline: false, zeroline: false,
          fixedrange: true,
          range: [floorY - padY, maxY + padY],
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
    // 1d: intraday using current positions (no date simulation needed)
    if (period === '1d') {
      const qtys = {};
      for (const op of allOps) {
        if (!qtys[op.ticker]) qtys[op.ticker] = 0;
        qtys[op.ticker] += op.tipo === 'compra' ? parseFloat(op.cantidad) : -parseFloat(op.cantidad);
      }
      const activeTkrs = Object.keys(qtys).filter(t => qtys[t] > 0.0001);
      const settled1d = await Promise.allSettled(activeTkrs.map(async ticker => {
        const [chart, priceInfo] = await Promise.all([
          this.fetchYahooChart(ticker, '1d', '30m'),
          this.fetchYahooPrice(ticker),
        ]);
        const { moneda, factor } = this.normalizarMoneda(priceInfo.currency);
        let tc = 1.0;
        if (moneda !== 'USD') { try { tc = (await this.fetchFXRate(moneda)).tc; } catch(_) {} }
        return { ticker, dates: chart.dates, prices: chart.prices, factor, tc };
      }));
      const timeMaps = {};
      const allTimes = new Set();
      for (const r of settled1d) {
        if (r.status !== 'fulfilled' || !r.value.prices.length) continue;
        const { ticker, dates, prices, factor, tc } = r.value;
        const map = {};
        for (let i = 0; i < dates.length; i++) {
          const key = dates[i].getTime();
          map[key] = prices[i] * factor * tc;
          allTimes.add(key);
        }
        timeMaps[ticker] = map;
      }
      const sortedTs = [...allTimes].sort((a, b) => a - b);

      // Cuál es el primer timestamp en que CADA ticker tiene dato propio.
      // A partir del más tardío (cuando el último mercado abrió), todos tienen datos.
      const latestStart1d = Object.values(timeMaps).reduce((acc, map) => {
        const firstTs = Math.min(...Object.keys(map).map(Number));
        return firstTs > acc ? firstTs : acc;
      }, 0);

      // Recorrer todos los timestamps con carry-forward, pero plotear solo desde latestStart1d.
      const lastKnown = {};
      const d1Dates = [], d1Values = [];
      for (const ts of sortedTs) {
        for (const [ticker, map] of Object.entries(timeMaps)) {
          if (map[ts] != null) lastKnown[ticker] = map[ts];
        }
        if (ts < latestStart1d) continue; // esperar a que todos los mercados tengan datos
        let total = 0, hasData = false;
        for (const [ticker, qty] of Object.entries(qtys)) {
          if (qty < 0.0001) continue;
          const p = lastKnown[ticker];
          if (p != null) { total += qty * p; hasData = true; }
        }
        if (hasData && total > 0) { d1Dates.push(new Date(ts)); d1Values.push(total); }
      }
      // Fallback: si no hay puntos tras el filtro (p.ej. NYSE aún no abrió) mostrar todos con carry-forward
      if (!d1Dates.length) {
        const lk2 = {};
        for (const ts of sortedTs) {
          for (const [ticker, map] of Object.entries(timeMaps)) {
            if (map[ts] != null) lk2[ticker] = map[ts];
          }
          let total = 0, hasData = false;
          for (const [ticker, qty] of Object.entries(qtys)) {
            if (qty < 0.0001) continue;
            const p = lk2[ticker];
            if (p != null) { total += qty * p; hasData = true; }
          }
          if (hasData && total > 0) { d1Dates.push(new Date(ts)); d1Values.push(total); }
        }
      }
      return d1Dates.length ? { dates: d1Dates, values: d1Values } : null;
    }

    const rangeMap = { '5d':'5d','1mo':'1mo','3mo':'3mo','6mo':'6mo','1y':'1y','2y':'2y','5y':'5y','10y':'10y' };
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

    // Arrancar solo desde la fecha en que TODOS los tickers tienen su primer dato.
    // Distintos mercados (NYSE vs TSX vs ASX) pueden empezar un día antes/después
    // en el mismo rango, generando saltos artificiales en el total del portafolio.
    const latestStart = Object.values(priceMaps).reduce((acc, map) => {
      const first = Object.keys(map).sort()[0];
      return (first && first > acc) ? first : acc;
    }, '');
    const sortedDates = [...allDateSet].filter(d => !latestStart || d >= latestStart).sort();

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
    if (this._opLimit == null) this._opLimit = 25;
    this._opFilter = '';
    const ops = await dbFetch('operaciones', { order: { col: 'fecha', asc: false }, limit: this._opLimit });
    this._lastOps = ops;
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

      <!-- Historial controles -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin:1.5rem 0 .6rem;flex-wrap:wrap;gap:8px">
        <span style="font-weight:600;font-size:.9rem">Historial</span>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <div style="position:relative;display:inline-flex;align-items:center">
            <input id="ops-filter" type="text" placeholder="Buscar ticker…"
              style="width:140px;font-size:.8rem;padding:5px 28px 5px 10px;border-radius:6px;
                border:1px solid var(--border);background:var(--surface);color:var(--text);
                font-family:'DM Mono',monospace;outline:none">
            <button id="ops-filter-clear"
              style="position:absolute;right:6px;background:none;border:none;cursor:pointer;
                color:var(--text-sec);padding:0;font-size:.9rem;line-height:1;visibility:hidden">✕</button>
          </div>
          <select id="ops-limit"
            style="font-size:.8rem;padding:5px 10px;border-radius:6px;
              border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer">
            <option value="25"  ${this._opLimit===25?'selected':''}>25 ops</option>
            <option value="50"  ${this._opLimit===50?'selected':''}>50 ops</option>
            <option value="100" ${this._opLimit===100?'selected':''}>100 ops</option>
            <option value="200" ${this._opLimit===200?'selected':''}>200 ops</option>
            <option value="0"   ${this._opLimit===null?'selected':''}>Todas</option>
          </select>
        </div>
      </div>

      <!-- Historial tabla -->
      <div class="table-wrap" id="ops-table-wrap">
        ${this._opsTableHTML(ops)}
      </div>
    `;

    // ── Filtro y límite de historial ─────────────────────────────────
    document.getElementById('ops-filter').addEventListener('input', e => {
      this._opFilter = e.target.value.trim().toUpperCase();
      document.getElementById('ops-filter-clear').style.visibility = this._opFilter ? 'visible' : 'hidden';
      const tbody = document.getElementById('ops-tbody');
      if (tbody) { tbody.innerHTML = this._filteredOpRows(); this._attachDeleteHandlers(); }
    });
    document.getElementById('ops-filter-clear').addEventListener('click', () => {
      document.getElementById('ops-filter').value = '';
      this._opFilter = '';
      document.getElementById('ops-filter-clear').style.visibility = 'hidden';
      const tbody = document.getElementById('ops-tbody');
      if (tbody) { tbody.innerHTML = this._filteredOpRows(); this._attachDeleteHandlers(); }
    });
    document.getElementById('ops-limit').addEventListener('change', e => {
      const val = parseInt(e.target.value);
      this._opLimit = val === 0 ? null : val;
      this._refreshTable();
    });

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
        // Obtener tipo de cambio histórico para la fecha de la operación
        if (st.monedaNorm !== 'USD') {
          const fxInfo = await this.fetchFXRate(st.monedaNorm, fecha);
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
    this._portfolioCache = null;
    const newOps = await dbFetch('operaciones', { order: { col: 'fecha', asc: false }, limit: this._opLimit });
    this._lastOps = newOps;
    const wrap = document.getElementById('ops-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = this._opsTableHTML(newOps);
    this._attachDeleteHandlers();
  },

  _opsTableHTML(ops) {
    const rows = this._filteredOpRows();
    const total = ops.length;
    const shown = (this._opFilter ? ops.filter(op => op.ticker.includes(this._opFilter)).length : total);
    const label = this._opFilter
      ? `${shown} de ${total} operaciones · filtro: ${this._opFilter}`
      : `${total} operacion${total !== 1 ? 'es' : ''}`;
    return `
      <div class="table-header"><span class="table-title">${label}</span></div>
      ${ops.length === 0 ? `
        <div class="empty"><div class="empty-icon">🔄</div><div class="empty-text">Sin operaciones registradas aún</div></div>
      ` : `
        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Ticker</th><th>Tipo</th><th>Cantidad</th>
                <th>Precio</th><th>Moneda</th><th>TC</th><th>Monto</th><th>Com.</th><th></th>
              </tr>
            </thead>
            <tbody id="ops-tbody">${rows}</tbody>
          </table>
        </div>
      `}`;
  },

  _filteredOpRows() {
    const ops = this._lastOps ?? [];
    const q = (this._opFilter ?? '').toUpperCase();
    const filtered = q ? ops.filter(op => op.ticker.toUpperCase().includes(q)) : ops;
    return filtered.map(op => this._opRow(op)).join('');
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
    const dec = Math.abs(n) >= 100 ? 0 : 2;
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

        // Use Yahoo's marketState when available; fall back to currentTradingPeriod timestamps
        let marketState = meta.marketState ?? null;
        if (!marketState) {
          const ctp = meta.currentTradingPeriod;
          if (ctp) {
            const now = Date.now() / 1000;
            if (ctp.regular && now >= ctp.regular.start && now <= ctp.regular.end) {
              marketState = 'REGULAR';
            } else if (ctp.pre && now >= ctp.pre.start && now <= ctp.pre.end) {
              marketState = 'PRE';
            } else if (ctp.post && now >= ctp.post.start && now <= ctp.post.end) {
              marketState = 'POST';
            } else {
              marketState = 'CLOSED';
            }
          }
        }

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
          currency:    meta.currency ?? 'USD',
          marketState,
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
        priceOrig:   info.price,
        currency:    info.currency,
        priceUSD:    info.price * factor * tc,
        factor,
        tc,
        marketState: info.marketState,
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

  // Obtiene tipo de cambio vs USD — si se pasa fecha y es pasada, usa el TC histórico de ese día
  async fetchFXRate(monedaNorm, fecha = null) {
    if (!monedaNorm || monedaNorm === 'USD') return { tc: 1.0 };
    if (fecha && fecha < new Date().toISOString().slice(0, 10)) {
      try {
        const tc = await this._fetchHistoricalFXRate(monedaNorm, fecha);
        if (tc) return { tc };
      } catch(_) {}
    }
    try {
      const info = await this.fetchYahooPrice(`${monedaNorm}USD=X`);
      return { tc: info.price };
    } catch(_) {
      toast('⚠️ No se pudo obtener el tipo de cambio, se usará 1.0', 'warn');
      return { tc: 1.0 };
    }
  },

  // Busca el TC de cierre de una moneda vs USD para una fecha específica usando Yahoo Finance
  async _fetchHistoricalFXRate(monedaNorm, fecha) {
    const target    = new Date(fecha + 'T12:00:00');
    const daysSince = (Date.now() - target.getTime()) / 86400000;
    const range     = daysSince > 700 ? '5y' : daysSince > 350 ? '2y' : daysSince > 170 ? '1y' : '6mo';
    const chart     = await this.fetchYahooChart(`${monedaNorm}USD=X`, range, '1d');
    const targetStr = target.toDateString();
    for (let i = 0; i < chart.dates.length; i++) {
      if (chart.dates[i].toDateString() === targetStr && chart.prices[i]) return chart.prices[i];
    }
    // Fallback: día de trading más cercano (fin de semana / feriado)
    let best = null, bestDiff = Infinity;
    for (let i = 0; i < chart.dates.length; i++) {
      if (!chart.prices[i]) continue;
      const diff = Math.abs(chart.dates[i] - target);
      if (diff < bestDiff) { bestDiff = diff; best = chart.prices[i]; }
    }
    return best;
  },

  // Corrige tipo_cambio_usd, precio_unitario, comision y monto_total de todas las ops no-USD
  // usando el TC de cierre histórico de Yahoo Finance para la fecha de cada operación
  async _migrateHistoricalTCs(onProgress) {
    const ops = await dbFetch('operaciones', {
      select: 'id,ticker,fecha,tipo,cantidad,precio_unitario,moneda,tipo_cambio_usd,comision,monto_total',
    });
    const nonUSD = ops.filter(op => op.moneda && op.moneda !== 'USD');
    if (!nonUSD.length) return 0;

    const cache = {};
    let updated = 0;
    for (let i = 0; i < nonUSD.length; i++) {
      const op = nonUSD[i];
      const { moneda: monedaNorm, factor } = this.normalizarMoneda(op.moneda);
      const key = `${monedaNorm}_${op.fecha}`;
      if (!(key in cache)) {
        cache[key] = null;
        try { cache[key] = await this._fetchHistoricalFXRate(monedaNorm, op.fecha); } catch(_) {}
      }
      const newTC = cache[key];
      if (onProgress) onProgress(i + 1, nonUSD.length, op.ticker, op.fecha, newTC);
      if (!newTC) continue;
      const oldTC = parseFloat(op.tipo_cambio_usd) || 1.0;
      if (Math.abs(newTC - oldTC) < 0.00005) continue;

      // Preservar precio en moneda origen, recalcular valores USD
      const priceOrig   = parseFloat(op.precio_unitario) / (factor * oldTC);
      const comOrig     = parseFloat(op.comision || 0) / (factor * oldTC);
      const qty         = parseFloat(op.cantidad);
      const newPriceUSD = priceOrig * factor * newTC;
      const newComUSD   = comOrig   * factor * newTC;
      await dbUpdate('operaciones', {
        tipo_cambio_usd: newTC,
        precio_unitario: newPriceUSD,
        comision:        newComUSD,
      }, { id: op.id });
      updated++;
    }
    return updated;
  },
};
