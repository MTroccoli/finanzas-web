window.Mods = window.Mods || {};
window.Mods.ingresos = {
  _filterTipo: '',

  async render() {
    const c = document.getElementById('content');

    // Check auto-presets before rendering (silent, no await-blocking UI)
    this._checkAutoPresets().catch(() => {});

    const [ingresos, tipos] = await Promise.all([
      dbFetch('ingresos',      { order: { col: 'fecha', asc: false }, limit: 200 }),
      dbFetch('tipos_ingreso', { filters: { activo: 1 }, order: { col: 'nombre', asc: true } }),
    ]);

    const presets = this._loadPresets();
    const inp = `font-size:.82rem;padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);width:100%`;

    c.innerHTML = `
      <h1>Ingresos</h1>
      <p class="page-subtitle">Registro de entradas</p>

      <div class="form-card">
        <h3 style="margin-bottom:12px">Nuevo ingreso</h3>

        ${presets.length ? `
        <details id="presets-wrap" style="margin-bottom:14px">
          <summary style="cursor:pointer;font-size:.82rem;color:var(--accent);list-style:none;user-select:none">
            📂 Guardados (${presets.length})
          </summary>
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
            ${presets.map((p, i) => `
              <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:6px;background:var(--surface);border:1px solid var(--border)">
                <div style="flex:1;min-width:0">
                  <div style="font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    ${p.desc || 'Sin nombre'} · <span style="color:var(--text-sec)">${p.moneda || 'USD'} ${p.monto}</span>${p.frecuencia ? ` · <span style="color:var(--accent)">${p.frecuencia}</span>` : ''}${p.auto ? ` · <span style="color:#10b981">⚡auto</span>` : ''}
                  </div>
                  ${p.frecuencia && p.ultima_carga ? `<div style="font-size:.65rem;color:var(--text-sec);margin-top:2px">Próx: ${this._nextDue(p.ultima_carga, p.frecuencia)}</div>` : ''}
                </div>
                <button class="btn-load-preset" data-idx="${i}" style="font-size:.72rem;padding:2px 8px;border-radius:10px;border:1px solid #3b82f6;background:rgba(59,130,246,.12);color:#3b82f6;cursor:pointer;white-space:nowrap;flex-shrink:0">⚡ Cargar</button>
                <button class="btn-del-preset" data-idx="${i}" style="font-size:.72rem;padding:2px 6px;border-radius:10px;border:1px solid var(--border);background:none;color:var(--text-sec);cursor:pointer;flex-shrink:0">✕</button>
              </div>`).join('')}
          </div>
        </details>` : ''}

        <form id="form-ingreso">
          <!-- Row 1: Fecha · Moneda · Monto (min-width:0 fuerza celdas a respetar el grid) -->
          <div style="display:grid;grid-template-columns:minmax(0,1.3fr) 72px minmax(0,1fr);gap:8px;margin-bottom:10px">
            <div class="form-group" style="min-width:0;overflow:hidden">
              <label>Fecha</label>
              <input id="i-fecha" type="date" value="${new Date().toISOString().slice(0,10)}" style="${inp}" required>
            </div>
            <div class="form-group" style="min-width:0">
              <label>Moneda</label>
              <select id="i-moneda" style="${inp}">
                <option value="USD">USD</option>
                <option value="UYU">UYU</option>
              </select>
            </div>
            <div class="form-group" style="min-width:0">
              <label id="i-monto-lbl">Monto</label>
              <input id="i-monto" type="number" step="0.01" min="0.01" placeholder="0.00" style="${inp}" required>
            </div>
          </div>

          <!-- Row 2: Tipo · Descripción -->
          <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:8px;margin-bottom:12px">
            <div class="form-group" style="min-width:0">
              <label>Tipo</label>
              <select id="i-tipo" style="${inp}">
                <option value="">Sin tipo</option>
                ${tipos.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="min-width:0">
              <label>Descripción</label>
              <input id="i-desc" type="text" placeholder="Salario, freelance..." style="${inp}">
            </div>
          </div>

          <!-- Row 3: Botones -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <button type="submit" class="btn btn-primary" style="justify-content:center;width:100%">✚ Registrar</button>
            <button type="button" id="btn-save-preset" class="btn" style="justify-content:center;width:100%;border:1px solid var(--border)">💾 Recurrente</button>
          </div>

          <!-- Panel de frecuencia (oculto por defecto) -->
          <div id="preset-freq-panel" style="display:none;margin-top:12px;padding:12px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,.03)">
            <div style="font-size:.72rem;color:var(--text-sec);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Opciones de recurrencia</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
              <div class="form-group" style="flex:1;min-width:120px">
                <label>Frecuencia</label>
                <select id="preset-freq" style="${inp}">
                  <option value="mensual">Mensual</option>
                  <option value="bimensual">Bimensual (c/2 meses)</option>
                  <option value="semestral">Semestral (c/6 meses)</option>
                  <option value="anual">Anual</option>
                </select>
              </div>
              <div style="display:flex;align-items:center;gap:6px;padding-bottom:6px">
                <input type="checkbox" id="preset-auto" style="width:15px;height:15px;accent-color:var(--accent)">
                <label for="preset-auto" style="font-size:.8rem;cursor:pointer;user-select:none">Carga automática al vencer</label>
              </div>
            </div>
            <button type="button" id="btn-confirm-preset" class="btn btn-primary" style="margin-top:10px">💾 Confirmar y guardar</button>
          </div>
        </form>
      </div>

      <div class="table-wrap">
        <div class="table-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <span class="table-title">Ingresos</span>
          <select id="ing-filter-tipo" style="font-size:.82rem;padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
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

    // toggle frecuencia panel
    document.getElementById('btn-save-preset').addEventListener('click', () => {
      const panel = document.getElementById('preset-freq-panel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    // confirm & save preset
    document.getElementById('btn-confirm-preset').addEventListener('click', async () => {
      const monto = document.getElementById('i-monto').value;
      if (!monto) { toast('⚠️ Completá el monto antes de guardar', 'err'); return; }
      const fecha  = document.getElementById('i-fecha').value;
      const moneda = document.getElementById('i-moneda').value;
      const desc   = document.getElementById('i-desc').value.trim();
      const tipo   = document.getElementById('i-tipo').value;
      const p = {
        monto, moneda, desc, tipo,
        frecuencia:   document.getElementById('preset-freq').value,
        auto:         document.getElementById('preset-auto').checked,
        ultima_carga: fecha, // usar la fecha ingresada como punto de partida
      };
      const arr = this._loadPresets();
      arr.unshift(p);
      if (arr.length > 10) arr.length = 10;
      localStorage.setItem('ingresos_presets', JSON.stringify(arr));

      // Si la fecha es <= hoy, registrar el ingreso inmediatamente
      const today = new Date().toISOString().slice(0, 10);
      if (fecha <= today) {
        try {
          await dbInsert('ingresos', {
            fecha,
            monto:       parseFloat(monto),
            moneda,
            descripcion: desc || null,
            tipo_id:     tipo ? parseInt(tipo) : null,
          });
          toast('✅ Ingreso registrado y guardado como recurrente');
        } catch(err) {
          toast('💾 Guardado como recurrente (error al registrar: ' + err.message + ')', 'err');
        }
      } else {
        toast('💾 Ingreso recurrente guardado');
      }
      this.render();
    });

    // load preset
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

    // delete preset
    document.querySelectorAll('.btn-del-preset').forEach(btn =>
      btn.addEventListener('click', () => {
        const arr = this._loadPresets();
        arr.splice(parseInt(btn.dataset.idx), 1);
        localStorage.setItem('ingresos_presets', JSON.stringify(arr));
        this.render();
      })
    );

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
    return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <table style="min-width:340px;width:100%">
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
      <td style="white-space:nowrap">${tipo ? tipo.nombre : '—'}</td>
      <td style="white-space:nowrap"><strong class="pos">${monStr}</strong></td>
      <td><button class="ing-del" data-id="${i.id}" title="Eliminar" style="background:none;border:none;cursor:pointer;opacity:.45;font-size:.9rem;padding:2px 4px">🗑</button></td>
    </tr>`;
  },

  async _checkAutoPresets() {
    const today   = new Date().toISOString().slice(0, 10);
    const presets = this._loadPresets();
    let changed   = false;
    for (let i = 0; i < presets.length; i++) {
      const p = presets[i];
      if (!p.auto || !p.frecuencia || !p.ultima_carga) continue;
      if (today < this._nextDue(p.ultima_carga, p.frecuencia)) continue;
      try {
        await dbInsert('ingresos', {
          fecha:       today,
          monto:       parseFloat(p.monto),
          moneda:      p.moneda || 'USD',
          descripcion: p.desc || null,
          tipo_id:     p.tipo ? parseInt(p.tipo) : null,
        });
        presets[i].ultima_carga = today;
        changed = true;
        toast(`⚡ Auto-ingreso: ${p.desc || 'Ingreso'} (${p.moneda || 'USD'} ${p.monto})`);
      } catch { /* silent */ }
    }
    if (changed) localStorage.setItem('ingresos_presets', JSON.stringify(presets));
  },

  _nextDue(lastDate, frecuencia) {
    const d = new Date(lastDate + 'T00:00:00');
    const months = { mensual: 1, bimensual: 2, semestral: 6, anual: 12 };
    d.setMonth(d.getMonth() + (months[frecuencia] || 1));
    return d.toISOString().slice(0, 10);
  },

  _loadPresets() {
    try {
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
