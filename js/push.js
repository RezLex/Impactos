/**
 * Web Push (FCM) — permiso, token y mensajes en primer plano.
 *
 * Quién manda: el Apps Script (`docs/app-script.gs`), cuando detecta una compra
 * en el correo. Este módulo solo se encarga del lado del navegador: pedir
 * permiso, conseguir el token y dejarlo en `users/{uid}/dispositivos` para que
 * el script sepa a dónde enviar.
 *
 * Los mensajes van **data-only** (sin bloque `notification`): así el `push` de
 * `sw.js` controla qué se muestra. Con un bloque `notification`, Chrome pinta
 * la suya por su cuenta y saldrían dos avisos por compra.
 *
 * Ver docs/NOTIFICACIONES-PUSH.md.
 */

import { app } from './firebase.js';
import { upsert, remove } from './utils/db.js';
import { toast } from './utils/ui.js';

/**
 * Clave pública VAPID: Firebase Console → Configuración del proyecto → Cloud
 * Messaging → Web Push certificates → "Generar par de claves".
 *
 * Es pública por diseño —viaja al navegador en cada suscripción, igual que la
 * `apiKey` de `firebase.js`—, así que va en el código y no en un secreto.
 */
const VAPID_KEY = 'BOXaOlE2TdMmjrETnFWu-skE77ffxPk4tY0vhmYWbYGUD1phE4NOexdHFjjNDO8_4Vu41z4ZKdePCYGdOXJ_TDU';

const SDK = 'https://www.gstatic.com/firebasejs/11.8.1/firebase-messaging.js';

let _messaging = null;

/** Carga perezosa del SDK: no vale la pena bajarlo donde no hay push. */
async function _getMessaging() {
  if (_messaging) return _messaging;
  const { getMessaging } = await import(SDK);
  _messaging = getMessaging(app);
  return _messaging;
}

/**
 * `isSupported()` del SDK cubre lo que las comprobaciones sueltas no ven —
 * Safari viejo, WebViews, modo incógnito de Firefox. En iOS solo devuelve
 * true si la PWA está instalada en la pantalla de inicio (16.4+).
 */
export async function soportaPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;
  try {
    const { isSupported } = await import(SDK);
    return await isSupported();
  } catch { return false; }
}

/** `'default' | 'granted' | 'denied'`, o `'no-soportado'`. */
export function estadoPermiso() {
  return 'Notification' in window ? Notification.permission : 'no-soportado';
}

/**
 * Pide el token y lo guarda. El token es el id del documento: reabrir la app
 * reescribe el mismo, en vez de acumular un registro por sesión.
 */
async function _registrarToken() {
  if (!VAPID_KEY) throw new Error('Falta la clave VAPID en js/push.js');

  // `ready` en vez de registrar de nuevo: app.js ya registró ./sw.js, y crear
  // un segundo registro dejaría la suscripción en un Service Worker distinto
  // del que atiende los push.
  const registro  = await navigator.serviceWorker.ready;
  const messaging = await _getMessaging();
  const { getToken } = await import(SDK);

  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registro,
  });
  if (!token) throw new Error('El navegador no entregó token');

  await upsert('dispositivos', token, {
    ua:      navigator.userAgent,
    visto:   new Date().toISOString(),
  });
  return token;
}

/** Se llama desde un gesto del usuario: `requestPermission` lo exige. */
export async function activarPush() {
  if (!(await soportaPush())) {
    toast('Este navegador no soporta notificaciones push', 'warning');
    return false;
  }

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    toast(permiso === 'denied'
      ? 'Notificaciones bloqueadas — hay que habilitarlas en los permisos del sitio'
      : 'Permiso no concedido', 'warning');
    _pintarBoton();
    return false;
  }

  try {
    await _registrarToken();
    toast('Notificaciones activadas en este dispositivo');
    _pintarBoton();
    return true;
  } catch (e) {
    toast('No se pudo activar: ' + e.message, 'danger');
    return false;
  }
}

/**
 * Refresca el token en cada inicio de sesión. FCM lo rota de vez en cuando y
 * un token viejo deja de recibir sin avisar a nadie: el envío desde Apps
 * Script simplemente responde UNREGISTERED contra un documento fantasma.
 */
async function _sincronizarToken() {
  if (estadoPermiso() !== 'granted' || !VAPID_KEY) return;
  try { await _registrarToken(); } catch { /* sin conexión o SW no listo aún */ }
}

/**
 * Con la app abierta el push no llega al Service Worker, llega aquí. Mostrar
 * una notificación del sistema sobre la app que ya estás mirando sobra: basta
 * un toast, y de paso se refresca el contador.
 */
async function _escucharPrimerPlano() {
  try {
    const messaging = await _getMessaging();
    const { onMessage } = await import(SDK);
    onMessage(messaging, payload => {
      const d = payload?.data || {};
      toast(`${d.titulo || 'Compra detectada'} · toca Notificaciones para registrarla`, 'info');
      import('./modules/notificaciones.js').then(m => m.refrescarBadge()).catch(() => {});
    });
  } catch { /* sin soporte: no hay nada que escuchar */ }
}

const TEXTOS = {
  granted:   { icono: 'bi-bell-fill',  texto: 'Notificaciones activadas' },
  denied:    { icono: 'bi-bell-slash', texto: 'Notificaciones bloqueadas' },
  default:   { icono: 'bi-bell',       texto: 'Activar notificaciones' },
};

function _pintarBoton() {
  const btn = document.getElementById('btn-push');
  if (!btn) return;
  const t = TEXTOS[estadoPermiso()] || TEXTOS.default;
  btn.innerHTML = `<i class="bi ${t.icono}"></i><span>${t.texto}</span>`;
  btn.title     = t.texto;
  // Bloqueado no se arregla desde aquí: el navegador ya no vuelve a preguntar,
  // hay que ir a los permisos del sitio.
  btn.disabled  = estadoPermiso() === 'denied';
}

/** Cablea el botón del sidebar y pone al día el token. Lo llama `app.js` al entrar. */
export async function initPush() {
  const btn = document.getElementById('btn-push');

  if (!(await soportaPush())) {
    if (btn) btn.hidden = true;   // no ofrecer algo que no puede funcionar
    return;
  }

  _pintarBoton();
  btn?.addEventListener('click', activarPush);
  _sincronizarToken();
  _escucharPrimerPlano();
}

/**
 * Borra el token de este dispositivo. Lo usa el Apps Script del lado servidor
 * cuando FCM responde que ya no existe; aquí sirve para no dejar basura si el
 * usuario revoca el permiso desde el navegador.
 */
export async function olvidarToken(token) {
  try { await remove('dispositivos', token); } catch { /* ya no estaba */ }
}
