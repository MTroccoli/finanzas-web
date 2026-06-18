const PAGES = {
  dashboard:     ()    => window.Mods.dashboard.render(),
  inversiones:   (sub) => window.Mods.inversiones.render(sub || 'portafolio'),
  gastos:        (sub) => { if (sub) window.Mods.gastos._tab = sub; return window.Mods.gastos.render(); },
  ingresos:      ()    => window.Mods.ingresos.render(),
  configuracion: ()    => window.Mods.configuracion.render(),
};

const PAGE_NAMES = {
  dashboard: 'Análisis', inversiones: 'Inversiones',
  gastos: 'Gastos', ingresos: 'Ingresos', configuracion: 'Configuración',
};

async function handleRoute() {
  if (!window.Auth?._user) return;
  document.getElementById('gas-subnav')?.remove();

  const hash = window.location.hash.slice(1) || 'dashboard';
  const [page, sub] = hash.split('/');
  const route = PAGES[page] || PAGES.dashboard;
  const activePage = PAGES[page] ? page : 'dashboard';
  const activeSub = sub || (activePage === 'inversiones' ? 'portafolio' : 'resumen');

  document.body.classList.remove('nav-open');

  // TDC sub-nav (Comercios / Adicional tabs fixed below topbar)
  const isTdc = activePage === 'gastos' && (activeSub === 'comercios' || activeSub === 'adicional');
  const tdcSubnav = document.getElementById('tdc-subnav');
  if (tdcSubnav) {
    tdcSubnav.classList.toggle('visible', isTdc);
    tdcSubnav.querySelectorAll('.tdc-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.sub === activeSub);
    });
  }
  document.body.classList.toggle('has-tdc-subnav', isTdc);

  // Sidenav active states
  // sn-item: active by page; if item also has data-sub, match both page+sub
  document.querySelectorAll('.sn-item[data-page]').forEach(el => {
    if (el.dataset.sub) {
      el.classList.toggle('active', el.dataset.page === activePage && el.dataset.sub === activeSub);
    } else {
      el.classList.toggle('active', el.dataset.page === activePage);
    }
  });
  // sn-sub: match page+sub; data-sub-alt allows alternate subs to also highlight the item
  document.querySelectorAll('.sn-sub, .sn-sub2').forEach(el => {
    const altSubs = el.dataset.subAlt ? el.dataset.subAlt.split(',') : [];
    const match = el.dataset.page === activePage &&
      (el.dataset.sub === activeSub || altSubs.includes(activeSub));
    el.classList.toggle('active', match);
  });

  // Open accordion for active page
  // Skip gastos accordion when on importar (it's a top-level nav item, not inside the accordion)
  document.querySelectorAll('.sn-acc').forEach(acc => {
    if (acc.dataset.acc === activePage && !(activePage === 'gastos' && activeSub === 'importar')) {
      acc.classList.add('open');
    }
  });

  // Topbar page name
  const tbPage = document.getElementById('tb-page');
  if (tbPage) tbPage.textContent = PAGE_NAMES[activePage] || '';

  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    await route(sub);
  } catch (e) {
    content.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">${e.message}</div></div>`;
    console.error(e);
  }
}

function toast(msg, type = 'ok', ms = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => { el.className = 'toast hidden'; }, ms);
}

window.addEventListener('hashchange', handleRoute);
window.addEventListener('load', () => {
  if (!window.location.hash || window.location.hash === '#') {
    window.location.hash = '#dashboard';
  }

  document.getElementById('hamburger').addEventListener('click', () => {
    document.body.classList.toggle('nav-open');
  });

  document.getElementById('nav-overlay').addEventListener('click', () => {
    document.body.classList.remove('nav-open');
  });

  document.querySelectorAll('.sn-acc-hd').forEach(hd => {
    hd.addEventListener('click', () => {
      hd.closest('.sn-acc').classList.toggle('open');
    });
  });

  window.Auth.init();
});
