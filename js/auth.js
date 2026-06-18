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
    const nav = document.getElementById('mainnav');
    nav.style.display = '';
    // Enlace de cierre de sesión al final del nav
    if (!document.getElementById('btn-signout')) {
      const a = document.createElement('a');
      a.id = 'btn-signout';
      a.className = 'nav-item';
      a.href = '#';
      a.title = this._user.email;
      a.innerHTML = '<span class="nav-icon">🚪</span><span class="nav-label">Salir</span>';
      a.addEventListener('click', e => { e.preventDefault(); this.signOut(); });
      nav.appendChild(a);
    }
    handleRoute();
  },

  _showScreen() {
    document.getElementById('mainnav').style.display = 'none';
    const el = document.createElement('div');
    el.id = 'auth-screen';
    el.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo">Finanzas</div>
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
