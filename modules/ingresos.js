window.Mods = window.Mods || {};
window.Mods.ingresos = {
  async render() {
    const c = document.getElementById('content');
    const [ingresos, tipos] = await Promise.all([
      dbFetch('ingresos',     { order: { col: 'fecha', asc: false }, limit: 50 }),
      dbFetch('tipos_ingreso', { filters: { activo: 1 }, order: { col: 'nombre', asc: true } }),
    ]);

    c.innerHTML = `
      <h1>Ingresos</h1>
      <p class="page-subtitle">Registro de entradas</p>

      <div class="form-card">
        <h3>Nuevo ingreso</h3>
        <form id="form-ingreso">
          <div class="form-grid">
            <div class="form-group">
              <label>Fecha</label>
              <input id="i-fecha" type="date" value="${new Date().toISOString().slice(0,10)}" required>
            </div>
            <div class="form-group">
              <label>Monto (USD)</label>
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
            <div class="form-group">
              <label>Usuario</label>
              <select id="i-usuario">
                <option value="compartido">Compartido</option>
                <option value="usuario1">Usuario 1</option>
                <option value="usuario2">Usuario 2</option>
              </select>
            </div>
          </div>
          <button type="submit" class="btn btn-primary">✚ Registrar ingreso</button>
        </form>
      </div>

      <div class="table-wrap">
        <div class="table-header"><span class="table-title">Últimos 50 ingresos</span></div>
        ${ingresos.length === 0 ? `
          <div class="empty"><div class="empty-icon">💵</div><div class="empty-text">Sin ingresos registrados</div></div>
        ` : `
          <table>
            <thead><tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Usuario</th><th>Monto</th></tr></thead>
            <tbody id="ing-tbody">
              ${ingresos.map(i => this._row(i, tipos)).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;

    document.getElementById('form-ingreso').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await dbInsert('ingresos', {
          fecha:       document.getElementById('i-fecha').value,
          monto:       parseFloat(document.getElementById('i-monto').value),
          descripcion: document.getElementById('i-desc').value.trim() || null,
          tipo_id:     document.getElementById('i-tipo').value ? parseInt(document.getElementById('i-tipo').value) : null,
          usuario:     document.getElementById('i-usuario').value,
        });
        toast('✅ Ingreso registrado');
        e.target.reset();
        document.getElementById('i-fecha').value = new Date().toISOString().slice(0,10);
        const rows = await dbFetch('ingresos', { order: { col: 'fecha', asc: false }, limit: 50 });
        const tbody = document.getElementById('ing-tbody');
        if (tbody) tbody.innerHTML = rows.map(i => this._row(i, tipos)).join('');
      } catch(err) { toast('❌ ' + err.message, 'err'); }
    });
  },

  _row(i, tipos) {
    const tipo = tipos.find(t => t.id === i.tipo_id);
    return `<tr>
      <td>${fmtDate(i.fecha)}</td>
      <td>${i.descripcion ?? '—'}</td>
      <td>${tipo ? tipo.nombre : '—'}</td>
      <td>${i.usuario}</td>
      <td><strong class="pos">${fmtUSD(i.monto)}</strong></td>
    </tr>`;
  },
};
