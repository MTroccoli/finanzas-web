window.Auth = {
  _user: null,

  async init() {
    const sb = getDB();
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      this._user = session.user;
      await this._afterSignIn();
    } else {
      this._showScreen();
    }
    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
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
    const userArea = document.getElementById('sn-user-area');
    if (userArea && !userArea.querySelector('.sn-signout')) {
      userArea.innerHTML = `
        <div class="sn-user-email">${this._user.email}</div>
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
    handleRoute();
  },

  _showScreen() {
    const el = document.createElement('div');
    el.id = 'auth-screen';
    el.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo">
          <svg width="130" height="56" viewBox="0 0 230 64" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
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
          </svg>
        </div>
        <div class="auth-tabs">
          <button class="auth-tab-btn active" data-tab="login">Ingresar</button>
          <button class="auth-tab-btn" data-tab="signup">Registrarse</button>
        </div>
        <div id="auth-err" class="auth-err" style="display:none"></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <input id="auth-email" type="email" placeholder="Email" autocomplete="email" class="auth-input">
          <input id="auth-pass"  type="password" placeholder="Contraseña" autocomplete="current-password" class="auth-input">
          <button id="auth-submit" class="btn btn-primary" style="margin-top:6px;padding:11px">Ingresar</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    this._bindScreen(el);
  },

  _bindScreen(el) {
    let mode = 'login';
    const err    = el.querySelector('#auth-err');
    const submit = el.querySelector('#auth-submit');

    el.querySelectorAll('.auth-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.tab;
        el.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        submit.textContent = mode === 'login' ? 'Ingresar' : 'Crear cuenta';
        err.style.display = 'none';
      });
    });

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

  async signOut() {
    await getDB().auth.signOut();
  },
};

function _authMsg(msg) {
  if (!msg) return 'Error al autenticar';
  if (msg.includes('Invalid login'))      return 'Email o contraseña incorrectos';
  if (msg.includes('Email not confirmed')) return 'Confirmá tu email antes de ingresar';
  if (msg.includes('already registered')) return 'Ya existe una cuenta con ese email';
  if (msg.includes('Password should'))    return 'La contraseña debe tener al menos 6 caracteres';
  return msg;
}
