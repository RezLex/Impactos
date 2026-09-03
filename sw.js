const CACHE = 'impactos-v40';

const SHELL = [
  './',
  './css/app.css',
  './js/app.js',
  './js/auth.js',
  './js/firebase.js',
  './js/push.js',
  './js/router.js',
  './js/modules/admin-tarjetas.js',
  './js/modules/dashboard.js',
  './js/modules/evento-detalle.js',
  './js/modules/eventos.js',
  './js/modules/ajustes.js',
  './js/modules/festivos.js',
  './js/modules/fijos.js',
  './js/modules/impacto.js',
  './js/modules/migracion.js',
  './js/modules/msi.js',
  './js/modules/notificaciones.js',
  './js/modules/quick-add.js',
  './js/modules/rendimientos.js',
  './js/modules/tarjetas.js',
  './js/utils/acumular.js',
  './js/utils/ciclo.js',
  './js/utils/db.js',
  './js/utils/formatters.js',
  './js/utils/impacto-calc.js',
  './js/utils/prefill-compra.js',
  './js/utils/rendimiento.js',
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

// ── Web Push ────────────────────────────────────────────────────────────────
// Los mensajes llegan data-only desde el Apps Script (ver docs/app-script.gs).
// Es deliberado: si trajeran bloque `notification`, Chrome mostraría la suya
// además de esta y saldrían dos avisos por compra.

self.addEventListener('push', e => {
  if (!e.data) return;

  let payload = {};
  try {
    const json = e.data.json();
    payload = json.data || json;   // FCM anida en `data`; una prueba manual, no
  } catch {
    payload = { cuerpo: e.data.text() };
  }

  e.waitUntil(self.registration.showNotification(payload.titulo || 'Compra detectada', {
    body:  payload.cuerpo || '',
    icon:  './icons/icon-192.png',
    // El badge es el ícono chico junto al nombre de la app, y Android lo
    // enmascara por canal alfa: descarta el color y se queda con la silueta.
    // Pasarle icon-192 daba un cuadrado, porque es opaco de borde a borde.
    badge: './icons/badge-96.png',
    // El id del documento como tag: si el envío se reintenta, la notificación
    // se reemplaza en vez de apilar copias de la misma compra.
    tag:      payload.notifId || 'impactos-compra',
    renotify: !!payload.notifId,
    // `ruta` viaja en el payload cuando Apps Script ya sabe el destino exacto
    // (un solo recordatorio en la corrida — docs/app-script-recordatorios.gs);
    // las compras y los resúmenes de varios mezclados no la traen y caen al
    // fallback, que es donde el usuario revisa/procesa cada uno.
    data:     { ruta: payload.ruta || '/notificaciones' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const ruta = e.notification.data?.ruta || '/notificaciones';

  e.waitUntil((async () => {
    const abiertos = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const propio   = abiertos.find(c => c.url.startsWith(self.registration.scope));

    // Con la app ya abierta se le avisa por mensaje en vez de navegarla: un
    // `navigate()` a la misma URL con otro hash recarga la pestaña entera y se
    // perdería lo que el usuario tuviera a medias.
    if (propio) {
      await propio.focus();
      propio.postMessage({ tipo: 'navegar', ruta });
      return;
    }
    await self.clients.openWindow('./#' + ruta);
  })());
});

/**
 * Guarda una respuesta en el caché sin que un fallo se propague.
 *
 * La Cache API rechaza más cosas de las que parece: respuestas parciales (206,
 * típicas de un <video> o de una descarga con Range) y cualquier esquema que no
 * sea http(s). Como el `put` es asíncrono y su promesa no la espera nadie —a
 * propósito: cachear no debe demorar la respuesta al usuario— un rechazo salía
 * a la consola como "Uncaught (in promise)" sin que nada estuviera realmente
 * roto. Se filtra lo que no se puede guardar y se traga el resto.
 */
function guardarEnCache(request, respuesta) {
  if (!respuesta.ok || respuesta.status === 206) return;
  caches.open(CACHE).then(c => c.put(request, respuesta)).catch(() => {});
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Solo http(s). Las extensiones del navegador (chrome-extension://) disparan
  // peticiones que pasan por aquí sin que la app las haya pedido, y ni se
  // pueden cachear ni son asunto nuestro: que las resuelva el navegador.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

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
          // Clonar YA, antes de que nadie lea el body — `caches.open()` es async,
          // y para cuando resolviera, el body de `res` ya podía estar consumido
          // (quien recibe la respuesta de `respondWith` la lee de inmediato),
          // lanzando "Response body is already used" en el clone tardío.
          guardarEnCache(e.request, res.clone());
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
      guardarEnCache(e.request, res.clone()); // clonar ya, mismo motivo que arriba
      return res;
    }).catch(() => caches.match(e.request))
  );
});
