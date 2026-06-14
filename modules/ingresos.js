window.Mods = window.Mods || {};
window.Mods.ingresos = {
  _filterTipo: '',

  async render() {
    const c = document.getElementById('content');
    const [ingresos, tipos] = await Promise.all([
      dbFetch('ingresos',      { order: { col: 'fecha', asc: false }, limit: 200 }),
      dbFetch('tipos_ingreso', { filters: { activo: 1 }, order: { col: 'nombre', asc: true } }),
    ]);

    const preset = this._loadPreset();
    const selSt  = `font-size:.82rem;padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)`;

    c.innerHTML = `
      <h1>Ingresos</h1>
      <p class="page-subtitle">Registro de entradas</p>

      <div class="form-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <h3 style="margin:0">Nuevo ingreso</h3>
          ${preset ? `<button id="btn-load-preset" style="font-size:.78rem;padding:4px 10px;border-radius:12px;border:1px solid #3b82f6;background:rgba(59,130,246,.12);color:#3b82f6;cursor:pointer">⚡ Cargar: ${preset.desc || preset.tipo || 'recurrente'}</button>` : ''}
        </div>
        <form id="form-ingreso">
          <div class="form-grid">
            <div class="form-group">
              <label>Fecha</label>
              <input id="i-fecha" type="date" value="${new Date().toISOString().slice(0,10)}" required>
            </div>
            <div class="form-group">
              <label>Moneda</label>
              <select id="i-moneda" style="${selSt}">
                <option value="USD">USD</option>
                <option value="UYU">UYU</option>
              </select>
            </div>
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
              <select id="i-tipo" style="${selSt}">
                <option value="">Sin tipo</option>
                ${tipos.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Usuario</label>
              <select id="i-usuario" style="${selSt}">
                <option value="compartido">Compartido</option>
                <option value="usuario1">Usuario 1</option>
                <option value="usuario2">Usuario 2</option>
              </select>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
            <button type="submit" class="btn btn-primary">✚ Registrar ingreso</button>
            <button type="button" id="btn-save-preset" class="btn" style="border:1px solid var(--border)">💾 Guardar recurrente</button>
          </div>
        </form>
      </div>

      <div class="table-wrap">
        <div class="table-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <span class="table-title">Ingresos</span>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="ing-filter-tipo" style="${selSt}">
              <option value="">Todos los tipos</option>
              ${tipos.map(t => `<option value="${t.id}" ${this._filterTipo == t.id ? 'selected' : ''}>${t.nombre}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="ing-list">
          ${this._renderList(ingresos, tipos, this._filterTipo)}
        </div>
      </div>
    `;

    // moneda label update
    document.getElementById('i-moneda').addEventListener('change', e => {
      document.getElementById('i-monto-lbl').textContent = `Monto (${e.target.value})`;
    });

    // load preset
    document.getElementById('btn-load-preset')?.addEventListener('click', () => {
      const p = this._loadPreset();
      if (!p) return;
      if (p.monto)   document.getElementById('i-monto').value   = p.monto;
      if (p.moneda)  document.getElementById('i-moneda').value  = p.moneda;
      if (p.desc)    document.getElementById('i-desc').value    = p.desc;
      if (p.tipo)    document.getElementById('i-tipo').value    = p.tipo;
      if (p.usuario) document.getElementById('i-usuario').value = p.usuario;
      document.getElementById('i-monto-lbl').textContent = `Monto (${p.moneda || 'USD'})`;
    });

    // save preset
    document.getElementById('btn-save-preset').addEventListener('click', () => {
      const preset = {
        monto:   document.getElementById('i-monto').value,
        moneda:  document.getElementById('i-moneda').value,
        desc:    document.getElementById('i-desc').value.trim(),
        tipo:    document.getElementById('i-tipo').value,
        usuario: document.getElementById('i-usuario').value,
      };
      if (!preset.monto) { toast('⚠️ Completá el monto antes de guardar', 'err'); return; }
      this._savePreset(preset);
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
          usuario:     document.getElementById('i-usuario').value,
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
    return `<table>
      <thead><tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Usuario</th><th>Monto</th><th></th></tr></thead>
      <tbody id="ing-tbody">
        ${rows.map(i => this._row(i, tipos)).join('')}
      </tbody>
    </table>`;
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
      <td>${fmtDate(i.fecha)}</td>
      <td>${i.descripcion ?? '—'}</td>
      <td>${tipo ? tipo.nombre : '—'}</td>
      <td>${i.usuario}</td>
      <td><strong class="pos">${monStr}</strong></td>
      <td><button class="ing-del btn-icon" data-id="${i.id}" title="Eliminar" style="font-size:.85rem;opacity:.5;cursor:pointer;background:none;border:none;color:var(--text)">🗑</button></td>
    </tr>`;
  },

  _loadPreset() {
    try { return JSON.parse(localStorage.getItem('ingreso_preset') || 'null'); } catch { return null; }
  },

  _savePreset(p) {
    localStorage.setItem('ingreso_preset', JSON.stringify(p));
  },
};
