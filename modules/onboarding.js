window.Mods = window.Mods || {};
window.Mods.onboarding = {
  _step:       1,
  _nombre:     '',
  _modules:    null,   // Set de keys habilitadas
  _guideQueue: [],     // keys de módulos a recorrer en la carga guiada
  _guideIdx:   0,

  MODULES: [
    { key: 'dashboard',   name: 'Análisis',    desc: 'Tu tablero general: ingresos vs. gastos, balance, ahorro y proyección a 3 meses. Se arma solo con lo que cargás.', route: '#dashboard' },
    { key: 'inversiones', name: 'Inversiones', desc: 'Tu portafolio de acciones y ETFs, mercado, operaciones y rentabilidad', route: '#inversiones/portafolio' },
    { key: 'gastos',      name: 'Gastos',      desc: 'Registrá o importá tus gastos, con resúmenes, categorías y cuotas',     route: '#gastos/resumen' },
    { key: 'tarjetas',    name: 'Tarjetas',    desc: 'Descuentos bancarios y análisis de los beneficios de tus tarjetas',     route: '#tarjetas/descuentos' },
    { key: 'ingresos',    name: 'Ingresos',    desc: 'Registro de ingresos y recurrentes que se cargan automáticamente',      route: '#ingresos' },
  ],

  // Frases cortas para la bienvenida (paso 1)
  WELCOME: {
    inversiones: 'seguí tu portafolio y su rentabilidad',
    gastos:      'importá y ordená todos tus gastos',
    tarjetas:    'aprovechá los descuentos de tus tarjetas',
    ingresos:    'registrá lo que entra, con recurrentes automáticos',
    dashboard:   'el resumen que se arma solo con tus datos',
  },

  // Pantallas de carga de datos por módulo (para la carga guiada)
  GUIDE: {
    tarjetas:    { route: '#tarjetas/mis-tarjetas',  title: 'Cargá tus tarjetas',    instr: 'Agregá las tarjetas que tenés (banco, red y nivel) para ver tus descuentos y beneficios.' },
    ingresos:    { route: '#ingresos',               title: 'Registrá tus ingresos', instr: 'Cargá tus ingresos. Si son mensuales, marcalos como recurrentes y se cargan solos.' },
    inversiones: { route: '#inversiones/operaciones', title: 'Cargá una compra',     instr: 'Registrá tu primera compra de una acción o ETF con "+ Nueva operación".' },
    gastos:      { route: '#gastos/importar',        title: 'Importá tus gastos',    instr: 'Importá el PDF de un estado de cuenta. Tené los EDC a mano — cargar unos meses puede llevarte ~10 minutos.' },
  },
  GUIDE_ORDER: ['tarjetas', 'ingresos', 'inversiones', 'gastos'],

  // Mismos íconos que el menú lateral (index.html)
  ICONS: {
    dashboard:   '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    inversiones: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    gastos:      '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    tarjetas:    '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    ingresos:    '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  },

  _icon(key, size = 24) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${this.ICONS[key] || ''}</svg>`;
  },

  start() {
    this._step = 1;
    this._nombre = window.Auth?._nombre || '';
    this._modules = window.APP_MODULES
      ? new Set(window.APP_MODULES)
      : new Set(this.MODULES.map(m => m.key));
    let el = document.getElementById('onboarding-screen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'onboarding-screen';
      el.style.cssText = 'position:fixed;inset:0;z-index:2000;background:var(--bg);' +
        'display:flex;align-items:center;justify-content:center;padding:24px 20px;overflow-y:auto';
      document.body.appendChild(el);
    }
    this._render();
  },

  _render() {
    const el = document.getElementById('onboarding-screen');
    if (!el) return;
    el.innerHTML = this._step === 1 ? this._step1()
                 : this._step === 2 ? this._step2()
                 : this._step3();
    this._bind();
  },

  _dots() {
    return `<div style="display:flex;gap:7px;justify-content:center;margin-top:26px">
      ${[1,2,3].map(n => `<span style="width:8px;height:8px;border-radius:50%;
        background:${n === this._step ? 'var(--accent)' : 'var(--border-strong)'}"></span>`).join('')}
    </div>`;
  },

  _step1() {
    const n = (this._nombre || '').replace(/"/g, '&quot;');
    const rows = ['inversiones', 'gastos', 'tarjetas', 'ingresos', 'dashboard'].map(k => `
      <div style="display:flex;align-items:center;gap:11px;padding:5px 0">
        <span style="flex-shrink:0;color:var(--accent);display:flex">${this._icon(k, 20)}</span>
        <span style="font-size:.83rem;color:var(--text-sec);line-height:1.35">
          <strong style="color:var(--text)">${this.MODULES.find(m => m.key === k).name}</strong> — ${this.WELCOME[k]}</span>
      </div>`).join('');
    return `
      <div style="max-width:460px;width:100%;text-align:center">
        <h1 style="font-family:'Bebas Neue',sans-serif;font-size:2.4rem;letter-spacing:.06em;margin:0 0 8px">
          Bienvenido a FinPro</h1>
        <p style="color:var(--text-sec);font-size:.92rem;line-height:1.5;margin:0 auto 18px;max-width:380px">
          Tu centro financiero personal, todo en un lugar. Con FinPro podés:</p>
        <div style="text-align:left;max-width:360px;margin:0 auto 22px">${rows}</div>
        <p style="color:var(--text);font-size:.95rem;margin:0 0 8px">¿Cómo te llamás?</p>
        <input id="ob-nombre" type="text" maxlength="40" value="${n}" placeholder="Tu nombre"
          style="width:100%;max-width:280px;padding:12px 14px;background:var(--surface);
          border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:1rem;text-align:center">
        <div style="display:flex;flex-direction:column;gap:10px;max-width:280px;margin:22px auto 0">
          <button id="ob-next1" class="btn btn-primary" style="padding:12px">Continuar</button>
          <button id="ob-skip1" class="btn btn-ghost" style="padding:9px;font-size:.82rem">Omitir</button>
        </div>
        ${this._dots()}
      </div>`;
  },

  _step2() {
    const hola = this._nombre ? `Hola, ${this._nombre}` : 'Hola';
    return `
      <div style="max-width:520px;width:100%">
        <h1 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;letter-spacing:.06em;margin:0 0 4px;text-align:center">
          ${hola}</h1>
        <p style="color:var(--text-sec);font-size:.9rem;line-height:1.5;text-align:center;margin:0 0 20px">
          Elegí qué módulos querés usar. Vas a poder cambiarlos cuando quieras desde Configuración.</p>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${this.MODULES.map(m => {
            const on = this._modules.has(m.key);
            return `
            <div class="ob-mod" data-key="${m.key}" style="display:flex;align-items:center;gap:14px;
              padding:13px 15px;border-radius:12px;cursor:pointer;user-select:none;
              border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};
              background:${on ? 'rgba(46,142,200,.10)' : 'var(--surface)'};transition:.12s">
              <div style="flex-shrink:0;color:${on ? 'var(--accent)' : 'var(--text-sec)'};display:flex">${this._icon(m.key, 24)}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:.92rem;font-weight:600;color:var(--text)">${m.name}</div>
                <div style="font-size:.76rem;color:var(--text-sec);line-height:1.35;margin-top:2px">${m.desc}</div>
              </div>
              <div style="width:22px;height:22px;border-radius:6px;flex-shrink:0;display:flex;align-items:center;
                justify-content:center;font-size:.8rem;font-weight:700;
                border:1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'};
                background:${on ? 'var(--accent)' : 'transparent'};color:#fff">${on ? '✓' : ''}</div>
            </div>`;
          }).join('')}
        </div>
        <div style="display:flex;gap:10px;margin-top:22px">
          <button id="ob-back2" class="btn btn-ghost" style="padding:11px;flex:0 0 auto">Atrás</button>
          <button id="ob-next2" class="btn btn-primary" style="padding:11px;flex:1"
            ${this._modules.size ? '' : 'disabled'}>Continuar</button>
        </div>
        ${this._dots()}
      </div>`;
  },

  _step3() {
    const q = this._nombre ? `Carguemos tus datos, ${this._nombre}` : 'Carguemos tus datos';
    // Módulos con pantalla de carga que el usuario habilitó, en el orden de la guía
    const steps = this.GUIDE_ORDER.filter(k => this._modules.has(k));
    if (!steps.length) {
      // Solo habilitó Análisis (u otros sin carga): entrar directo
      return `
        <div style="max-width:440px;width:100%;text-align:center">
          <h1 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;letter-spacing:.06em;margin:0 0 6px">
            Todo listo</h1>
          <p style="color:var(--text-sec);font-size:.9rem;margin:0 0 22px">Ya podés empezar a usar FinPro.</p>
          <div style="max-width:300px;margin:0 auto">
            <button id="ob-enter" class="btn btn-primary" style="padding:12px;width:100%">Entrar a la app</button>
          </div>
          ${this._dots()}
        </div>`;
    }
    return `
      <div style="max-width:480px;width:100%">
        <h1 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;letter-spacing:.06em;margin:0 0 4px;text-align:center">
          ${q}</h1>
        <p style="color:var(--text-sec);font-size:.9rem;text-align:center;margin:0 0 20px">
          Te vamos a llevar a cada pantalla para cargar tus datos, paso a paso. Podés saltar la guía cuando quieras.</p>
        <div style="display:flex;flex-direction:column;gap:9px">
          ${steps.map((k, i) => {
            const g = this.GUIDE[k];
            return `
            <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:12px;
              border:1px solid var(--border);background:var(--surface)">
              <span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:rgba(46,142,200,.15);
                color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;margin-top:1px">${i + 1}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:.9rem;font-weight:600;color:var(--text);display:flex;align-items:center;gap:7px">
                  <span style="color:var(--accent);display:flex">${this._icon(k, 17)}</span>${g.title}</div>
                <div style="font-size:.76rem;color:var(--text-sec);line-height:1.35;margin-top:2px">${g.instr}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:9px;margin-top:22px">
          <button id="ob-guide-start" class="btn btn-primary" style="padding:12px">Empezar carga guiada</button>
          <div style="display:flex;gap:10px">
            <button id="ob-back3" class="btn btn-ghost" style="padding:9px;flex:0 0 auto;font-size:.82rem">Atrás</button>
            <button id="ob-explore" class="btn btn-ghost" style="padding:9px;flex:1;font-size:.82rem">Explorar por mi cuenta</button>
          </div>
        </div>
        ${this._dots()}
      </div>`;
  },

  _bind() {
    const el = document.getElementById('onboarding-screen');
    if (!el) return;

    if (this._step === 1) {
      const inp = el.querySelector('#ob-nombre');
      inp?.focus();
      const next = () => { this._nombre = (inp?.value || '').trim(); this._step = 2; this._render(); };
      el.querySelector('#ob-next1')?.addEventListener('click', next);
      el.querySelector('#ob-skip1')?.addEventListener('click', () => { this._nombre = ''; this._step = 2; this._render(); });
      inp?.addEventListener('keydown', e => { if (e.key === 'Enter') next(); });
    }

    if (this._step === 2) {
      el.querySelectorAll('.ob-mod').forEach(card => {
        card.addEventListener('click', () => {
          const k = card.dataset.key;
          if (this._modules.has(k)) this._modules.delete(k); else this._modules.add(k);
          this._render();
        });
      });
      el.querySelector('#ob-back2')?.addEventListener('click', () => { this._step = 1; this._render(); });
      el.querySelector('#ob-next2')?.addEventListener('click', () => {
        if (!this._modules.size) return;
        this._step = 3; this._render();
      });
    }

    if (this._step === 3) {
      el.querySelector('#ob-back3')?.addEventListener('click', () => { this._step = 2; this._render(); });
      el.querySelector('#ob-guide-start')?.addEventListener('click', () => this._startGuide());
      el.querySelector('#ob-explore')?.addEventListener('click', () => this._finish());
      el.querySelector('#ob-enter')?.addEventListener('click', () => this._finish());
    }
  },

  async _savePrefs() {
    try {
      await Promise.all([
        setConfig('user_nombre', this._nombre || ''),
        setConfig('modules_enabled', [...this._modules].join(',')),
        setConfig('onboarding_done', 'true'),
      ]);
    } catch (_) { /* no bloquear la entrada a la app */ }
    if (window.Auth) window.Auth._nombre = this._nombre || '';
    window.APP_MODULES = new Set(this._modules);
    if (typeof applyModuleVisibility === 'function') applyModuleVisibility();
    const ua = document.querySelector('.sn-user-email');
    if (ua && this._nombre) ua.textContent = this._nombre;
  },

  // "Explorar por mi cuenta" / entrar sin guía
  async _finish() {
    await this._savePrefs();
    document.getElementById('onboarding-screen')?.remove();
    const first = this.GUIDE_ORDER.find(k => this._modules.has(k));
    const route = first ? this.GUIDE[first].route : '#dashboard';
    if (window.location.hash.slice(1) === route.slice(1)) handleRoute();
    else window.location.hash = route;
  },

  // ── Carga guiada ────────────────────────────────────────────────────────
  async _startGuide() {
    await this._savePrefs();
    this._guideQueue = this.GUIDE_ORDER.filter(k => this._modules.has(k));
    this._guideIdx = 0;
    document.getElementById('onboarding-screen')?.remove();
    if (!this._guideQueue.length) { window.location.hash = '#dashboard'; return; }
    this._renderGuide();
    this._gotoGuideStep();
  },

  _gotoGuideStep() {
    const g = this.GUIDE[this._guideQueue[this._guideIdx]];
    if (window.location.hash.slice(1) === g.route.slice(1)) handleRoute();
    else window.location.hash = g.route;
  },

  _renderGuide() {
    let w = document.getElementById('onb-guide');
    if (!w) {
      w = document.createElement('div');
      w.id = 'onb-guide';
      w.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;max-width:560px;margin:0 auto;z-index:1500;' +
        'background:var(--surface);border:1px solid var(--accent);border-radius:14px;padding:14px 16px;' +
        'box-shadow:0 8px 30px rgba(0,0,0,.45)';
      document.body.appendChild(w);
    }
    const key  = this._guideQueue[this._guideIdx];
    const g    = this.GUIDE[key];
    const last = this._guideIdx === this._guideQueue.length - 1;
    w.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:12px">
        <div style="color:var(--accent);flex-shrink:0;margin-top:2px;display:flex">${this._icon(key, 22)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.66rem;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);font-weight:700">
            Carga guiada · paso ${this._guideIdx + 1} de ${this._guideQueue.length}</div>
          <div style="font-size:.9rem;font-weight:600;color:var(--text);margin:3px 0 3px">${g.title}</div>
          <div style="font-size:.78rem;color:var(--text-sec);line-height:1.4">${g.instr}</div>
        </div>
        <button class="onb-guide-close" title="Cerrar guía" style="background:none;border:none;color:var(--text-sec);
          cursor:pointer;font-size:1.1rem;line-height:1;padding:0 2px;flex-shrink:0">✕</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
        <button class="onb-guide-skip btn btn-ghost" style="padding:8px 14px;font-size:.8rem">Saltar guía</button>
        <button class="onb-guide-next btn btn-primary" style="padding:8px 16px;font-size:.82rem">
          ${last ? 'Terminar ✓' : 'Siguiente →'}</button>
      </div>`;
    w.querySelector('.onb-guide-next').addEventListener('click', () => this._guideNext());
    w.querySelector('.onb-guide-skip').addEventListener('click', () => this._endGuide(false));
    w.querySelector('.onb-guide-close').addEventListener('click', () => this._endGuide(false));
  },

  _guideNext() {
    this._guideIdx++;
    if (this._guideIdx >= this._guideQueue.length) { this._endGuide(true); return; }
    this._renderGuide();
    this._gotoGuideStep();
  },

  _endGuide(done) {
    document.getElementById('onb-guide')?.remove();
    this._guideQueue = [];
    this._guideIdx = 0;
    if (done) {
      if (typeof toast === 'function') toast('¡Listo! Ya cargaste lo básico 🎉');
      if (window.location.hash.slice(1) !== 'dashboard') window.location.hash = '#dashboard';
      else handleRoute();
    }
  },
};
