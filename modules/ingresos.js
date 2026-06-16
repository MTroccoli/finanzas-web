window.Mods = window.Mods || {};
window.Mods.ingresos = {
  _filterTipo:     '',
  _presetsEditIdx: null,
  _ingEditId:      null,
  _tipos:          [],
  _rows:           [],

  async render() {
    const c = document.getElementById('content');

    // Check auto-presets before rendering (silent, no await-blocking UI)
    this._checkAutoPresets().catch(() => {});

    const [ingresos, tipos, presets] = await Promise.all([
      dbFetch('ingresos',      { order: { col: 'fecha', asc: false }, limit: 200 }),
      dbFetch('tipos_ingreso', { filters: { activo: 1 }, order: { col: 'nombre', asc: true } }),
      this._loadPresets(),
    ]);
    this._tipos = tipos;
    this._rows  = ingresos;

    const today   = new Date().toISOString().slice(0,10);
    const inp = `font-size:.82rem;padding:7px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);width:100%;max-width:100%;box-sizing:border-box`;
    const lbl = `display:block;font-family:'DM Mono',monospace;font-size:.62rem;text-transform:uppercase;letter-spacing:.1em;color:var(--text-sec);margin-bottom:5px`;

    const fechaRowHTML = (val = today) =>
      `<div class="i-fecha-row" style="display:flex;gap:6px;align-items:center">
        <input class="i-fecha-item" type="date" value="${val}" required
          style="${inp};-webkit-appearance:none;appearance:none;width:auto">
        <button type="button" class="i-fecha-rm"
          style="background:none;border:none;color:var(--text-sec);cursor:pointer;font-size:.9rem;padding:0 6px;line-height:1">✕</button>
      </div>`;

    c.innerHTML = `
      <h1>Ingresos</h1>
      <p class="page-subtitle">Registro de entradas</p>

      <div class="form-card">
        <h3 style="margin-bottom:12px">Nuevo ingreso</h3>

        ${presets.length ? `
        <details id="presets-wrap" style="margin-bottom:14px" ${this._presetsEditIdx !== null ? 'open' : ''}>
          <summary style="cursor:pointer;font-size:.82rem;color:var(--accent);list-style:none;user-select:none">
            📂 Guardados (${presets.length})
          </summary>
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
            ${presets.map((p, i) => {
              if (this._presetsEditIdx === i) {
                return `<div style="padding:12px;border-radius:8px;background:var(--surface);border:1px solid var(--accent)">
                  <div style="display:grid;grid-template-columns:62px 1fr;gap:6px;margin-bottom:6px">
                    <div>
                      <span style="${lbl}">Moneda</span>
                      <select class="pe-moneda" style="${inp}">
                        <option value="UYU" ${(p.moneda||'UYU')==='UYU'?'selected':''}>UYU</option>
                        <option value="USD" ${p.moneda==='USD'?'selected':''}>USD</option>
                      </select>
                    </div>
                    <div>
                      <span style="${lbl}">Monto</span>
                      <input class="pe-monto" type="number" step="0.01" value="${p.monto||''}" style="${inp}">
                    </div>
                  </div>
                  <div style="margin-bottom:6px">
                    <span style="${lbl}">Descripción</span>
                    <input class="pe-desc" type="text" value="${p.desc||''}" style="${inp}">
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
                    <div>
                      <span style="${lbl}">Tipo</span>
                      <select class="pe-tipo" style="${inp}">
                        <option value="">Sin tipo</option>
                        ${tipos.map(t => `<option value="${t.id}" ${p.tipo==t.id?'selected':''}>${t.nombre}</option>`).join('')}
                      </select>
                    </div>
                    <div>
                      <span style="${lbl}">Frecuencia</span>
                      <select class="pe-freq" style="${inp}">
                        <option value="mensual" ${p.frecuencia==='mensual'?'selected':''}>Mensual</option>
                        <option value="trimestral" ${p.frecuencia==='trimestral'?'selected':''}>Trimestral</option>
                        <option value="semestral" ${p.frecuencia==='semestral'?'selected':''}>Semestral</option>
                        <option value="anual" ${p.frecuencia==='anual'?'selected':''}>Anual</option>
                      </select>
                    </div>
                  </div>
                  <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
                    <input type="checkbox" class="pe-auto" id="pe-auto-${i}" style="accent-color:var(--accent)" ${p.auto?'checked':''}>
                    <label for="pe-auto-${i}" style="font-size:.8rem;cursor:pointer">Auto-carga al vencer</label>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                    <button class="btn-pe-save btn btn-primary" data-idx="${i}" style="justify-content:center">✅ Guardar</button>
                    <button class="btn-pe-cancel btn btn-ghost" style="justify-content:center">✕ Cancelar</button>
                  </div>
                </div>`;
              }
              return `<div style="display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:6px;background:var(--surface);border:1px solid var(--border)">
                <div style="flex:1;min-width:0">
                  <div style="font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    ${p.desc || 'Sin nombre'} · <span style="color:var(--text-sec)">${p.moneda || 'UYU'} ${p.monto}</span>${p.frecuencia ? ` · <span style="color:var(--accent)">${p.frecuencia}</span>` : ''}${p.auto ? ` · <span style="color:#10b981">⚡auto</span>` : ''}
                  </div>
                  ${p.frecuencia && p.ultima_carga ? `<div style="font-size:.65rem;color:var(--text-sec);margin-top:2px">Próx: ${this._nextDue(p.ultima_carga, p.frecuencia)}</div>` : ''}
                </div>
                <button class="btn-edit-preset" data-idx="${i}" style="font-size:.72rem;padding:2px 8px;border-radius:10px;border:1px solid #a78bfa;background:rgba(167,139,250,.08);color:#a78bfa;cursor:pointer;white-space:nowrap;flex-shrink:0">✏️</button>
                <button class="btn-load-preset" data-idx="${i}" style="font-size:.72rem;padding:2px 8px;border-radius:10px;border:1px solid #3b82f6;background:rgba(59,130,246,.12);color:#3b82f6;cursor:pointer;white-space:nowrap;flex-shrink:0">⚡ Cargar</button>
                <button class="btn-del-preset" data-idx="${i}" style="font-size:.72rem;padding:2px 6px;border-radius:10px;border:1px solid var(--border);background:none;color:var(--text-sec);cursor:pointer;flex-shrink:0">✕</button>
              </div>`;
            }).join('')}
          </div>
        </details>` : ''}

        <form id="form-ingreso" style="display:flex;flex-direction:column;gap:10px">
          <!-- Fecha(s) -->
          <div>
            <span style="${lbl}">Fecha(s)</span>
            <div id="i-fechas-wrap" style="display:flex;flex-direction:column;gap:6px;margin-bottom:6px">
              ${fechaRowHTML()}
            </div>
            <button type="button" id="i-add-fecha" class="btn btn-ghost"
              style="font-size:.78rem;padding:4px 14px">＋ Agregar fecha</button>
          </div>

          <!-- Row 1: Moneda · Monto -->
          <div style="display:grid;grid-template-columns:62px 1fr;gap:8px">
            <div>
              <span style="${lbl}">Moneda</span>
              <select id="i-moneda" style="${inp}">
                <option value="UYU" selected>UYU</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <span id="i-monto-lbl" style="${lbl}">Monto (UYU)</span>
              <input id="i-monto" type="number" step="0.01" min="0.01" placeholder="0.00" style="${inp}" required>
            </div>
          </div>

          <!-- Row 2: Tipo · Descripción -->
          <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px">
            <div style="min-width:0">
              <span style="${lbl}">Tipo</span>
              <select id="i-tipo" style="${inp}">
                <option value="">Sin tipo</option>
                ${tipos.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('')}
              </select>
            </div>
            <div style="min-width:0">
              <span style="${lbl}">Descripción</span>
              <input id="i-desc" type="text" placeholder="Salario, freelance..." style="${inp}">
            </div>
          </div>

          <!-- Row 3: Botones -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <button type="submit" class="btn btn-primary" style="justify-content:center;width:100%">✚ Registrar</button>
            <button type="button" id="btn-save-preset" class="btn" style="justify-content:center;width:100%;border:1px solid #a78bfa;background:rgba(167,139,250,.08);color:#a78bfa">⚡ Recurrente</button>
          </div>

          <!-- Panel de frecuencia (oculto por defecto) -->
          <div id="preset-freq-panel" style="display:none;margin-top:12px;padding:12px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,.03)">
            <div style="font-size:.72rem;color:var(--text-sec);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Opciones de recurrencia</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
              <div class="form-group" style="flex:1;min-width:120px">
                <label>Frecuencia</label>
                <select id="preset-freq" style="${inp}">
                  <option value="mensual">Mensual</option>
                  <option value="trimestral">Trimestral (c/3 meses)</option>
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

    const _getFechas = () =>
      [...document.querySelectorAll('.i-fecha-item')].map(el => el.value).filter(Boolean);

    const _bindRemoveFecha = () => {
      document.querySelectorAll('.i-fecha-rm').forEach(btn => {
        btn.onclick = () => {
          if (document.querySelectorAll('.i-fecha-row').length <= 1) return;
          btn.closest('.i-fecha-row').remove();
        };
      });
    };
    _bindRemoveFecha();

    document.getElementById('i-add-fecha')?.addEventListener('click', () => {
      const wrap = document.getElementById('i-fechas-wrap');
      const div = document.createElement('div');
      div.innerHTML = fechaRowHTML();
      wrap.appendChild(div.firstElementChild);
      _bindRemoveFecha();
    });

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
      const fecha  = document.querySelector('.i-fecha-item')?.value || today;
      const moneda = document.getElementById('i-moneda').value;
      const desc   = document.getElementById('i-desc').value.trim();
      const tipo   = document.getElementById('i-tipo').value;
      const p = {
        monto, moneda, desc, tipo,
        frecuencia:   document.getElementById('preset-freq').value,
        auto:         document.getElementById('preset-auto').checked,
        ultima_carga: fecha,
      };
      const arr = await this._loadPresets();
      arr.unshift(p);
      await this._savePresets(arr);

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
      btn.addEventListener('click', async () => {
        const arr = await this._loadPresets();
        const p = arr[parseInt(btn.dataset.idx)];
        if (!p) return;
        if (p.monto)  document.getElementById('i-monto').value  = p.monto;
        if (p.moneda) { document.getElementById('i-moneda').value = p.moneda; document.getElementById('i-monto-lbl').textContent = `Monto (${p.moneda})`; }
        if (p.desc)   document.getElementById('i-desc').value   = p.desc;
        if (p.tipo)   document.getElementById('i-tipo').value   = p.tipo;
      })
    );

    // delete preset
    document.querySelectorAll('.btn-del-preset').forEach(btn =>
      btn.addEventListener('click', async () => {
        const arr = await this._loadPresets();
        arr.splice(parseInt(btn.dataset.idx), 1);
        await this._savePresets(arr);
        this._presetsEditIdx = null;
        this.render();
      })
    );

    // edit preset — open inline form
    document.querySelectorAll('.btn-edit-preset').forEach(btn =>
      btn.addEventListener('click', () => {
        this._presetsEditIdx = parseInt(btn.dataset.idx);
        this.render();
      })
    );

    // save preset edit
    document.querySelectorAll('.btn-pe-save').forEach(btn =>
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx);
        const card = btn.closest('div[style*="border:1px solid var(--accent)"]');
        const arr = await this._loadPresets();
        if (arr[idx]) {
          arr[idx] = {
            ...arr[idx],
            monto:      card.querySelector('.pe-monto').value,
            moneda:     card.querySelector('.pe-moneda').value,
            desc:       card.querySelector('.pe-desc').value.trim(),
            tipo:       card.querySelector('.pe-tipo').value,
            frecuencia: card.querySelector('.pe-freq').value,
            auto:       card.querySelector('.pe-auto').checked,
          };
          await this._savePresets(arr);
          toast('💾 Recurrente actualizado');
        }
        this._presetsEditIdx = null;
        this.render();
      })
    );

    // cancel preset edit
    document.querySelectorAll('.btn-pe-cancel').forEach(btn =>
      btn.addEventListener('click', () => {
        this._presetsEditIdx = null;
        this.render();
      })
    );

    // submit
    document.getElementById('form-ingreso').addEventListener('submit', async e => {
      e.preventDefault();
      const fechas = _getFechas();
      if (!fechas.length) { toast('Ingresá al menos una fecha', 'err'); return; }
      try {
        const monto       = parseFloat(document.getElementById('i-monto').value);
        const moneda      = document.getElementById('i-moneda').value;
        const descripcion = document.getElementById('i-desc').value.trim() || null;
        const tipo_id     = document.getElementById('i-tipo').value ? parseInt(document.getElementById('i-tipo').value) : null;
        const newRows = [];
        for (const fecha of fechas) {
          const row = await dbInsert('ingresos', { fecha, monto, moneda, descripcion, tipo_id });
          if (row) newRows.push(row);
        }
        toast(fechas.length > 1 ? `✅ ${fechas.length} ingresos registrados` : '✅ Ingreso registrado');
        e.target.reset();
        document.getElementById('i-fechas-wrap').innerHTML = fechaRowHTML();
        _bindRemoveFecha();
        document.getElementById('i-monto-lbl').textContent = 'Monto (UYU)';
        this._rows = [...newRows, ...this._rows].sort((a, b) => b.fecha.localeCompare(a.fecha));
        document.getElementById('ing-list').innerHTML = this._renderList(this._rows, tipos, this._filterTipo);
        this._bindDelete(tipos); this._bindEdit(tipos);
      } catch(err) { toast('❌ ' + err.message, 'err'); }
    });

    // tipo filter — instant, uses cached rows
    document.getElementById('ing-filter-tipo').addEventListener('change', e => {
      this._filterTipo = e.target.value;
      document.getElementById('ing-list').innerHTML = this._renderList(this._rows, tipos, this._filterTipo);
      this._bindDelete(tipos); this._bindEdit(tipos);
    });

    this._bindDelete(tipos);
    this._bindEdit(tipos);
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
          const id = parseInt(btn.dataset.id);
          await dbDelete('ingresos', { id });
          toast('🗑 Eliminado');
          this._rows = this._rows.filter(r => r.id !== id);
          document.getElementById('ing-list').innerHTML = this._renderList(this._rows, tipos, this._filterTipo);
          this._bindDelete(tipos); this._bindEdit(tipos);
        } catch(err) { toast('❌ ' + err.message, 'err'); }
      })
    );
  },

  _row(i, tipos) {
    if (this._ingEditId === i.id) {
      const inpS = 'font-size:.78rem;padding:4px 6px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);width:100%;box-sizing:border-box';
      return `<tr data-ing-edit="${i.id}">
        <td><input class="ie-fecha" type="date" value="${i.fecha}" style="${inpS};-webkit-appearance:none;appearance:none;width:100px"></td>
        <td><input class="ie-desc" type="text" value="${i.descripcion||''}" placeholder="Descripción" style="${inpS}"></td>
        <td><select class="ie-tipo" style="${inpS}">
          <option value="">—</option>
          ${tipos.map(t => `<option value="${t.id}" ${i.tipo_id===t.id?'selected':''}>${t.nombre}</option>`).join('')}
        </select></td>
        <td style="white-space:nowrap">
          <select class="ie-moneda" style="${inpS};width:56px;display:inline-block">
            <option value="UYU" ${i.moneda!=='USD'?'selected':''}>UYU</option>
            <option value="USD" ${i.moneda==='USD'?'selected':''}>USD</option>
          </select>
          <input class="ie-monto" type="number" step="0.01" value="${i.monto}" style="${inpS};width:80px;display:inline-block;margin-top:2px">
        </td>
        <td style="white-space:nowrap">
          <button class="ie-save" data-id="${i.id}" style="font-size:.72rem;padding:2px 7px;border-radius:4px;border:1px solid var(--accent);background:rgba(46,127,217,.1);color:var(--accent);cursor:pointer;margin-right:2px">✅</button>
          <button class="ie-cancel" style="font-size:.72rem;padding:2px 5px;border-radius:4px;border:none;background:none;color:var(--text-sec);cursor:pointer">✕</button>
        </td>
      </tr>`;
    }
    const tipo   = tipos.find(t => t.id === i.tipo_id);
    const moneda = i.moneda || 'USD';
    const monStr = moneda === 'USD' ? fmtUSD(i.monto) : `$U ${fmt(i.monto, 0)}`;
    return `<tr>
      <td style="white-space:nowrap">${fmtDate(i.fecha)}</td>
      <td>${i.descripcion ?? '—'}</td>
      <td style="white-space:nowrap">${tipo ? tipo.nombre : '—'}</td>
      <td style="white-space:nowrap"><strong class="pos">${monStr}</strong></td>
      <td style="white-space:nowrap">
        <button class="ing-edit" data-id="${i.id}" title="Editar" style="background:none;border:none;cursor:pointer;opacity:.45;font-size:.9rem;padding:2px 4px">✏️</button>
        <button class="ing-del" data-id="${i.id}" title="Eliminar" style="background:none;border:none;cursor:pointer;opacity:.45;font-size:.9rem;padding:2px 4px">🗑</button>
      </td>
    </tr>`;
  },

  _bindEdit(tipos) {
    document.querySelectorAll('.ing-edit').forEach(btn =>
      btn.addEventListener('click', () => {
        this._ingEditId = parseInt(btn.dataset.id);
        document.getElementById('ing-list').innerHTML = this._renderList(this._rows, tipos, this._filterTipo);
        this._bindDelete(tipos);
        this._bindEdit(tipos);
      })
    );
    document.querySelectorAll('.ie-save').forEach(btn =>
      btn.addEventListener('click', async () => {
        const id  = parseInt(btn.dataset.id);
        const row = btn.closest('tr[data-ing-edit]');
        try {
          const updated = {
            fecha:       row.querySelector('.ie-fecha').value,
            monto:       parseFloat(row.querySelector('.ie-monto').value),
            moneda:      row.querySelector('.ie-moneda').value,
            descripcion: row.querySelector('.ie-desc').value.trim() || null,
            tipo_id:     row.querySelector('.ie-tipo').value ? parseInt(row.querySelector('.ie-tipo').value) : null,
          };
          await dbUpdate('ingresos', updated, { id });
          toast('✅ Ingreso actualizado');
          this._ingEditId = null;
          const idx = this._rows.findIndex(r => r.id === id);
          if (idx >= 0) this._rows[idx] = { ...this._rows[idx], ...updated };
          document.getElementById('ing-list').innerHTML = this._renderList(this._rows, tipos, this._filterTipo);
          this._bindDelete(tipos);
          this._bindEdit(tipos);
        } catch(err) { toast('❌ ' + err.message, 'err'); }
      })
    );
    document.querySelectorAll('.ie-cancel').forEach(btn =>
      btn.addEventListener('click', () => {
        this._ingEditId = null;
        document.getElementById('ing-list').innerHTML = this._renderList(this._rows, tipos, this._filterTipo);
        this._bindDelete(tipos);
        this._bindEdit(tipos);
      })
    );
  },

  async _checkAutoPresets() {
    const today   = new Date().toISOString().slice(0, 10);
    const presets = await this._loadPresets();
    let changed   = false;
    for (let i = 0; i < presets.length; i++) {
      const p = presets[i];
      if (!p.auto || !p.frecuencia || !p.ultima_carga) continue;
      if (today < this._nextDue(p.ultima_carga, p.frecuencia)) continue;
      try {
        await dbInsert('ingresos', {
          fecha:       today,
          monto:       parseFloat(p.monto),
          moneda:      p.moneda || 'UYU',
          descripcion: p.desc || null,
          tipo_id:     p.tipo ? parseInt(p.tipo) : null,
        });
        presets[i].ultima_carga = today;
        changed = true;
        toast(`⚡ Auto-ingreso: ${p.desc || 'Ingreso'} (${p.moneda || 'UYU'} ${p.monto})`);
      } catch { /* silent */ }
    }
    if (changed) await this._savePresets(presets);
  },

  _nextDue(lastDate, frecuencia) {
    const d = new Date(lastDate + 'T00:00:00');
    const months = { mensual: 1, bimensual: 2, trimestral: 3, semestral: 6, anual: 12 };
    d.setMonth(d.getMonth() + (months[frecuencia] || 1));
    return d.toISOString().slice(0, 10);
  },

  async _loadPresets() {
    try {
      // Migrate from localStorage on first run
      const lsRaw = localStorage.getItem('ingresos_presets') || localStorage.getItem('ingreso_preset');
      if (lsRaw) {
        let arr;
        try { const p = JSON.parse(lsRaw); arr = Array.isArray(p) ? p : [p]; }
        catch { arr = []; }
        localStorage.removeItem('ingresos_presets');
        localStorage.removeItem('ingreso_preset');
        if (arr.length) await setConfig('ingresos_presets', JSON.stringify(arr));
        return arr;
      }
      const val = await getConfig('ingresos_presets');
      return JSON.parse(val || '[]');
    } catch { return []; }
  },

  async _savePresets(arr) {
    if (arr.length > 10) arr.length = 10;
    await setConfig('ingresos_presets', JSON.stringify(arr));
  },
};
