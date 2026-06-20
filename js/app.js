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

  // TDC sub-nav (Comercios / Adicional / Descuentos tabs fixed below topbar)
  const isTdc = activePage === 'gastos' && (activeSub === 'comercios' || activeSub === 'adicional' || activeSub === 'descuentos');
  const tdcSubnav = document.getElementById('tdc-subnav');
  if (tdcSubnav) {
    tdcSubnav.classList.toggle('visible', isTdc);
    tdcSubnav.querySelectorAll('.tdc-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.sub === activeSub);
    });
  }
  document.body.classList.toggle('has-tdc-subnav', isTdc);

  // Helper: checks if a sub-link matches the current route
  const subMatches = el => {
    const alts = el.dataset.subAlt ? el.dataset.subAlt.split(',') : [];
    return el.dataset.page === activePage &&
      (el.dataset.sub === activeSub || alts.includes(activeSub));
  };

  // sn-sub / sn-sub2 active state
  document.querySelectorAll('.sn-sub, .sn-sub2').forEach(el => {
    el.classList.toggle('active', subMatches(el));
  });

  // Accordion: open only when one of its subs is active; close otherwise
  document.querySelectorAll('.sn-acc').forEach(acc => {
    const hasActive = [...acc.querySelectorAll('.sn-sub, .sn-sub2')].some(subMatches);
    acc.classList.toggle('open', hasActive);
  });

  // sn-item active state:
  // - top-level links (data-sub present): match page+sub exactly
  // - accordion headers (no data-sub): active only when one of their subs is active
  document.querySelectorAll('.sn-item[data-page]').forEach(el => {
    if (el.dataset.sub) {
      el.classList.toggle('active', el.dataset.page === activePage && el.dataset.sub === activeSub);
    } else {
      const acc = el.closest('.sn-acc');
      const isActive = acc
        ? [...acc.querySelectorAll('.sn-sub, .sn-sub2')].some(subMatches)
        : el.dataset.page === activePage;
      el.classList.toggle('active', isActive);
    }
  });

  // Topbar page name
  const SUB_NAMES = { 'gastos/importar': 'Importar EDC' };
  const tbPage = document.getElementById('tb-page');
  if (tbPage) tbPage.textContent = SUB_NAMES[`${activePage}/${activeSub}`] || PAGE_NAMES[activePage] || '';

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
