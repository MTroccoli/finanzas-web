const CACHE = 'finpro-v1';
const ASSETS = [
  '/finanzas-web/',
  '/finanzas-web/index.html',
  '/finanzas-web/css/main.css',
  '/finanzas-web/js/config.js',
  '/finanzas-web/js/db.js',
  '/finanzas-web/js/auth.js',
  '/finanzas-web/js/app.js',
  '/finanzas-web/modules/dashboard.js',
  '/finanzas-web/modules/inversiones.js',
  '/finanzas-web/modules/gastos.js',
  '/finanzas-web/modules/ingresos.js',
  '/finanzas-web/modules/presupuesto.js',
  '/finanzas-web/modules/config_page.js',
  '/finanzas-web/img/logo.png',
  '/finanzas-web/img/icon-192.png',
  '/finanzas-web/img/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Don't cache Supabase or CDN requests
  if (url.hostname !== location.hostname) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || network;
    })
  );
});
