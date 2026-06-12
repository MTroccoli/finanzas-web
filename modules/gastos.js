window.Mods = window.Mods || {};
window.Mods.gastos = {
  _tab:        'resumen',
  _cats:       [],
  _pending:    [],         // transacciones parseadas pendientes de confirmación
  _learned:    {},         // { merchant_normalizado: categoria_id }
  _excludedCards: '',
  _splitCatNames: new Set(['Restaurantes', 'Viajes']),
  _histMes:      null,
  _histCat:      '',
  _histMoneda:   'UYU',   // 'UYU' | 'USD' | 'TOTAL_USD'
  _histTipo:     '',
  _cuotasMoneda: 'UYU',   // 'UYU' | 'USD' | 'TOTAL_USD'
  _resDesde:     null,
  _resHasta:     null,
  _tc:           '',      // TC UYU/USD — persiste en configuracion

  // Normalizar comercio para matching: lowercase, sin tildes, sin códigos de comercio
  _normMerchant(s) {
    if (!s) return '';
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')         // quitar tildes
      .replace(/\b\d{3,}\b/g, '')                               // quitar números largos (códigos)
      .replace(/\*+\d+/g, '')                                   // quitar *1234
      .replace(/[^a-z0-9 ]+/g, ' ')                             // solo alfanumérico
      .replace(/\b(s a|s r l|sa|srl|sas|sucursal|hiper|express|exp)\b/g, '')
      .replace(/\s+/g, ' ').trim();
  },

  async render() {
    const c = document.getElementById('content');
    c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const [cats, learnedRows, excludedCards, savedTC] = await Promise.all([
      dbFetch('categorias_gastos', { filters: { activo: 1 }, order: { col: 'nombre', asc: true } }),
      dbFetch('merchant_categorias', { order: { col: 'seen_count', asc: false } }).catch(() => []),
      getConfig('gastos_tarjetas_excluidas').catch(() => ''),
      getConfig('gastos_tc').catch(() => ''),
    ]);
    this._cats = cats;
    this._learned = {};
    for (const r of learnedRows) this._learned[r.merchant_normalizado] = r.categoria_id;
    this._learnedRows = learnedRows;
    this._excludedCards = excludedCards || '';
    if (savedTC && !this._tc) this._tc = savedTC;
    this._splitCatIds = new Set(
      cats.filter(c => this._splitCatNames.has(c.nombre)).map(c => c.id)
    );
    this._drawShell();
    this._drawTab();
  },

  _isSplitCat(catId) { return this._splitCatIds?.has(catId); },

  // ── Helpers de moneda (usados en Historial, Cuotas y Resumen) ───────────

  // Formato de USD con prefijo explícito "USD 1,234" para distinguirlo de UYU
  _fmtUSD(n) {
    if (n == null) return '—';
    const dec = Math.abs(n) >= 100 ? 0 : 2;
    return 'USD ' + new Intl.NumberFormat('en-US', {
      minimumFractionDigits: dec, maximumFractionDigits: dec,
    }).format(n);
  },

  // Formatea en la moneda original del gasto
  _fmtMon(n, mon) {
    if (mon === 'USD') return this._fmtUSD(n);
    return new Intl.NumberFormat('es-UY', {
      style: 'currency', currency: mon || 'UYU', maximumFractionDigits: 0,
    }).format(n);
  },

  // Convierte a USD usando el TC; si no hay TC devuelve el número sin convertir
  _toUSD(n, mon, tc) {
    if (mon === 'USD') return parseFloat(n);
    return tc > 0 ? parseFloat(n) / tc : parseFloat(n);
  },

  // Muestra el monto según el modo de vista
  _fmtView(n, mon, viewMode, tc) {
    if (viewMode === 'TOTAL_USD') return this._fmtUSD(this._toUSD(n, mon, tc));
    return this._fmtMon(n, mon);
  },

  // Render del selector de moneda + campo TC (compartido entre Historial y Cuotas)
  _renderMonedaFilter(idPfx, current, tc) {
    const sel = `font-size:.82rem;padding:5px 10px;border-radius:6px;
      border:1px solid var(--border);background:var(--surface);color:var(--text)`;
    return `
      <select id="${idPfx}-moneda" style="${sel}">
        <option value="UYU"${current==='UYU'?' selected':''}>UYU — Pesos</option>
        <option value="USD"${current==='USD'?' selected':''}>USD — Dólares</option>
        <option value="TOTAL_USD"${current==='TOTAL_USD'?' selected':''}>≈ Total en USD</option>
      </select>
      ${current === 'TOTAL_USD' ? `
        <div style="display:flex;align-items:center;gap:6px">
          <label style="font-size:.78rem;color:var(--text-sec);white-space:nowrap">TC UYU/USD</label>
          <input id="${idPfx}-tc" type="number" min="1" step="0.1" placeholder="43.5"
            value="${tc}"
            style="width:78px;font-size:.78rem;padding:4px 8px;border-radius:6px;
              border:1px solid var(--border);background:var(--surface);color:var(--text);
              font-family:'DM Mono',monospace">
        </div>` : ''}`;
  },

  // Guarda el TC en configuracion (fire-and-forget)
  _saveTC(val) {
    this._tc = val;
    setConfig('gastos_tc', val).catch(() => {});
  },

  _drawShell() {
    const c = document.getElementById('content');
    const tabs = [
      ['resumen',  '📊 Resumen'],
      ['historial','📋 Historial'],
      ['cuotas',   '📅 Cuotas'],
      ['importar', '📤 Importar EDC'],
      ['manual',   '✚ Nuevo gasto'],
    ];
    c.innerHTML = `
      <h1>Gastos</h1>
      <p class="page-subtitle">Control de egresos · importación automática de EDC</p>
      <div class="g-tabs">
        ${tabs.map(([t,l]) => `<button class="g-tab${this._tab===t?' active':''}" data-tab="${t}">${l}</button>`).join('')}
      </div>
      <div id="g-content"></div>
    `;
    document.querySelectorAll('.g-tab').forEach(btn =>
      btn.addEventListener('click', () => {
        this._tab = btn.dataset.tab;
        document.querySelectorAll('.g-tab').forEach(b => b.classList.toggle('active', b === btn));
        this._drawTab();
      })
    );
  },

  _drawTab() {
    switch (this._tab) {
      case 'resumen':   return this._drawResumen();
      case 'historial': return this._drawHistorial();
      case 'cuotas':    return this._drawCuotas();
      case 'importar':  return this._drawImportar();
      case 'manual':    return this._drawManual();
    }
  },

  // ── Importar EDC ────────────────────────────────────────────────────────
  _drawImportar() {
    if (this._pending.length) return this._drawReview();
    document.getElementById('g-content').innerHTML = `
      <div class="form-card">
        <h3>Importar Estado de Cuenta VISA</h3>
        <p style="font-size:.82rem;color:var(--text-sec);margin:0 0 16px">
          Subí el PDF del resumen o una captura. Claude extrae y categoriza todas las transacciones automáticamente.
        </p>
        <div style="margin:0 0 14px">
          <label style="display:block;font-size:.78rem;color:var(--text-sec);margin-bottom:4px">
            Tarjetas adicionales a excluir (últimos 4 dígitos, separados por coma)
          </label>
          <input id="g-exclude-cards" type="text" value="${this._excludedCards}"
            placeholder="ej: 7084, 1234"
            style="width:100%;max-width:280px;font-size:.82rem;padding:6px 10px;border-radius:6px;
              border:1px solid var(--border);background:var(--surface);color:var(--text);
              font-family:'DM Mono',monospace">
          <div style="font-size:.7rem;color:var(--text-sec);margin-top:3px">
            Se excluyen sus compras y los descuentos/beneficios asociados
          </div>
        </div>
        <div class="g-upload-zone" id="g-drop-zone">
          <div style="font-size:2rem;line-height:1;margin-bottom:8px">📄</div>
          <div style="font-size:.88rem;color:var(--text-sec)">Arrastrá el archivo acá<br>o tocá para seleccionar</div>
          <div id="g-file-name" style="margin-top:8px;font-size:.78rem;color:var(--accent);display:none"></div>
          <input type="file" id="g-file-input" accept=".pdf,image/*" style="display:none">
        </div>
        <button id="g-btn-parse" class="btn btn-primary" style="margin-top:14px;display:none">
          ✨ Parsear con IA
        </button>
        <div id="g-parse-log" style="margin-top:10px;font-family:'DM Mono',monospace;font-size:.72rem;color:var(--text-sec);min-height:18px"></div>
      </div>
    `;

    const zone     = document.getElementById('g-drop-zone');
    const input    = document.getElementById('g-file-input');
    const btnParse = document.getElementById('g-btn-parse');
    const nameEl   = document.getElementById('g-file-name');
    let selFile    = null;

    const setFile = f => {
      selFile = f;
      nameEl.textContent = f.name;
      nameEl.style.display = 'block';
      btnParse.style.display = 'inline-flex';
    };

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', ()  => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag');
      if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files[0]) setFile(input.files[0]); });

    btnParse.addEventListener('click', async () => {
      if (!selFile) return;
      const log = document.getElementById('g-parse-log');
      btnParse.disabled = true;
      btnParse.textContent = '⏳ Procesando…';
      log.textContent = 'Enviando a Claude…';
      try {
        // Persistir cambios al campo de tarjetas excluidas
        const excludeVal = document.getElementById('g-exclude-cards').value.trim();
        if (excludeVal !== this._excludedCards) {
          this._excludedCards = excludeVal;
          setConfig('gastos_tarjetas_excluidas', excludeVal).catch(() => {});
        }

        const fd = new FormData();
        fd.append('file', selFile);
        if (excludeVal) fd.append('exclude_cards', excludeVal);

        // Enviar top-50 ejemplos aprendidos como hints few-shot
        const topLearned = (this._learnedRows || []).slice(0, 50).map(r => ({
          ejemplo: r.ejemplo_original || r.merchant_normalizado,
          categoria: this._cats.find(c => c.id === r.categoria_id)?.nombre || 'Otros',
        }));
        if (topLearned.length) fd.append('learned', JSON.stringify(topLearned));

        const resp = await fetch(`${SUPABASE_URL}/functions/v1/parse-edc`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${SUPABASE_KEY}` },
          body: fd,
        });
        const result = await resp.json();
        if (!resp.ok || result.error) throw new Error(result.error || result.detail || 'Error desconocido');

        // Aplicar override local con merchant_categorias aprendidos (más confiable que la IA)
        let overrides = 0;
        this._pending = result.transactions.map((t, i) => {
          const norm = this._normMerchant(t.descripcion);
          const learnedCat = this._learned[norm];
          const aiCat = this._cats.find(c => c.nombre === t.categoria)?.id ?? null;
          const finalCat = learnedCat ?? aiCat;
          if (learnedCat && learnedCat !== aiCat) overrides++;
          return {
            ...t, _id: i, _include: true, _dividirEntre: 1,
            _catId: finalCat,
            _cuotaActual:   t.cuota_actual   ?? null,
            _cuotasTotales: t.cuotas_totales ?? null,
            _tipoGasto:     t.tipo_gasto     ?? 'casual',
            _normMerchant: norm,
            _overridden: learnedCat && learnedCat !== aiCat,
          };
        });
        log.textContent = `✅ ${result.count} transacciones · ${overrides} re-categorizadas con tu historial. Revisá y confirmá.`;
        setTimeout(() => this._drawReview(), 900);
      } catch(e) {
        log.textContent = `❌ ${e.message}`;
        btnParse.disabled = false;
        btnParse.textContent = '✨ Parsear con IA';
      }
    });
  },

  _drawReview() {
    const catOpts = this._cats.map(c =>
      `<option value="${c.id}">${c.icono} ${c.nombre}</option>`).join('');
    const sel     = this._pending.filter(t => t._include).length;

    document.getElementById('g-content').innerHTML = `
      <div class="form-card" style="padding-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
          <h3 style="margin:0">${this._pending.length} transacciones · <span id="g-sel-count">${sel}</span> seleccionadas</h3>
          <div style="display:flex;gap:8px">
            <button id="g-btn-cancel" class="btn btn-ghost" style="font-size:.78rem">✕ Cancelar</button>
            <button id="g-btn-confirm" class="btn btn-primary" style="font-size:.78rem">
              ✅ Guardar <span id="g-confirm-n">${sel}</span> gastos
            </button>
          </div>
        </div>
        <div style="overflow-x:auto">
          <table style="font-size:.78rem">
            <thead>
              <tr>
                <th><input type="checkbox" id="g-chk-all" checked></th>
                <th>Fecha</th><th>Descripción</th><th>Monto</th><th>Mon.</th>
                <th>Categoría</th><th title="Tipo de gasto">Tipo</th><th style="white-space:nowrap" title="Dividir entre N personas">÷N</th>
              </tr>
            </thead>
            <tbody id="g-review-tbody">
              ${this._pending.map(t => this._reviewRow(t, catOpts)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const refreshCounts = () => {
      const n = this._pending.filter(t => t._include).length;
      document.getElementById('g-sel-count').textContent   = n;
      document.getElementById('g-confirm-n').textContent   = n;
      document.querySelectorAll('#g-review-tbody tr').forEach((tr, i) => {
        tr.style.opacity = this._pending[i]?._include ? 1 : 0.4;
      });
    };

    document.getElementById('g-chk-all').addEventListener('change', e => {
      this._pending.forEach(t => { t._include = e.target.checked; });
      document.querySelectorAll('.g-row-chk').forEach(c => { c.checked = e.target.checked; });
      refreshCounts();
    });

    const tbody = document.getElementById('g-review-tbody');

    tbody.addEventListener('change', e => {
      const id = e.target.dataset.id !== undefined ? +e.target.dataset.id : null;
      const t  = id != null ? this._pending.find(p => p._id === id) : null;
      if (!t) return;

      if (e.target.classList.contains('g-row-chk')) {
        t._include = e.target.checked;
        refreshCounts();
      }
      if (e.target.classList.contains('g-cat-sel')) {
        t._catId = e.target.value ? +e.target.value : null;
        t.categoria = this._cats.find(c => c.id === t._catId)?.nombre ?? 'Otros';
        const divCell = tbody.querySelector(`.g-div-cell[data-id="${id}"]`);
        if (divCell) divCell.innerHTML = this._divCellHTML(t);
        if (!this._isSplitCat(t._catId)) t._dividirEntre = 1;
      }
      if (e.target.classList.contains('g-div-sel')) {
        t._dividirEntre = +e.target.value || 1;
      }
      if (e.target.classList.contains('g-tipo-sel')) {
        t._tipoGasto = e.target.value;
      }
    });

    tbody.addEventListener('input', e => {
      if (!e.target.classList.contains('g-monto-inp')) return;
      const t = this._pending.find(p => p._id === +e.target.dataset.id);
      if (t) t.monto = parseFloat(e.target.value) || t.monto;
    });

    document.getElementById('g-btn-cancel').addEventListener('click', () => {
      this._pending = [];
      this._drawImportar();
    });
    document.getElementById('g-btn-confirm').addEventListener('click', () => this._confirmImport());
  },

  _divCellHTML(t) {
    if (!this._isSplitCat(t._catId)) return '—';
    const opts = [1, 2, 3, 4, 5, 6, 7, 8].map(n =>
      `<option value="${n}"${n===(t._dividirEntre||1)?' selected':''}>${n===1?'No':'÷'+n}</option>`).join('');
    return `<select class="g-div-sel" data-id="${t._id}"
      style="font-size:.72rem;padding:3px 6px;border-radius:4px;
        border:1px solid var(--border);background:var(--surface);color:var(--text)">${opts}</select>`;
  },

  _reviewRow(t, catOpts) {
    const descEsc = t.descripcion.replace(/"/g, '&quot;');
    const aiBadge = t._overridden
      ? ' <span style="font-size:.6rem;color:var(--accent)" title="Re-categorizado según tu historial">✦</span>'
      : '';
    const cuotaBadge = (t._cuotaActual && t._cuotasTotales)
      ? ` <span style="font-size:.62rem;color:var(--text-sec);background:rgba(255,255,255,.06);padding:1px 5px;border-radius:3px"
          title="Cuota ${t._cuotaActual} de ${t._cuotasTotales}">📅 ${t._cuotaActual}/${t._cuotasTotales}</span>`
      : '';
    return `
      <tr style="opacity:${t._include?1:.4}">
        <td><input type="checkbox" class="g-row-chk" data-id="${t._id}" checked></td>
        <td style="white-space:nowrap;font-family:'DM Mono',monospace;font-size:.72rem">${t.fecha}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${descEsc}">${t.descripcion}${aiBadge}${cuotaBadge}</td>
        <td><input type="number" class="g-monto-inp" data-id="${t._id}" value="${t.monto}"
          style="width:88px;font-size:.75rem;padding:3px 6px;border-radius:4px;
            border:1px solid var(--border);background:var(--surface);color:var(--text);
            font-family:'DM Mono',monospace"></td>
        <td style="font-family:'DM Mono',monospace;font-size:.72rem">${t.moneda}</td>
        <td>
          <select class="g-cat-sel" data-id="${t._id}"
            style="font-size:.72rem;padding:3px 6px;border-radius:4px;
              border:1px solid var(--border);background:var(--surface);color:var(--text);max-width:140px">
            <option value="">—</option>
            ${this._cats.map(c =>
              `<option value="${c.id}"${c.id===t._catId?' selected':''}>${c.icono} ${c.nombre}</option>`
            ).join('')}
          </select>
        </td>
        <td>
          <select class="g-tipo-sel" data-id="${t._id}"
            style="font-size:.72rem;padding:3px 6px;border-radius:4px;
              border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <option value="casual"${(t._tipoGasto||'casual')==='casual'?' selected':''}>💳 Casual</option>
            <option value="recurrente"${t._tipoGasto==='recurrente'?' selected':''}>🔁 Recurrente</option>
          </select>
        </td>
        <td class="g-div-cell" data-id="${t._id}" style="text-align:center">${this._divCellHTML(t)}</td>
      </tr>`;
  },

  async _confirmImport() {
    const toSave = this._pending.filter(t => t._include);
    if (!toSave.length) { toast('Seleccioná al menos una transacción', 'warn'); return; }
    const btn = document.getElementById('g-btn-confirm');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const imp = await dbInsert('importaciones', {
        tipo: 'pdf', nombre_archivo: 'edc_visa', registros_importados: toSave.length,
      });
      for (const t of toSave) {
        const N = Math.max(1, t._dividirEntre || 1);
        const monto = t.monto / N;
        await dbInsert('gastos', {
          fecha: t.fecha, monto, moneda: t.moneda || 'UYU',
          comercio: t.descripcion,
          categoria_id: t._catId || null,
          usuario: 'compartido',
          fuente: 'edc_visa',
          tipo_gasto: t._tipoGasto || 'casual',
          dividido_entre: N,
          importacion_id: imp.id,
          cuota_actual:   t._cuotaActual   || null,
          cuotas_totales: t._cuotasTotales || null,
          notas: N > 1 ? `Dividido entre ${N} · total original: ${t.monto} ${t.moneda}` : null,
        });
      }

      // Aprender merchants categorizados
      await this._learnMerchants(toSave);

      toast(`✅ ${toSave.length} gastos importados`);
      this._pending = [];
      this._tab = 'historial';
      await this.render();
    } catch(e) {
      toast('❌ ' + e.message, 'err');
      btn.disabled = false;
      btn.textContent = `✅ Guardar ${toSave.length} gastos`;
    }
  },

  // Guardar/actualizar mapeo merchant → categoría para futuras importaciones
  async _learnMerchants(transactions) {
    const updates = {};
    for (const t of transactions) {
      if (!t._catId) continue;
      const norm = t._normMerchant || this._normMerchant(t.descripcion);
      if (!norm || norm.length < 3) continue;
      // Si hay conflicto entre filas, gana la última (la corrección más reciente)
      updates[norm] = { ejemplo: t.descripcion, catId: t._catId };
    }
    const sb = getDB();
    for (const [norm, { ejemplo, catId }] of Object.entries(updates)) {
      const { data: existing } = await sb.from('merchant_categorias')
        .select('seen_count').eq('merchant_normalizado', norm).maybeSingle();
      const seen = (existing?.seen_count || 0) + 1;
      await sb.from('merchant_categorias').upsert({
        merchant_normalizado: norm,
        categoria_id: catId,
        ejemplo_original: ejemplo,
        seen_count: seen,
        ultima_vez: new Date().toISOString(),
      });
    }
  },

  // ── Manual ──────────────────────────────────────────────────────────────
  _drawManual() {
    const catOpts = this._cats.map(c =>
      `<option value="${c.id}">${c.icono} ${c.nombre}</option>`).join('');

    document.getElementById('g-content').innerHTML = `
      <div class="form-card">
        <h3>Nuevo gasto</h3>
        <form id="form-gasto">
          <div class="form-grid">
            <div class="form-group">
              <label>Fecha</label>
              <input id="g-fecha" type="date" value="${new Date().toISOString().slice(0,10)}" required>
            </div>
            <div class="form-group">
              <label>Monto</label>
              <input id="g-monto" type="number" step="0.01" min="0.01" placeholder="5000" required>
            </div>
            <div class="form-group">
              <label>Moneda</label>
              <select id="g-moneda">
                <option value="UYU">UYU — Pesos uruguayos</option>
                <option value="USD">USD — Dólares</option>
              </select>
            </div>
            <div class="form-group">
              <label>Comercio / descripción</label>
              <input id="g-comercio" type="text" placeholder="Carrefour, Uber…">
            </div>
            <div class="form-group">
              <label>Categoría</label>
              <select id="g-categoria">
                <option value="">Sin categoría</option>
                ${catOpts}
              </select>
            </div>
            <div class="form-group">
              <label>Tipo de gasto</label>
              <select id="g-tipo-gasto">
                <option value="casual">💳 Casual</option>
                <option value="recurrente">🔁 Recurrente</option>
              </select>
            </div>
            <div class="form-group">
              <label>Usuario</label>
              <select id="g-usuario">
                <option value="compartido">Compartido</option>
                <option value="usuario1">Usuario 1</option>
                <option value="usuario2">Usuario 2</option>
              </select>
            </div>
          </div>
          <div id="g-div-wrap" style="display:none;margin-bottom:14px">
            <label style="font-size:.84rem;margin-bottom:5px;display:block">Dividir entre N personas</label>
            <select id="g-dividir-entre" style="font-size:.84rem;padding:5px 10px;border-radius:6px;
              border:1px solid var(--border);background:var(--surface);color:var(--text)">
              ${[1,2,3,4,5,6,7,8].map(n =>
                `<option value="${n}"${n===1?' selected':''}>${n===1?'No dividir':'Dividir entre '+n}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-grid" style="margin-bottom:14px">
            <div class="form-group">
              <label>Cuota actual (opcional)</label>
              <input id="g-cuota-actual" type="number" min="1" max="120" placeholder="ej: 3">
            </div>
            <div class="form-group">
              <label>Cuotas totales (opcional)</label>
              <input id="g-cuotas-totales" type="number" min="1" max="120" placeholder="ej: 12">
            </div>
          </div>
          <div class="form-group" style="margin-bottom:16px">
            <label>Notas (opcional)</label>
            <input id="g-notas" type="text" placeholder="Detalle adicional…">
          </div>
          <button type="submit" class="btn btn-primary">✚ Registrar gasto</button>
        </form>
      </div>
    `;

    document.getElementById('g-categoria').addEventListener('change', e => {
      const catId = e.target.value ? +e.target.value : null;
      const split = this._isSplitCat(catId);
      document.getElementById('g-div-wrap').style.display = split ? 'block' : 'none';
      if (!split) document.getElementById('g-dividir-entre').value = '1';
    });

    document.getElementById('form-gasto').addEventListener('submit', async e => {
      e.preventDefault();
      const rawMonto = parseFloat(document.getElementById('g-monto').value);
      const N        = parseInt(document.getElementById('g-dividir-entre').value) || 1;
      const monto    = rawMonto / N;
      const catId    = document.getElementById('g-categoria').value;
      const cuotaA   = parseInt(document.getElementById('g-cuota-actual').value)   || null;
      const cuotaT   = parseInt(document.getElementById('g-cuotas-totales').value) || null;
      const notas    = document.getElementById('g-notas').value.trim();

      if ((cuotaA && !cuotaT) || (cuotaT && !cuotaA)) {
        return toast('Completá las dos cuotas o dejalas vacías', 'err');
      }
      if (cuotaA && cuotaT && cuotaA > cuotaT) {
        return toast('La cuota actual no puede ser mayor al total', 'err');
      }

      try {
        await dbInsert('gastos', {
          fecha:        document.getElementById('g-fecha').value,
          monto, moneda: document.getElementById('g-moneda').value,
          comercio:     document.getElementById('g-comercio').value.trim() || null,
          categoria_id: catId ? +catId : null,
          tipo_gasto:   document.getElementById('g-tipo-gasto').value,
          usuario:      document.getElementById('g-usuario').value,
          dividido_entre: N, fuente: 'manual',
          cuota_actual:   cuotaA,
          cuotas_totales: cuotaT,
          notas: N > 1 ? `Total original: ${rawMonto} · dividido entre ${N}` : (notas || null),
        });
        toast('✅ Gasto registrado');
        e.target.reset();
        document.getElementById('g-fecha').value = new Date().toISOString().slice(0,10);
        document.getElementById('g-div-wrap').style.display = 'none';
      } catch(err) { toast('❌ ' + err.message, 'err'); }
    });
  },

  // ── Historial ───────────────────────────────────────────────────────────
  async _drawHistorial() {
    const gc = document.getElementById('g-content');
    gc.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const now       = new Date();
    const mesAct    = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const mesFilter = this._histMes    || mesAct;
    const catFilter = this._histCat    || '';
    const viewMode  = this._histMoneda || 'UYU';   // 'UYU' | 'USD' | 'TOTAL_USD'
    const tipoFilter= this._histTipo   || '';
    const tc        = parseFloat(this._tc) || 0;

    const [yr, mo] = mesFilter.split('-').map(Number);
    const desde = `${yr}-${String(mo).padStart(2,'0')}-01`;
    const hasta = `${yr}-${String(mo).padStart(2,'0')}-${new Date(yr, mo, 0).getDate()}`;

    const meses = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return {
        val: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        lbl: d.toLocaleDateString('es-UY', { month: 'long', year: 'numeric' }),
      };
    });

    let q = getDB().from('gastos').select('*').gte('fecha', desde).lte('fecha', hasta);
    if (catFilter)                   q = q.eq('categoria_id', +catFilter);
    if (tipoFilter)                  q = q.eq('tipo_gasto', tipoFilter);
    if (viewMode !== 'TOTAL_USD')    q = q.eq('moneda', viewMode);
    const { data: gastos, error } = await q.order('fecha', { ascending: false });
    if (error) throw error;

    const needsTC = viewMode === 'TOTAL_USD' && !tc;

    const toVal = (monto, mon) => viewMode === 'TOTAL_USD'
      ? this._toUSD(monto, mon, tc)
      : parseFloat(monto);

    const fmtTotal = n => viewMode === 'TOTAL_USD' ? this._fmtUSD(n) : this._fmtMon(n, viewMode);

    const totalMes = gastos.reduce((s, g) => s + toVal(g.monto, g.moneda), 0);
    const bycat = {};
    for (const g of gastos) {
      const k = g.categoria_id ?? 'sin';
      bycat[k] = (bycat[k] || 0) + toVal(g.monto, g.moneda);
    }

    const catBadge = id => {
      const c = this._cats.find(c => c.id === (id === 'sin' ? null : +id));
      return c ? `${c.icono} ${c.nombre}` : '—';
    };
    const catOpts = this._cats.map(c =>
      `<option value="${c.id}">${c.icono} ${c.nombre}</option>`).join('');
    const selSt = `font-size:.82rem;padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)`;

    gc.innerHTML = `
      <!-- Filtros -->
      <div class="form-card" style="padding:12px 16px;margin-bottom:.75rem">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <select id="h-mes" style="${selSt}">
            ${meses.map(m => `<option value="${m.val}"${m.val===mesFilter?' selected':''}>${m.lbl}</option>`).join('')}
          </select>
          <select id="h-cat" style="${selSt}">
            <option value="">Todas las categorías</option>
            ${this._cats.map(c =>
              `<option value="${c.id}"${String(c.id)===catFilter?' selected':''}>${c.icono} ${c.nombre}</option>`
            ).join('')}
          </select>
          <select id="h-tipo" style="${selSt}">
            <option value=""${!tipoFilter?' selected':''}>Todos</option>
            <option value="casual"${tipoFilter==='casual'?' selected':''}>💳 Casual</option>
            <option value="recurrente"${tipoFilter==='recurrente'?' selected':''}>🔁 Recurrente</option>
          </select>
          ${this._renderMonedaFilter('h', viewMode, this._tc)}
        </div>
        ${needsTC ? `<div style="margin-top:8px;font-size:.75rem;color:var(--red)">
          ⚠ Ingresá el TC UYU/USD para ver los totales convertidos.</div>` : ''}
      </div>

      <!-- Resumen por categoría -->
      ${Object.keys(bycat).length === 0 ? '' : `
      <div class="form-card" style="padding:14px 16px;margin-bottom:.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="font-weight:600;font-size:.9rem">Resumen del mes
            ${viewMode==='TOTAL_USD' && tc
              ? `<span style="font-size:.7rem;color:var(--accent);font-weight:400"> · en USD (TC ${tc})</span>`
              : ''}
          </span>
          <span style="font-family:'DM Mono',monospace;font-size:.85rem;color:var(--accent);font-weight:600">
            Total: ${fmtTotal(totalMes)}
          </span>
        </div>
        ${Object.entries(bycat).sort((a,b) => b[1]-a[1]).map(([id, tot]) => {
          const pct = totalMes > 0 ? (tot/totalMes*100) : 0;
          return `
            <div style="margin-bottom:9px">
              <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:3px">
                <span>${catBadge(id)}</span>
                <span style="font-family:'DM Mono',monospace">
                  ${fmtTotal(tot)} <span style="color:var(--text-sec)">(${pct.toFixed(0)}%)</span>
                </span>
              </div>
              <div style="height:4px;background:var(--border);border-radius:2px">
                <div style="height:4px;background:var(--accent);border-radius:2px;width:${pct.toFixed(1)}%"></div>
              </div>
            </div>`;
        }).join('')}
      </div>`}

      <!-- Recurrente vs Casual -->
      ${(() => {
        const rec = gastos.filter(g => g.tipo_gasto === 'recurrente').reduce((s, g) => s + toVal(g.monto, g.moneda), 0);
        const cas = gastos.filter(g => g.tipo_gasto !== 'recurrente').reduce((s, g) => s + toVal(g.monto, g.moneda), 0);
        if (!rec && !cas) return '';
        const pctRec = totalMes > 0 ? (rec / totalMes * 100) : 0;
        return `
        <div class="form-card" style="padding:12px 16px;margin-bottom:.75rem">
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div style="flex:1;min-width:120px">
              <div style="font-size:.7rem;color:var(--text-sec);margin-bottom:2px">🔁 Recurrente</div>
              <div style="font-family:'DM Mono',monospace;font-weight:600">${fmtTotal(rec)}</div>
              <div style="font-size:.7rem;color:var(--text-sec)">${pctRec.toFixed(0)}% del total</div>
            </div>
            <div style="flex:1;min-width:120px">
              <div style="font-size:.7rem;color:var(--text-sec);margin-bottom:2px">💳 Casual</div>
              <div style="font-family:'DM Mono',monospace;font-weight:600">${fmtTotal(cas)}</div>
              <div style="font-size:.7rem;color:var(--text-sec)">${(100-pctRec).toFixed(0)}% del total</div>
            </div>
          </div>
        </div>`;
      })()}

      <!-- Tabla -->
      <div class="table-wrap">
        <div class="table-header">
          <span class="table-title">${gastos.length} gastos</span>
          <span style="font-size:.68rem;color:var(--text-sec);font-family:'DM Mono',monospace">${mesFilter}</span>
        </div>
        ${gastos.length === 0 ? `
          <div class="empty"><div class="empty-icon">💸</div>
          <div class="empty-text">Sin gastos para este período</div></div>
        ` : `
          <table>
            <thead><tr>
              <th>Fecha</th><th>Comercio</th><th>Categoría</th>
              <th>Mon.</th><th>Monto</th><th></th>
            </tr></thead>
            <tbody id="g-hist-tbody">
              ${gastos.map(g => this._histRow(g, catOpts, viewMode, tc)).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;

    ['h-mes','h-cat','h-tipo'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        this._histMes  = document.getElementById('h-mes').value;
        this._histCat  = document.getElementById('h-cat').value;
        this._histTipo = document.getElementById('h-tipo').value;
        this._drawHistorial();
      });
    });
    document.getElementById('h-moneda')?.addEventListener('change', e => {
      this._histMoneda = e.target.value;
      this._drawHistorial();
    });
    document.getElementById('h-tc')?.addEventListener('change', e => {
      this._saveTC(e.target.value.trim());
      this._drawHistorial();
    });

    this._attachHistHandlers(gastos, catOpts, viewMode, tc);
  },

  _histRow(g, catOpts, viewMode, tc) {
    const monBadge = `<span style="font-size:.7rem;font-family:'DM Mono',monospace;color:var(--text-sec)">${g.moneda}</span>`;
    const badges = (g.tipo_gasto === 'recurrente' ? ' <span style="font-size:.6rem;color:var(--accent)">🔁</span>' : '')
      + (g.dividido_entre > 1 ? ` <span style="font-size:.65rem;color:var(--text-sec)">÷${g.dividido_entre}</span>` : '')
      + (g.cuota_actual && g.cuotas_totales ? ` <span style="font-size:.62rem;color:var(--text-sec);background:rgba(255,255,255,.06);padding:1px 5px;border-radius:3px">📅 ${g.cuota_actual}/${g.cuotas_totales}</span>` : '');
    const catC = this._cats.find(c => c.id === g.categoria_id);
    const catLabel = catC ? `${catC.icono} ${catC.nombre}` : '—';
    const montoDisplay = this._fmtView(parseFloat(g.monto), g.moneda, viewMode, tc);
    return `
      <tr data-id="${g.id}">
        <td style="white-space:nowrap">${fmtDate(g.fecha)}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${g.comercio ?? '—'}${badges}</td>
        <td>${catLabel}</td>
        <td>${monBadge}</td>
        <td style="font-family:'DM Mono',monospace;font-weight:600;white-space:nowrap">${montoDisplay}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-edit-g" data-id="${g.id}"
            style="font-size:.7rem;padding:2px 7px">✏️</button>
          <button class="btn btn-ghost btn-del-g" data-id="${g.id}"
            style="font-size:.7rem;padding:2px 7px;color:var(--red)">✕</button>
        </td>
      </tr>`;
  },

  _histEditRow(g, catOpts) {
    return `
      <tr class="g-editing" data-id="${g.id}" style="background:rgba(255,255,255,.04)">
        <td colspan="6" style="padding:10px 8px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
            <div>
              <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Fecha</div>
              <input class="ge-fecha" type="date" value="${g.fecha}"
                style="font-size:.78rem;padding:4px 7px;border-radius:5px;
                  border:1px solid var(--border);background:var(--surface);color:var(--text)">
            </div>
            <div style="flex:1;min-width:120px">
              <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Comercio</div>
              <input class="ge-comercio" type="text" value="${(g.comercio||'').replace(/"/g,'&quot;')}"
                style="width:100%;font-size:.78rem;padding:4px 7px;border-radius:5px;
                  border:1px solid var(--border);background:var(--surface);color:var(--text)">
            </div>
            <div>
              <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Monto</div>
              <input class="ge-monto" type="number" step="0.01" value="${g.monto}"
                style="width:90px;font-size:.78rem;padding:4px 7px;border-radius:5px;
                  border:1px solid var(--border);background:var(--surface);color:var(--text);
                  font-family:'DM Mono',monospace">
            </div>
            <div>
              <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Moneda</div>
              <select class="ge-moneda" style="font-size:.78rem;padding:4px 7px;border-radius:5px;
                border:1px solid var(--border);background:var(--surface);color:var(--text)">
                <option value="UYU"${g.moneda==='UYU'?' selected':''}>UYU</option>
                <option value="USD"${g.moneda==='USD'?' selected':''}>USD</option>
              </select>
            </div>
            <div>
              <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Categoría</div>
              <select class="ge-cat" style="font-size:.78rem;padding:4px 7px;border-radius:5px;
                border:1px solid var(--border);background:var(--surface);color:var(--text)">
                <option value="">—</option>
                ${this._cats.map(c =>
                  `<option value="${c.id}"${c.id===g.categoria_id?' selected':''}>${c.icono} ${c.nombre}</option>`
                ).join('')}
              </select>
            </div>
            <div>
              <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Tipo</div>
              <select class="ge-tipo" style="font-size:.78rem;padding:4px 7px;border-radius:5px;
                border:1px solid var(--border);background:var(--surface);color:var(--text)">
                <option value="casual"${g.tipo_gasto!=='recurrente'?' selected':''}>💳 Casual</option>
                <option value="recurrente"${g.tipo_gasto==='recurrente'?' selected':''}>🔁 Recurrente</option>
              </select>
            </div>
            <div style="display:flex;gap:6px;align-items:flex-end;padding-bottom:1px">
              <button class="btn btn-primary ge-save" data-id="${g.id}"
                style="font-size:.75rem;padding:5px 12px">✓ Guardar</button>
              <button class="btn btn-ghost ge-cancel" data-id="${g.id}"
                style="font-size:.75rem;padding:5px 10px">✕</button>
            </div>
          </div>
        </td>
      </tr>`;
  },

  _attachHistHandlers(gastos, catOpts, viewMode, tc) {
    const tbody = document.getElementById('g-hist-tbody');
    if (!tbody) return;

    tbody.addEventListener('click', async e => {
      const id = +e.target.dataset.id;

      // Eliminar
      if (e.target.classList.contains('btn-del-g')) {
        if (!confirm('¿Eliminar este gasto?')) return;
        await dbDelete('gastos', { id });
        toast('Eliminado');
        this._drawHistorial();
        return;
      }

      // Abrir edición
      if (e.target.classList.contains('btn-edit-g')) {
        const existing = tbody.querySelector('tr.g-editing');
        if (existing) existing.remove();
        const dataRow = tbody.querySelector(`tr[data-id="${id}"]:not(.g-editing)`);
        if (!dataRow) return;
        const g = gastos.find(x => x.id === id);
        if (!g) return;
        dataRow.insertAdjacentHTML('afterend', this._histEditRow(g, catOpts));
        tbody.querySelector(`.ge-comercio`).focus();
        return;
      }

      // Cancelar edición
      if (e.target.classList.contains('ge-cancel')) {
        tbody.querySelector('tr.g-editing')?.remove();
        return;
      }

      // Guardar edición
      if (e.target.classList.contains('ge-save')) {
        const editRow = tbody.querySelector('tr.g-editing');
        if (!editRow) return;
        const monto = parseFloat(editRow.querySelector('.ge-monto').value);
        if (!monto || monto <= 0) { toast('Monto inválido', 'err'); return; }
        try {
          await dbUpdate('gastos', {
            fecha:       editRow.querySelector('.ge-fecha').value,
            comercio:    editRow.querySelector('.ge-comercio').value.trim() || null,
            monto,
            moneda:      editRow.querySelector('.ge-moneda').value,
            categoria_id: editRow.querySelector('.ge-cat').value ? +editRow.querySelector('.ge-cat').value : null,
            tipo_gasto:  editRow.querySelector('.ge-tipo').value,
          }, { id });
          toast('✅ Guardado');
          this._drawHistorial();
        } catch(err) { toast('❌ ' + err.message, 'err'); }
      }
    });
  },

  // ── Cuotas (proyección de gastos futuros) ───────────────────────────────
  async _drawCuotas() {
    const gc = document.getElementById('g-content');
    gc.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const sb = getDB();
    const { data: rows, error } = await sb.from('gastos')
      .select('*').not('cuotas_totales', 'is', null)
      .order('fecha', { ascending: false });
    if (error) throw error;

    const viewMode = this._cuotasMoneda || 'UYU';   // 'UYU' | 'USD' | 'TOTAL_USD'
    const tc       = parseFloat(this._tc) || 0;
    const needsTC  = viewMode === 'TOTAL_USD' && !tc;

    // Filtrar según viewMode
    const allActivas = (rows || []).filter(g => g.cuota_actual < g.cuotas_totales);
    const activas = viewMode === 'TOTAL_USD'
      ? allActivas
      : allActivas.filter(g => g.moneda === viewMode);

    const catBadge = id => {
      const c = this._cats.find(c => c.id === id);
      return c ? `${c.icono} ${c.nombre}` : '—';
    };
    const fmtV = (n, mon) => this._fmtView(n, mon, viewMode, tc);

    // Proyección próximos 12 meses
    const now = new Date();
    const proj = [];
    for (let i = 1; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      proj.push({
        ym:    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        label: d.toLocaleDateString('es-UY', { month: 'short', year: '2-digit' }),
        total: 0,
      });
    }

    for (const g of activas) {
      const restantes = g.cuotas_totales - g.cuota_actual;
      const [yr, mo] = g.fecha.split('-').map(Number);
      const baseDate  = new Date(yr, mo - 1, 1);
      const monto     = viewMode === 'TOTAL_USD'
        ? this._toUSD(g.monto, g.moneda, tc)
        : parseFloat(g.monto);
      for (let k = 1; k <= restantes; k++) {
        const d  = new Date(baseDate.getFullYear(), baseDate.getMonth() + k, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const slot = proj.find(p => p.ym === ym);
        if (slot) slot.total += monto;
      }
    }

    // Total pendiente global
    const totalPend = activas.reduce((s, g) => {
      const m = viewMode === 'TOTAL_USD'
        ? this._toUSD(g.monto, g.moneda, tc)
        : parseFloat(g.monto);
      return s + m * (g.cuotas_totales - g.cuota_actual);
    }, 0);
    const fmtTotalPend = viewMode === 'TOTAL_USD' ? this._fmtUSD(totalPend) : this._fmtMon(totalPend, viewMode);

    const maxProj = Math.max(1, ...proj.map(p => p.total));
    const selSt   = `font-size:.82rem;padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)`;

    gc.innerHTML = `
      <!-- Filtro moneda -->
      <div class="form-card" style="padding:12px 16px;margin-bottom:.75rem">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          ${this._renderMonedaFilter('c', viewMode, this._tc)}
        </div>
        ${needsTC ? `<div style="margin-top:8px;font-size:.75rem;color:var(--red)">
          ⚠ Ingresá el TC UYU/USD para convertir a dólares.</div>` : ''}
      </div>

      <!-- Totales -->
      <div class="form-card" style="padding:14px 16px;margin-bottom:.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-weight:600;font-size:.9rem">Cuotas pendientes
              ${viewMode==='TOTAL_USD' && tc
                ? `<span style="font-size:.7rem;color:var(--accent);font-weight:400"> · en USD (TC ${tc})</span>`
                : ''}
            </div>
            <div style="font-size:.74rem;color:var(--text-sec);margin-top:2px">
              ${activas.length} compras con cuotas restantes
            </div>
          </div>
          <div style="text-align:right;font-family:'DM Mono',monospace;font-size:.85rem;color:var(--accent);font-weight:600">
            ${activas.length ? fmtTotalPend : '—'}
          </div>
        </div>
      </div>

      ${activas.length === 0 ? `
        <div class="table-wrap">
          <div class="empty"><div class="empty-icon">📅</div>
          <div class="empty-text">Sin cuotas pendientes</div>
          <div style="font-size:.75rem;color:var(--text-sec);margin-top:4px">
            Las compras en cuotas detectadas al importar el EDC aparecerán acá.
          </div></div>
        </div>` : `

      <!-- Proyección por mes -->
      <div class="form-card" style="padding:14px 16px;margin-bottom:.75rem">
        <div style="font-weight:600;font-size:.9rem;margin-bottom:12px">Proyección próximos 12 meses</div>
        ${proj.filter(p => p.total > 0).map(p => {
          const pct = Math.max(2, (p.total / maxProj) * 100);
          const label = viewMode === 'TOTAL_USD' ? this._fmtUSD(p.total) : this._fmtMon(p.total, viewMode);
          return `
            <div style="margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;font-size:.76rem;margin-bottom:3px">
                <span style="text-transform:capitalize">${p.label}</span>
                <span style="font-family:'DM Mono',monospace">${label}</span>
              </div>
              <div style="height:4px;background:var(--border);border-radius:2px">
                <div style="height:4px;background:var(--accent);border-radius:2px;width:${pct.toFixed(1)}%"></div>
              </div>
            </div>`;
        }).join('') || `<div style="color:var(--text-sec);font-size:.78rem">Sin proyección en los próximos 12 meses</div>`}
      </div>

      <!-- Lista -->
      <div class="table-wrap">
        <div class="table-header"><span class="table-title">Compras en cuotas</span></div>
        <table>
          <thead><tr>
            <th>Compra</th><th>Categoría</th><th>Cuota</th><th>Por mes</th><th>Restante</th><th></th>
          </tr></thead>
          <tbody>
            ${activas.map(g => {
              const restantes = g.cuotas_totales - g.cuota_actual;
              const monto     = parseFloat(g.monto);
              return `
                <tr>
                  <td>${g.comercio ?? '—'}
                    <div style="font-size:.68rem;color:var(--text-sec);font-family:'DM Mono',monospace">
                      ${fmtDate(g.fecha)} · ${g.moneda}
                    </div>
                  </td>
                  <td>${catBadge(g.categoria_id)}</td>
                  <td style="font-family:'DM Mono',monospace;font-size:.78rem">${g.cuota_actual}/${g.cuotas_totales}</td>
                  <td style="font-family:'DM Mono',monospace;font-weight:600;white-space:nowrap">
                    ${fmtV(monto, g.moneda)}
                  </td>
                  <td style="font-family:'DM Mono',monospace;color:var(--text-sec);white-space:nowrap">
                    ${fmtV(monto * restantes, g.moneda)}
                    <div style="font-size:.65rem">${restantes} cuotas</div>
                  </td>
                  <td><button class="btn btn-ghost btn-del-c" data-id="${g.id}"
                    style="font-size:.7rem;padding:2px 7px;color:var(--red)">✕</button></td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`}
    `;

    document.getElementById('c-moneda')?.addEventListener('change', e => {
      this._cuotasMoneda = e.target.value;
      this._drawCuotas();
    });
    document.getElementById('c-tc')?.addEventListener('change', e => {
      this._saveTC(e.target.value.trim());
      this._drawCuotas();
    });

    document.querySelectorAll('.btn-del-c').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este gasto?')) return;
        await dbDelete('gastos', { id: +btn.dataset.id });
        toast('Eliminado');
        this._drawCuotas();
      })
    );
  },

  // ── Resumen (gráficos) ──────────────────────────────────────────────────
  async _drawResumen() {
    const gc = document.getElementById('g-content');
    gc.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const now = new Date();
    if (!this._resDesde || !this._resHasta) {
      const [yr, mo] = [now.getFullYear(), now.getMonth() + 1];
      this._resDesde = `${yr}-${String(mo).padStart(2,'0')}-01`;
      this._resHasta = `${yr}-${String(mo).padStart(2,'0')}-${new Date(yr, mo, 0).getDate()}`;
    }
    const tc = parseFloat(this._tc) || 0;

    // Construir últimos 12 meses
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        ym:    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        label: d.toLocaleDateString('es-UY', { month: 'short', year: '2-digit' }),
      });
    }
    const firstMonthDate = `${months[0].ym}-01`;

    const sb = getDB();
    const [barRows, pieRows] = await Promise.all([
      sb.from('gastos').select('fecha, monto, moneda').gte('fecha', firstMonthDate),
      sb.from('gastos').select('monto, moneda, categoria_id').gte('fecha', this._resDesde).lte('fecha', this._resHasta),
    ]);
    const barData = barRows.data || [];
    const pieData = pieRows.data || [];

    // Buckets por mes (UYU y USD nativos)
    const byMonth = {};
    for (const m of months) byMonth[m.ym] = { UYU: 0, USD: 0 };
    for (const r of barData) {
      const ym = r.fecha.slice(0, 7);
      if (byMonth[ym]) byMonth[ym][r.moneda === 'USD' ? 'USD' : 'UYU'] += parseFloat(r.monto);
    }

    // Buckets por categoría — todo convertido a USD
    const byCat = {};
    for (const r of pieData) {
      const k = r.categoria_id ?? 'sin';
      const v = r.moneda === 'USD' ? parseFloat(r.monto)
                                   : (tc ? parseFloat(r.monto) / tc : 0);
      byCat[k] = (byCat[k] || 0) + v;
    }
    const totalPie = Object.values(byCat).reduce((s, v) => s + v, 0);

    gc.innerHTML = `
      <div class="form-card" style="padding:12px 16px;margin-bottom:.75rem">
        <div style="display:flex;align-items:center;gap:6px">
          <label style="font-size:.78rem;color:var(--text-sec)">TC UYU/USD</label>
          <input id="r-tc" type="number" min="1" step="0.1" placeholder="43.5" value="${this._tc}"
            style="width:90px;font-size:.78rem;padding:4px 8px;border-radius:6px;
              border:1px solid var(--border);background:var(--surface);color:var(--text);
              font-family:'DM Mono',monospace">
        </div>
        ${!tc ? '<div style="margin-top:8px;font-size:.75rem;color:var(--red)">⚠ Ingresá el TC UYU/USD para ver los totales convertidos a USD.</div>' : ''}
      </div>

      <div class="form-card" style="padding:14px 16px;margin-bottom:.75rem">
        <div style="font-weight:600;font-size:.9rem;margin-bottom:8px">
          Evolución mensual (últimos 12 meses · en USD)
        </div>
        <div id="g-bar-chart" style="height:340px"></div>
      </div>

      <div class="form-card" style="padding:14px 16px;margin-bottom:.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <div style="font-weight:600;font-size:.9rem">Gastos por categoría (en USD)</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <label style="font-size:.72rem;color:var(--text-sec)">Desde</label>
            <input id="r-desde" type="date" value="${this._resDesde}"
              style="font-size:.78rem;padding:4px 7px;border-radius:5px;
                border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <label style="font-size:.72rem;color:var(--text-sec)">Hasta</label>
            <input id="r-hasta" type="date" value="${this._resHasta}"
              style="font-size:.78rem;padding:4px 7px;border-radius:5px;
                border:1px solid var(--border);background:var(--surface);color:var(--text)">
          </div>
        </div>
        <div style="font-size:.78rem;color:var(--text-sec);margin-bottom:8px">
          Total del período: <span style="color:var(--accent);font-family:'DM Mono',monospace;font-weight:600">${this._fmtUSD(totalPie)}</span>
        </div>
        <div id="g-pie-chart" style="height:360px"></div>
      </div>
    `;

    // ── Bar chart (apilado por moneda, todo en USD) ─────────────────────
    const uyuY    = months.map(m => tc ? byMonth[m.ym].UYU / tc : 0);
    const usdY    = months.map(m => byMonth[m.ym].USD);
    const xLabels = months.map(m => m.label);

    const layoutBase = {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor:  'rgba(0,0,0,0)',
      font: { color: '#cfcfcf', family: 'DM Sans, sans-serif', size: 11 },
    };

    Plotly.newPlot('g-bar-chart', [
      {
        x: xLabels, y: uyuY, type: 'bar', name: 'UYU (convertido)',
        marker: { color: '#3b82f6' },
        hovertemplate: '<b>%{x}</b><br>UYU → USD %{y:,.0f}<extra></extra>',
      },
      {
        x: xLabels, y: usdY, type: 'bar', name: 'USD',
        marker: { color: '#10b981' },
        hovertemplate: '<b>%{x}</b><br>USD %{y:,.0f}<extra></extra>',
      },
    ], {
      ...layoutBase,
      barmode: 'stack',
      margin: { t: 10, r: 10, b: 70, l: 70 },
      xaxis: { tickangle: -30, gridcolor: 'rgba(255,255,255,.05)' },
      yaxis: { tickprefix: 'USD ', tickformat: ',d', gridcolor: 'rgba(255,255,255,.05)', zerolinecolor: 'rgba(255,255,255,.1)' },
      legend: { orientation: 'h', y: -0.25, x: 0 },
    }, { displayModeBar: false, responsive: true });

    // ── Pie chart por categoría ─────────────────────────────────────────
    const palette = ['#3b82f6','#10b981','#f59e0b','#ef4444','#a855f7','#06b6d4','#ec4899','#84cc16','#f97316','#6366f1','#14b8a6','#eab308'];
    const entries = Object.entries(byCat).filter(([, v]) => v > 0).sort((a,b) => b[1] - a[1]);
    if (!entries.length) {
      document.getElementById('g-pie-chart').innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-sec);font-size:.85rem">Sin datos en el rango seleccionado</div>';
    } else {
      const pieLabels = entries.map(([id]) => {
        if (id === 'sin') return 'Sin categoría';
        const c = this._cats.find(c => c.id === +id);
        return c ? `${c.icono} ${c.nombre}` : 'Otros';
      });
      const pieValues = entries.map(([, v]) => v);
      Plotly.newPlot('g-pie-chart', [{
        values: pieValues,
        labels: pieLabels,
        type: 'pie',
        hole: 0.45,
        textinfo: 'label+percent',
        textposition: 'outside',
        textfont: { size: 11, color: '#cfcfcf' },
        marker: { colors: palette.slice(0, pieValues.length), line: { color: 'rgba(0,0,0,.2)', width: 1 } },
        hovertemplate: '<b>%{label}</b><br>USD %{value:,.0f}<br>%{percent}<extra></extra>',
      }], {
        ...layoutBase,
        showlegend: false,
        margin: { t: 20, r: 20, b: 20, l: 20 },
      }, { displayModeBar: false, responsive: true });
    }

    // Handlers
    document.getElementById('r-tc')?.addEventListener('change', e => {
      this._saveTC(e.target.value.trim());
      this._drawResumen();
    });
    ['r-desde','r-hasta'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        this._resDesde = document.getElementById('r-desde').value;
        this._resHasta = document.getElementById('r-hasta').value;
        this._drawResumen();
      });
    });
  },
};
