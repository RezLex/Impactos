/**
 * Detección de conectividad real (no solo navigator.onLine, que puede
 * reportar "conectado" con wifi sin internet real). Los eventos online/offline
 * dan una reacción instantánea; cada 10s se confirma con una petición liviana
 * al propio origen (un ícono chico, sin caché) — si falla, no hay red real
 * aunque el navegador diga lo contrario.
 */

let _offline = !navigator.onLine;
const _listeners = new Set();

function _avisar() {
  _listeners.forEach(fn => fn(_offline));
}

function _setEstado(offline) {
  if (offline === _offline) return;
  _offline = offline;
  _avisar();
}

async function _verificar() {
  try {
    // `swprobe` le indica a sw.js que deje pasar esta petición sin
    // interceptarla — si no, su estrategia "cae al caché cuando falla la red"
    // haría que esto resuelva "éxito" incluso sin internet real.
    await fetch(`./icons/favicon-16.png?swprobe=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
    _setEstado(false);
  } catch {
    _setEstado(true);
  }
}

/** Estado actual, sin disparar una nueva verificación. */
export function estaOffline() {
  return _offline;
}

/**
 * Se suscribe a cambios de conectividad — `fn(offline)` se llama de inmediato
 * con el estado actual y de nuevo cada vez que cambia. Devuelve una función
 * para cancelar la suscripción.
 */
export function onCambioConexion(fn) {
  _listeners.add(fn);
  fn(_offline);
  return () => _listeners.delete(fn);
}

/** Arranca los listeners de red y el sondeo periódico. Llamar una sola vez. */
export function iniciarMonitorConexion() {
  window.addEventListener('online',  _verificar);
  window.addEventListener('offline', () => _setEstado(true));
  _verificar();
  setInterval(_verificar, 10000);
}
