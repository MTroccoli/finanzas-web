window.Mods = window.Mods || {};
window.Mods.configuracion = {
  async render() {
    const c = document.getElementById('content');
    const { data: { user } } = await getDB().auth.getUser();
    const bench = await getConfig('benchmark_ticker');

    c.innerHTML = `
      <h1>Configuración</h1>
      <p class="page-subtitle">Ajustes generales de la app</p>

      <div class="form-card">
        <h3>Cuenta</h3>
        <div class="form-group" style="margin-bottom:14px">
          <label>Email</label>
          <div style="font-family:'DM Mono',monospace;font-size:.85rem;color:var(--text);
            padding:10px 14px;background:var(--bg);border:1px solid var(--border);
            border-radius:8px">${user?.email ?? '—'}</div>
        </div>
        <button id="btn-signout-cfg" class="btn btn-ghost" style="color:var(--red,#f87171);border-color:rgba(248,113,113,.3)">
          Cerrar sesión
        </button>
        <hr style="margin:20px 0">
        <h3>Inversiones</h3>
        <div class="form-grid">
          <div class="form-group">
            <label>Benchmark (ticker)</label>
            <input id="cfg-bench" type="text" value="${bench ?? 'SPY'}" placeholder="SPY" style="text-transform:uppercase">
          </div>
        </div>
        <button id="btn-save-cfg" class="btn btn-primary">Guardar configuración</button>
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

    document.getElementById('btn-signout-cfg').addEventListener('click', () => window.Auth.signOut());

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
        await setConfig('benchmark_ticker', document.getElementById('cfg-bench').value.trim().toUpperCase());
        const msg = document.getElementById('cfg-msg');
        msg.style.display = 'inline';
        setTimeout(() => { msg.style.display = 'none'; }, 2500);
      } catch(err) { toast('❌ ' + err.message, 'err'); }
    });
  },
};
