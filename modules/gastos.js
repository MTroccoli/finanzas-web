window.Mods = window.Mods || {};
window.Mods.gastos = {
  _tab:        'importar',
  _cats:       [],
  _pending:    [],         // transacciones parseadas pendientes de confirmación
  _learned:    {},         // { merchant_normalizado: categoria_id }
  _excludedCards: '',
  _splitCatNames: new Set(['Restaurantes', 'Viajes']),
  _histMes:    null,
  _histCat:    '',
  _histMoneda: 'UYU',

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
    const [cats, learnedRows, excludedCards] = await Promise.all([
      dbFetch('categorias_gastos', { filters: { activo: 1 }, order: { col: 'nombre', asc: true } }),
      dbFetch('merchant_categorias', { order: { col: 'seen_count', asc: false } }).catch(() => []),
      getConfig('gastos_tarjetas_excluidas').catch(() => ''),
    ]);
    this._cats = cats;
    this._learned = {};
    for (const r of learnedRows) this._learned[r.merchant_normalizado] = r.categoria_id;
    this._learnedRows = learnedRows;
    this._excludedCards = excludedCards || '';
    this._splitCatIds = new Set(
      cats.filter(c => this._splitCatNames.has(c.nombre)).map(c => c.id)
    );
    this._drawShell();
    this._drawTab();
  },

  _isSplitCat(catId) { return this._splitCatIds?.has(catId); },

  _drawShell() {
    const c = document.getElementById('content');
    const tabs = [['importar','📤 Importar EDC'],['manual','✚ Nuevo gasto'],['historial','📋 Historial'],['cuotas','📅 Cuotas']];
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
      case 'importar':  return this._drawImportar();
      case 'manual':    return this._drawManual();
      case 'historial': return this._drawHistorial();
      case 'cuotas':    return this._drawCuotas();
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
                <option value="ARS">ARS — Pesos argentinos</option>
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

    const now     = new Date();
    const mesAct  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const mesFilter   = this._histMes    || mesAct;
    const catFilter   = this._histCat    || '';
    const monedaFilter= this._histMoneda || 'UYU';
    const tipoFilter  = this._histTipo   || '';

    const [yr, mo] = mesFilter.split('-').map(Number);
    const desde = `${yr}-${String(mo).padStart(2,'0')}-01`;
    const hasta = `${yr}-${String(mo).padStart(2,'0')}-${new Date(yr, mo, 0).getDate()}`;

    // Build 12-month dropdown
    const meses = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return {
        val: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        lbl: d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
      };
    });

    // Fetch with date range via Supabase client directly
    let q = getDB().from('gastos').select('*').gte('fecha', desde).lte('fecha', hasta);
    if (catFilter)    q = q.eq('categoria_id', +catFilter);
    if (monedaFilter) q = q.eq('moneda', monedaFilter);
    if (tipoFilter)   q = q.eq('tipo_gasto', tipoFilter);
    const { data: gastos, error } = await q.order('fecha', { ascending: false });
    if (error) throw error;

    // Totals by category
    const bycat = {};
    for (const g of gastos) {
      const k = g.categoria_id ?? 'sin';
      bycat[k] = (bycat[k] || 0) + parseFloat(g.monto);
    }
    const totalMes = gastos.reduce((s, g) => s + parseFloat(g.monto), 0);

    const fmtAmt = (n, mon = monedaFilter) => mon === 'USD'
      ? fmtUSD(n)
      : new Intl.NumberFormat('es-UY', { style: 'currency', currency: mon || 'UYU', maximumFractionDigits: 0 }).format(n);

    const catBadge = id => {
      const c = this._cats.find(c => c.id === (id === 'sin' ? null : +id));
      return c ? `${c.icono} ${c.nombre}` : '—';
    };

    gc.innerHTML = `
      <!-- Filtros -->
      <div class="form-card" style="padding:12px 16px;margin-bottom:.75rem">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <select id="h-mes" style="font-size:.82rem;padding:5px 10px;border-radius:6px;
            border:1px solid var(--border);background:var(--surface);color:var(--text)">
            ${meses.map(m => `<option value="${m.val}"${m.val===mesFilter?' selected':''}>${m.lbl}</option>`).join('')}
          </select>
          <select id="h-cat" style="font-size:.82rem;padding:5px 10px;border-radius:6px;
            border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <option value="">Todas las categorías</option>
            ${this._cats.map(c =>
              `<option value="${c.id}"${String(c.id)===catFilter?' selected':''}>${c.icono} ${c.nombre}</option>`
            ).join('')}
          </select>
          <select id="h-moneda" style="font-size:.82rem;padding:5px 10px;border-radius:6px;
            border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <option value="UYU"${monedaFilter==='UYU'?' selected':''}>UYU</option>
            <option value="USD"${monedaFilter==='USD'?' selected':''}>USD</option>
            <option value="ARS"${monedaFilter==='ARS'?' selected':''}>ARS</option>
          </select>
          <select id="h-tipo" style="font-size:.82rem;padding:5px 10px;border-radius:6px;
            border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <option value=""${!tipoFilter?' selected':''}>Todos</option>
            <option value="casual"${tipoFilter==='casual'?' selected':''}>💳 Casual</option>
            <option value="recurrente"${tipoFilter==='recurrente'?' selected':''}>🔁 Recurrente</option>
          </select>
        </div>
      </div>

      <!-- Resumen por categoría -->
      ${Object.keys(bycat).length === 0 ? '' : `
      <div class="form-card" style="padding:14px 16px;margin-bottom:.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="font-weight:600;font-size:.9rem">Resumen del mes</span>
          <span style="font-family:'DM Mono',monospace;font-size:.85rem;color:var(--accent);font-weight:600">
            Total: ${fmtAmt(totalMes)}
          </span>
        </div>
        ${Object.entries(bycat).sort((a,b) => b[1]-a[1]).map(([id, tot]) => {
          const pct = totalMes > 0 ? (tot/totalMes*100) : 0;
          return `
            <div style="margin-bottom:9px">
              <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:3px">
                <span>${catBadge(id)}</span>
                <span style="font-family:'DM Mono',monospace">
                  ${fmtAmt(tot)} <span style="color:var(--text-sec)">(${pct.toFixed(0)}%)</span>
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
        const rec  = gastos.filter(g => g.tipo_gasto === 'recurrente').reduce((s, g) => s + parseFloat(g.monto), 0);
        const cas  = gastos.filter(g => g.tipo_gasto !== 'recurrente').reduce((s, g) => s + parseFloat(g.monto), 0);
        if (!rec && !cas) return '';
        const pctRec = totalMes > 0 ? (rec / totalMes * 100) : 0;
        return `
        <div class="form-card" style="padding:12px 16px;margin-bottom:.75rem">
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div style="flex:1;min-width:120px">
              <div style="font-size:.7rem;color:var(--text-sec);margin-bottom:2px">🔁 Recurrente</div>
              <div style="font-family:'DM Mono',monospace;font-weight:600">${fmtAmt(rec)}</div>
              <div style="font-size:.7rem;color:var(--text-sec)">${pctRec.toFixed(0)}% del total</div>
            </div>
            <div style="flex:1;min-width:120px">
              <div style="font-size:.7rem;color:var(--text-sec);margin-bottom:2px">💳 Casual</div>
              <div style="font-family:'DM Mono',monospace;font-weight:600">${fmtAmt(cas)}</div>
              <div style="font-size:.7rem;color:var(--text-sec)">${(100-pctRec).toFixed(0)}% del total</div>
            </div>
          </div>
        </div>`;
      })()}

      <!-- Tabla -->
      <div class="table-wrap">
        <div class="table-header">
          <span class="table-title">${gastos.length} gastos</span>
          <span style="font-size:.68rem;color:var(--text-sec);font-family:'DM Mono',monospace">
            ${mesFilter}
          </span>
        </div>
        ${gastos.length === 0 ? `
          <div class="empty"><div class="empty-icon">💸</div>
          <div class="empty-text">Sin gastos para este período</div></div>
        ` : `
          <table>
            <thead><tr><th>Fecha</th><th>Comercio</th><th>Categoría</th><th>Monto</th><th></th></tr></thead>
            <tbody>
              ${gastos.map(g => `
                <tr>
                  <td style="white-space:nowrap">${fmtDate(g.fecha)}</td>
                  <td>${g.comercio ?? '—'}${g.tipo_gasto === 'recurrente'
                    ? ' <span style="font-size:.62rem;color:var(--accent)">🔁</span>' : ''}${(g.dividido_entre > 1)
                    ? ` <span style="font-size:.65rem;color:var(--text-sec)">÷${g.dividido_entre}</span>` : ''}${(g.cuota_actual && g.cuotas_totales)
                    ? ` <span style="font-size:.62rem;color:var(--text-sec);background:rgba(255,255,255,.06);padding:1px 5px;border-radius:3px">📅 ${g.cuota_actual}/${g.cuotas_totales}</span>` : ''}</td>
                  <td>${catBadge(g.categoria_id)}</td>
                  <td style="font-family:'DM Mono',monospace;font-weight:600;white-space:nowrap">
                    ${fmtAmt(parseFloat(g.monto), g.moneda)}
                  </td>
                  <td><button class="btn btn-ghost btn-del-g" data-id="${g.id}"
                    style="font-size:.7rem;padding:2px 7px;color:var(--red)">✕</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;

    ['h-mes','h-cat','h-moneda','h-tipo'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        this._histMes    = document.getElementById('h-mes').value;
        this._histCat    = document.getElementById('h-cat').value;
        this._histMoneda = document.getElementById('h-moneda').value;
        this._histTipo   = document.getElementById('h-tipo').value;
        this._drawHistorial();
      });
    });

    document.querySelectorAll('.btn-del-g').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este gasto?')) return;
        await dbDelete('gastos', { id: +btn.dataset.id });
        toast('Eliminado');
        this._drawHistorial();
      })
    );
  },

  // ── Cuotas (proyección de gastos futuros) ───────────────────────────────
  async _drawCuotas() {
    const gc = document.getElementById('g-content');
    gc.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    // Traemos solo gastos con cuotas pendientes (cuota_actual < cuotas_totales)
    const sb = getDB();
    const { data: rows, error } = await sb.from('gastos')
      .select('*')
      .not('cuotas_totales', 'is', null)
      .order('fecha', { ascending: false });
    if (error) throw error;

    const activas = (rows || []).filter(g => g.cuota_actual < g.cuotas_totales);
    const catBadge = id => {
      const c = this._cats.find(c => c.id === id);
      return c ? `${c.icono} ${c.nombre}` : '—';
    };
    const fmtAmt = (n, mon) => mon === 'USD'
      ? fmtUSD(n)
      : new Intl.NumberFormat('es-UY', { style: 'currency', currency: mon || 'UYU', maximumFractionDigits: 0 }).format(n);

    // Proyección: para cada gasto activo, sumar la cuota en los próximos 12 meses
    const now = new Date();
    const proj = []; // [{ym, label, byMon:{UYU:0, USD:0, ...}}]
    for (let i = 1; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      proj.push({
        ym,
        label: d.toLocaleDateString('es-UY', { month: 'short', year: '2-digit' }),
        byMon: {},
      });
    }

    for (const g of activas) {
      const restantes = g.cuotas_totales - g.cuota_actual;
      const [yr, mo] = g.fecha.split('-').map(Number);
      const baseDate = new Date(yr, mo - 1, 1);
      const monto = parseFloat(g.monto);
      const mon = g.moneda || 'UYU';
      for (let k = 1; k <= restantes; k++) {
        const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + k, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const slot = proj.find(p => p.ym === ym);
        if (slot) slot.byMon[mon] = (slot.byMon[mon] || 0) + monto;
      }
    }

    const totalByMon = {};
    for (const g of activas) {
      const mon = g.moneda || 'UYU';
      totalByMon[mon] = (totalByMon[mon] || 0) + parseFloat(g.monto) * (g.cuotas_totales - g.cuota_actual);
    }

    const maxProj = Math.max(1, ...proj.map(p => Math.max(0, ...Object.values(p.byMon))));

    gc.innerHTML = `
      <!-- Totales -->
      <div class="form-card" style="padding:14px 16px;margin-bottom:.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-weight:600;font-size:.9rem">Cuotas pendientes</div>
            <div style="font-size:.74rem;color:var(--text-sec);margin-top:2px">
              ${activas.length} compras con cuotas restantes
            </div>
          </div>
          <div style="text-align:right;font-family:'DM Mono',monospace;font-size:.85rem">
            ${Object.entries(totalByMon).map(([mon, tot]) =>
              `<div${mon==='USD'?' style="color:var(--accent)"':''}>${fmtAmt(tot, mon)}</div>`
            ).join('') || '<div style="color:var(--text-sec)">—</div>'}
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
        ${proj.map(p => {
          const monEntries = Object.entries(p.byMon).filter(([,v]) => v > 0);
          if (!monEntries.length) return '';
          const maxVal = Math.max(...monEntries.map(([,v]) => v));
          const pct = Math.max(2, (maxVal / maxProj) * 100);
          return `
            <div style="margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;font-size:.76rem;margin-bottom:3px">
                <span style="text-transform:capitalize">${p.label}</span>
                <span style="font-family:'DM Mono',monospace">
                  ${monEntries.map(([mon, val]) =>
                    `<span${mon==='USD'?' style="color:var(--accent);margin-left:6px"':''}>${fmtAmt(val, mon)}</span>`
                  ).join('')}
                </span>
              </div>
              <div style="height:4px;background:var(--border);border-radius:2px">
                <div style="height:4px;background:var(--accent);border-radius:2px;width:${pct.toFixed(1)}%"></div>
              </div>
            </div>`;
        }).join('') || '<div style="color:var(--text-sec);font-size:.78rem">Sin proyección en los próximos 12 meses</div>'}
      </div>

      <!-- Lista de compras con cuotas activas -->
      <div class="table-wrap">
        <div class="table-header">
          <span class="table-title">Compras en cuotas</span>
        </div>
        <table>
          <thead><tr>
            <th>Compra</th><th>Categoría</th><th>Cuota</th><th>Por mes</th><th>Restante</th><th></th>
          </tr></thead>
          <tbody>
            ${activas.map(g => {
              const restantes = g.cuotas_totales - g.cuota_actual;
              const monto = parseFloat(g.monto);
              return `
                <tr>
                  <td>${g.comercio ?? '—'}
                    <div style="font-size:.68rem;color:var(--text-sec);font-family:'DM Mono',monospace">
                      ${fmtDate(g.fecha)}
                    </div>
                  </td>
                  <td>${catBadge(g.categoria_id)}</td>
                  <td style="font-family:'DM Mono',monospace;font-size:.78rem">
                    ${g.cuota_actual}/${g.cuotas_totales}
                  </td>
                  <td style="font-family:'DM Mono',monospace;font-weight:600;white-space:nowrap">
                    ${fmtAmt(monto, g.moneda)}
                  </td>
                  <td style="font-family:'DM Mono',monospace;color:var(--text-sec);white-space:nowrap">
                    ${fmtAmt(monto * restantes, g.moneda)}
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

    document.querySelectorAll('.btn-del-c').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este gasto?')) return;
        await dbDelete('gastos', { id: +btn.dataset.id });
        toast('Eliminado');
        this._drawCuotas();
      })
    );
  },
};
