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
function enviarPushSimulado(compras, { respuestaFcm = { codigo: 200, texto: '{}' } } = {}) {
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

  const n = ctx.enviarPush(compras);
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

// Los importes llegan como number: `crearNotificacion` los convierte antes de
// guardarlos. Pasarlos como string en la prueba escondía que `'$' + 195.7`
// producía "$195.7" en el título.
const compra = (notifId, datos) => ({ notifId, datos });
const UBER   = compra('noti-1', { total: 195.7, desc: 'Uber', tarjeta: '2167', match: true,
                                  asunto: 'Autorizó un pago para UBR PAGOS MEXICO' });

/** Atajo: manda y devuelve lo que el Service Worker terminaría mostrando. */
function mostrar(compras, opts) {
  const { enviados } = enviarPushSimulado(compras, opts);
  // Tal como lo entrega FCM al navegador: el mapa `data` anidado en el sobre
  return entregarPush(JSON.stringify({ data: enviados[0].message.data, from: '1087836294078' }));
}

test('el envío va data-only: sin bloque `notification`, que duplicaría el aviso', () => {
  const { enviados } = enviarPushSimulado([UBER]);
  assert.equal(enviados.length, 1);
  const msg = enviados[0].message;
  assert.equal(msg.notification, undefined);
  assert.equal(msg.token, TOKEN);
  assert.ok(msg.data, 'debe viajar en `data`');
});

test('FCM exige que todo valor de `data` sea string', () => {
  const { enviados } = enviarPushSimulado([compra(12345, { total: 195.7, desc: 'X', meses: 6 })]);
  Object.entries(enviados[0].message.data).forEach(([k, v]) =>
    assert.equal(typeof v, 'string', `data.${k} debería ser string y es ${typeof v}`));
});

test('los campos que manda el script son los que lee el Service Worker', () => {
  const m = mostrar([UBER]);
  assert.equal(m.titulo, '$195.70 — Uber');
  assert.equal(m.opciones.body, '···2167 — toca para registrarla');
  assert.equal(m.opciones.tag, 'noti-1');
  assert.equal(m.opciones.data.ruta, '/notificaciones');
  assert.ok(m.opciones.icon.includes('icon-192'));
  // El badge tiene que ser el monocromo: Android lo enmascara por alfa y con un
  // ícono opaco de borde a borde saldría un cuadrado en la barra de estado.
  assert.ok(m.opciones.badge.includes('badge-96'));
});

test('el importe se formatea: llega como number y "$" + 195.7 daría "$195.7"', () => {
  assert.equal(mostrar([UBER]).titulo, '$195.70 — Uber');
  assert.equal(mostrar([compra('n', { total: 1372.23, desc: 'X', match: true })]).titulo,
    '$1,372.23 — X');   // con separador de millares
  assert.equal(mostrar([compra('n', { total: 87, desc: 'X', match: true })]).titulo, '$87.00 — X');
});

test('a plazos: los meses van en el título', () => {
  const m = mostrar([compra('noti-2', { ...UBER.datos, meses: 6, mensualidad: 32.61 })]);
  assert.equal(m.titulo, '$195.70 — Uber (6 MSI)');
});

test('sin match en el diccionario el cuerpo es el asunto crudo', () => {
  // El título trae el comercio sin resolver, que no dice nada: el asunto es lo
  // único que orienta.
  const m = mostrar([compra('noti-3', { ...UBER.datos, desc: 'UBR PAGOS MEXICO', match: false })]);
  assert.equal(m.opciones.body, 'Autorizó un pago para UBR PAGOS MEXICO');
});

test('sin terminación conocida no se inventa el "···NA"', () => {
  const m = mostrar([compra('noti-4', { ...UBER.datos, tarjeta: 'NA' })]);
  assert.equal(m.opciones.body, 'toca para registrarla');
});

test('el artículo distingue una compra de Amazon en el título', () => {
  const m = mostrar([compra('n', { total: 1002.23, desc: 'Amazon', tarjeta: 'NA', match: true,
                                    articulo: 'Colgate Enjuague Bucal' })]);
  assert.equal(m.titulo, '$1,002.23 — Amazon · Colgate Enjuague Bucal');
});

// ── Un solo aviso por corrida ────────────────────────────────────────────────

test('varias compras van en UN solo envío, no uno por compra', () => {
  const { enviados } = enviarPushSimulado([
    UBER,
    compra('n2', { total: 1372.23, desc: 'Amazon', tarjeta: '4321', match: true }),
    compra('n3', { total: 87, desc: 'Oxxo', tarjeta: '2167', match: true }),
  ]);
  // Un dispositivo, un envío — antes eran tres vibraciones seguidas
  assert.equal(enviados.length, 1);
});

test('el resumen dice cuántas, de dónde y por cuánto', () => {
  const m = mostrar([
    UBER,
    compra('n2', { total: 1372.23, desc: 'Amazon', tarjeta: '4321', match: true }),
    compra('n3', { total: 87, desc: 'Oxxo', tarjeta: '2167', match: true }),
  ]);
  assert.equal(m.titulo, '3 compras detectadas');
  assert.equal(m.opciones.body, 'Uber, Amazon y 1 más · $1,654.93 en total');
});

test('el resumen usa el artículo: sin él, varios pedidos de Amazon se verían idénticos', () => {
  const m = mostrar([
    compra('n1', { total: 1002.23, desc: 'Amazon', match: true, articulo: 'Colgate Enjuague Bucal' }),
    compra('n2', { total: 485.51,  desc: 'Amazon', match: true, articulo: 'Fresh Step Multi-Cat' }),
  ]);
  assert.equal(m.opciones.body,
    'Amazon · Colgate Enjuague Bucal, Amazon · Fresh Step Multi-Cat · $1,487.74 en total');
});

test('con dos no sobra el "y N más"', () => {
  const m = mostrar([UBER, compra('n2', { total: 87, desc: 'Oxxo', match: true })]);
  assert.equal(m.titulo, '2 compras detectadas');
  assert.equal(m.opciones.body, 'Uber, Oxxo · $282.70 en total');
});

test('el tag del resumen es propio de la corrida, no tapa al anterior', () => {
  const m = mostrar([UBER, compra('n2', { total: 87, desc: 'Oxxo', match: true })]);
  assert.match(m.opciones.tag, /^resumen-\d+$/);
});

// ── Errores ──────────────────────────────────────────────────────────────────

test('un token muerto se borra en vez de reintentarse cada 15 min', () => {
  const { borrados, resultado } = enviarPushSimulado([UBER], {
    respuestaFcm: { codigo: 404, texto: '{"error":{"status":"UNREGISTERED"}}' },
  });
  assert.equal(resultado, 0);
  assert.equal(borrados.length, 1);
  assert.ok(borrados[0].endsWith('/dispositivos/' + TOKEN));
});

test('un error pasajero de FCM no borra el token', () => {
  const { borrados, resultado } = enviarPushSimulado([UBER], {
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
  assert.equal(ctx.enviarPush([UBER]), 0);
});

test('una corrida sin compras nuevas no manda nada', () => {
  const { enviados, resultado } = enviarPushSimulado([]);
  assert.equal(resultado, 0);
  assert.equal(enviados.length, 0);
});

test('un push manual sin envoltorio de FCM tampoco rompe el Service Worker', () => {
  // Lo que manda el botón "Push" de DevTools: JSON plano, sin `data`
  const mostrada = entregarPush(JSON.stringify({ titulo: 'Manual', cuerpo: 'desde DevTools' }));
  assert.equal(mostrada.titulo, 'Manual');
  assert.equal(mostrada.opciones.body, 'desde DevTools');
  assert.equal(mostrada.opciones.tag, 'impactos-compra');   // sin notifId, tag genérico
});

console.log(`\n${pasadas} pruebas ok`);
