const PAGES = {
  dashboard:     (sub) => window.Mods.dashboard.render(),
  inversiones:   (sub) => window.Mods.inversiones.render(sub || 'portafolio'),
  gastos:        (sub) => window.Mods.gastos.render(),
  ingresos:      (sub) => window.Mods.ingresos.render(),
  presupuesto:   (sub) => window.Mods.presupuesto.render(),
  configuracion: (sub) => window.Mods.configuracion.render(),
};

const WITH_SUBNAV = new Set(['inversiones']);

async function handleRoute() {
  const hash = window.location.hash.slice(1) || 'dashboard';
  const [page, sub] = hash.split('/');
  const route = PAGES[page] || PAGES.dashboard;

  // Nav active state
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === (PAGES[page] ? page : 'dashboard'));
  });

  // Subnav
  const subnav = document.getElementById('subnav');
  const content = document.getElementById('content');
  if (WITH_SUBNAV.has(page)) {
    subnav.classList.remove('hidden');
    content.className = 'with-subnav';
    document.querySelectorAll('.sub-item').forEach(el => {
      el.classList.toggle('active', el.dataset.sub === (sub || 'portafolio'));
    });
  } else {
    subnav.classList.add('hidden');
    content.className = '';
  }

  // Render
  content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    await route(sub);
  } catch (e) {
    content.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">${e.message}</div></div>`;
    console.error(e);
  }
}

// Toast utility
function toast(msg, type = 'ok', ms = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => { el.className = 'toast hidden'; }, ms);
}

window.addEventListener('hashchange', handleRoute);
window.addEventListener('load', handleRoute);
