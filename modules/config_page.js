window.Mods = window.Mods || {};
window.Mods.configuracion = {
  async render() {
    const c = document.getElementById('content');
    const [{ data: { user } }, bench, monedaVista, gastosTc, adminStats] = await Promise.all([
      getDB().auth.getUser(),
      getConfig('benchmark_ticker'),
      getConfig('moneda_vista').catch(() => null),
      getConfig('gastos_tc').catch(() => ''),
      // Solo devuelve datos para el admin; para el resto falla silenciosamente
      getDB().rpc('admin_stats').then(r => (r.error ? null : r.data)).catch(() => null),
    ]);
    const mv = monedaVista || 'ORIGEN';

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
        <hr style="margin:20px 0">
        <h3>Visualización de importes</h3>
        <div class="form-grid" style="margin-bottom:14px">
          <div class="form-group">
            <label>Modo de visualización</label>
            <select id="cfg-moneda-vista">
              <option value="ORIGEN" ${mv==='ORIGEN'?'selected':''}>Moneda Origen</option>
              <option value="UYU"    ${mv==='UYU'?'selected':''}>Todo UYU</option>
              <option value="USD"    ${mv==='USD'?'selected':''}>Todo USD</option>
            </select>
          </div>
          <div class="form-group" id="cfg-tc-wrap" style="display:${mv!=='ORIGEN'?'':'none'}">
            <label>Tipo de Cambio UYU/USD</label>
            <input id="cfg-tc" type="number" min="1" step="0.1"
              value="${gastosTc}" placeholder="43.5">
          </div>
        </div>
        <button id="btn-save-cfg" class="btn btn-primary">Guardar configuración</button>
        <span id="cfg-msg" style="margin-left:12px;font-family:'DM Mono',monospace;font-size:.72rem;color:var(--green);display:none">✅ Guardado</span>
      </div>

      <div class="form-card">
        <h3>Apariencia</h3>
        <p style="font-size:.82rem;color:var(--text-sec);margin:0 0 14px">Elegí el tema de la app.</p>
        <div style="display:flex;gap:10px">
          ${[['dark', '🌙 Oscuro'], ['light', '☀️ Claro']].map(([val, lbl]) => `
            <button class="cfg-theme-btn" data-theme-val="${val}" style="flex:1;padding:12px;border-radius:10px;cursor:pointer;
              font-size:.85rem;font-weight:600;
              border:1px solid ${(window.APP_THEME || 'dark') === val ? 'var(--accent)' : 'var(--border)'};
              background:${(window.APP_THEME || 'dark') === val ? 'rgba(62,112,152,.14)' : 'transparent'};
              color:${(window.APP_THEME || 'dark') === val ? 'var(--accent)' : 'var(--text)'}">${lbl}</button>
          `).join('')}
        </div>
      </div>

      <div class="form-card">
        <h3>Presentación y módulos</h3>
        <p style="font-size:.82rem;color:var(--text-sec);margin:0 0 14px">
          Elegí qué módulos ver en el menú. Los que desmarques se ocultan (podés volver a activarlos acá cuando quieras).
        </p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
          ${(window.Mods.onboarding?.MODULES || []).map(m => {
            const on = !window.APP_MODULES || window.APP_MODULES.has(m.key);
            return `
            <label style="display:flex;align-items:center;gap:11px;cursor:pointer;padding:8px 10px;
              border:1px solid var(--border);border-radius:9px;background:var(--bg)">
              <input type="checkbox" class="cfg-mod" data-key="${m.key}" ${on ? 'checked' : ''}
                style="width:17px;height:17px;accent-color:var(--accent);flex-shrink:0">
              <span style="color:var(--accent);display:flex;flex-shrink:0">${window.Mods.onboarding._icon(m.key, 20)}</span>
              <span style="flex:1;font-size:.88rem;color:var(--text)">${m.name}</span>
            </label>`;
          }).join('')}
        </div>
        <button id="btn-save-mods" class="btn btn-primary">Guardar módulos</button>
        <span id="mods-msg" style="margin-left:12px;font-family:'DM Mono',monospace;font-size:.72rem;color:var(--green);display:none">✅ Guardado</span>
        <hr style="margin:20px 0">
        <button id="btn-redo-onb" class="btn btn-ghost">Rehacer presentación de bienvenida</button>
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

      ${adminStats ? (() => {
        const thA = 'padding:6px 8px;font-size:.62rem;color:var(--text-sec);text-transform:uppercase;letter-spacing:.08em;font-weight:600;border-bottom:1px solid var(--border);text-align:left;white-space:nowrap';
        const tdA = 'padding:7px 8px;font-size:.78rem;border-bottom:1px solid var(--border)';
        const num = 'font-family:\'DM Mono\',monospace;text-align:right';
        const fmtLogin = ts => {
          if (!ts) return '—';
          const d = new Date(ts);
          return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        };
        const modBadges = m => m === null
          ? '<span style="color:var(--text-sec)">todos</span>'
          : (m || '').split(',').filter(Boolean).map(k =>
              `<span style="font-size:.6rem;padding:1px 6px;border-radius:4px;background:rgba(62,112,152,.12);color:var(--accent);font-weight:600;margin-right:3px;white-space:nowrap">${k}</span>`).join('') || '<span style="color:var(--text-sec)">ninguno</span>';
        return `
      <div class="form-card">
        <h3>👑 Administración — uso por usuario</h3>
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:16px">
          <table style="width:100%;min-width:680px;border-collapse:collapse">
            <thead><tr>
              <th style="${thA}">Usuario</th><th style="${thA}">Alta</th><th style="${thA}">Últ. login</th>
              <th style="${thA}">Módulos</th>
              <th style="${thA};text-align:right">Gastos</th><th style="${thA};text-align:right">Ingr.</th>
              <th style="${thA};text-align:right">Oper.</th><th style="${thA};text-align:right">Tarj.</th>
              <th style="${thA};text-align:right">EDCs</th>
            </tr></thead>
            <tbody>
              ${(adminStats.usuarios || []).map(u => `
                <tr>
                  <td style="${tdA}"><div style="font-weight:600">${u.nombre || '—'}</div>
                    <div style="font-size:.66rem;color:var(--text-sec)">${u.email}</div></td>
                  <td style="${tdA};white-space:nowrap">${fmtDate(u.alta)}</td>
                  <td style="${tdA};white-space:nowrap;font-family:'DM Mono',monospace;font-size:.72rem">${fmtLogin(u.ultimo_login)}</td>
                  <td style="${tdA}">${modBadges(u.modulos)}${u.onboarding !== 'true' ? ' <span style="font-size:.6rem;color:var(--gold)">sin onboarding</span>' : ''}</td>
                  <td style="${tdA};${num}">${u.gastos}</td>
                  <td style="${tdA};${num}">${u.ingresos}</td>
                  <td style="${tdA};${num}">${u.operaciones}</td>
                  <td style="${tdA};${num}">${u.tarjetas}</td>
                  <td style="${tdA};${num};font-weight:700">${u.edcs}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <h3 style="margin-top:4px">EDCs importados por mes</h3>
        ${(adminStats.edc_por_mes || []).length ? `
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
          <table style="width:100%;min-width:320px;border-collapse:collapse;max-width:480px">
            <thead><tr>
              <th style="${thA}">Mes</th><th style="${thA}">Usuario</th>
              <th style="${thA};text-align:right">EDCs</th>
            </tr></thead>
            <tbody>
              ${adminStats.edc_por_mes.map(r => `
                <tr>
                  <td style="${tdA};font-family:'DM Mono',monospace">${r.mes}</td>
                  <td style="${tdA}">${r.email}</td>
                  <td style="${tdA};${num};font-weight:700">${r.edcs}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<p style="font-size:.8rem;color:var(--text-sec);margin:0">Sin importaciones todavía.</p>'}
      </div>`;
      })() : ''}

      <div class="form-card" style="border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.04)">
        <h3 style="color:var(--red)">⚠️ Zona de peligro</h3>
        <p style="font-size:.82rem;color:var(--text-sec);margin:0 0 14px">
          Elimina todos los gastos importados de EDC y sus registros de importación.
          Los PDFs quedan en storage y se pueden recuperar, pero los ajustes manuales se pierden.
          No se puede deshacer.
        </p>
        <button id="btn-del-all-imp" class="btn btn-ghost" style="color:var(--red);border-color:rgba(239,68,68,.45)">
          🗑 Eliminar todos los gastos importados
        </button>
      </div>
    `;

    document.getElementById('btn-signout-cfg').addEventListener('click', () => window.Auth.signOut());

    document.getElementById('btn-save-mods')?.addEventListener('click', async () => {
      const keys = [...document.querySelectorAll('.cfg-mod:checked')].map(c => c.dataset.key);
      if (!keys.length) { toast('Elegí al menos un módulo', 'err'); return; }
      try {
        await setConfig('modules_enabled', keys.join(','));
        window.APP_MODULES = new Set(keys);
        if (typeof applyModuleVisibility === 'function') applyModuleVisibility();
        const msg = document.getElementById('mods-msg');
        msg.style.display = 'inline';
        setTimeout(() => { msg.style.display = 'none'; }, 2500);
      } catch (err) { toast('❌ ' + err.message, 'err'); }
    });

    document.getElementById('btn-redo-onb')?.addEventListener('click', () => {
      window.Mods.onboarding?.start();
    });

    document.querySelectorAll('.cfg-theme-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const val = btn.dataset.themeVal;
        if (typeof applyTheme === 'function') applyTheme(val);
        try { await setConfig('tema', val); } catch (_) {}
        this.render();   // refresca el estado visual de los botones
      });
    });

    document.getElementById('cfg-moneda-vista').addEventListener('change', e => {
      const wrap = document.getElementById('cfg-tc-wrap');
      wrap.style.display = e.target.value !== 'ORIGEN' ? '' : 'none';
    });

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
        const monedaVal = document.getElementById('cfg-moneda-vista').value;
        const tcVal = document.getElementById('cfg-tc')?.value.trim() || '';
        await Promise.all([
          setConfig('benchmark_ticker', document.getElementById('cfg-bench').value.trim().toUpperCase()),
          setConfig('moneda_vista', monedaVal),
          tcVal ? setConfig('gastos_tc', tcVal) : Promise.resolve(),
        ]);
        const msg = document.getElementById('cfg-msg');
        msg.style.display = 'inline';
        setTimeout(() => { msg.style.display = 'none'; }, 2500);
      } catch(err) { toast('❌ ' + err.message, 'err'); }
    });

    document.getElementById('btn-del-all-imp').addEventListener('click', async () => {
      const btn = document.getElementById('btn-del-all-imp');
      const { data: impsData } = await getDB().from('importaciones').select('id');
      const ids = (impsData || []).map(i => i.id);
      if (!ids.length) { toast('No hay importaciones para eliminar'); return; }
      const { count } = await getDB().from('gastos').select('id', { count: 'exact', head: true }).not('importacion_id', 'is', null);
      const ok = confirm(
        `⚠️ ELIMINAR TODOS LOS GASTOS IMPORTADOS\n\n` +
        `Se van a borrar ${count || '?'} gastos de ${ids.length} importaciones.\n\n` +
        `Los PDFs quedan en storage y se pueden recuperar, ` +
        `pero los ajustes manuales (nombres, divisiones, etc.) no.\n\n` +
        `¿Confirmás?`
      );
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = 'Eliminando…';
      try {
        await getDB().from('gastos').delete().not('importacion_id', 'is', null);
        await getDB().from('importaciones').delete().gt('id', 0);
        toast('✅ Todos los gastos importados eliminados');
      } catch(err) { toast('❌ ' + err.message, 'err'); }
      btn.disabled = false;
      btn.textContent = '🗑 Eliminar todos los gastos importados';
    });
  },
};
