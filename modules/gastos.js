window.Mods = window.Mods || {};
window.Mods.gastos = {

  async render() {
    const c = document.getElementById('content');
    const [gastos, categorias] = await Promise.all([
      dbFetch('gastos', { order: { col: 'fecha', asc: false }, limit: 50 }),
      dbFetch('categorias_gastos', { filters: { activo: 1 }, order: { col: 'nombre', asc: true } }),
    ]);

    c.innerHTML = `
      <h1>Gastos</h1>
      <p class="page-subtitle">Control de egresos</p>

      <div class="form-card">
        <h3>Nuevo gasto</h3>
        <form id="form-gasto">
          <div class="form-grid">
            <div class="form-group">
              <label>Fecha</label>
              <input id="g-fecha" type="date" value="${new Date().toISOString().slice(0,10)}" required>
            </div>
            <div class="form-group">
              <label>Monto (USD)</label>
              <input id="g-monto" type="number" step="0.01" min="0.01" placeholder="50.00" required>
            </div>
            <div class="form-group">
              <label>Comercio / descripción</label>
              <input id="g-comercio" type="text" placeholder="Supermercado...">
            </div>
            <div class="form-group">
              <label>Categoría</label>
              <select id="g-categoria">
                <option value="">Sin categoría</option>
                ${categorias.map(cat => `<option value="${cat.id}">${cat.icono ?? ''} ${cat.nombre}</option>`).join('')}
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
          <div class="form-group" style="margin-bottom:16px">
            <label>Notas (opcional)</label>
            <input id="g-notas" type="text" placeholder="Detalle adicional...">
          </div>
          <button type="submit" class="btn btn-primary">✚ Registrar gasto</button>
        </form>
      </div>

      <div class="table-wrap">
        <div class="table-header"><span class="table-title">Últimos 50 gastos</span></div>
        ${gastos.length === 0 ? `
          <div class="empty">
            <div class="empty-icon">💸</div>
            <div class="empty-text">Sin gastos registrados</div>
          </div>
        ` : `
          <table>
            <thead>
              <tr><th>Fecha</th><th>Comercio</th><th>Categoría</th><th>Usuario</th><th>Monto</th></tr>
            </thead>
            <tbody id="gastos-tbody">
              ${gastos.map(g => this._row(g, categorias)).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;

    document.getElementById('form-gasto').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fecha      = document.getElementById('g-fecha').value;
      const monto      = parseFloat(document.getElementById('g-monto').value);
      const comercio   = document.getElementById('g-comercio').value.trim();
      const catId      = document.getElementById('g-categoria').value;
      const usuario    = document.getElementById('g-usuario').value;
      const notas      = document.getElementById('g-notas').value.trim();

      try {
        await dbInsert('gastos', {
          fecha, monto, comercio: comercio || null,
          categoria_id: catId ? parseInt(catId) : null,
          usuario, notas: notas || null,
        });
        toast('✅ Gasto registrado');
        e.target.reset();
        document.getElementById('g-fecha').value = new Date().toISOString().slice(0,10);

        const newGastos = await dbFetch('gastos', { order: { col: 'fecha', asc: false }, limit: 50 });
        const tbody = document.getElementById('gastos-tbody');
        if (tbody) tbody.innerHTML = newGastos.map(g => this._row(g, categorias)).join('');
      } catch(err) {
        toast('❌ ' + err.message, 'err');
      }
    });
  },

  _row(g, categorias) {
    const cat = categorias.find(c => c.id === g.categoria_id);
    return `
      <tr>
        <td>${fmtDate(g.fecha)}</td>
        <td>${g.comercio ?? '—'}</td>
        <td>${cat ? `${cat.icono ?? ''} ${cat.nombre}` : '—'}</td>
        <td>${g.usuario}</td>
        <td><strong>${fmtUSD(g.monto)}</strong></td>
      </tr>
    `;
  },
};
