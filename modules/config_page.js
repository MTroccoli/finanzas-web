window.Mods = window.Mods || {};
window.Mods.configuracion = {
  async render() {
    const c = document.getElementById('content');
    const [u1, u2, bench] = await Promise.all([
      getConfig('nombre_usuario_1'),
      getConfig('nombre_usuario_2'),
      getConfig('benchmark_ticker'),
    ]);

    c.innerHTML = `
      <h1>Configuración</h1>
      <p class="page-subtitle">Ajustes generales de la app</p>

      <div class="form-card">
        <h3>Usuarios</h3>
        <div class="form-grid">
          <div class="form-group">
            <label>Nombre usuario 1</label>
            <input id="cfg-u1" type="text" value="${u1 ?? ''}" placeholder="Usuario 1">
          </div>
          <div class="form-group">
            <label>Nombre usuario 2</label>
            <input id="cfg-u2" type="text" value="${u2 ?? ''}" placeholder="Usuario 2">
          </div>
        </div>
        <hr>
        <h3>Inversiones</h3>
        <div class="form-grid">
          <div class="form-group">
            <label>Benchmark (ticker)</label>
            <input id="cfg-bench" type="text" value="${bench ?? 'SPY'}" placeholder="SPY" style="text-transform:uppercase">
          </div>
        </div>
        <button id="btn-save-cfg" class="btn btn-primary">💾 Guardar configuración</button>
        <span id="cfg-msg" style="margin-left:12px;font-family:'DM Mono',monospace;font-size:.72rem;color:var(--green);display:none">✅ Guardado</span>
      </div>
    `;

    document.getElementById('btn-save-cfg').addEventListener('click', async () => {
      try {
        await Promise.all([
          setConfig('nombre_usuario_1', document.getElementById('cfg-u1').value.trim()),
          setConfig('nombre_usuario_2', document.getElementById('cfg-u2').value.trim()),
          setConfig('benchmark_ticker', document.getElementById('cfg-bench').value.trim().toUpperCase()),
        ]);
        const msg = document.getElementById('cfg-msg');
        msg.style.display = 'inline';
        setTimeout(() => { msg.style.display = 'none'; }, 2500);
      } catch(err) { toast('❌ ' + err.message, 'err'); }
    });
  },
};
