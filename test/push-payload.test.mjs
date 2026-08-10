/**
 * Contrato del push, de punta a punta y sin navegador:
 * `enviarPush` (docs/app-script.gs) → envoltorio de FCM → listener `push` (sw.js).
 *
 * Sin framework: `node test/push-payload.test.mjs`.
 *
 * Esta costura es la que ningún `node --check` puede ver: son dos archivos que
 * no se importan entre sí y que solo se encuentran en tiempo de ejecución, con
 * FCM en medio. Si alguien renombra un campo de `data` en un lado, la
 * notificación llega vacía y no hay error en ninguna parte.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let pasadas = 0;
const test = (nombre, fn) => { fn(); pasadas++; console.log('ok  ' + nombre); };

// ── Lado Apps Script ─────────────────────────────────────────────────────────

const TOKEN = 'fAkE-t0ken:APA91bZZZ';

/** Corre `enviarPush` con los servicios de Apps Script simulados y devuelve el body que mandó a FCM. */
function enviarPushSimulado(datos, notifId, { respuestaFcm = { codigo: 200, texto: '{}' } } = {}) {
  const enviados = [];
  const borrados = [];

  const resp = (codigo, texto) => ({ getResponseCode: () => codigo, getContentText: () => texto });

  const ctx = vm.createContext({
    console: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'UID-FALSO' }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'x@y.z' }), getScriptTimeZone: () => 'UTC' },
    ScriptApp: { getOAuthToken: () => 'token-oauth' },
    GmailApp: {}, MailApp: {}, Utilities: {},
    UrlFetchApp: {
      fetch(url, opts) {
        if (url.indexOf('/dispositivos') !== -1 && opts.method === 'get') {
          return resp(200, JSON.stringify({ documents: [
            { name: 'projects/impactos-b4307/databases/(default)/documents/users/UID-FALSO/dispositivos/' + TOKEN },
          ] }));
        }
        if (url.indexOf('fcm.googleapis.com') !== -1) {
          enviados.push(JSON.parse(opts.payload));
          return resp(respuestaFcm.codigo, respuestaFcm.texto);
        }
        if (opts.method === 'delete') { borrados.push(url); return resp(200, '{}'); }
        throw new Error('llamada inesperada: ' + url);
      },
    },
  });
  vm.runInContext(readFileSync(raiz + 'docs/app-script.gs', 'utf8'), ctx);

  const n = ctx.enviarPush(datos, notifId);
  return { enviados, borrados, resultado: n };
}

// ── Lado Service Worker ──────────────────────────────────────────────────────

/** Carga sw.js con un `self` de mentira y devuelve sus listeners. */
function cargarSw() {
  const listeners = {};
  const self = {
    addEventListener: (tipo, fn) => { listeners[tipo] = fn; },
    location: { hostname: 'rezlex.github.io' },
    registration: { scope: 'https://rezlex.github.io/Impactos/', showNotification: () => {} },
    clients: {},
    skipWaiting: () => {},
  };
  const ctx = vm.createContext({ self, caches: {}, fetch: () => {}, URL, console });
  ctx.self = self;
  vm.runInContext(readFileSync(raiz + 'sw.js', 'utf8'), ctx);
  return { listeners, self };
}

/** Entrega un payload al listener `push` y devuelve los argumentos de showNotification. */
function entregarPush(cuerpoCrudo) {
  const { listeners, self } = cargarSw();
  let mostrada = null;
  self.registration.showNotification = (titulo, opciones) => { mostrada = { titulo, opciones }; };

  listeners.push({
    data: { json: () => JSON.parse(cuerpoCrudo), text: () => cuerpoCrudo },
    waitUntil: p => p,
  });
  return mostrada;
}

// ── Pruebas ──────────────────────────────────────────────────────────────────

const COMPRA = { total: '195.70', desc: 'Uber', tarjeta: '2167', match: true,
                 asunto: 'Autorizó un pago para UBR PAGOS MEXICO' };

test('el envío va data-only: sin bloque `notification`, que duplicaría el aviso', () => {
  const { enviados } = enviarPushSimulado(COMPRA, 'noti-1');
  assert.equal(enviados.length, 1);
  const msg = enviados[0].message;
  assert.equal(msg.notification, undefined);
  assert.equal(msg.token, TOKEN);
  assert.ok(msg.data, 'debe viajar en `data`');
});

test('FCM exige que todo valor de `data` sea string', () => {
  const { enviados } = enviarPushSimulado({ ...COMPRA, total: 195.7, meses: 6 }, 12345);
  Object.entries(enviados[0].message.data).forEach(([k, v]) =>
    assert.equal(typeof v, 'string', `data.${k} debería ser string y es ${typeof v}`));
});

test('los campos que manda el script son los que lee el Service Worker', () => {
  const { enviados } = enviarPushSimulado(COMPRA, 'noti-1');
  // Tal como lo entrega FCM al navegador: el mapa `data` anidado en el sobre
  const mostrada = entregarPush(JSON.stringify({ data: enviados[0].message.data, from: '1087836294078' }));

  assert.equal(mostrada.titulo, '$195.70 — Uber');
  assert.equal(mostrada.opciones.body, '···2167 — toca para registrarla');
  assert.equal(mostrada.opciones.tag, 'noti-1');       // reintento reemplaza, no apila
  assert.equal(mostrada.opciones.data.ruta, '/notificaciones');
  assert.ok(mostrada.opciones.icon.includes('icon-192'));
  // El badge tiene que ser el monocromo: Android lo enmascara por alfa y con un
  // ícono opaco de borde a borde saldría un cuadrado en la barra de estado.
  assert.ok(mostrada.opciones.badge.includes('badge-96'));
});

test('a plazos: los meses van en el título', () => {
  const { enviados } = enviarPushSimulado({ ...COMPRA, meses: 6, mensualidad: '32.61' }, 'noti-2');
  const mostrada = entregarPush(JSON.stringify({ data: enviados[0].message.data }));
  assert.equal(mostrada.titulo, '$195.70 — Uber (6 MSI)');
});

test('sin match en el diccionario el cuerpo es el asunto crudo', () => {
  // El título trae el comercio sin resolver, que no dice nada: el asunto es lo
  // único que orienta.
  const { enviados } = enviarPushSimulado({ ...COMPRA, desc: 'UBR PAGOS MEXICO', match: false }, 'noti-3');
  const mostrada = entregarPush(JSON.stringify({ data: enviados[0].message.data }));
  assert.equal(mostrada.opciones.body, 'Autorizó un pago para UBR PAGOS MEXICO');
});

test('sin terminación conocida no se inventa el "···NA"', () => {
  const { enviados } = enviarPushSimulado({ ...COMPRA, tarjeta: 'NA' }, 'noti-4');
  const mostrada = entregarPush(JSON.stringify({ data: enviados[0].message.data }));
  assert.equal(mostrada.opciones.body, 'toca para registrarla');
});

test('un token muerto se borra en vez de reintentarse cada 15 min', () => {
  const { borrados, resultado } = enviarPushSimulado(COMPRA, 'noti-5', {
    respuestaFcm: { codigo: 404, texto: '{"error":{"status":"UNREGISTERED"}}' },
  });
  assert.equal(resultado, 0);
  assert.equal(borrados.length, 1);
  assert.ok(borrados[0].endsWith('/dispositivos/' + TOKEN));
});

test('un error pasajero de FCM no borra el token', () => {
  const { borrados, resultado } = enviarPushSimulado(COMPRA, 'noti-6', {
    respuestaFcm: { codigo: 503, texto: '{"error":{"status":"UNAVAILABLE"}}' },
  });
  assert.equal(resultado, 0);
  assert.equal(borrados.length, 0);
});

test('sin dispositivos registrados no truena ni llama a FCM', () => {
  const ctx = vm.createContext({
    console: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'UID' }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'x@y.z' }), getScriptTimeZone: () => 'UTC' },
    ScriptApp: { getOAuthToken: () => 't' }, GmailApp: {}, MailApp: {}, Utilities: {},
    // Colección inexistente: Firestore responde 200 con el cuerpo vacío
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => '' }) },
  });
  vm.runInContext(readFileSync(raiz + 'docs/app-script.gs', 'utf8'), ctx);
  assert.equal(ctx.enviarPush(COMPRA, 'noti-7'), 0);
});

test('un push manual sin envoltorio de FCM tampoco rompe el Service Worker', () => {
  // Lo que manda el botón "Push" de DevTools: JSON plano, sin `data`
  const mostrada = entregarPush(JSON.stringify({ titulo: 'Manual', cuerpo: 'desde DevTools' }));
  assert.equal(mostrada.titulo, 'Manual');
  assert.equal(mostrada.opciones.body, 'desde DevTools');
  assert.equal(mostrada.opciones.tag, 'impactos-compra');   // sin notifId, tag genérico
});

console.log(`\n${pasadas} pruebas ok`);
