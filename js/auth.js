window.Auth = {
  _user: null,
  _nombre: '',
  _recoveryMode: false,   // true tras clickear el link del email de reset

  async init() {
    const sb = getDB();

    // Detección temprana de recovery: cuando el usuario vuelve del email de
    // reset, Supabase incluye `type=recovery` en el hash antes de disparar el
    // evento PASSWORD_RECOVERY. Lo detectamos acá para mostrar la pantalla de
    // nueva contraseña sin flash de la pantalla de login.
    if (/[#&?]type=recovery/.test(window.location.hash)) {
      this._recoveryMode = true;
    }

    const { data: { session } } = await sb.auth.getSession();
    if (this._recoveryMode) {
      this._showNewPasswordScreen();
    } else if (session?.user) {
      this._user = session.user;
      await this._afterSignIn();
    } else {
      this._showScreen();
    }

    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        this._recoveryMode = true;
        this._showNewPasswordScreen();
        return;
      }
      if (event === 'SIGNED_IN' && session?.user) {
        // Supabase re-dispara SIGNED_IN en token refresh y al recuperar foco de
        // la pestaña. Si ya estamos autenticados con el mismo usuario, ignorar:
        // volver a llamar _afterSignIn() reinicia la ruta y borra el formulario
        // que el usuario esté cargando. Tampoco entrar a la app si estamos en
        // medio del flujo de recovery — el usuario debe setear la nueva
        // contraseña primero.
        if (this._recoveryMode) return;
        if (this._user?.id === session.user.id) return;
        this._user = session.user;
        await this._afterSignIn();
      } else if (event === 'SIGNED_OUT') {
        this._user = null;
        location.reload();
      }
    });
  },

  async _afterSignIn() {
    try { await getDB().rpc('claim_existing_data'); } catch (_) {}
    document.getElementById('auth-screen')?.remove();

    // Preferencias per-user: nombre + módulos habilitados (null = todos) + tema
    const [nombre, mods, onbDone, tema] = await Promise.all([
      getConfig('user_nombre').catch(() => null),
      getConfig('modules_enabled').catch(() => null),
      getConfig('onboarding_done').catch(() => null),
      getConfig('tema').catch(() => null),
    ]);
    this._nombre = nombre || '';
    window.APP_MODULES = mods ? new Set(mods.split(',').filter(Boolean)) : null;
    if (typeof applyTheme === 'function') applyTheme(tema || 'dark');

    const userArea = document.getElementById('sn-user-area');
    if (userArea && !userArea.querySelector('.sn-signout')) {
      userArea.innerHTML = `
        <div class="sn-user-email">${this._nombre || this._user.email}</div>
        <button class="sn-signout">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Cerrar sesión
        </button>`;
      userArea.querySelector('.sn-signout').addEventListener('click', () => this.signOut());
    }

    if (typeof applyModuleVisibility === 'function') applyModuleVisibility();

    if (!onbDone && window.Mods?.onboarding) {
      window.Mods.onboarding.start();   // al finalizar rutea al módulo elegido
    } else {
      handleRoute();
    }
  },

  _logoSVG() {
    return `
      <svg viewBox="-52 0 230 64" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="spec-auth" color-interpolation-filters="sRGB" x="-5%" y="-5%" width="120%" height="120%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="blur"/>
            <feSpecularLighting in="blur" surfaceScale="6" specularConstant="1.2" specularExponent="25" lighting-color="#AADFF5" result="specular">
              <fePointLight x="10" y="5" z="80"/>
            </feSpecularLighting>
            <feComposite in="specular" in2="SourceAlpha" operator="in" result="lit"/>
            <feFlood flood-color="#2E8EC8" result="base"/>
            <feComposite in="base" in2="SourceAlpha" operator="in" result="baseClipped"/>
            <feBlend in="baseClipped" in2="lit" mode="screen" result="blended"/>
            <feComposite in="blended" in2="SourceAlpha" operator="in"/>
          </filter>
        </defs>
        <text x="2" y="58" font-family="'Crimson Text',serif" font-size="64" font-weight="600" fill="#2E8EC8" filter="url(#spec-auth)">F</text>
        <text x="40" y="50" font-family="'DM Sans',sans-serif" font-size="34" font-weight="300" fill="#FFFFFF">inPro</text>
      </svg>`;
  },

  _showScreen() {
    document.getElementById('auth-screen')?.remove();
    const el = document.createElement('div');
    el.id = 'auth-screen';
    el.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo">${this._logoSVG()}</div>
        <div class="auth-tabs">
          <button class="auth-tab-btn active" data-tab="login">Ingresar</button>
          <button class="auth-tab-btn" data-tab="signup">Registrarse</button>
        </div>
        <div id="auth-err" class="auth-err" style="display:none"></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <input id="auth-email" type="email" placeholder="Email" autocomplete="email" class="auth-input">
          <input id="auth-pass"  type="password" placeholder="Contraseña" autocomplete="current-password" class="auth-input">
          <button id="auth-submit" class="btn btn-primary" style="margin-top:6px;padding:11px">Ingresar</button>
          <button id="auth-forgot" type="button"
            style="background:none;border:none;color:var(--accent);cursor:pointer;
                   font-size:.85rem;padding:6px;margin-top:2px;text-align:center">
            ¿Olvidaste tu contraseña?
          </button>
        </div>
      </div>`;
    document.body.appendChild(el);
    this._bindScreen(el);
  },

  _bindScreen(el) {
    let mode = 'login';
    const err     = el.querySelector('#auth-err');
    const submit  = el.querySelector('#auth-submit');
    const forgot  = el.querySelector('#auth-forgot');

    el.querySelectorAll('.auth-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.tab;
        el.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        submit.textContent = mode === 'login' ? 'Ingresar' : 'Crear cuenta';
        err.style.display = 'none';
      });
    });

    forgot.addEventListener('click', () => this._showRecoveryScreen());

    const go = async () => {
      const email = el.querySelector('#auth-email').value.trim();
      const pass  = el.querySelector('#auth-pass').value;
      if (!email || !pass) return;
      err.style.display = 'none';
      submit.disabled = true;
      submit.textContent = '…';
      try {
        const sb = getDB();
        let res;
        if (mode === 'login') {
          res = await sb.auth.signInWithPassword({ email, password: pass });
        } else {
          res = await sb.auth.signUp({ email, password: pass });
          if (!res.error && res.data.user && !res.data.session) {
            // Confirmación de email requerida
            err.className = 'auth-err auth-ok';
            err.textContent = '✓ Revisá tu email para confirmar la cuenta.';
            err.style.display = '';
            submit.disabled = false;
            submit.textContent = 'Crear cuenta';
            return;
          }
        }
        if (res.error) throw res.error;
      } catch (e) {
        err.className = 'auth-err';
        err.textContent = _authMsg(e.message);
        err.style.display = '';
        submit.disabled = false;
        submit.textContent = mode === 'login' ? 'Ingresar' : 'Crear cuenta';
      }
    };

    submit.addEventListener('click', go);
    el.querySelectorAll('.auth-input').forEach(inp => {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    });
  },

  // Pantalla 1 del reset: pide el email y dispara el envío del link por Supabase.
  _showRecoveryScreen() {
    document.getElementById('auth-screen')?.remove();
    const el = document.createElement('div');
    el.id = 'auth-screen';
    el.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo">${this._logoSVG()}</div>
        <div style="text-align:center;margin-bottom:14px">
          <div style="font-size:1.05rem;font-weight:500;margin-bottom:4px">Recuperar contraseña</div>
          <div style="font-size:.85rem;color:var(--text-sec);line-height:1.4">
            Ingresá tu email y te vamos a enviar un link para elegir una nueva contraseña.
          </div>
        </div>
        <div id="auth-err" class="auth-err" style="display:none"></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <input id="auth-email" type="email" placeholder="Email" autocomplete="email" class="auth-input">
          <button id="auth-submit" class="btn btn-primary" style="margin-top:6px;padding:11px">
            Enviarme el link
          </button>
          <button id="auth-back" type="button"
            style="background:none;border:none;color:var(--accent);cursor:pointer;
                   font-size:.85rem;padding:6px;margin-top:2px;text-align:center">
            ← Volver a ingresar
          </button>
        </div>
      </div>`;
    document.body.appendChild(el);

    const err     = el.querySelector('#auth-err');
    const submit  = el.querySelector('#auth-submit');
    const emailIn = el.querySelector('#auth-email');

    el.querySelector('#auth-back').addEventListener('click', () => this._showScreen());

    const go = async () => {
      const email = emailIn.value.trim();
      if (!email) return;
      err.style.display = 'none';
      submit.disabled = true;
      submit.textContent = '…';
      try {
        const sb = getDB();
        // redirectTo: la URL de la app sin el hash — Supabase le agrega el token.
        const redirectTo = window.location.origin + window.location.pathname;
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        err.className = 'auth-err auth-ok';
        err.textContent = '✓ Si el email existe, te enviamos el link. Revisá tu bandeja (y spam).';
        err.style.display = '';
        submit.textContent = 'Enviado';
      } catch (e) {
        err.className = 'auth-err';
        err.textContent = _authMsg(e.message);
        err.style.display = '';
        submit.disabled = false;
        submit.textContent = 'Enviarme el link';
      }
    };
    submit.addEventListener('click', go);
    emailIn.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  },

  // Pantalla 2 del reset: aparece cuando el usuario vuelve del link del email.
  // La sesión ya está activa pero en modo "recovery"; usar updateUser para
  // fijar la nueva contraseña y luego rutear normal.
  _showNewPasswordScreen() {
    document.getElementById('auth-screen')?.remove();
    const el = document.createElement('div');
    el.id = 'auth-screen';
    el.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo">${this._logoSVG()}</div>
        <div style="text-align:center;margin-bottom:14px">
          <div style="font-size:1.05rem;font-weight:500;margin-bottom:4px">Nueva contraseña</div>
          <div style="font-size:.85rem;color:var(--text-sec);line-height:1.4">
            Elegí una contraseña de al menos 6 caracteres.
          </div>
        </div>
        <div id="auth-err" class="auth-err" style="display:none"></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <input id="auth-pass1" type="password" placeholder="Nueva contraseña" autocomplete="new-password" class="auth-input">
          <input id="auth-pass2" type="password" placeholder="Repetir contraseña" autocomplete="new-password" class="auth-input">
          <button id="auth-submit" class="btn btn-primary" style="margin-top:6px;padding:11px">
            Cambiar contraseña
          </button>
        </div>
      </div>`;
    document.body.appendChild(el);

    const err    = el.querySelector('#auth-err');
    const submit = el.querySelector('#auth-submit');
    const p1     = el.querySelector('#auth-pass1');
    const p2     = el.querySelector('#auth-pass2');

    const go = async () => {
      const v1 = p1.value, v2 = p2.value;
      if (!v1 || !v2) return;
      if (v1.length < 6) {
        err.className = 'auth-err';
        err.textContent = 'La contraseña debe tener al menos 6 caracteres';
        err.style.display = ''; return;
      }
      if (v1 !== v2) {
        err.className = 'auth-err';
        err.textContent = 'Las contraseñas no coinciden';
        err.style.display = ''; return;
      }
      err.style.display = 'none';
      submit.disabled = true;
      submit.textContent = '…';
      try {
        const sb = getDB();
        const { data, error } = await sb.auth.updateUser({ password: v1 });
        if (error) throw error;
        // Limpiar el hash de recovery, salir del modo recovery y entrar como usuario normal
        history.replaceState(null, '', window.location.pathname + window.location.search);
        this._recoveryMode = false;
        this._user = data.user;
        await this._afterSignIn();
      } catch (e) {
        err.className = 'auth-err';
        err.textContent = _authMsg(e.message);
        err.style.display = '';
        submit.disabled = false;
        submit.textContent = 'Cambiar contraseña';
      }
    };
    submit.addEventListener('click', go);
    [p1, p2].forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
  },

  async signOut() {
    await getDB().auth.signOut();
  },
};

function _authMsg(msg) {
  if (!msg) return 'Error al autenticar';
  if (msg.includes('Invalid login'))       return 'Email o contraseña incorrectos';
  if (msg.includes('Email not confirmed')) return 'Confirmá tu email antes de ingresar';
  if (msg.includes('already registered'))  return 'Ya existe una cuenta con ese email';
  if (msg.includes('Password should'))     return 'La contraseña debe tener al menos 6 caracteres';
  if (msg.includes('same as the old'))     return 'La nueva contraseña no puede ser igual a la anterior';
  if (msg.includes('rate limit') || msg.includes('For security purposes'))
    return 'Muchos intentos seguidos — esperá un minuto y probá de nuevo';
  return msg;
}
