window.Mods = window.Mods || {};
window.Mods.onboarding = {
  _step:    1,
  _nombre:  '',
  _modules: null,   // Set de keys habilitadas

  MODULES: [
    { key: 'dashboard',   emoji: '📊', name: 'Análisis',    desc: 'Panorama de tu patrimonio: ingresos vs. gastos y proyecciones',        route: '#dashboard' },
    { key: 'inversiones', emoji: '📈', name: 'Inversiones', desc: 'Tu portafolio de acciones y ETFs, mercado, operaciones y rentabilidad', route: '#inversiones/portafolio' },
    { key: 'gastos',      emoji: '💸', name: 'Gastos',      desc: 'Registrá o importá tus gastos, con resúmenes, categorías y cuotas',     route: '#gastos/resumen' },
    { key: 'tarjetas',    emoji: '💳', name: 'Tarjetas',    desc: 'Descuentos bancarios y análisis de los beneficios de tus tarjetas',     route: '#tarjetas/descuentos' },
    { key: 'ingresos',    emoji: '💰', name: 'Ingresos',    desc: 'Registro de ingresos y recurrentes que se cargan automáticamente',      route: '#ingresos' },
  ],

  start() {
    this._step = 1;
    this._nombre = window.Auth?._nombre || '';
    // Por defecto, todos habilitados (o los ya guardados si rehace la presentación)
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
    return `
      <div style="max-width:440px;width:100%;text-align:center">
        <div style="font-size:3rem;margin-bottom:8px">👋</div>
        <h1 style="font-family:'Bebas Neue',sans-serif;font-size:2.4rem;letter-spacing:.02em;margin:0 0 6px">
          Bienvenido a FinPro</h1>
        <p style="color:var(--text-sec);font-size:.92rem;line-height:1.5;margin:0 auto 4px;max-width:360px">
          Tu centro financiero personal: inversiones, gastos, tarjetas e ingresos, todo en un solo lugar.</p>
        <p style="color:var(--text);font-size:.95rem;margin:24px 0 8px">¿Cómo te llamás?</p>
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
    const hola = this._nombre ? `¡Hola, ${this._nombre}! 👋` : '¡Hola! 👋';
    return `
      <div style="max-width:520px;width:100%">
        <h1 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;letter-spacing:.02em;margin:0 0 4px;text-align:center">
          ${hola}</h1>
        <p style="color:var(--text-sec);font-size:.9rem;line-height:1.5;text-align:center;margin:0 0 20px">
          Elegí qué módulos querés usar. Vas a poder cambiarlos cuando quieras desde Configuración.</p>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${this.MODULES.map(m => {
            const on = this._modules.has(m.key);
            return `
            <div class="ob-mod" data-key="${m.key}" style="display:flex;align-items:center;gap:13px;
              padding:13px 15px;border-radius:12px;cursor:pointer;user-select:none;
              border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};
              background:${on ? 'rgba(46,142,200,.10)' : 'var(--surface)'};transition:.12s">
              <div style="font-size:1.5rem;line-height:1">${m.emoji}</div>
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
    const q = this._nombre ? `¿Por dónde empezamos, ${this._nombre}?` : '¿Por dónde empezamos?';
    const enabled = this.MODULES.filter(m => this._modules.has(m.key));
    return `
      <div style="max-width:460px;width:100%">
        <h1 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;letter-spacing:.02em;margin:0 0 4px;text-align:center">
          ${q}</h1>
        <p style="color:var(--text-sec);font-size:.9rem;text-align:center;margin:0 0 20px">
          Elegí el módulo con el que querés arrancar. El resto queda a un clic en el menú.</p>
        <div style="display:flex;flex-direction:column;gap:9px">
          ${enabled.map(m => `
            <button class="ob-start" data-route="${m.route}" style="display:flex;align-items:center;gap:12px;
              padding:13px 15px;border-radius:12px;cursor:pointer;text-align:left;width:100%;
              border:1px solid var(--border);background:var(--surface);color:var(--text);transition:.12s">
              <span style="font-size:1.4rem;line-height:1">${m.emoji}</span>
              <span style="flex:1;font-size:.95rem;font-weight:600">${m.name}</span>
              <span style="color:var(--text-sec);font-size:1.1rem">→</span>
            </button>`).join('')}
        </div>
        <div style="margin-top:20px;text-align:center">
          <button id="ob-back3" class="btn btn-ghost" style="padding:9px 18px;font-size:.82rem">Atrás</button>
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
      el.querySelectorAll('.ob-start').forEach(btn => {
        btn.addEventListener('click', () => this._finish(btn.dataset.route));
      });
      el.querySelector('#ob-back3')?.addEventListener('click', () => { this._step = 2; this._render(); });
    }
  },

  async _finish(route) {
    try {
      await Promise.all([
        setConfig('user_nombre', this._nombre || ''),
        setConfig('modules_enabled', [...this._modules].join(',')),
        setConfig('onboarding_done', 'true'),
      ]);
    } catch (_) { /* seguimos igual: no bloquear la entrada a la app */ }

    if (window.Auth) window.Auth._nombre = this._nombre || '';
    window.APP_MODULES = new Set(this._modules);
    if (typeof applyModuleVisibility === 'function') applyModuleVisibility();
    const ua = document.querySelector('.sn-user-email');
    if (ua && this._nombre) ua.textContent = this._nombre;

    document.getElementById('onboarding-screen')?.remove();
    if (window.location.hash.slice(1) === route.slice(1)) handleRoute();
    else window.location.hash = route;
  },
};
