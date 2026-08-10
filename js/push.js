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
 * Estado real de este dispositivo.
 *
 * `activo` no es lo mismo que `permiso === 'granted'`: el permiso del navegador
 * no se puede revocar desde JavaScript, así que "desactivar" significa quitar la
 * suscripción y borrar el token. El permiso se queda concedido y el dispositivo
 * deja de recibir igual. La verdad la tiene `pushManager`, no `Notification`.
 *
 * @returns {{soportado: boolean, permiso: string, activo: boolean}}
 */
export async function estadoPush() {
  const soportado = await soportaPush();
  const permiso   = estadoPermiso();
  let activo = false;
  if (soportado && permiso === 'granted') {
    try {
      const registro = await navigator.serviceWorker.ready;
      activo = !!(await registro.pushManager.getSubscription());
    } catch { /* SW no listo: se reporta inactivo, que es lo conservador */ }
  }
  return { soportado, permiso, activo };
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
 * Deja de recibir avisos en este dispositivo.
 *
 * El permiso del navegador **no se puede revocar** desde JavaScript, así que lo
 * que se hace es cortar por el otro lado: se borra el token de Firestore —el
 * Apps Script deja de tener a dónde enviar— y se anula la suscripción con
 * `deleteToken`, que además la da de baja en los servidores de FCM. Volver a
 * activar no vuelve a preguntar nada, porque el permiso sigue concedido.
 */
export async function desactivarPush() {
  try {
    const messaging = await _getMessaging();
    const { getToken, deleteToken } = await import(SDK);
    const registro = await navigator.serviceWorker.ready;

    // Se pide el token ANTES de invalidarlo: es el id del documento a borrar
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registro,
    }).catch(() => null);

    if (token) await remove('dispositivos', token).catch(() => {});
    await deleteToken(messaging);

    toast('Este dispositivo dejará de recibir avisos');
    _pintarBoton();
    return true;
  } catch (e) {
    toast('No se pudo desactivar: ' + e.message, 'danger');
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
  try {
    const registro = await navigator.serviceWorker.ready;
    // Si el usuario desactivó los avisos, la suscripción ya no existe pero el
    // permiso sigue concedido. Sin esta guarda, el siguiente inicio de sesión
    // los resucitaría solo, sin que nadie lo haya pedido.
    if (!(await registro.pushManager.getSubscription())) return;
    await _registrarToken();
  } catch { /* sin conexión o SW no listo aún */ }
}


// El interruptor vive en Ajustes (`js/modules/ajustes.js`); aquí solo se
// notifica que el estado cambió, para que la vista se repinte si está abierta.
function _pintarBoton() {
  document.dispatchEvent(new CustomEvent('push-cambio'));
}

/**
 * Pone al día el token de este dispositivo. Lo llama `app.js` al entrar.
 *
 * No hay nada que escuchar en primer plano: el `onMessage` del SDK depende de
 * que el Service Worker use el handler de FCM para reenviar el mensaje a la
 * página, y el nuestro es un listener `push` propio. La notificación la muestra
 * siempre `sw.js`, esté la app abierta o cerrada — que es el comportamiento que
 * se quiere.
 */
export async function initPush() {
  if (!(await soportaPush())) return;
  _sincronizarToken();
}
