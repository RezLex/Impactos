const CACHE = 'impactos-v7';

const SHELL = [
  './',
  './css/app.css',
  './js/app.js',
  './js/auth.js',
  './js/firebase.js',
  './js/router.js',
  './js/modules/admin-tarjetas.js',
  './js/modules/dashboard.js',
  './js/modules/evento-detalle.js',
  './js/modules/eventos.js',
  './js/modules/exportar.js',
  './js/modules/festivos.js',
  './js/modules/fijos.js',
  './js/modules/impacto.js',
  './js/modules/migracion.js',
  './js/modules/msi.js',
  './js/modules/quick-add.js',
  './js/modules/tarjetas.js',
  './js/utils/ciclo.js',
  './js/utils/db.js',
  './js/utils/formatters.js',
  './js/utils/impacto-calc.js',
  './js/utils/saldo.js',
  './js/utils/ui.js',
];

const FIREBASE_HOSTS = [
  'firestore.googleapis.com',
  'securetoken.googleapis.com',
  'identitytoolkit.googleapis.com',
  'www.googleapis.com',
  'accounts.google.com',
  'firebase.googleapis.com',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Firebase/Google APIs → siempre red, sin interceptar
  if (FIREBASE_HOSTS.some(h => url.hostname.includes(h))) return;

  // Navegación (HTML) → red primero, fallback a index cacheado
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('./'))
    );
    return;
  }

  // CDN externo → stale-while-revalidate
  if (url.hostname !== self.location.hostname) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fresh = fetch(e.request).then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        });
        return cached || fresh;
      })
    );
    return;
  }

  // Archivos locales → network first, caché solo si hay error de red (offline)
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
