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

const TDC_SUBS = new Set(['comercios', 'adicional', 'importar', 'cuotas']);

async function handleRoute() {
  if (!window.Auth?._user) return;
  document.getElementById('gas-subnav')?.remove();

  const hash = window.location.hash.slice(1) || 'dashboard';
  const [page, sub] = hash.split('/');
  const route = PAGES[page] || PAGES.dashboard;
  const activePage = PAGES[page] ? page : 'dashboard';
  const activeSub = sub || (activePage === 'inversiones' ? 'portafolio' : 'resumen');

  document.body.classList.remove('nav-open');

  // Sidenav active states
  document.querySelectorAll('.sn-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === activePage);
  });
  document.querySelectorAll('.sn-sub, .sn-sub2').forEach(el => {
    el.classList.toggle('active', el.dataset.page === activePage && el.dataset.sub === activeSub);
  });

  // Open accordion for active page
  document.querySelectorAll('.sn-acc').forEach(acc => {
    if (acc.dataset.acc === activePage) acc.classList.add('open');
  });

  // Auto-open nested TDC accordion when a TDC sub is active
  if (activePage === 'gastos' && TDC_SUBS.has(activeSub)) {
    document.querySelectorAll('.sn-acc-nested[data-acc-nested="tdc"]').forEach(acc => acc.classList.add('open'));
  }

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

  document.querySelectorAll('.sn-sub-acc-hd').forEach(hd => {
    hd.addEventListener('click', () => {
      hd.closest('.sn-acc-nested').classList.toggle('open');
    });
  });

  window.Auth.init();
});
