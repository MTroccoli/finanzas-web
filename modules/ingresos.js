window.Mods = window.Mods || {};
window.Mods.ingresos = {
  _filterTipo: '',

  async render() {
    const c = document.getElementById('content');
    const [ingresos, tipos] = await Promise.all([
      dbFetch('ingresos',      { order: { col: 'fecha', asc: false }, limit: 200 }),
      dbFetch('tipos_ingreso', { filters: { activo: 1 }, order: { col: 'nombre', asc: true } }),
    ]);

    const presets = this._loadPresets();
    const selSt   = `font-size:.82rem;padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)`;

    c.innerHTML = `
      <h1>Ingresos</h1>
      <p class="page-subtitle">Registro de entradas</p>

      <div class="form-card">
        <h3>Nuevo ingreso</h3>

        ${presets.length ? `
        <details id="presets-wrap" style="margin-bottom:14px">
          <summary style="cursor:pointer;font-size:.82rem;color:var(--accent);list-style:none;display:flex;align-items:center;gap:6px">
            <span>📂 Guardados (${presets.length})</span>
          </summary>
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
            ${presets.map((p, i) => `
              <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;background:var(--surface);border:1px solid var(--border)">
                <span style="flex:1;font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${p.desc || 'Sin nombre'} · <span style="color:var(--text-sec)">${p.moneda} ${p.monto}</span>
                </span>
                <button class="btn-load-preset" data-idx="${i}" style="font-size:.75rem;padding:2px 8px;border-radius:10px;border:1px solid #3b82f6;background:rgba(59,130,246,.12);color:#3b82f6;cursor:pointer;white-space:nowrap">⚡ Cargar</button>
                <button class="btn-del-preset" data-idx="${i}" style="font-size:.75rem;padding:2px 6px;border-radius:10px;border:1px solid var(--border);background:none;color:var(--text-sec);cursor:pointer">✕</button>
              </div>`).join('')}
          </div>
        </details>` : ''}

        <form id="form-ingreso">
          <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
            <div class="form-group" style="flex:0 1 138px;min-width:110px">
              <label>Fecha</label>
              <input id="i-fecha" type="date" value="${new Date().toISOString().slice(0,10)}" style="${selSt};width:100%" required>
            </div>
            <div class="form-group" style="flex:0 1 90px;min-width:80px">
              <label>Moneda</label>
              <select id="i-moneda" style="${selSt};width:100%">
                <option value="USD">USD</option>
                <option value="UYU">UYU</option>
              </select>
            </div>
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label id="i-monto-lbl">Monto</label>
              <input id="i-monto" type="number" step="0.01" min="0.01" placeholder="1000.00" required>
            </div>
            <div class="form-group">
              <label>Descripción</label>
              <input id="i-desc" type="text" placeholder="Salario, freelance...">
            </div>
            <div class="form-group">
              <label>Tipo</label>
              <select id="i-tipo">
                <option value="">Sin tipo</option>
                ${tipos.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="submit" class="btn btn-primary">✚ Registrar ingreso</button>
            <button type="button" id="btn-save-preset" class="btn" style="border:1px solid var(--border)">💾 Guardar recurrente</button>
          </div>
        </form>
      </div>

      <div class="table-wrap">
        <div class="table-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <span class="table-title">Ingresos</span>
          <select id="ing-filter-tipo" style="${selSt}">
            <option value="">Todos los tipos</option>
            ${tipos.map(t => `<option value="${t.id}" ${this._filterTipo == t.id ? 'selected' : ''}>${t.nombre}</option>`).join('')}
          </select>
        </div>
        <div id="ing-list">
          ${this._renderList(ingresos, tipos, this._filterTipo)}
        </div>
      </div>
    `;

    // moneda label
    document.getElementById('i-moneda').addEventListener('change', e => {
      document.getElementById('i-monto-lbl').textContent = `Monto (${e.target.value})`;
    });

    // load preset buttons
    document.querySelectorAll('.btn-load-preset').forEach(btn =>
      btn.addEventListener('click', () => {
        const p = this._loadPresets()[parseInt(btn.dataset.idx)];
        if (!p) return;
        if (p.monto)  document.getElementById('i-monto').value  = p.monto;
        if (p.moneda) { document.getElementById('i-moneda').value = p.moneda; document.getElementById('i-monto-lbl').textContent = `Monto (${p.moneda})`; }
        if (p.desc)   document.getElementById('i-desc').value   = p.desc;
        if (p.tipo)   document.getElementById('i-tipo').value   = p.tipo;
      })
    );

    // delete preset buttons
    document.querySelectorAll('.btn-del-preset').forEach(btn =>
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const arr = this._loadPresets();
        arr.splice(idx, 1);
        localStorage.setItem('ingresos_presets', JSON.stringify(arr));
        this.render();
      })
    );

    // save preset
    document.getElementById('btn-save-preset').addEventListener('click', () => {
      const monto = document.getElementById('i-monto').value;
      if (!monto) { toast('⚠️ Completá el monto antes de guardar', 'err'); return; }
      const p = {
        monto,
        moneda: document.getElementById('i-moneda').value,
        desc:   document.getElementById('i-desc').value.trim(),
        tipo:   document.getElementById('i-tipo').value,
      };
      const arr = this._loadPresets();
      arr.unshift(p);
      if (arr.length > 10) arr.length = 10;
      localStorage.setItem('ingresos_presets', JSON.stringify(arr));
      toast('💾 Ingreso recurrente guardado');
      this.render();
    });

    // submit
    document.getElementById('form-ingreso').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await dbInsert('ingresos', {
          fecha:       document.getElementById('i-fecha').value,
          monto:       parseFloat(document.getElementById('i-monto').value),
          moneda:      document.getElementById('i-moneda').value,
          descripcion: document.getElementById('i-desc').value.trim() || null,
          tipo_id:     document.getElementById('i-tipo').value ? parseInt(document.getElementById('i-tipo').value) : null,
        });
        toast('✅ Ingreso registrado');
        e.target.reset();
        document.getElementById('i-fecha').value = new Date().toISOString().slice(0,10);
        document.getElementById('i-monto-lbl').textContent = 'Monto';
        const rows = await dbFetch('ingresos', { order: { col: 'fecha', asc: false }, limit: 200 });
        document.getElementById('ing-list').innerHTML = this._renderList(rows, tipos, this._filterTipo);
        this._bindDelete(tipos);
      } catch(err) { toast('❌ ' + err.message, 'err'); }
    });

    // tipo filter
    document.getElementById('ing-filter-tipo').addEventListener('change', async e => {
      this._filterTipo = e.target.value;
      const rows = await dbFetch('ingresos', { order: { col: 'fecha', asc: false }, limit: 200 });
      document.getElementById('ing-list').innerHTML = this._renderList(rows, tipos, this._filterTipo);
      this._bindDelete(tipos);
    });

    this._bindDelete(tipos);
  },

  _renderList(ingresos, tipos, filterTipo) {
    const rows = filterTipo
      ? ingresos.filter(i => String(i.tipo_id) === String(filterTipo))
      : ingresos;
    if (!rows.length) return `<div class="empty"><div class="empty-icon">💵</div><div class="empty-text">Sin ingresos registrados</div></div>`;
    return `<div style="overflow-x:auto"><table style="min-width:360px">
      <thead><tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Monto</th><th></th></tr></thead>
      <tbody id="ing-tbody">
        ${rows.map(i => this._row(i, tipos)).join('')}
      </tbody>
    </table></div>`;
  },

  _bindDelete(tipos) {
    document.querySelectorAll('.ing-del').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este ingreso?')) return;
        try {
          await dbDelete('ingresos', { id: parseInt(btn.dataset.id) });
          toast('🗑 Eliminado');
          const rows = await dbFetch('ingresos', { order: { col: 'fecha', asc: false }, limit: 200 });
          document.getElementById('ing-list').innerHTML = this._renderList(rows, tipos, this._filterTipo);
          this._bindDelete(tipos);
        } catch(err) { toast('❌ ' + err.message, 'err'); }
      })
    );
  },

  _row(i, tipos) {
    const tipo   = tipos.find(t => t.id === i.tipo_id);
    const moneda = i.moneda || 'USD';
    const monStr = moneda === 'USD' ? fmtUSD(i.monto) : `$U ${fmt(i.monto, 0)}`;
    return `<tr>
      <td style="white-space:nowrap">${fmtDate(i.fecha)}</td>
      <td>${i.descripcion ?? '—'}</td>
      <td>${tipo ? tipo.nombre : '—'}</td>
      <td><strong class="pos">${monStr}</strong></td>
      <td><button class="ing-del" data-id="${i.id}" title="Eliminar" style="background:none;border:none;cursor:pointer;opacity:.5;font-size:.9rem;padding:2px 4px">🗑</button></td>
    </tr>`;
  },

  _loadPresets() {
    try {
      // migrate single old preset
      const old = localStorage.getItem('ingreso_preset');
      if (old && !localStorage.getItem('ingresos_presets')) {
        const arr = [JSON.parse(old)];
        localStorage.setItem('ingresos_presets', JSON.stringify(arr));
        localStorage.removeItem('ingreso_preset');
        return arr;
      }
      return JSON.parse(localStorage.getItem('ingresos_presets') || '[]');
    } catch { return []; }
  },
};
