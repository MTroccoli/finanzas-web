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

      <div class="form-card">
        <h3>Mantenimiento de datos</h3>
        <p style="font-size:.82rem;color:var(--text-sec);margin:0 0 14px">
          Corrige el <strong>tipo de cambio histórico</strong> de todas las operaciones en moneda
          distinta de USD usando el TC de cierre de cada fecha según Yahoo Finance.
          Recalcula precio_unitario, comisión y monto en USD. Ejecutar una sola vez.
        </p>
        <button id="btn-migrate-tc" class="btn btn-primary">Recalcular tipos de cambio históricos</button>
        <div id="migrate-log" style="margin-top:10px;font-family:'DM Mono',monospace;font-size:.72rem;
          color:var(--text-sec);min-height:20px;white-space:pre-wrap"></div>
      </div>
    `;

    document.getElementById('btn-migrate-tc').addEventListener('click', async () => {
      const btn = document.getElementById('btn-migrate-tc');
      const log = document.getElementById('migrate-log');
      btn.disabled = true;
      btn.textContent = 'Procesando…';
      log.textContent = '';
      try {
        const updated = await Mods.inversiones._migrateHistoricalTCs((done, total, ticker, fecha, tc) => {
          log.textContent = `[${done}/${total}] ${ticker} ${fecha} → TC ${tc ? tc.toFixed(4) : 'no encontrado'}`;
        });
        log.textContent = `✅ ${updated} operacion${updated !== 1 ? 'es' : ''} actualizadas con TC histórico correcto.`;
      } catch(e) {
        log.textContent = `❌ Error: ${e.message}`;
      }
      btn.disabled = false;
      btn.textContent = 'Recalcular tipos de cambio históricos';
    });

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
