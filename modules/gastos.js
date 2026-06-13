window.Mods = window.Mods || {};
window.Mods.gastos = {
  _tab:        'resumen',
  _cats:       [],
  _pending:    [],         // transacciones parseadas pendientes de confirmación
  _learned:    {},         // { merchant_normalizado: categoria_id }
  _learnedMoneda: {},     // { merchant_normalizado: 'UYU'|'USD' } — aprendido de correcciones
  _excludedCards: '',
  _splitCatNames: new Set(['Restaurantes', 'Viajes']),
  _histMes:      null,
  _histCat:      '',
  _histMoneda:   'UYU',   // 'UYU' | 'USD' | 'TOTAL_USD'
  _histTipo:     '',
  _histSearch:   '',
  _histTitular:  '',      // Filtro por tarjetahabiente en Historial
  _histSort:     { col: 'fecha', dir: 'desc' },
  _reviewSort:   { col: 'fecha', dir: 'asc' },
  _histView:     'gastos',  // 'gastos' | 'comercios'
  _cuotasMoneda: 'UYU',   // 'UYU' | 'USD' | 'TOTAL_USD'
  _resDesde:     null,
  _resHasta:     null,
  _tc:           '',      // TC UYU/USD — persiste en configuracion
  _edcMes:       '',      // Mes del EDC (YYYY-MM) — corrige fechas de cuotas > 1
  _resCat:       '',      // Filtro de categoría en Resumen
  _comTipo:      '',      // Filtro tipo en panel Comercios
  _histBanco:    '',      // Filtro banco/tarjeta en Historial
  _cuotasBanco:  '',      // Filtro banco/tarjeta en Cuotas
  _pendingFile:  null,    // Archivo PDF pendiente de subir a storage tras confirmar import
  _reparsePath:  null,    // Ruta del PDF en storage cuando se re-parsea uno existente (evita duplicar)
  _comSort:      { col: 'count', dir: 'desc' },  // Sort activo en panel Comercios
  _adicOpenMonths: new Set(),                     // "titular|mes" abiertos en acordeón Adicional
  _bancotarjeta: '',      // Banco/tarjeta detectado por la IA en el EDC activo
  _resBanco:     '',      // Filtro por banco/tarjeta en Resumen
  _adicTitular:  '',      // Nombre titular adicional asignado en la vista previa
  _adicMes:      null,    // Filtro mes en panel Adicional
  _adicTitularFiltro: '', // Filtro titular en panel Adicional
  _adicCards:    [],      // [{ digits, name, editedName }] — tarjetas adicionales detectadas en el EDC

  // Normalizar comercio para matching: lowercase, sin tildes, sin códigos de comercio
  _normMerchant(s) {
    if (!s) return '';
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')         // quitar tildes
      .replace(/\b\d{1,2}\/\d{1,2}\b/g, '')                     // quitar cuotas 1/12, 2/6, etc.
      .replace(/\b\d{3,}\b/g, '')                               // quitar números largos (códigos)
      .replace(/\*+\d+/g, '')                                   // quitar *1234
      .replace(/[^a-z0-9 ]+/g, ' ')                             // solo alfanumérico
      .replace(/\b(s a|s r l|sa|srl|sas|sucursal|hiper|express|exp)\b/g, '')
      .replace(/\s+/g, ' ').trim();
  },

  // Limpia el nombre de comercio para mostrar/guardar (NO para matchear).
  // Quita bloque de moneda extranjera "(BR ,BRL, 166,16)", número de cuota
  // "04/04" y espacios sobrantes. Preserva mayúsculas/tildes del original.
  _cleanComercio(s) {
    if (!s) return s;
    return String(s)
      .replace(/\(\s*[A-Za-z]{2,3}\s*,[^)]*\)/g, ' ')   // (BR ,BRL, 166,16)
      .replace(/\b\d{1,2}\/\d{1,2}\b/g, ' ')             // cuota 04/04, 1/12
      .replace(/\s*([·\-–|])\s*$/,'')                    // separadores colgando al final
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;])/g, '$1')
      .trim();
  },

  // Detecta si una transacción es un pago del titular a la tarjeta (no es gasto).
  _isPago(s) {
    if (!s) return false;
    return /\bsu\s+pago\b|\bpago\s+recibido\b|pago\s*[-·]?\s*gracias|\bpago\s+en\s+l[ií]nea\b/i.test(String(s));
  },

  // Busca categoría aprendida para un merchant normalizado.
  // Primero intenta exact match, luego substring bilateral (mínimo 5 chars).
  _learnedFuzzy(norm) {
    if (!norm) return null;
    if (this._learned[norm]) return this._learned[norm];
    for (const [key, catId] of Object.entries(this._learned)) {
      if (key.length < 5 || norm.length < 5) continue;
      if (norm.includes(key) || key.includes(norm)) return catId;
    }
    return null;
  },

  // Busca moneda aprendida para un merchant (UYU/USD corregido manualmente).
  _learnedMonedaFuzzy(norm) {
    if (!norm) return null;
    if (this._learnedMoneda[norm]) return this._learnedMoneda[norm];
    for (const [key, mon] of Object.entries(this._learnedMoneda)) {
      if (key.length < 5 || norm.length < 5) continue;
      if (norm.includes(key) || key.includes(norm)) return mon;
    }
    return null;
  },


  async render() {
    const c = document.getElementById('content');
    c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const [cats, learnedRows, excludedCards, savedTC, divRows] = await Promise.all([
      dbFetch('categorias_gastos', { filters: { activo: 1 }, order: { col: 'nombre', asc: true } }),
      dbFetch('merchant_categorias', { order: { col: 'seen_count', asc: false } }).catch(() => []),
      getConfig('gastos_tarjetas_excluidas').catch(() => ''),
      getConfig('gastos_tc').catch(() => ''),
      getDB().from('gastos').select('comercio,dividido_entre').gt('dividido_entre', 1).not('comercio', 'is', null)
        .then(r => r.data || []).catch(() => []),
    ]);
    this._cats = cats;
    this._learned = {};
    this._learnedMoneda = {};
    this._histMoneda   = 'TOTAL_USD';
    this._cuotasMoneda = 'TOTAL_USD';
    for (const r of learnedRows) {
      this._learned[r.merchant_normalizado] = r.categoria_id;
      if (r.moneda) this._learnedMoneda[r.merchant_normalizado] = r.moneda;
    }
    this._learnedRows = learnedRows;
    // Aprender "dividido entre" del historial: por comercio normalizado, el valor más frecuente
    this._learnedDiv = {};
    const divCounts = {};
    for (const r of divRows) {
      const k = this._normMerchant(r.comercio);
      if (!k) continue;
      divCounts[k] = divCounts[k] || {};
      divCounts[k][r.dividido_entre] = (divCounts[k][r.dividido_entre] || 0) + 1;
    }
    for (const [k, counts] of Object.entries(divCounts)) {
      this._learnedDiv[k] = +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
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
    const lbl = `font-size:.68rem;color:var(--text-sec);margin-bottom:2px`;
    return `
      <div>
        <div style="${lbl}">Importes</div>
        <select id="${idPfx}-moneda" style="${sel}">
          <option value="UYU"${current==='UYU'?' selected':''}>UYU — Pesos</option>
          <option value="USD"${current==='USD'?' selected':''}>USD — Dólares</option>
          <option value="TOTAL_USD"${current==='TOTAL_USD'?' selected':''}>≈ Total en USD</option>
        </select>
      </div>
      ${current === 'TOTAL_USD' ? `
      <div>
        <div style="${lbl}">T/C UYU/USD</div>
        <input id="${idPfx}-tc" type="number" min="1" step="0.1" placeholder="43.5"
          value="${tc}"
          style="width:78px;font-size:.82rem;padding:5px 8px;border-radius:6px;
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
      ['comercios','🏷️ Comercios'],
      ['adicional','👤 Adicional'],
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
      case 'historial': return this._drawHistorialGastos();
      case 'cuotas':    return this._drawCuotas();
      case 'comercios': return this._drawHistorialComercios();
      case 'adicional': return this._drawHistorialAdicional();
      case 'importar':  return this._drawImportar();
      case 'manual':    return this._drawManual();
    }
  },

  // ── Sort helpers ────────────────────────────────────────────────────────

  _thSort(col, label, s) {
    const cur = s.col === col;
    const arrow = cur
      ? (s.dir === 'asc' ? ' ↑' : ' ↓')
      : ' <span style="opacity:.25;font-size:.75em">⇅</span>';
    return `<th data-sort="${col}" data-lbl="${label}" style="cursor:pointer;user-select:none;white-space:nowrap">${label}${arrow}</th>`;
  },

  _refreshSortArrows(containerEl, sortState) {
    containerEl.querySelectorAll('th[data-sort]').forEach(th => {
      const col = th.dataset.sort;
      const lbl = th.dataset.lbl;
      const cur = sortState.col === col;
      th.innerHTML = cur
        ? lbl + (sortState.dir === 'asc' ? ' ↑' : ' ↓')
        : lbl + ' <span style="opacity:.25;font-size:.75em">⇅</span>';
    });
  },

  _sortPending(arr) {
    const { col, dir } = this._reviewSort;
    const asc = dir === 'asc';
    return [...arr].sort((a, b) => {
      let va, vb;
      switch (col) {
        case 'fecha': va = a.fecha || '';  vb = b.fecha || ''; break;
        case 'desc':  va = (a.descripcion||'').toLowerCase(); vb = (b.descripcion||'').toLowerCase(); break;
        case 'monto': va = Math.abs(parseFloat(a.monto||0)); vb = Math.abs(parseFloat(b.monto||0)); break;
        case 'tipo':  va = a._tipoGasto||''; vb = b._tipoGasto||''; break;
        default: return 0;
      }
      return va < vb ? (asc ? -1 : 1) : va > vb ? (asc ? 1 : -1) : 0;
    });
  },

  _sortGastos(arr) {
    const { col, dir } = this._histSort;
    const asc = dir === 'asc';
    return [...arr].sort((a, b) => {
      let va, vb;
      switch (col) {
        case 'fecha':    va = a.fecha||'';    vb = b.fecha||''; break;
        case 'comercio': va = (a.comercio||'').toLowerCase(); vb = (b.comercio||'').toLowerCase(); break;
        case 'monto':    va = parseFloat(a.monto||0); vb = parseFloat(b.monto||0); break;
        default: return 0;
      }
      return va < vb ? (asc ? -1 : 1) : va > vb ? (asc ? 1 : -1) : 0;
    });
  },

  // ── Importar EDC ────────────────────────────────────────────────────────
  async _drawImportar() {
    if (this._pending.length) return this._drawReview();

    // Cargar importaciones anteriores para el panel de gestión
    const sb = getDB();
    const [impsRes, gastosRes, stoRes] = await Promise.all([
      sb.from('importaciones').select('id, registros_importados, archivo_path, banco_tarjeta').order('id', { ascending: false }),
      sb.from('gastos').select('importacion_id, fecha').not('importacion_id', 'is', null),
      sb.storage.from('edcs').list('', { limit: 1000, sortBy: { column: 'name', order: 'asc' } }).catch(() => ({ data: [] })),
    ]);
    const impsRaw = impsRes.data || [];
    const gastosAll = gastosRes.data || [];
    // PDFs en storage que no están enlazados a ninguna importación (huérfanos →
    // recuperables tras un borrado accidental de la tabla gastos/importaciones).
    const stoFiles = (stoRes?.data || []).filter(f => f?.name && /\.(pdf|png|jpe?g|webp|gif)$/i.test(f.name));
    const referenced = new Set(impsRaw.map(i => i.archivo_path).filter(Boolean));
    const orphanFiles = stoFiles
      .filter(f => !referenced.has(f.name))
      .sort((a, b) => (parseInt(b.name) || 0) - (parseInt(a.name) || 0));
    const impMap = {};
    for (const g of gastosAll) {
      const id = g.importacion_id;
      if (!impMap[id]) impMap[id] = { count: 0, desde: g.fecha, hasta: g.fecha };
      impMap[id].count++;
      if (g.fecha < impMap[id].desde) impMap[id].desde = g.fecha;
      if (g.fecha > impMap[id].hasta) impMap[id].hasta = g.fecha;
    }
    const imps = impsRaw.map(i => ({ ...i, ...(impMap[i.id] || { count: 0, desde: null, hasta: null }) }));

    document.getElementById('g-content').innerHTML = `
      <div class="form-card">
        <h3>Importar Estado de Cuenta VISA</h3>
        <p style="font-size:.82rem;color:var(--text-sec);margin:0 0 16px">
          Subí el PDF del resumen o una captura. Claude extrae y categoriza todas las transacciones automáticamente,
          incluyendo las tarjetas adicionales detectadas en el documento.
        </p>
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

      ${imps.length === 0 ? '' : `
      <div class="form-card" style="padding:14px 16px;margin-top:.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <h3 style="margin:0;font-size:.9rem">Importaciones anteriores</h3>
        </div>
        <table style="font-size:.8rem">
          <thead><tr>
            <th style="width:40px">
              <input type="checkbox" id="g-imp-chk-all" title="Seleccionar todos">
            </th>
            <th>#</th><th>Banco/Tarjeta</th><th>Período</th><th>Gastos</th><th colspan="2"></th>
          </tr></thead>
          <tbody>
            ${imps.map(imp => `
              <tr data-imp-id="${imp.id}">
                <td><input type="checkbox" class="g-imp-chk" data-id="${imp.id}"></td>
                <td style="font-family:'DM Mono',monospace;color:var(--text-sec)">#${imp.id}</td>
                <td style="white-space:nowrap;font-size:.78rem">${imp.banco_tarjeta || '—'}</td>
                <td style="white-space:nowrap">
                  ${imp.desde ? `${fmtDate(imp.desde)} → ${fmtDate(imp.hasta)}` : '—'}
                </td>
                <td style="font-family:'DM Mono',monospace">${imp.count}</td>
                <td>
                  <button class="btn btn-ghost g-imp-del-btn" data-id="${imp.id}" data-n="${imp.count}"
                    style="font-size:.72rem;padding:2px 8px;color:var(--red)">✕ Eliminar</button>
                </td>
                <td>
                  ${imp.archivo_path ? `
                    <button class="btn btn-ghost g-imp-reparse-btn" data-path="${imp.archivo_path}"
                      style="font-size:.72rem;padding:2px 8px">↺ Re-parsear</button>
                  ` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div id="g-imp-sel-bar" style="display:none;margin-top:10px;display:flex;gap:8px;align-items:center">
          <span id="g-imp-sel-count" style="font-size:.78rem;color:var(--text-sec)"></span>
          <button id="g-btn-del-sel" class="btn btn-ghost"
            style="font-size:.75rem;padding:4px 10px;color:var(--red);border-color:rgba(239,68,68,.3)">
            🗑 Eliminar seleccionados
          </button>
        </div>
      </div>`}

      ${orphanFiles.length === 0 ? '' : `
      <div class="form-card" style="padding:14px 16px;margin-top:.75rem;border:1px solid rgba(245,158,11,.35)">
        <h3 style="margin:0 0 4px;font-size:.9rem">♻️ Recuperar EDCs sin importar</h3>
        <p style="font-size:.78rem;color:var(--text-sec);margin:0 0 12px">
          Estos ${orphanFiles.length} PDF${orphanFiles.length>1?'s están':' está'} en el storage pero no tienen gastos asociados
          (quedaron tras un borrado). Re-parsealos para volver a cargarlos. Tus categorías aprendidas se aplican automáticamente.
        </p>
        <table style="font-size:.8rem">
          <thead><tr><th>Archivo</th><th></th></tr></thead>
          <tbody>
            ${orphanFiles.map(f => `
              <tr>
                <td style="font-family:'DM Mono',monospace;color:var(--text-sec)">${f.name}</td>
                <td style="text-align:right">
                  <button class="btn btn-ghost g-imp-reparse-btn" data-path="${f.name}"
                    style="font-size:.72rem;padding:2px 8px">↺ Re-parsear</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}

      ${imps.length === 0 ? '' : `
      <div class="form-card" style="padding:14px 16px;margin-top:.75rem;
        border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.04)">
        <h3 style="margin:0 0 4px;font-size:.88rem;color:var(--red)">⚠️ Zona de peligro</h3>
        <p style="font-size:.76rem;color:var(--text-sec);margin:0 0 12px">
          Esta acción elimina todos los gastos e importaciones. Los PDFs quedan en storage y
          se pueden recuperar, pero los ajustes manuales se pierden. No se puede deshacer.
        </p>
        <button id="g-btn-del-all" class="btn btn-ghost"
          style="font-size:.8rem;padding:6px 16px;color:var(--red);border-color:rgba(239,68,68,.45)">
          🗑 Eliminar todos los gastos importados
        </button>
      </div>`}
    `;

    const zone     = document.getElementById('g-drop-zone');
    const input    = document.getElementById('g-file-input');
    const btnParse = document.getElementById('g-btn-parse');
    const nameEl   = document.getElementById('g-file-name');
    let selFile    = null;

    const setFile = f => {
      selFile = f;
      this._reparsePath = null;   // subida fresca, no es recuperación de un PDF existente
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
      log.innerHTML = '<span class="spinner" style="width:13px;height:13px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:7px"></span>Enviando a Claude…';
      try {
        const fd = new FormData();
        fd.append('file', selFile);

        // Enviar categorías disponibles para que la IA use nombres exactos
        fd.append('categorias', JSON.stringify(this._cats.map(c => c.nombre)));

        // Enviar todos los ejemplos aprendidos como hints few-shot
        const topLearned = (this._learnedRows || []).map(r => ({
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
        const restId  = this._cats.find(c => c.nombre === 'Restaurantes')?.id ?? null;
        const otrosId = this._cats.find(c => c.nombre === 'Otros')?.id ?? null;
        let overrides = 0;
        this._pending = result.transactions.map((t, i) => {
          // Auto-detectar cuotas del patrón N/M en la descripción si la IA no las set
          let cuotaActual   = t.cuota_actual   ?? null;
          let cuotasTotales = t.cuotas_totales ?? null;
          let descripcion   = t.descripcion;
          // Leer la cuota del patrón N/M si la IA no la marcó (la cuota se conserva
          // en sus campos; el N/M se quita del nombre en el cleanComercio de abajo).
          if (!cuotaActual) {
            const cm = descripcion.match(/\b(\d{1,2})\/(\d{1,2})\b/);
            if (cm) {
              const n = parseInt(cm[1], 10), tot = parseInt(cm[2], 10);
              if (tot >= 2 && tot <= 60 && n >= 1 && n <= tot) {
                cuotaActual   = n;
                cuotasTotales = tot;
              }
            }
          }
          // Limpiar SIEMPRE el nombre visible (cuota, moneda extranjera, espacios)
          descripcion = this._cleanComercio(descripcion);
          const esPago = t.es_pago === true || this._isPago(t.descripcion);
          const norm = this._normMerchant(descripcion);
          const learnedCat = this._learnedFuzzy(norm);
          const nc = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
          const aiCatName = nc(t.categoria || '');
          let aiCat = this._cats.find(c => nc(c.nombre) === aiCatName)?.id ?? null;
          // Fuzzy: si el AI devolvió nombre parcial (ej "Farmacia" ≈ "Farmacia y Salud")
          if (!aiCat && aiCatName.length >= 4) {
            aiCat = this._cats.find(c => {
              const cn = nc(c.nombre);
              return cn.includes(aiCatName) || aiCatName.includes(cn);
            })?.id ?? null;
          }

          // No sugerir Restaurantes para montos pequeños — bajar a Otros
          // (los comercios ya aprendidos ganan siempre, no aplica)
          if (!learnedCat && aiCat === restId && restId !== null) {
            const monto = parseFloat(t.monto) || 0;
            const tooSmall = (t.moneda === 'UYU' && monto < 1300)
                          || (t.moneda === 'USD' && monto < 30);
            if (tooSmall) aiCat = otrosId;
          }

          // Montos negativos sin categoría aprendida → sugerir Beneficio
          if (!learnedCat && parseFloat(t.monto) < 0) {
            const beneficioId = this._cats.find(c => c.nombre === 'Beneficio')?.id ?? null;
            if (beneficioId) aiCat = beneficioId;
          }

          const finalCat = learnedCat ?? aiCat;
          if (learnedCat && learnedCat !== aiCat) overrides++;
          // Aplicar moneda aprendida de correcciones previas del usuario
          const learnedMon = this._learnedMonedaFuzzy(norm);
          const moneda = learnedMon || t.moneda || 'UYU';
          return {
            ...t,
            descripcion,         // descripción limpia sin el N/M de cuota
            moneda,
            _id: i,
            _esPago: esPago,
            _include: t.tarjeta_adicional !== true && t.descuento_de_adicional !== true && !esPago,
            _dividirEntre: this._learnedDiv[norm] || 1,
            _catId: finalCat,
            _cuotaActual:   cuotaActual,
            _cuotasTotales: cuotasTotales,
            _tipoGasto: ['casual','recurrente','tdc'].includes(t.tipo_gasto) ? t.tipo_gasto : 'casual',
            _normMerchant: norm,
            _overridden: learnedCat && learnedCat !== aiCat,
            _monedaOverridden: !!learnedMon,   // si ya estaba aprendida, cuenta como override
            _manualCard: null,
          };
        });
        // Guardar tarjetas adicionales detectadas (con nombre editable)
        this._adicCards = (result.adicionales || []).map(a => ({
          digits: a.digits, name: a.name || null, editedName: a.name || '',
        }));
        // Vincular descuentos de adicional a su tarjeta (por ref_comercio → purchase.descripcion)
        const adicPurchases = this._pending.filter(t => t.tarjeta_adicional);
        for (const disc of this._pending.filter(t => t.descuento_de_adicional)) {
          const refNorm = this._normMerchant(disc.ref_comercio || '');
          const linked  = adicPurchases.find(p => {
            const pn = this._normMerchant(p.descripcion);
            return pn === refNorm || pn.includes(refNorm) || refNorm.includes(pn);
          });
          if (linked) disc._adicCardDigits = linked.adicional_card_digits || null;
        }
        // Auto-aplicar mes detectado por la IA
        if (result.fecha_cierre) {
          this._edcMes = result.fecha_cierre;
          const inp = document.getElementById('g-edc-mes');
          if (inp) inp.value = result.fecha_cierre;
        }
        this._pendingFile = selFile;
        if (result.banco_tarjeta) this._bancotarjeta = result.banco_tarjeta;
        const addCount  = this._pending.filter(p => p.tarjeta_adicional).length;
        const descCount = this._pending.filter(p => p.descuento_de_adicional).length;
        const bancoInfo = result.banco_tarjeta ? ` · 🏦 ${result.banco_tarjeta}` : '';
        const mesInfo   = result.fecha_cierre  ? ` · EDC: ${result.fecha_cierre}` : '';
        const addInfo   = addCount  > 0 ? ` · ${addCount} adicional` : '';
        const descInfo  = descCount > 0 ? ` · ${descCount} desc. asociado` : '';
        const truncWarn = result.truncated ? ' ⚠ Respuesta truncada — revisá que estén todas.' : '';
        log.textContent = `✅ ${result.count} transacciones${bancoInfo}${mesInfo}${addInfo}${descInfo} · ${overrides} re-categorizadas. Revisá y confirmá.${truncWarn}`;
        setTimeout(() => this._drawReview(), 900);
      } catch(e) {
        log.textContent = `❌ ${e.message}`;
        btnParse.disabled = false;
        btnParse.textContent = '✨ Parsear con IA';
      }
    });

    // ── Gestión de importaciones anteriores ───────────────────────────────
    const deleteImport = async (ids, label) => {
      if (!confirm(`¿Eliminar ${label}? Esta acción no se puede deshacer.`)) return;
      try {
        for (const id of ids) {
          await getDB().from('gastos').delete().eq('importacion_id', id);
          await getDB().from('importaciones').delete().eq('id', id);
        }
        toast(`✅ Eliminado${ids.length > 1 ? 's' : ''}`);
        this._drawImportar();
      } catch(err) { toast('❌ ' + err.message, 'err'); }
    };

    // Eliminar batch individual
    document.querySelectorAll('.g-imp-del-btn').forEach(btn =>
      btn.addEventListener('click', () =>
        deleteImport([+btn.dataset.id], `${btn.dataset.n} gastos del batch #${btn.dataset.id}`)
      )
    );

    // Re-parsear: descargar archivo guardado y relanzar el parseo
    document.querySelectorAll('.g-imp-reparse-btn').forEach(btn =>
      btn.addEventListener('click', async () => {
        const path = btn.dataset.path;
        if (!path) return;
        btn.disabled = true; btn.textContent = '⏳ Descargando…';
        try {
          const { data, error } = await getDB().storage.from('edcs').download(path);
          if (error) throw error;
          const ext = path.split('.').pop() || 'pdf';
          const mime = ext === 'pdf' ? 'application/pdf' : `image/${ext}`;
          selFile = new File([data], path, { type: mime });
          this._reparsePath = path;   // marcar para enlazar (no duplicar) al confirmar
          nameEl.textContent = selFile.name;
          nameEl.style.display = 'block';
          btnParse.style.display = 'inline-flex';
          btnParse.click();
        } catch(err) {
          toast('❌ ' + err.message, 'err');
          btn.disabled = false; btn.textContent = '↺ Re-parsear';
        }
      })
    );

    // Select all checkbox
    const chkAll = document.getElementById('g-imp-chk-all');
    const selBar = document.getElementById('g-imp-sel-bar');
    const selCount = document.getElementById('g-imp-sel-count');
    const updateSelBar = () => {
      const checked = [...document.querySelectorAll('.g-imp-chk:checked')];
      if (selBar) {
        selBar.style.display = checked.length ? 'flex' : 'none';
        if (selCount) {
          const total = checked.reduce((s, c) => s + (+(c.closest('tr')?.querySelector('.g-imp-del-btn')?.dataset.n || 0)), 0);
          selCount.textContent = `${checked.length} batch${checked.length>1?'es':''} · ${total} gastos seleccionados`;
        }
      }
    };
    chkAll?.addEventListener('change', e => {
      document.querySelectorAll('.g-imp-chk').forEach(c => { c.checked = e.target.checked; });
      updateSelBar();
    });
    document.querySelectorAll('.g-imp-chk').forEach(c => c.addEventListener('change', updateSelBar));

    // Eliminar seleccionados
    document.getElementById('g-btn-del-sel')?.addEventListener('click', () => {
      const ids = [...document.querySelectorAll('.g-imp-chk:checked')].map(c => +c.dataset.id);
      if (!ids.length) return;
      const total = [...document.querySelectorAll('.g-imp-chk:checked')].reduce(
        (s, c) => s + (+(c.closest('tr')?.querySelector('.g-imp-del-btn')?.dataset.n || 0)), 0
      );
      deleteImport(ids, `${total} gastos de ${ids.length} batch${ids.length>1?'es':''}`);
    });

    // Eliminar TODO — confirmación explícita con cantidad exacta
    document.getElementById('g-btn-del-all')?.addEventListener('click', () => {
      const ids   = imps.map(i => i.id);
      const total = imps.reduce((s, i) => s + i.count, 0);
      const ok = confirm(
        `⚠️ ELIMINAR TODOS LOS GASTOS\n\n` +
        `Se van a borrar ${total} gastos de ${ids.length} importaciones.\n\n` +
        `Los PDFs originales quedan en storage y se pueden recuperar, ` +
        `pero los ajustes manuales (nombres, divisiones, etc.) no.\n\n` +
        `¿Confirmás?`
      );
      if (ok) deleteImport(ids, `los ${total} gastos importados`);
    });
  },

  _drawReview() {
    const catOpts    = this._cats.map(c => `<option value="${c.id}">${c.icono} ${c.nombre}</option>`).join('');
    const adicCards  = this._adicCards || [];
    const hasAdics   = adicCards.length > 0;
    const rs         = this._reviewSort;
    const tableHead  = `<thead class="review-thead"><tr>
      <th></th>
      ${this._thSort('fecha', 'Fecha', rs)}
      ${this._thSort('desc',  'Descripción', rs)}
      ${this._thSort('monto', 'Monto', rs)}
      <th>Mon.</th>
      <th>Categoría</th>
      ${this._thSort('tipo',  'Tipo', rs)}
      <th style="white-space:nowrap" title="Dividir entre N personas">÷N</th>
      ${hasAdics ? '<th title="Asignar a tarjeta">TDC</th>' : ''}
    </tr></thead>`;

    // Clasificar pendientes: usar _adicCardDigits (ya calculado en el linking step)
    // en lugar de re-hacer el matching por nombre (que falla con variantes como "LAS MARGARITAS 2")
    const linkedDiscIds = new Set(
      this._pending.filter(t => t.descuento_de_adicional && t._adicCardDigits).map(t => t._id)
    );
    const mainRowsAll = this._pending.filter(t => !t.tarjeta_adicional && !linkedDiscIds.has(t._id));
    const mainRows = this._sortPending(mainRowsAll);

    const getCardRows = (digits) => {
      const purchases = this._pending.filter(t => t.tarjeta_adicional && t.adicional_card_digits === digits);
      const pNorms    = new Set(purchases.map(t => this._normMerchant(t.descripcion)));
      const discounts = this._pending.filter(t => t.descuento_de_adicional && (pNorms.has(this._normMerchant(t.ref_comercio || '')) || t._adicCardDigits === digits));
      const all       = [...purchases, ...discounts];
      return { purchases, discounts, all, sorted: this._sortPending(all) };
    };

    const sel = this._pending.filter(t => t._include).length;

    // Sección tarjeta titular
    const mainSection = `
      <div class="form-card" style="padding-bottom:12px;margin-bottom:.75rem">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <input type="checkbox" id="g-chk-main-all" ${mainRows.every(t=>t._include)?'checked':''} style="width:15px;height:15px;cursor:pointer">
          <span style="font-size:.82rem;font-weight:600">💳 Tarjeta titular</span>
          <span style="font-size:.7rem;color:var(--text-sec)">${mainRows.length} transacciones</span>
        </div>
        <div style="overflow-x:auto">
          <table style="font-size:.78rem">${tableHead}
            <tbody id="g-main-tbody">
              ${mainRows.map(t => this._reviewRow(t, catOpts)).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    // Secciones por tarjeta adicional
    const adicSections = adicCards.map(card => {
      const { purchases, discounts, all, sorted } = getCardRows(card.digits);
      if (!all.length) return '';
      const allChecked = all.every(t => t._include);
      return `
        <div class="form-card" style="padding-bottom:12px;margin-bottom:.75rem;border-left:3px solid rgba(16,185,129,.5)">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
            <input type="checkbox" class="g-adic-card-all" data-digits="${card.digits}"
              ${allChecked?'checked':''} style="width:15px;height:15px;cursor:pointer">
            <div>
              <span style="font-size:.82rem;font-weight:600">👤 Tarjeta adicional **** ${card.digits}</span>
              <span style="font-size:.68rem;color:var(--text-sec);margin-left:6px">
                ${purchases.length} compras · ${discounts.length} descuentos
              </span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-left:auto;flex-wrap:wrap">
              <span style="font-size:.72rem;color:var(--text-sec)">Titular:</span>
              <input type="text" class="g-adic-name" data-digits="${card.digits}"
                value="${card.editedName}" placeholder="Nombre del titular"
                style="font-size:.74rem;padding:3px 8px;border-radius:5px;width:130px;
                  border:1px solid rgba(16,185,129,.4);background:rgba(16,185,129,.07);color:var(--text)">
            </div>
            <span style="font-size:.68rem;color:var(--text-sec)">
              ☐ Sin marcar → pestaña Adicional para cobrarle
            </span>
          </div>
          <div style="overflow-x:auto">
            <table style="font-size:.78rem">${tableHead}
              <tbody class="g-adic-tbody" data-digits="${card.digits}">
                ${sorted.map(t => this._reviewRow(t, catOpts)).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }).join('');

    document.getElementById('g-content').innerHTML = `
      <div class="form-card" style="padding:10px 16px;margin-bottom:.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <h3 style="margin:0 0 4px">${this._pending.length} transacciones · <span id="g-sel-count">${sel}</span> seleccionadas</h3>
            <div style="display:flex;align-items:center;gap:12px;font-size:.75rem;color:var(--text-sec);flex-wrap:wrap">
              <span style="display:flex;align-items:center;gap:6px">
                📅 EDC:
                <input id="g-review-edc-mes" type="month" value="${this._edcMes}"
                  style="font-size:.74rem;padding:2px 6px;border-radius:5px;
                    border:1px solid var(--border);background:var(--surface);color:var(--text);
                    font-family:'DM Mono',monospace">
              </span>
              <span style="display:flex;align-items:center;gap:6px">
                🏦 Banco/Tarjeta:
                <input id="g-review-banco" type="text" value="${this._bancotarjeta}" placeholder="ej: BBVA Visa"
                  style="font-size:.74rem;padding:2px 8px;border-radius:5px;width:130px;
                    border:1px solid var(--border);background:var(--surface);color:var(--text)">
              </span>
              <span style="font-size:.68rem;color:var(--text-sec)">Editá si la IA se equivocó</span>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button id="g-btn-cancel" class="btn btn-ghost" style="font-size:.78rem">✕ Cancelar</button>
            <button id="g-btn-confirm" class="btn btn-primary" style="font-size:.78rem">
              ✅ Guardar <span id="g-confirm-n">${sel}</span> gastos
            </button>
          </div>
        </div>
      </div>
      ${mainSection}
      ${adicSections}
    `;

    const refreshCounts = () => {
      const n = this._pending.filter(t => t._include).length;
      document.getElementById('g-sel-count').textContent = n;
      document.getElementById('g-confirm-n').textContent = n;
      this._pending.forEach(t => {
        const row = document.querySelector(`tr[data-pending-id="${t._id}"]`);
        if (row) row.style.opacity = t._include ? 1 : 0.4;
      });
    };

    // Bulk toggle tarjeta titular
    document.getElementById('g-chk-main-all')?.addEventListener('change', e => {
      mainRows.forEach(t => { t._include = e.target.checked; });
      document.querySelectorAll('#g-main-tbody .g-row-chk').forEach(c => { c.checked = e.target.checked; });
      refreshCounts();
    });

    // Bulk toggle por tarjeta adicional
    document.querySelectorAll('.g-adic-card-all').forEach(chk => {
      chk.addEventListener('change', e => {
        const digits = e.target.dataset.digits;
        const { all } = getCardRows(digits);
        all.forEach(t => { t._include = e.target.checked; });
        document.querySelectorAll(`.g-adic-tbody[data-digits="${digits}"] .g-row-chk`)
          .forEach(c => { c.checked = e.target.checked; });
        refreshCounts();
      });
    });

    // Nombre editable del titular de adicional
    document.querySelectorAll('.g-adic-name').forEach(inp => {
      inp.addEventListener('input', e => {
        const card = (this._adicCards || []).find(c => c.digits === e.target.dataset.digits);
        if (card) card.editedName = e.target.value;
      });
    });

    // Mes EDC — re-renderiza todas las filas (sin re-attachar handlers)
    document.getElementById('g-review-edc-mes')?.addEventListener('change', e => {
      this._edcMes = e.target.value;
      document.getElementById('g-main-tbody').innerHTML = this._sortPending(mainRowsAll).map(t => this._reviewRow(t, catOpts)).join('');
      adicCards.forEach(card => {
        const { all } = getCardRows(card.digits);
        const tbody = document.querySelector(`.g-adic-tbody[data-digits="${card.digits}"]`);
        if (tbody) tbody.innerHTML = this._sortPending(all).map(t => this._reviewRow(t, catOpts)).join('');
      });
    });

    this._attachReviewBodyHandlers(refreshCounts, getCardRows);

    // Sort por columna — re-renderiza la pantalla de revisión completa
    document.querySelectorAll('.review-thead th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (this._reviewSort.col === col) {
          this._reviewSort.dir = this._reviewSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          this._reviewSort.col = col;
          this._reviewSort.dir = 'asc';
        }
        this._drawReview();
      });
    });

    document.getElementById('g-btn-cancel').addEventListener('click', () => {
      this._pending = [];
      this._adicCards = [];
      this._reviewChangeHandler = null;
      this._reviewInputHandler  = null;
      this._drawImportar();
    });
    document.getElementById('g-btn-confirm').addEventListener('click', () => this._confirmImport());
  },

  _attachReviewBodyHandlers(refreshCounts, getCardRows) {
    const gc = document.getElementById('g-content');
    // Eliminar listeners anteriores si existen (evita duplicados en re-renders)
    if (this._reviewChangeHandler) gc.removeEventListener('change', this._reviewChangeHandler);
    if (this._reviewInputHandler)  gc.removeEventListener('input',  this._reviewInputHandler);

    this._reviewChangeHandler = (e) => {
      const id = e.target.dataset.id !== undefined ? +e.target.dataset.id : null;
      const t  = id != null ? this._pending.find(p => p._id === id) : null;
      if (!t) return;

      // Reasignación manual de tarjeta
      if (e.target.classList.contains('g-card-sel')) {
        const digits = e.target.value || null;
        if (t.descuento_de_adicional) {
          t._adicCardDigits = digits;
        } else {
          t._manualCard         = digits;
          t.tarjeta_adicional   = !!digits;
          t.adicional_card_digits = digits;
        }
        // Sincronizar descuentos vinculados si es una compra
        if (!t.descuento_de_adicional) {
          const tNorm = this._normMerchant(t.descripcion);
          this._pending
            .filter(d => d.descuento_de_adicional && this._normMerchant(d.ref_comercio || '') === tNorm)
            .forEach(d => {
              d._adicCardDigits = digits;
              d._include = !digits;
              const discChk = document.querySelector(`.g-row-chk[data-id="${d._id}"]`);
              if (discChk) discChk.checked = d._include;
              const discRow = document.querySelector(`tr[data-pending-id="${d._id}"]`);
              if (discRow) discRow.style.opacity = d._include ? 1 : 0.4;
              // Update discount's card-sel too
              const discSel = document.querySelector(`.g-card-sel[data-id="${d._id}"]`);
              if (discSel) discSel.value = digits || '';
            });
        }
        t._include = !digits;
        const chk = document.querySelector(`.g-row-chk[data-id="${id}"]`);
        if (chk) chk.checked = t._include;
        const row = document.querySelector(`tr[data-pending-id="${id}"]`);
        if (row) row.style.opacity = t._include ? 1 : 0.4;
        refreshCounts();
        return;
      }

      if (e.target.classList.contains('g-row-chk')) {
        t._include = e.target.checked;
        // Sincronizar descuentos vinculados cuando se togglea una compra de adicional
        if (t.tarjeta_adicional || t._manualCard) {
          const tNorm = this._normMerchant(t.descripcion);
          this._pending
            .filter(d => d.descuento_de_adicional && this._normMerchant(d.ref_comercio || '') === tNorm)
            .forEach(d => {
              d._include = e.target.checked;
              const discChk = document.querySelector(`.g-row-chk[data-id="${d._id}"]`);
              if (discChk) discChk.checked = e.target.checked;
            });
        }
        refreshCounts();
      }
      if (e.target.classList.contains('g-cat-sel')) {
        t._catId = e.target.value ? +e.target.value : null;
        t.categoria = this._cats.find(c => c.id === t._catId)?.nombre ?? 'Otros';
        const divCell = document.querySelector(`.g-div-cell[data-id="${id}"]`);
        if (divCell) divCell.innerHTML = this._divCellHTML(t);
      }
      if (e.target.classList.contains('g-div-inp')) {
        t._dividirEntre = Math.max(1, parseInt(e.target.value) || 1);
      }
      if (e.target.classList.contains('g-tipo-sel')) {
        t._tipoGasto = e.target.value;
      }
      if (e.target.classList.contains('g-mon-sel')) {
        t.moneda = e.target.value;
        t._monedaOverridden = true;
      }
    };

    this._reviewInputHandler = (e) => {
      if (e.target.classList.contains('g-monto-inp')) {
        const t = this._pending.find(p => p._id === +e.target.dataset.id);
        if (t) t.monto = parseFloat(e.target.value) || t.monto;
        return;
      }
      if (e.target.classList.contains('g-desc-inp')) {
        const t = this._pending.find(p => p._id === +e.target.dataset.id);
        if (t) {
          t.descripcion   = e.target.value;
          t._normMerchant = this._normMerchant(e.target.value);
        }
      }
    };

    gc.addEventListener('change', this._reviewChangeHandler);
    gc.addEventListener('input',  this._reviewInputHandler);
  },

  _divCellHTML(t) {
    const val = t._dividirEntre || 1;
    return `<input type="number" class="g-div-inp" data-id="${t._id}"
      min="1" step="1" value="${val}"
      style="width:46px;font-size:.72rem;padding:3px 5px;border-radius:4px;text-align:center;
        border:1px solid var(--border);background:var(--surface);color:var(--text);
        -moz-appearance:textfield">`;
  },

  _reviewRow(t, catOpts) {
    const descEsc = t.descripcion.replace(/"/g, '&quot;');
    const aiBadge = t._overridden
      ? ' <span style="font-size:.6rem;color:var(--accent)" title="Re-categorizado según tu historial">✦</span>'
      : '';
    const discBadge = t.descuento_de_adicional
      ? ` <span style="font-size:.6rem;color:#10b981;background:rgba(16,185,129,.1);padding:1px 5px;border-radius:3px"
          title="Descuento vinculado a compra de adicional${t.ref_comercio ? ' en ' + t.ref_comercio : ''}">🔗 Desc.</span>`
      : '';
    const cuotaBadge = (t._cuotaActual && t._cuotasTotales)
      ? ` <span style="font-size:.62rem;color:var(--text-sec);background:rgba(255,255,255,.06);padding:1px 5px;border-radius:3px"
          title="Cuota ${t._cuotaActual} de ${t._cuotasTotales}">📅 ${t._cuotaActual}/${t._cuotasTotales}</span>`
      : '';
    const pagoBadge = t._esPago
      ? ` <span style="font-size:.6rem;color:#f59e0b;background:rgba(245,158,11,.12);padding:1px 5px;border-radius:3px"
          title="Pago de la tarjeta — no es un gasto (desmarcado)">💳 Pago</span>`
      : '';
    let displayFecha = t.fecha;
    let fechaCorrected = false;
    if ((t._cuotaActual ?? 0) > 1 && this._edcMes) {
      const dd = String(t.fecha).slice(8, 10);
      const [yyyy, mm] = this._edcMes.split('-');
      const corrected = `${yyyy}-${mm}-${dd}`;
      if (corrected !== t.fecha) { displayFecha = corrected; fechaCorrected = true; }
    }
    const fechaHTML = fechaCorrected
      ? `<span style="color:var(--accent)" title="Fecha corregida (original: ${t.fecha})">${displayFecha}</span>`
      : displayFecha;
    const rowBg = t.descuento_de_adicional ? 'background:rgba(16,185,129,.05);' : '';
    return `
      <tr data-pending-id="${t._id}" style="opacity:${t._include?1:.4};${rowBg}">
        <td><input type="checkbox" class="g-row-chk" data-id="${t._id}" ${t._include?'checked':''}></td>
        <td style="white-space:nowrap;font-family:'DM Mono',monospace;font-size:.72rem">${fechaHTML}</td>
        <td style="min-width:170px">
          <input type="text" class="g-desc-inp" data-id="${t._id}" value="${descEsc}"
            title="Editá el nombre del comercio"
            style="width:100%;min-width:150px;font-size:.74rem;padding:3px 6px;border-radius:4px;
              border:1px solid var(--border);background:var(--surface);color:var(--text)">
          <div style="margin-top:2px;line-height:1.4">${aiBadge}${discBadge}${cuotaBadge}${pagoBadge}</div></td>
        <td><input type="number" class="g-monto-inp" data-id="${t._id}" value="${t.monto}"
          style="width:88px;font-size:.75rem;padding:3px 6px;border-radius:4px;
            border:1px solid var(--border);background:var(--surface);color:var(--text);
            font-family:'DM Mono',monospace"></td>
        <td>
          <select class="g-mon-sel" data-id="${t._id}"
            style="font-size:.72rem;padding:3px 5px;border-radius:4px;
              border:1px solid var(--border);background:var(--surface);color:var(--text);
              font-family:'DM Mono',monospace">
            <option value="UYU"${t.moneda!=='USD'?' selected':''}>UYU</option>
            <option value="USD"${t.moneda==='USD'?' selected':''}>USD</option>
          </select>
        </td>
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
            <option value="tdc"${t._tipoGasto==='tdc'?' selected':''}>🏦 Cargo TDC</option>
          </select>
        </td>
        <td class="g-div-cell" data-id="${t._id}" style="text-align:center">${this._divCellHTML(t)}</td>
        ${(this._adicCards||[]).length > 0 ? `
        <td>
          <select class="g-card-sel" data-id="${t._id}"
            style="font-size:.66rem;padding:2px 4px;border-radius:4px;max-width:80px;
              border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <option value="">Titular</option>
            ${(this._adicCards||[]).map(c => {
              const selDigits = t.adicional_card_digits || t._adicCardDigits || t._manualCard;
              return `<option value="${c.digits}" ${selDigits===c.digits?'selected':''}>
                **** ${c.digits}${c.editedName ? ' — ' + c.editedName.split(' ')[0] : ''}
              </option>`;
            }).join('')}
          </select>
        </td>` : ''}
      </tr>`;
  },

  async _confirmImport() {
    // Checked items = "mis gastos". Unchecked adicional/manual items = tracking. Unchecked main = skip.
    const toSave   = this._pending.filter(t => t._include);
    const adicTrack = this._pending.filter(t =>
      !t._include && (t.tarjeta_adicional || t._manualCard || t.descuento_de_adicional || t._adicCardDigits)
    );
    const allToInsert = [...toSave, ...adicTrack];
    if (!toSave.length && !adicTrack.length) { toast('Seleccioná al menos una transacción', 'warn'); return; }
    const btn = document.getElementById('g-btn-confirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:13px;height:13px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:7px"></span>Guardando…';

    const getAdicName = (digits) => {
      if (!digits) return null;
      const card = (this._adicCards || []).find(c => c.digits === digits);
      return (card?.editedName?.trim()) || (card?.name) || `**** ${digits}`;
    };

    try {
      const bancoVal = (document.getElementById('g-review-banco')?.value?.trim() || this._bancotarjeta) || null;
      const imp = await dbInsert('importaciones', {
        tipo: 'pdf', nombre_archivo: 'edc_visa', registros_importados: toSave.length,
        banco_tarjeta: bancoVal,
      });

      for (const t of allToInsert) {
        const isTracking = !t._include; // unchecked adicional → tracking
        const N = Math.max(1, t._dividirEntre || 1);
        const monto = t.monto / N;
        let fecha = t.fecha;
        if ((t._cuotaActual ?? 0) > 1 && this._edcMes) {
          const dd = String(t.fecha).slice(8, 10);
          const [yyyy, mm] = this._edcMes.split('-');
          fecha = `${yyyy}-${mm}-${dd}`;
        }
        let notas = N > 1 ? `Dividido entre ${N} · total original: ${t.monto} ${t.moneda}` : null;
        // Discounts going to tracking carry the ref so Adicional tab can link them
        if (isTracking && t.descuento_de_adicional && t.ref_comercio) {
          notas = `desc_adic:${t.ref_comercio}`;
        }
        const digits = t._manualCard || t.adicional_card_digits || t._adicCardDigits || null;
        await dbInsert('gastos', {
          fecha, monto, moneda: t.moneda || 'UYU',
          comercio: t.descripcion,
          categoria_id: t._catId || null,
          usuario: 'compartido',
          fuente: 'edc_visa',
          tipo_gasto: ['casual','recurrente','tdc'].includes(t._tipoGasto) ? t._tipoGasto : 'casual',
          dividido_entre: N,
          importacion_id: imp.id,
          cuota_actual:   t._cuotaActual   || null,
          cuotas_totales: t._cuotasTotales || null,
          banco_tarjeta:  bancoVal,
          // Adicional items always keep the cardholder name; if checked (not tracking)
          // they're also flagged so the historial filter includes them with the badge.
          titular_adicional:   digits ? getAdicName(digits) : null,
          incluido_en_gastos:  !isTracking && !!digits,
          notas,
        });
      }

      // Aprender merchants categorizados
      await this._learnMerchants(toSave);

      // Guardar archivo fuente en storage para re-parseos futuros.
      // Si vino de re-parsear un PDF ya existente (recuperación de huérfano),
      // enlazamos esa ruta en vez de subir un duplicado.
      if (this._reparsePath) {
        await getDB().from('importaciones').update({ archivo_path: this._reparsePath }).eq('id', imp.id);
        this._reparsePath = null;
        this._pendingFile = null;
      } else if (this._pendingFile) {
        const ext = (this._pendingFile.name.split('.').pop() || 'pdf').toLowerCase();
        const storagePath = `${imp.id}.${ext}`;
        const { error: upErr } = await getDB().storage.from('edcs').upload(storagePath, this._pendingFile);
        if (!upErr) {
          await getDB().from('importaciones').update({ archivo_path: storagePath }).eq('id', imp.id);
        }
        this._pendingFile = null;
      }
      this._bancotarjeta = '';
      this._adicTitular  = '';
      this._adicCards    = [];

      toast(`✅ ${toSave.length} gastos importados${adicTrack.length ? ` · ${adicTrack.length} al Adicional` : ''}`);
      this._pending = [];
      this._tab = 'historial';
      await this.render();
    } catch(e) {
      toast('❌ ' + e.message, 'err');
      btn.disabled = false;
      btn.textContent = `✅ Guardar ${toSave.length} gastos`;
    }
  },

  // Guardar/actualizar mapeo merchant → categoría (y moneda si fue corregida) para futuras importaciones
  async _learnMerchants(transactions) {
    const updates = {};
    for (const t of transactions) {
      if (!t._catId) continue;
      const norm = t._normMerchant || this._normMerchant(t.descripcion);
      if (!norm || norm.length < 3) continue;
      // Si hay conflicto entre filas, gana la última (la corrección más reciente)
      updates[norm] = {
        ejemplo: t.descripcion,
        catId: t._catId,
        moneda: t._monedaOverridden ? t.moneda : null,
      };
    }
    const sb = getDB();
    for (const [norm, { ejemplo, catId, moneda }] of Object.entries(updates)) {
      const { data: existing } = await sb.from('merchant_categorias')
        .select('seen_count').eq('merchant_normalizado', norm).maybeSingle();
      const seen = (existing?.seen_count || 0) + 1;
      const upsertData = {
        merchant_normalizado: norm,
        categoria_id: catId,
        ejemplo_original: ejemplo,
        seen_count: seen,
        ultima_vez: new Date().toISOString(),
      };
      if (moneda) upsertData.moneda = moneda;
      await sb.from('merchant_categorias').upsert(upsertData);
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
          <div id="g-div-wrap" style="margin-bottom:14px">
            <label style="font-size:.84rem;margin-bottom:5px;display:block">Dividir entre N personas</label>
            <input type="number" id="g-dividir-entre" min="1" step="1" value="1"
              placeholder="1"
              style="width:90px;font-size:.84rem;padding:5px 10px;border-radius:6px;
                border:1px solid var(--border);background:var(--surface);color:var(--text);
                -moz-appearance:textfield">
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
      } catch(err) { toast('❌ ' + err.message, 'err'); }
    });
  },

  // ── Historial ───────────────────────────────────────────────────────────

  async _drawHistorialGastos() {
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

    let q = getDB().from('gastos').select('*').gte('fecha', desde).lte('fecha', hasta)
                   .or('titular_adicional.is.null,incluido_en_gastos.eq.true');
    if (catFilter)                   q = q.eq('categoria_id', +catFilter);
    if (tipoFilter === 'cuotas')     q = q.not('cuota_actual', 'is', null);
    else if (tipoFilter)             q = q.eq('tipo_gasto', tipoFilter);
    if (viewMode !== 'TOTAL_USD')    q = q.eq('moneda', viewMode);
    const { data: gastosRaw, error } = await q.order('fecha', { ascending: false });
    if (error) throw error;

    const bancosHist    = [...new Set((gastosRaw || []).map(g => g.banco_tarjeta).filter(Boolean))].sort();
    const titularesHist = [...new Set((gastosRaw || []).map(g => g.titular_adicional).filter(Boolean))].sort();
    let gastos = gastosRaw || [];
    if (this._histBanco) gastos = gastos.filter(g => g.banco_tarjeta === this._histBanco);
    if (this._histTitular === '__titular__')  gastos = gastos.filter(g => !g.titular_adicional);
    else if (this._histTitular)              gastos = gastos.filter(g => g.titular_adicional === this._histTitular);

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
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Mes</div>
            <select id="h-mes" style="${selSt}">
              ${meses.map(m => `<option value="${m.val}"${m.val===mesFilter?' selected':''}>${m.lbl}</option>`).join('')}
            </select>
          </div>
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Categoría</div>
            <select id="h-cat" style="${selSt}">
              <option value="">Todas</option>
              ${this._cats.map(c =>
                `<option value="${c.id}"${String(c.id)===catFilter?' selected':''}>${c.icono} ${c.nombre}</option>`
              ).join('')}
            </select>
          </div>
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Tipo de gasto</div>
            <select id="h-tipo" style="${selSt}">
              <option value=""${!tipoFilter?' selected':''}>Todos</option>
              <option value="casual"${tipoFilter==='casual'?' selected':''}>💳 Casual</option>
              <option value="recurrente"${tipoFilter==='recurrente'?' selected':''}>🔁 Recurrente</option>
              <option value="tdc"${tipoFilter==='tdc'?' selected':''}>🏦 Cargo TDC</option>
              <option value="cuotas"${tipoFilter==='cuotas'?' selected':''}>📅 Solo cuotas</option>
            </select>
          </div>
          ${bancosHist.length > 0 ? `
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Tarjeta</div>
            <select id="h-banco" style="${selSt}">
              <option value="">Todas las TDC</option>
              ${bancosHist.map(b => `<option value="${b}"${b===this._histBanco?' selected':''}>${b}</option>`).join('')}
            </select>
          </div>` : ''}
          ${titularesHist.length > 0 ? `
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Tarjetahabiente</div>
            <select id="h-titular" style="${selSt}">
              <option value="">Todos</option>
              <option value="__titular__"${this._histTitular==='__titular__'?' selected':''}>💳 Titular</option>
              ${titularesHist.map(t => `<option value="${t}"${t===this._histTitular?' selected':''}>👤 ${t}</option>`).join('')}
            </select>
          </div>` : ''}
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
        <div class="table-header" style="gap:10px;flex-wrap:wrap">
          <span class="table-title"><span id="h-count">${gastos.length}</span> gastos</span>
          <div style="position:relative;display:flex;align-items:center;flex:1;min-width:160px;max-width:280px">
            <input id="h-search" type="search" placeholder="🔍 Buscar comercio…" value="${this._histSearch}"
              style="width:100%;font-size:.78rem;padding:6px 28px 6px 10px;border-radius:6px;
                border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <button id="h-search-clear" type="button"
              style="position:absolute;right:6px;background:none;border:none;color:var(--text-sec);
                cursor:pointer;font-size:.85rem;padding:2px 6px;
                visibility:${this._histSearch?'visible':'hidden'}">✕</button>
          </div>
          <span style="font-size:.68rem;color:var(--text-sec);font-family:'DM Mono',monospace">${mesFilter}</span>
        </div>
        ${gastos.length === 0 ? `
          <div class="empty"><div class="empty-icon">💸</div>
          <div class="empty-text">Sin gastos para este período</div></div>
        ` : `
          <table>
            <thead id="g-hist-thead"><tr>
              ${this._thSort('fecha',    'Fecha',    this._histSort)}
              ${this._thSort('comercio', 'Comercio', this._histSort)}
              <th>Categoría</th>
              <th>Mon.</th>
              ${this._thSort('monto',    'Monto',    this._histSort)}
              <th></th>
            </tr></thead>
            <tbody id="g-hist-tbody"></tbody>
          </table>
        `}
      </div>
    `;

    // Cache para re-renderizar tbody al filtrar por búsqueda sin volver a la DB
    this._gastosCache = { gastos, viewMode, tc, catOpts };
    this._renderGastosTbody();

    ['h-mes','h-cat','h-tipo','h-banco','h-titular'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        this._histMes      = document.getElementById('h-mes').value;
        this._histCat      = document.getElementById('h-cat').value;
        this._histTipo     = document.getElementById('h-tipo').value;
        this._histBanco    = document.getElementById('h-banco')?.value    || '';
        this._histTitular  = document.getElementById('h-titular')?.value  || '';
        this._drawHistorialGastos();
      });
    });
    document.getElementById('h-moneda')?.addEventListener('change', e => {
      this._histMoneda = e.target.value;
      this._drawHistorialGastos();
    });
    document.getElementById('h-tc')?.addEventListener('change', e => {
      this._saveTC(e.target.value.trim());
      this._drawHistorialGastos();
    });

    // Búsqueda — re-renderiza tbody sin volver a la DB
    const search = document.getElementById('h-search');
    const clear  = document.getElementById('h-search-clear');
    search?.addEventListener('input', e => {
      this._histSearch = e.target.value;
      clear.style.visibility = this._histSearch ? 'visible' : 'hidden';
      this._renderGastosTbody();
    });
    clear?.addEventListener('click', () => {
      this._histSearch = '';
      search.value = '';
      clear.style.visibility = 'hidden';
      this._renderGastosTbody();
      search.focus();
    });

    // Sort por columna en historial
    document.querySelectorAll('#g-hist-thead th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (this._histSort.col === col) {
          this._histSort.dir = this._histSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          this._histSort.col = col;
          this._histSort.dir = col === 'fecha' ? 'desc' : 'asc';
        }
        const thead = document.getElementById('g-hist-thead');
        if (thead) this._refreshSortArrows(thead, this._histSort);
        this._renderGastosTbody();
      });
    });

    this._attachHistHandlers(gastos, catOpts, viewMode, tc);
  },

  _renderGastosTbody() {
    const tbody = document.getElementById('g-hist-tbody');
    if (!tbody || !this._gastosCache) return;
    const { gastos, viewMode, tc, catOpts } = this._gastosCache;
    const q = (this._histSearch || '').toLowerCase().trim();
    let filtered = q
      ? gastos.filter(g => (g.comercio || '').toLowerCase().includes(q))
      : gastos;
    filtered = this._sortGastos(filtered);
    tbody.innerHTML = filtered.length
      ? filtered.map(g => this._histRow(g, catOpts, viewMode, tc)).join('')
      : `<tr><td colspan="6" style="text-align:center;color:var(--text-sec);padding:20px">Sin resultados</td></tr>`;
    const counter = document.getElementById('h-count');
    if (counter) counter.textContent = filtered.length;
  },

  // ── Comercios únicos (re-categorizar en bulk) ───────────────────────────
  async _drawHistorialComercios() {
    const gc = document.getElementById('g-content');
    gc.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const { data: rows, error } = await getDB()
      .from('gastos').select('id, comercio, moneda, monto, categoria_id, fecha, tipo_gasto, cuota_actual, banco_tarjeta')
      .not('comercio', 'is', null)
      .or('titular_adicional.is.null,incluido_en_gastos.eq.true')
      .order('fecha', { ascending: false });
    if (error) throw error;

    // Agrupar por comercio normalizado
    const groups = {};
    for (const r of rows) {
      const norm = this._normMerchant(r.comercio);
      if (!norm) continue;
      if (!groups[norm]) {
        groups[norm] = {
          norm, example: r.comercio, ids: [],
          gastos: [], hasQuotas: false, bancos: new Set(),
          count: 0, totals: { UYU: 0, USD: 0 }, negs: { UYU: 0, USD: 0 },
          catCounts: {}, tipoCounts: {}, ultima: r.fecha,
        };
      }
      const g = groups[norm];
      g.ids.push(r.id);
      g.gastos.push(r);
      if (r.cuota_actual) g.hasQuotas = true;
      if (r.banco_tarjeta) g.bancos.add(r.banco_tarjeta);
      g.count++;
      const monto = parseFloat(r.monto);
      const mon = r.moneda === 'USD' ? 'USD' : 'UYU';
      if (monto >= 0) g.totals[mon] += monto;
      else            g.negs[mon]   += monto;
      const cid = r.categoria_id ?? 'sin';
      g.catCounts[cid] = (g.catCounts[cid] || 0) + 1;
      const tid = r.tipo_gasto || 'casual';
      g.tipoCounts[tid] = (g.tipoCounts[tid] || 0) + 1;
    }
    const items = Object.values(groups).map(g => {
      const winner     = Object.entries(g.catCounts).sort((a,b) => b[1] - a[1])[0]?.[0];
      const tipoWinner = Object.entries(g.tipoCounts).sort((a,b) => b[1] - a[1])[0]?.[0] || 'casual';
      return { ...g, currentCat: winner === 'sin' ? null : +winner, currentTipo: tipoWinner };
    }).sort((a,b) => b.count - a.count);

    this._comerciosCache = items;

    const bancosComercio = [...new Set(items.flatMap(it => [...it.bancos]))].sort();

    gc.innerHTML = `
      <div class="form-card" style="padding:12px 16px;margin-bottom:.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-weight:600;font-size:.9rem">${items.length} comercios únicos</div>
            <div style="font-size:.72rem;color:var(--text-sec);margin-top:2px">
              Cambiá la categoría y se actualizarán todos los gastos del comercio + el aprendizaje futuro
            </div>
          </div>
          <div style="position:relative;display:flex;align-items:center;min-width:200px;max-width:300px;flex:1">
            <input id="c-search" type="search" placeholder="🔍 Buscar comercio…" value="${this._histSearch}"
              style="width:100%;font-size:.78rem;padding:6px 28px 6px 10px;border-radius:6px;
                border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <button id="c-search-clear" type="button"
              style="position:absolute;right:6px;background:none;border:none;color:var(--text-sec);
                cursor:pointer;font-size:.85rem;padding:2px 6px;
                visibility:${this._histSearch?'visible':'hidden'}">✕</button>
          </div>
        </div>
        ${bancosComercio.length > 0 ? `
        <div style="margin-top:10px">
          <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Tarjeta</div>
          <select id="c-banco" style="font-size:.76rem;padding:4px 9px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <option value="">Todas las TDC</option>
            ${bancosComercio.map(b => `<option value="${b}"${b===this._histBanco?' selected':''}>${b}</option>`).join('')}
          </select>
        </div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
          ${[['', 'Todos'], ['casual', '💳 Casual'], ['recurrente', '🔁 Recurrente'], ['cuotas', '📅 Cuotas']].map(([val, lbl]) => {
            const active = this._comTipo === val;
            return `<button class="c-tipo-btn" data-tipo="${val}"
              style="font-size:.74rem;padding:4px 11px;border-radius:6px;cursor:pointer;
                ${active
                  ? 'background:var(--accent);border:1px solid var(--accent);color:#fff'
                  : 'background:var(--surface);border:1px solid var(--border);color:var(--text-sec)'}">
              ${lbl}</button>`;
          }).join('')}
        </div>
      </div>

      <div class="table-wrap">
        ${items.length === 0 ? `
          <div class="empty"><div class="empty-icon">🏷️</div>
          <div class="empty-text">Sin comercios registrados</div></div>
        ` : `
          <table>
            <thead id="g-com-thead"><tr>
              ${this._thSort('nombre', 'Comercio',   this._comSort)}
              ${this._thSort('count',  'Gastos',     this._comSort)}
              <th>Última</th>
              ${this._thSort('totUYU', 'Total UYU',  this._comSort)}
              ${this._thSort('totUSD', 'Total USD',  this._comSort)}
              ${this._thSort('cat',    'Categoría',  this._comSort)}
              <th>Tipo</th>
            </tr></thead>
            <tbody id="g-com-tbody"></tbody>
          </table>
        `}
      </div>
    `;

    this._renderComerciosTbody();

    // Sort por columna en Comercios
    document.getElementById('g-com-thead')?.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (this._comSort.col === col) {
          this._comSort.dir = this._comSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          this._comSort.col = col;
          this._comSort.dir = (col === 'nombre' || col === 'cat') ? 'asc' : 'desc';
        }
        this._refreshSortArrows(document.getElementById('g-com-thead'), this._comSort);
        this._renderComerciosTbody();
      });
    });

    const search = document.getElementById('c-search');
    const clear  = document.getElementById('c-search-clear');
    search?.addEventListener('input', e => {
      this._histSearch = e.target.value;
      clear.style.visibility = this._histSearch ? 'visible' : 'hidden';
      this._renderComerciosTbody();
    });
    clear?.addEventListener('click', () => {
      this._histSearch = '';
      search.value = '';
      clear.style.visibility = 'hidden';
      this._renderComerciosTbody();
      search.focus();
    });

    gc.querySelectorAll('.c-tipo-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        this._comTipo = btn.dataset.tipo;
        this._drawHistorialComercios();
      })
    );
    document.getElementById('c-banco')?.addEventListener('change', e => {
      this._histBanco = e.target.value;
      this._renderComerciosTbody();
    });

    const tbody = document.getElementById('g-com-tbody');
    tbody?.addEventListener('click', async e => {
      const editBtn = e.target.closest('.g-com-edit');
      if (editBtn) {
        await this._renameComercio(editBtn.dataset.norm);
        return;
      }
      const btn = e.target.closest('.g-com-expand');
      if (!btn) return;
      const norm = btn.dataset.norm;
      const detailRow = tbody.querySelector(`tr.g-com-detail[data-norm="${CSS.escape(norm)}"]`);
      if (!detailRow) return;
      const isOpen = detailRow.style.display !== 'none';
      detailRow.style.display = isOpen ? 'none' : 'table-row';
      btn.textContent = isOpen ? '▶' : '▼';
      btn.style.color = isOpen ? 'var(--text-sec)' : 'var(--accent)';
    });

    tbody?.addEventListener('change', async e => {
      if (e.target.classList.contains('c-tipo-sel')) {
        const norm = e.target.dataset.norm;
        const item = this._comerciosCache.find(i => i.norm === norm);
        if (!item) return;
        const newTipo = e.target.value;
        if (newTipo === item.currentTipo) return;
        const tipoLabel = newTipo === 'recurrente' ? '🔁 Recurrente' : '💳 Casual';
        if (!confirm(`¿Marcar ${item.count} gasto(s) de "${item.example}" como ${tipoLabel}?`)) {
          e.target.value = item.currentTipo;
          return;
        }
        try {
          await Promise.all(item.ids.map(id =>
            dbUpdate('gastos', { tipo_gasto: newTipo }, { id })
          ));
          item.currentTipo = newTipo;
          toast(`✅ ${item.count} gasto(s) actualizado(s)`);
        } catch(err) {
          toast('❌ ' + err.message, 'err');
          e.target.value = item.currentTipo;
        }
        return;
      }
      if (!e.target.classList.contains('c-cat-sel')) return;
      const norm = e.target.dataset.norm;
      const item = this._comerciosCache.find(i => i.norm === norm);
      if (!item) return;
      const newCatId = e.target.value ? +e.target.value : null;
      if (newCatId === item.currentCat) return;
      const catName = newCatId
        ? this._cats.find(c => c.id === newCatId)?.nombre || ''
        : 'Sin categoría';
      if (!confirm(`¿Re-categorizar ${item.count} gasto(s) de "${item.example}" como ${catName}?`)) {
        e.target.value = item.currentCat ?? '';
        return;
      }
      try {
        await Promise.all(item.ids.map(id =>
          dbUpdate('gastos', { categoria_id: newCatId }, { id })
        ));
        if (newCatId) {
          await dbUpsert('merchant_categorias', {
            merchant_normalizado: norm,
            categoria_id: newCatId,
            ejemplo_original: item.example,
            seen_count: item.count,
            ultima_vez: new Date().toISOString(),
          });
          this._learned[norm] = newCatId;
        }
        item.currentCat = newCatId;
        toast(`✅ ${item.count} gasto(s) actualizado(s)`);
      } catch(err) {
        toast('❌ ' + err.message, 'err');
        e.target.value = item.currentCat ?? '';
      }
    });
  },

  // Renombrar (y unificar) un comercio: actualiza el campo comercio de todos sus
  // gastos. Si el nuevo nombre normaliza igual que otro comercio existente, se
  // fusionan solos al re-renderizar (el agrupado es por nombre normalizado).
  async _renameComercio(norm) {
    const item = this._comerciosCache?.find(i => i.norm === norm);
    if (!item) return;
    const entrada = prompt(
      `Nuevo nombre para "${item.example}" (${item.count} gasto/s).\n` +
      `Tip: poné el mismo nombre que otro comercio para unificarlos.`,
      item.example,
    );
    if (entrada == null) return;
    const nuevo = this._cleanComercio(entrada.trim());
    if (!nuevo || nuevo === item.example) return;

    const newNorm = this._normMerchant(nuevo);
    const existente = this._comerciosCache.find(i => i.norm === newNorm && i.norm !== norm);
    const msg = existente
      ? `¿Unificar "${item.example}" dentro de "${existente.example}"? Se renombrarán ${item.count} gasto/s.`
      : `¿Renombrar ${item.count} gasto/s a "${nuevo}"?`;
    if (!confirm(msg)) return;

    try {
      await Promise.all(item.ids.map(id => dbUpdate('gastos', { comercio: nuevo }, { id })));
      // Propagar categoría aprendida al nuevo nombre si no pisa otra ya existente
      if (item.currentCat && !this._learned[newNorm]) {
        await dbUpsert('merchant_categorias', {
          merchant_normalizado: newNorm,
          categoria_id: item.currentCat,
          ejemplo_original: nuevo,
          seen_count: item.count,
          ultima_vez: new Date().toISOString(),
        });
        this._learned[newNorm] = item.currentCat;
      }
      toast(`✅ ${item.count} gasto/s actualizado/s`);
      this._drawHistorialComercios();
    } catch(err) {
      toast('❌ ' + err.message, 'err');
    }
  },

  _renderComerciosTbody() {
    const tbody = document.getElementById('g-com-tbody');
    if (!tbody || !this._comerciosCache) return;
    const q    = (this._histSearch || '').toLowerCase().trim();
    const tipo = this._comTipo || '';
    let items = this._comerciosCache;
    if (tipo === 'cuotas')          items = items.filter(it => it.hasQuotas);
    else if (tipo === 'recurrente') items = items.filter(it => it.currentTipo === 'recurrente');
    else if (tipo === 'casual')     items = items.filter(it => it.currentTipo !== 'recurrente');
    if (this._histBanco) items = items.filter(it => it.bancos.has(this._histBanco));
    if (q) items = items.filter(it => it.example.toLowerCase().includes(q) || it.norm.includes(q));
    // Sort
    const cs = this._comSort;
    items = [...items].sort((a, b) => {
      let va, vb;
      switch (cs.col) {
        case 'nombre': va = a.example.toLowerCase(); vb = b.example.toLowerCase(); break;
        case 'count':  va = a.count; vb = b.count; break;
        case 'totUYU': va = a.totals.UYU; vb = b.totals.UYU; break;
        case 'totUSD': va = a.totals.USD; vb = b.totals.USD; break;
        case 'cat': {
          const ca = a.currentCat ? (this._cats.find(c => c.id === a.currentCat)?.nombre || '') : '';
          const cb = b.currentCat ? (this._cats.find(c => c.id === b.currentCat)?.nombre || '') : '';
          va = ca.toLowerCase(); vb = cb.toLowerCase(); break;
        }
        default: va = a.count; vb = b.count;
      }
      return va < vb ? (cs.dir === 'asc' ? -1 : 1) : va > vb ? (cs.dir === 'asc' ? 1 : -1) : 0;
    });
    tbody.innerHTML = items.length
      ? items.map(it => this._comercioRow(it)).join('')
      : `<tr><td colspan="7" style="text-align:center;color:var(--text-sec);padding:20px">Sin resultados</td></tr>`;
  },

  _comercioRow(it) {
    const catOpts = this._cats.map(c =>
      `<option value="${c.id}"${c.id===it.currentCat?' selected':''}>${c.icono} ${c.nombre}</option>`
    ).join('');
    const ttlUYU = it.totals.UYU > 0
      ? this._fmtMon(it.totals.UYU, 'UYU')
        + (it.negs.UYU < 0 ? `<span style="color:#10b981;font-size:.7rem;display:block">${this._fmtMon(it.negs.UYU, 'UYU')}</span>` : '')
      : (it.negs.UYU < 0 ? `<span style="color:#10b981">${this._fmtMon(it.negs.UYU, 'UYU')}</span>` : '—');
    const ttlUSD = it.totals.USD > 0
      ? this._fmtUSD(it.totals.USD)
        + (it.negs.USD < 0 ? `<span style="color:#10b981;font-size:.7rem;display:block">${this._fmtUSD(it.negs.USD)}</span>` : '')
      : (it.negs.USD < 0 ? `<span style="color:#10b981">${this._fmtUSD(it.negs.USD)}</span>` : '—');

    const sortedGastos = [...(it.gastos || [])].sort((a, b) => b.fecha.localeCompare(a.fecha));
    const detailRows = sortedGastos.map(g => {
      const catC = this._cats.find(c => c.id === g.categoria_id);
      const catLabel = catC ? `${catC.icono} ${catC.nombre}` : '—';
      const val = parseFloat(g.monto);
      const montoStr = g.moneda === 'USD' ? this._fmtUSD(val) : this._fmtMon(val, 'UYU');
      const montoColored = val < 0
        ? `<span style="color:#10b981">${montoStr}</span>`
        : montoStr;
      const tipoIcon = g.tipo_gasto === 'recurrente' ? '🔁' : '💳';
      return `<tr style="border-top:1px solid rgba(255,255,255,.04)">
        <td style="white-space:nowrap;font-size:.72rem;color:var(--text-sec);padding:4px 8px">${fmtDate(g.fecha)}</td>
        <td style="font-size:.72rem;font-family:'DM Mono',monospace;white-space:nowrap;padding:4px 8px">${montoColored}</td>
        <td style="font-size:.7rem;color:var(--text-sec);padding:4px 8px">${g.moneda}</td>
        <td style="font-size:.72rem;padding:4px 8px">${catLabel}</td>
        <td style="font-size:.7rem;color:var(--text-sec);padding:4px 8px">${tipoIcon}</td>
      </tr>`;
    }).join('');

    return `
      <tr data-norm="${it.norm}">
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          title="${it.example.replace(/"/g,'&quot;')}">
          <button class="g-com-expand" data-norm="${it.norm}"
            style="background:none;border:none;cursor:pointer;color:var(--text-sec);
              font-size:.72rem;margin-right:5px;padding:1px 4px;border-radius:3px;
              line-height:1;vertical-align:middle">▶</button>${it.example}
          <button class="g-com-edit" data-norm="${it.norm}" title="Renombrar / unificar comercio"
            style="background:none;border:none;cursor:pointer;color:var(--text-sec);
              font-size:.7rem;margin-left:4px;padding:1px 4px;border-radius:3px;
              line-height:1;vertical-align:middle">✏️</button>
        </td>
        <td style="font-family:'DM Mono',monospace">${it.count}</td>
        <td style="white-space:nowrap;font-size:.74rem;color:var(--text-sec)">${fmtDate(it.ultima)}</td>
        <td style="font-family:'DM Mono',monospace;white-space:nowrap">${ttlUYU}</td>
        <td style="font-family:'DM Mono',monospace;white-space:nowrap">${ttlUSD}</td>
        <td>
          <select class="c-cat-sel" data-norm="${it.norm}"
            style="font-size:.74rem;padding:3px 6px;border-radius:4px;
              border:1px solid var(--border);background:var(--surface);color:var(--text);max-width:160px">
            <option value=""${it.currentCat==null?' selected':''}>—</option>
            ${catOpts}
          </select>
        </td>
        <td>
          <select class="c-tipo-sel" data-norm="${it.norm}"
            style="font-size:.74rem;padding:3px 6px;border-radius:4px;
              border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <option value="casual"${it.currentTipo!=='recurrente'?' selected':''}>💳 Casual</option>
            <option value="recurrente"${it.currentTipo==='recurrente'?' selected':''}>🔁 Recurrente</option>
          </select>
        </td>
      </tr>
      <tr class="g-com-detail" data-norm="${it.norm}" style="display:none">
        <td colspan="7" style="padding:0 8px 10px 36px;background:rgba(255,255,255,.02)">
          <table style="width:100%;border-collapse:collapse">
            ${detailRows}
          </table>
        </td>
      </tr>`;
  },

  _histRow(g, catOpts, viewMode, tc) {
    const monBadge = `<span style="font-size:.7rem;font-family:'DM Mono',monospace;color:var(--text-sec)">${g.moneda}</span>`;
    const badges = (g.tipo_gasto === 'recurrente' ? ' <span style="font-size:.6rem;color:var(--accent)">🔁</span>' : '')
      + (g.tipo_gasto === 'tdc' ? ' <span style="font-size:.6rem;color:#f59e0b;background:rgba(245,158,11,.12);padding:1px 5px;border-radius:3px">🏦 TDC</span>' : '')
      + (g.dividido_entre > 1 ? ` <span style="font-size:.65rem;color:var(--text-sec)">÷${g.dividido_entre}</span>` : '')
      + (g.cuota_actual && g.cuotas_totales ? ` <span style="font-size:.62rem;color:var(--text-sec);background:rgba(255,255,255,.06);padding:1px 5px;border-radius:3px">📅 ${g.cuota_actual}/${g.cuotas_totales}</span>` : '');
    const catC = this._cats.find(c => c.id === g.categoria_id);
    const catLabel = catC ? `${catC.icono} ${catC.nombre}` : '—';
    const monto = parseFloat(g.monto);
    const montoDisplay = this._fmtView(monto, g.moneda, viewMode, tc);
    const montoColor = monto < 0 ? 'color:#10b981;' : '';
    const titBadge = g.titular_adicional
      ? `<span style="font-size:.58rem;color:#a78bfa;background:rgba(167,139,250,.12);padding:1px 5px;border-radius:3px">👤 ${g.titular_adicional}</span>`
      : `<span style="font-size:.58rem;color:var(--text-sec);background:rgba(255,255,255,.05);padding:1px 5px;border-radius:3px">💳 Titular</span>`;
    return `
      <tr data-id="${g.id}">
        <td style="white-space:nowrap">${fmtDate(g.fecha)}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis">
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${g.comercio ?? '—'}${badges}</div>
          <div style="margin-top:2px">${titBadge}</div>
        </td>
        <td>${catLabel}</td>
        <td>${monBadge}</td>
        <td style="font-family:'DM Mono',monospace;font-weight:600;white-space:nowrap;${montoColor}">${montoDisplay}</td>
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
            <div>
              <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Dividir entre</div>
              <input type="number" class="ge-div" min="1" step="1"
                value="${g.dividido_entre || 1}"
                style="width:60px;font-size:.78rem;padding:4px 7px;border-radius:5px;
                  border:1px solid var(--border);background:var(--surface);color:var(--text);
                  text-align:center;-moz-appearance:textfield">
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
        this._drawHistorialGastos();
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
        if (!monto || monto === 0) { toast('Monto inválido', 'err'); return; }
        try {
          await dbUpdate('gastos', {
            fecha:       editRow.querySelector('.ge-fecha').value,
            comercio:    editRow.querySelector('.ge-comercio').value.trim() || null,
            monto,
            moneda:        editRow.querySelector('.ge-moneda').value,
            categoria_id:  editRow.querySelector('.ge-cat').value ? +editRow.querySelector('.ge-cat').value : null,
            tipo_gasto:    editRow.querySelector('.ge-tipo').value,
            dividido_entre: +editRow.querySelector('.ge-div').value || 1,
          }, { id });
          toast('✅ Guardado');
          this._drawHistorialGastos();
        } catch(err) { toast('❌ ' + err.message, 'err'); }
      }
    });
  },

  // ── Adicional (resumen de gastos de tarjeta adicional para cobrar) ──────
  async _drawHistorialAdicional() {
    const gc = document.getElementById('g-content');
    gc.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const sb = getDB();
    const [adicRes, descRes] = await Promise.all([
      sb.from('gastos')
        .select('id, fecha, monto, moneda, comercio, categoria_id, titular_adicional, banco_tarjeta, incluido_en_gastos')
        .not('titular_adicional', 'is', null)
        .order('fecha', { ascending: false }),
      sb.from('gastos')
        .select('id, fecha, monto, moneda, comercio, notas, titular_adicional, incluido_en_gastos')
        .ilike('notas', 'desc_adic:%')
        .order('fecha', { ascending: false }),
    ]);

    const adicRows = adicRes.data || [];
    const descRows = descRes.data || [];
    const discountIds = new Set(descRows.map(d => d.id));

    // Build discount lookup: ref_comercio → { monto, fecha, id, notas }
    const descByRef = {};
    for (const d of descRows) {
      const ref = (d.notas || '').replace(/^desc_adic:/, '').trim();
      if (!descByRef[ref]) descByRef[ref] = [];
      descByRef[ref].push(d);
    }

    // Match discounts to purchases by normalized merchant name
    const matchDiscount = (comercio) => {
      const norm = this._normMerchant(comercio);
      for (const [ref, dlist] of Object.entries(descByRef)) {
        if (this._normMerchant(ref) === norm || norm.includes(this._normMerchant(ref)) || this._normMerchant(ref).includes(norm)) {
          return dlist;
        }
      }
      return [];
    };

    // Get all titulares for filter (exclude discount-only rows)
    const purchaseRows = adicRows.filter(r => !discountIds.has(r.id));
    const titulares = [...new Set(purchaseRows.map(r => r.titular_adicional).filter(Boolean))].sort();

    // Apply filters
    const filtTitular = this._adicTitularFiltro || '';
    const filtMes     = this._adicMes || '';
    let rows = purchaseRows;
    if (filtTitular) rows = rows.filter(r => r.titular_adicional === filtTitular);
    if (filtMes)     rows = rows.filter(r => (r.fecha || '').startsWith(filtMes));

    // Group by titular → month → purchases
    const byTitular = {};
    for (const r of rows) {
      const tit = r.titular_adicional;
      const mes = (r.fecha || '').slice(0, 7);
      if (!byTitular[tit]) byTitular[tit] = {};
      if (!byTitular[tit][mes]) byTitular[tit][mes] = [];
      byTitular[tit][mes].push(r);
    }

    // Months for dropdown (12 months back)
    const now = new Date();
    const meses = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return {
        val: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        lbl: d.toLocaleDateString('es-UY', { month: 'long', year: 'numeric' }),
      };
    });

    const selSt = `font-size:.82rem;padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)`;

    const titularesSections = Object.entries(byTitular).map(([tit, mesesData]) => {
      const monthSections = Object.entries(mesesData)
        .sort((a,b) => b[0].localeCompare(a[0]))
        .map(([mes, gastos]) => {
          const mesLabel = new Date(mes + '-15').toLocaleDateString('es-UY', { month: 'long', year: 'numeric' });
          const openKey  = `${tit}|${mes}`;
          const isOpen   = this._adicOpenMonths.has(openKey);

          // Pre-calc summary for the accordion header
          let sumUYU = 0, sumUSD = 0, descUYU_sum = 0, descUSD_sum = 0;
          for (const g of gastos) {
            const discs = matchDiscount(g.comercio || '');
            if (g.moneda !== 'USD') {
              sumUYU   += parseFloat(g.monto);
              descUYU_sum += discs.filter(d=>d.moneda!=='USD').reduce((s,d)=>s+parseFloat(d.monto),0);
            } else {
              sumUSD   += parseFloat(g.monto);
              descUSD_sum += discs.filter(d=>d.moneda==='USD').reduce((s,d)=>s+parseFloat(d.monto),0);
            }
          }
          const summaryParts = [];
          if (sumUYU > 0) {
            summaryParts.push(
              `<span style="font-family:'DM Mono',monospace;font-size:.76rem">${this._fmtMon(sumUYU,'UYU')}</span>` +
              (descUYU_sum < 0 ? `<span style="color:#10b981;font-size:.7rem;margin-left:2px">−${this._fmtMon(Math.abs(descUYU_sum),'UYU')}</span>` +
                `<span style="color:var(--accent);font-size:.76rem;font-weight:600;margin-left:2px">=${this._fmtMon(sumUYU+descUYU_sum,'UYU')}</span>` : '')
            );
          }
          if (sumUSD > 0) {
            summaryParts.push(
              `<span style="font-family:'DM Mono',monospace;font-size:.76rem">${this._fmtMon(sumUSD,'USD')}</span>` +
              (descUSD_sum < 0 ? `<span style="color:#10b981;font-size:.7rem;margin-left:2px">−${this._fmtMon(Math.abs(descUSD_sum),'USD')}</span>` +
                `<span style="color:var(--accent);font-size:.76rem;font-weight:600;margin-left:2px">=${this._fmtMon(sumUSD+descUSD_sum,'USD')}</span>` : '')
            );
          }

          const tableRows = gastos.map(g => {
            const discounts = matchDiscount(g.comercio || '');
            const dUYU = discounts.filter(d => d.moneda !== 'USD').reduce((s,d) => s + parseFloat(d.monto), 0);
            const dUSD = discounts.filter(d => d.moneda === 'USD').reduce((s,d) => s + parseFloat(d.monto), 0);
            const hasDisc   = discounts.length > 0;
            const netAmount = g.moneda !== 'USD' ? parseFloat(g.monto) + dUYU : parseFloat(g.monto) + dUSD;
            const catC      = this._cats.find(c => c.id === g.categoria_id);
            const included  = !!g.incluido_en_gastos;
            const inclBtnSt = included
              ? 'background:rgba(16,185,129,.15);border:1px solid #10b981;color:#10b981'
              : 'background:var(--surface);border:1px solid var(--border);color:var(--text-sec)';
            return `
              <tr style="opacity:${included ? 1 : 0.75}">
                <td style="white-space:nowrap;font-size:.72rem;font-family:'DM Mono',monospace">${fmtDate(g.fecha)}</td>
                <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${g.comercio ?? '—'}
                  ${catC ? `<span style="font-size:.62rem;color:var(--text-sec);margin-left:4px">${catC.icono}</span>` : ''}
                  ${hasDisc ? `<span style="font-size:.62rem;color:#10b981;margin-left:3px">🔗</span>` : ''}
                </td>
                <td style="font-family:'DM Mono',monospace;white-space:nowrap">${this._fmtMon(parseFloat(g.monto), g.moneda)}</td>
                <td style="font-family:'DM Mono',monospace;font-size:.72rem;color:#10b981;white-space:nowrap">
                  ${hasDisc ? (g.moneda !== 'USD' ? this._fmtMon(dUYU,'UYU') : this._fmtMon(dUSD,'USD')) : '—'}
                </td>
                <td style="font-family:'DM Mono',monospace;font-size:.8rem;font-weight:600;white-space:nowrap${hasDisc?';color:var(--accent)':''}">
                  ${this._fmtMon(netAmount, g.moneda)}
                </td>
                <td>
                  <button class="adic-incl-btn" data-id="${g.id}" data-val="${!included}"
                    style="font-size:.65rem;padding:3px 8px;border-radius:4px;cursor:pointer;white-space:nowrap;${inclBtnSt}">
                    ${included ? '✓ Incluido' : '+ Incluir'}
                  </button>
                </td>
              </tr>`;
          }).join('');

          return `
            <div style="margin-bottom:6px">
              <div class="adic-month-hdr" data-key="${openKey.replace(/"/g,'&quot;')}"
                style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;
                  padding:8px 10px;border-radius:6px;cursor:pointer;user-select:none;
                  background:rgba(255,255,255,.04);border:1px solid var(--border)">
                <span style="font-size:.78rem;font-weight:600;text-transform:capitalize">${mesLabel}</span>
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                  <span style="font-size:.7rem;color:var(--text-sec)">${gastos.length} gasto${gastos.length!==1?'s':''}</span>
                  ${summaryParts.map(p=>`<span>${p}</span>`).join('')}
                  <span class="adic-arrow" style="color:var(--text-sec);font-size:.78rem;min-width:10px">${isOpen?'▼':'▶'}</span>
                </div>
              </div>
              <div class="adic-month-detail" data-key="${openKey.replace(/"/g,'&quot;')}"
                style="display:${isOpen?'block':'none'};padding:8px 4px 0">
                <table style="font-size:.8rem;margin-bottom:4px">
                  <thead><tr>
                    <th>Fecha</th><th>Comercio</th><th>Monto</th><th>Descuento</th><th>Total</th><th></th>
                  </tr></thead>
                  <tbody>${tableRows}</tbody>
                </table>
              </div>
            </div>`;
        }).join('');

      // Grand totals for this titular across all months
      const allTitRows = purchaseRows.filter(r => r.titular_adicional === tit);
      const grandTotUYU  = allTitRows.filter(r => r.moneda !== 'USD').reduce((s,r) => s + parseFloat(r.monto), 0);
      const grandTotUSD  = allTitRows.filter(r => r.moneda === 'USD').reduce((s,r) => s + parseFloat(r.monto), 0);
      const grandDescUYU = allTitRows.reduce((s,r) => s + matchDiscount(r.comercio||'').filter(d=>d.moneda!=='USD').reduce((ss,d)=>ss+parseFloat(d.monto),0), 0);
      const grandDescUSD = allTitRows.reduce((s,r) => s + matchDiscount(r.comercio||'').filter(d=>d.moneda==='USD').reduce((ss,d)=>ss+parseFloat(d.monto),0), 0);
      const allIncluded  = allTitRows.length > 0 && allTitRows.every(r => r.incluido_en_gastos);
      const bulkVal      = !allIncluded;
      const bulkBtnSt    = allIncluded
        ? 'background:rgba(16,185,129,.15);border:1px solid #10b981;color:#10b981'
        : 'background:var(--surface);border:1px solid var(--border);color:var(--text-sec)';
      const titEsc = tit.replace(/"/g,'&quot;');

      return `
        <div class="form-card" style="padding:14px 16px;margin-bottom:.75rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div style="font-size:.95rem;font-weight:700;display:flex;align-items:center;gap:6px">
              👤 ${tit}
              <button class="adic-rename-btn" data-titular="${titEsc}" title="Renombrar titular"
                style="background:none;border:none;cursor:pointer;color:var(--text-sec);
                  font-size:.7rem;padding:2px 5px;border-radius:3px;vertical-align:middle">✏️</button>
            </div>
            <button class="adic-bulk-btn" data-titular="${titEsc}" data-val="${bulkVal}"
              style="font-size:.72rem;padding:4px 12px;border-radius:5px;cursor:pointer;${bulkBtnSt}">
              ${allIncluded ? '✓ Incluidos en gastos' : '+ Incluir todos en gastos'}
            </button>
          </div>
          ${monthSections}
          ${(grandTotUYU > 0 || grandTotUSD > 0) ? `
          <div style="border-top:2px solid var(--border);padding-top:10px;margin-top:8px">
            <div style="font-size:.7rem;color:var(--text-sec);font-weight:600;margin-bottom:4px;letter-spacing:.03em">
              TOTAL ${tit.toUpperCase()}
            </div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:.82rem">
              ${grandTotUYU > 0 ? `<div>
                <span style="color:var(--text-sec)">UYU:</span>
                <strong style="font-family:'DM Mono',monospace;margin:0 4px">${this._fmtMon(grandTotUYU,'UYU')}</strong>
                ${grandDescUYU < 0 ? `<span style="color:#10b981">− ${this._fmtMon(Math.abs(grandDescUYU),'UYU')} desc</span>` : ''}
                <span style="color:var(--accent);font-weight:700;margin-left:4px">= ${this._fmtMon(grandTotUYU+grandDescUYU,'UYU')}</span>
              </div>` : ''}
              ${grandTotUSD > 0 ? `<div>
                <span style="color:var(--text-sec)">USD:</span>
                <strong style="font-family:'DM Mono',monospace;margin:0 4px">${this._fmtMon(grandTotUSD,'USD')}</strong>
                ${grandDescUSD < 0 ? `<span style="color:#10b981">− ${this._fmtMon(Math.abs(grandDescUSD),'USD')} desc</span>` : ''}
                <span style="color:var(--accent);font-weight:700;margin-left:4px">= ${this._fmtMon(grandTotUSD+grandDescUSD,'USD')}</span>
              </div>` : ''}
            </div>
          </div>` : ''}
        </div>`;
    }).join('');

    gc.innerHTML = `
      <div class="form-card" style="padding:12px 16px;margin-bottom:.75rem">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          ${titulares.length > 1 ? `
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Tarjetahabiente</div>
            <select id="adic-titular" style="${selSt}">
              <option value="">Todos</option>
              ${titulares.map(t => `<option value="${t}"${t===filtTitular?' selected':''}>${t}</option>`).join('')}
            </select>
          </div>` : ''}
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Mes</div>
            <select id="adic-mes" style="${selSt}">
              <option value="">Todos los meses</option>
              ${meses.map(m => `<option value="${m.val}"${m.val===filtMes?' selected':''}>${m.lbl}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="font-size:.72rem;color:var(--text-sec);margin-top:8px">
          Los gastos de tarjeta adicional se registran cuando importás el EDC y asignás un titular.
          Los descuentos asociados se muestran vinculados automáticamente.
        </div>
      </div>

      ${adicRows.length === 0 ? `
        <div class="form-card">
          <div class="empty"><div class="empty-icon">👤</div>
          <div class="empty-text">Sin gastos de tarjeta adicional</div>
          <div style="font-size:.75rem;color:var(--text-sec);margin-top:6px">
            Al importar un EDC, asigná un nombre al titular de la tarjeta adicional<br>
            para hacer seguimiento de sus gastos acá.
          </div></div>
        </div>
      ` : Object.keys(byTitular).length === 0 ? `
        <div class="form-card">
          <div style="text-align:center;color:var(--text-sec);padding:20px;font-size:.82rem">
            Sin resultados para los filtros seleccionados
          </div>
        </div>
      ` : titularesSections}
    `;

    document.getElementById('adic-titular')?.addEventListener('change', e => {
      this._adicTitularFiltro = e.target.value;
      this._drawHistorialAdicional();
    });
    document.getElementById('adic-mes')?.addEventListener('change', e => {
      this._adicMes = e.target.value;
      this._drawHistorialAdicional();
    });

    if (this._adicClickHandler) gc.removeEventListener('click', this._adicClickHandler);
    this._adicClickHandler = async (e) => {
      // Acordeón: toggle mes
      const hdr = e.target.closest('.adic-month-hdr');
      if (hdr) {
        const key    = hdr.dataset.key;
        const detail = gc.querySelector(`.adic-month-detail[data-key="${CSS.escape(key)}"]`);
        const arrow  = hdr.querySelector('.adic-arrow');
        if (this._adicOpenMonths.has(key)) {
          this._adicOpenMonths.delete(key);
          if (detail) detail.style.display = 'none';
          if (arrow)  arrow.textContent = '▶';
        } else {
          this._adicOpenMonths.add(key);
          if (detail) detail.style.display = 'block';
          if (arrow)  arrow.textContent = '▼';
        }
        return;
      }

      // Renombrar titular
      const renameBtn = e.target.closest('.adic-rename-btn');
      if (renameBtn) {
        const oldName = renameBtn.dataset.titular;
        const newName = prompt(`Renombrar titular:\n"${oldName}"\n\nNuevo nombre:`, oldName)?.trim();
        if (!newName || newName === oldName) return;
        renameBtn.disabled = true;
        try {
          await getDB().from('gastos').update({ titular_adicional: newName }).eq('titular_adicional', oldName);
          // Actualizar claves de acordeón abiertas para que preserven su estado
          const updated = new Set();
          for (const k of this._adicOpenMonths) {
            updated.add(k.startsWith(`${oldName}|`) ? k.replace(`${oldName}|`, `${newName}|`) : k);
          }
          this._adicOpenMonths = updated;
          toast(`✅ Titular renombrado a "${newName}"`);
          this._drawHistorialAdicional();
        } catch(err) {
          toast('❌ ' + err.message, 'err');
          renameBtn.disabled = false;
        }
        return;
      }

      const inclBtn = e.target.closest('.adic-incl-btn');
      const bulkBtn = e.target.closest('.adic-bulk-btn');
      if (!inclBtn && !bulkBtn) return;

      if (inclBtn) {
        const id = +inclBtn.dataset.id;
        const newVal = inclBtn.dataset.val === 'true';
        const purchase = purchaseRows.find(r => r.id === id);
        if (!purchase) return;
        const linkedIds = matchDiscount(purchase.comercio || '').map(d => d.id);
        inclBtn.disabled = true;
        inclBtn.textContent = '…';
        await getDB().from('gastos').update({ incluido_en_gastos: newVal }).in('id', [id, ...linkedIds]);
        this._drawHistorialAdicional();
        return;
      }

      if (bulkBtn) {
        const tit = bulkBtn.dataset.titular;
        const newVal = bulkBtn.dataset.val === 'true';
        const titPurchases = purchaseRows.filter(r => r.titular_adicional === tit);
        const titDiscIds   = descRows.filter(d => d.titular_adicional === tit).map(d => d.id);
        const allIds = [...titPurchases.map(r => r.id), ...titDiscIds];
        if (!allIds.length) return;
        bulkBtn.disabled = true;
        bulkBtn.textContent = '…';
        await getDB().from('gastos').update({ incluido_en_gastos: newVal }).in('id', allIds);
        this._drawHistorialAdicional();
      }
    };
    gc.addEventListener('click', this._adicClickHandler);
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

    // Deduplicar: por cada compra en cuotas quedarse solo con la cuota más reciente
    const purchaseKey = g => `${g.comercio}|${g.cuotas_totales}|${g.monto}|${g.moneda}`;
    const byPurchase = {};
    for (const g of rows || []) {
      const key = purchaseKey(g);
      if (!byPurchase[key] || (g.cuota_actual ?? 0) > (byPurchase[key].cuota_actual ?? 0))
        byPurchase[key] = g;
    }
    const bancosCuotas = [...new Set((rows || []).map(r => r.banco_tarjeta).filter(Boolean))].sort();
    const allActivasRaw = Object.values(byPurchase).filter(g => g.cuota_actual < g.cuotas_totales);
    const allActivas = this._cuotasBanco
      ? allActivasRaw.filter(g => g.banco_tarjeta === this._cuotasBanco)
      : allActivasRaw;
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
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          ${this._renderMonedaFilter('c', viewMode, this._tc)}
          ${bancosCuotas.length > 0 ? `
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Tarjeta</div>
            <select id="c-banco-cuotas" style="${selSt}">
              <option value="">Todas las TDC</option>
              ${bancosCuotas.map(b => `<option value="${b}"${b===this._cuotasBanco?' selected':''}>${b}</option>`).join('')}
            </select>
          </div>` : ''}
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
                    <div style="margin-top:2px">
                      ${g.titular_adicional
                        ? `<span style="font-size:.58rem;color:#a78bfa;background:rgba(167,139,250,.12);padding:1px 5px;border-radius:3px">👤 ${g.titular_adicional}</span>`
                        : `<span style="font-size:.58rem;color:var(--text-sec);background:rgba(255,255,255,.05);padding:1px 5px;border-radius:3px">💳 Titular</span>`}
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
    document.getElementById('c-banco-cuotas')?.addEventListener('change', e => {
      this._cuotasBanco = e.target.value;
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
    // Default: año móvil (12 meses hacia atrás hasta hoy)
    if (!this._resDesde) {
      const d = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      this._resDesde = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    }
    if (!this._resHasta) {
      this._resHasta = now.toISOString().slice(0, 10);
    }
    const tc = parseFloat(this._tc) || 0;

    // Meses en el rango seleccionado (para el bar chart)
    const months = [];
    const startD = new Date(this._resDesde + 'T00:00:00');
    const endD   = new Date(this._resHasta + 'T00:00:00');
    let cur = new Date(startD.getFullYear(), startD.getMonth(), 1);
    while (cur <= endD) {
      months.push({
        ym:    `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`,
        label: cur.toLocaleDateString('es-UY', { month: 'short', year: '2-digit' }),
      });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }

    // Una sola query con todos los campos necesarios
    let q = getDB().from('gastos')
      .select('fecha, monto, moneda, categoria_id, banco_tarjeta')
      .gte('fecha', this._resDesde)
      .lte('fecha', this._resHasta);
    if (this._resCat) q = q.eq('categoria_id', +this._resCat);
    const { data: allDataRaw = [] } = await q;

    // Lista única de bancos/tarjetas para el filtro
    const bancos = [...new Set(allDataRaw.map(r => r.banco_tarjeta).filter(Boolean))].sort();

    // Aplicar filtro banco en JS (así siempre tenemos la lista completa de bancos disponibles)
    const allData = this._resBanco
      ? allDataRaw.filter(r => r.banco_tarjeta === this._resBanco)
      : allDataRaw;

    // Categorías de beneficio (excluir de gastos)
    const benefitCatIds = new Set(
      this._cats.filter(c => ['Beneficio','Puntos BBVA'].includes(c.nombre)).map(c => c.id)
    );
    const isBenefit = r => r.categoria_id != null && benefitCatIds.has(r.categoria_id);

    // Buckets por mes (solo gastos, sin beneficios)
    const byMonth = {};
    for (const m of months) byMonth[m.ym] = { UYU: 0, USD: 0 };
    for (const r of allData) {
      if (isBenefit(r)) continue;
      const ym = r.fecha.slice(0, 7);
      if (byMonth[ym]) byMonth[ym][r.moneda === 'USD' ? 'USD' : 'UYU'] += parseFloat(r.monto);
    }

    // Buckets por categoría en USD — separados en gastos y beneficios
    const byCat  = {};
    const bySave = {};
    for (const r of allData) {
      const k = r.categoria_id ?? 'sin';
      const v = r.moneda === 'USD' ? parseFloat(r.monto) : (tc ? parseFloat(r.monto) / tc : 0);
      if (isBenefit(r)) bySave[k] = (bySave[k] || 0) + v;
      else              byCat[k]  = (byCat[k]  || 0) + v;
    }

    // Tarjetas resumen
    const totalUSD   = Object.values(byCat).reduce((s, v) => s + v, 0);
    const totalSaved = -Object.values(bySave).reduce((s, v) => s + v, 0); // negativo → positivo

    const topCatEntry = Object.entries(byCat).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1])[0];
    const topCatName = topCatEntry
      ? (topCatEntry[0] === 'sin' ? 'Sin categoría'
         : (() => { const c = this._cats.find(c => c.id === +topCatEntry[0]); return c ? `${c.icono} ${c.nombre}` : 'Otros'; })())
      : '—';

    const topMonthEntry = months
      .map(m => ({ label: m.label, total: (tc ? byMonth[m.ym].UYU / tc : 0) + byMonth[m.ym].USD }))
      .filter(m => m.total > 0)
      .sort((a,b) => b.total - a.total)[0];

    const selSt  = `font-size:.82rem;padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)`;
    const catOpts = this._cats.map(c =>
      `<option value="${c.id}"${String(c.id)===String(this._resCat)?' selected':''}>${c.icono} ${c.nombre}</option>`
    ).join('');

    gc.innerHTML = `
      <!-- Filtros -->
      <div class="form-card" style="padding:12px 16px;margin-bottom:.75rem">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">T/C UYU/USD</div>
            <input id="r-tc" type="number" min="1" step="0.1" placeholder="43.5" value="${this._tc}"
              style="width:82px;font-size:.78rem;padding:5px 8px;border-radius:6px;
                border:1px solid var(--border);background:var(--surface);color:var(--text);
                font-family:'DM Mono',monospace">
          </div>
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Desde</div>
            <input id="r-desde" type="date" value="${this._resDesde}" style="${selSt}">
          </div>
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Hasta</div>
            <input id="r-hasta" type="date" value="${this._resHasta}" style="${selSt}">
          </div>
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Categoría</div>
            <select id="r-cat" style="${selSt}">
              <option value="">Todos los rubros</option>
              ${catOpts}
            </select>
          </div>
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Tarjeta</div>
            <select id="r-banco" style="${selSt};min-width:120px">
              <option value="">Todas las TDC</option>
              ${bancos.map(b => `<option value="${b}"${b===this._resBanco?' selected':''}>${b}</option>`).join('')}
            </select>
          </div>
        </div>
        ${!tc ? '<div style="margin-top:8px;font-size:.75rem;color:var(--red)">⚠ Ingresá el TC UYU/USD para ver los totales convertidos a USD.</div>' : ''}
      </div>

      <!-- Tarjetas resumen -->
      ${totalUSD > 0 || totalSaved > 0 ? `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:.75rem">
        <div class="form-card" style="padding:14px 16px;text-align:center">
          <div style="font-size:.65rem;color:var(--text-sec);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Total gastado</div>
          <div style="font-family:'DM Mono',monospace;font-size:1.1rem;font-weight:700;color:var(--accent)">${this._fmtUSD(totalUSD)}</div>
          <div style="font-size:.65rem;color:var(--text-sec);margin-top:3px">${this._resDesde.slice(0,7)} → ${this._resHasta.slice(0,7)}</div>
        </div>
        <div class="form-card" style="padding:14px 16px;text-align:center">
          <div style="font-size:.65rem;color:var(--text-sec);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Rubro top</div>
          <div style="font-size:.9rem;font-weight:600">${topCatName}</div>
          <div style="font-family:'DM Mono',monospace;font-size:.8rem;color:var(--accent);margin-top:3px">${this._fmtUSD(topCatEntry?.[1] ?? 0)}</div>
        </div>
        <div class="form-card" style="padding:14px 16px;text-align:center">
          <div style="font-size:.65rem;color:var(--text-sec);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Mes top</div>
          <div style="font-size:.9rem;font-weight:600;text-transform:capitalize">${topMonthEntry?.label ?? '—'}</div>
          <div style="font-family:'DM Mono',monospace;font-size:.8rem;color:var(--accent);margin-top:3px">${topMonthEntry ? this._fmtUSD(topMonthEntry.total) : '—'}</div>
        </div>
        ${totalSaved > 0 ? `
        <div class="form-card" style="padding:14px 16px;text-align:center;border-color:rgba(16,185,129,.3);background:rgba(16,185,129,.05)">
          <div style="font-size:.65rem;color:#10b981;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Ahorro / beneficios</div>
          <div style="font-family:'DM Mono',monospace;font-size:1.1rem;font-weight:700;color:#10b981">${this._fmtUSD(totalSaved)}</div>
          <div style="font-size:.65rem;color:var(--text-sec);margin-top:3px">🎁 Beneficio · 💎 Puntos BBVA</div>
        </div>` : ''}
      </div>` : ''}

      <!-- Bar chart -->
      <div class="form-card" style="padding:14px 16px;margin-bottom:.75rem">
        <div style="font-weight:600;font-size:.9rem;margin-bottom:8px">
          Evolución mensual · en USD${this._resCat ? ` · ${this._cats.find(c=>c.id===+this._resCat)?.nombre||''}` : ''}
        </div>
        <div id="g-bar-chart" style="height:300px"></div>
      </div>

      <!-- Pie chart -->
      <div class="form-card" style="padding:14px 16px;margin-bottom:.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
          <div style="font-weight:600;font-size:.9rem">Gastos por categoría · en USD</div>
          <div style="font-size:.78rem;color:var(--text-sec)">
            Total gastos: <span style="color:var(--accent);font-family:'DM Mono',monospace;font-weight:600">${this._fmtUSD(totalUSD)}</span>
            ${totalSaved > 0 ? ` · <span style="color:#10b981;font-family:'DM Mono',monospace">Ahorro: ${this._fmtUSD(totalSaved)}</span>` : ''}
          </div>
        </div>
        <div id="g-pie-chart" style="height:340px"></div>
      </div>
    `;

    // ── Bar chart ─────────────────────────────────────────────────────────
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

    // ── Pie chart ─────────────────────────────────────────────────────────
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
    document.getElementById('r-cat')?.addEventListener('change', e => {
      this._resCat = e.target.value;
      this._drawResumen();
    });
    document.getElementById('r-banco')?.addEventListener('change', e => {
      this._resBanco = e.target.value;
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
