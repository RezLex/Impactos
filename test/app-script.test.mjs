/**
 * Pruebas del Apps Script (`docs/app-script.gs`) — parsers de correo, montos y
 * horario silencioso. Sin framework: `node test/app-script.test.mjs`.
 *
 * El script no corre en Node: se carga en un contexto de `vm` con los servicios
 * de Apps Script (GmailApp, UrlFetchApp, Utilities…) sustituidos por stubs. Con
 * eso se ejercita la lógica pura —que es donde están los errores— sin tocar
 * Gmail, Firestore ni FCM.
 *
 * El contrato del push vive aparte, en `push-payload.test.mjs`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const src  = readFileSync(raiz + 'docs/app-script.gs', 'utf8');

/** Carga el script con los servicios simulados. `horaLocal` alimenta a Utilities.formatDate. */
function cargar({ horaLocal = 12 } = {}) {
  const ctx = vm.createContext({
    console: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'UID-FALSO' }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'x@y.z' }), getScriptTimeZone: () => 'UTC' },
    GmailApp: {}, MailApp: {}, UrlFetchApp: {}, ScriptApp: {},
    // El único uso que importa aquí es la hora del horario silencioso; la
    // conversión de zona es cosa de Apps Script, no nuestra.
    Utilities: { formatDate: () => String(horaLocal) },
  });
  vm.runInContext(src, ctx);
  return ctx;
}

const ctx = cargar();
const msg = asunto => ({ getSubject: () => asunto });

let pasadas = 0;
const test = (nombre, fn) => { fn(); pasadas++; console.log('ok  ' + nombre); };

/**
 * Comparación contra lo que devuelve el script. Los objetos nacen dentro del
 * `vm`, o sea en otro realm, y `deepStrictEqual` los rechaza por el prototipo
 * aunque el contenido sea idéntico: se normalizan antes.
 */
const igual = (real, esperado) => assert.deepEqual(JSON.parse(JSON.stringify(real)), esperado);

// ── PayPal "Autorizó un pago" ────────────────────────────────────────────────

const CUERPO_AUTH = `Hola Gabriel,

Ha autorizado un pago de $195.70 MXN a UBR PAGOS MEXICO

Fecha  8 ago 2026

Formas de pago utilizadas

Visa-2167
$195.70 MXN
`;

test('paypal-auth · comercio resuelto por el diccionario', () => {
  igual(ctx.parsePaypalAutorizacion(CUERPO_AUTH, msg('Autorizó un pago para UBR PAGOS MEXICO')),
    { tarjeta: '2167', total: '195.70', fecha: '', hora: '', desc: 'Uber', match: true });
});

test('paypal-auth · sin match manda el comercio crudo', () => {
  igual(ctx.parsePaypalAutorizacion(
    'Ha autorizado un pago de $1,250.00 MXN a TIENDA RARA SA DE CV\n',
    msg('Autorizó un pago para TIENDA RARA SA DE CV')),
    { tarjeta: 'NA', total: '1250.00', fecha: '', hora: '', desc: 'TIENDA RARA SA DE CV', match: false });
});

test('paypal-auth · el asunto sin acento también parsea (Gmail los ignora al buscar)', () => {
  assert.equal(
    ctx.parsePaypalAutorizacion(CUERPO_AUTH, msg('Autorizo un pago para UBR PAGOS MEXICO')).desc,
    'Uber');
});

test('paypal-auth · un recibo normal no lo captura', () => {
  assert.equal(
    ctx.parsePaypalAutorizacion('Ha pagado $20.00 MXN a GAMIVO\n', msg('Recibo de su pago')), null);
});

// ── Que la fuente nueva no haya roto las viejas ──────────────────────────────

test('santander', () => {
  igual(ctx.parseSantander(
    'Te informamos que se ha realizado una compra en el comercio AMAZON MX\n' +
    'con tu tarjeta terminación ****1234 por un monto de $ 1,499.00 El 05/08/2026 a las 14:32'),
    { tarjeta: '1234', total: '1499.00', fecha: '2026-08-05', hora: '14:32', desc: 'Amazon', match: true });
});

test('paypal · recibo', () => {
  igual(ctx.parsePaypal('Ha pagado $20.00 MXN a UBR PAGOS MEXICO\nPagó a X con  Visa-2167  $20.00 MXN\n'),
    { tarjeta: '2167', total: '20.00', fecha: '', hora: '', desc: 'Uber', match: true });
});

test('mercadopago · a plazos, con formato europeo de monto', () => {
  igual(ctx.parseMercadoPago(
    'Pagaste $ 1.372,23\nRevolut Crédito **** 6734\n6 meses de $ 228,71 sin interés',
    msg('Pago aprobado en API GLOBAL')),
    { tarjeta: '6734', total: '1372.23', fecha: '', hora: '', desc: 'API Global', match: true,
      meses: '6', mensualidad: '228.71' });
});

test('misaldo · cobra el Total, no el saldo abonado', () => {
  igual(ctx.parseMiSaldo(
    'Saldo abonado $100.00\nTarifa de servicio $5.00\nTotal $ 105.00\n' +
    'tu tarjeta MPL-PLATINUM MASTERCARD que termina en 6734.'),
    { tarjeta: '6734', total: '105.00', fecha: '', hora: '', desc: 'Mi Saldo', match: true });
});

// ── Montos ───────────────────────────────────────────────────────────────────

test('normalizarMonto · los formatos que llegan', () => {
  assert.equal(ctx.normalizarMonto('271.00'),   '271.00');    // Santander, PayPal
  assert.equal(ctx.normalizarMonto('201.6'),    '201.60');    // Amazon: a veces un solo decimal
  assert.equal(ctx.normalizarMonto('1.372,23'), '1372.23');   // Mercado Pago, formato europeo
  assert.equal(ctx.normalizarMonto('1,499.00'), '1499.00');
  assert.equal(ctx.normalizarMonto('1.500'),    '1500.00');   // sin decimales: todo era millares
});

// ── Amazon ───────────────────────────────────────────────────────────────────

const CUERPO_AMAZON_UN_PEDIDO = `Hola Gabriel,

Pedido n.º 702-1111111-1111111
Producto A x1

Total
201.6 MXN
`;

const CUERPO_AMAZON_VARIOS = `Hola Gabriel,

Pedido n.º 702-2435325-1682668
Producto B x1

Pedido n.º 702-2435325-1682668
Producto C x1

Total
1465.99 MXN

Pedido n.º 702-4694837-5698660
Producto D x2

Total
1002.23 MXN
`;

test('amazon · un pedido, monto de un solo decimal', () => {
  igual(ctx.parseAmazon(CUERPO_AMAZON_UN_PEDIDO), [
    { tarjeta: 'NA', total: '201.60', fecha: '', hora: '', desc: 'Amazon', match: true,
      pedido: '702-1111111-1111111', sufijo: '1111111' }
  ]);
});

test('amazon · un correo con dos pedidos, uno partido en dos bloques de envío', () => {
  igual(ctx.parseAmazon(CUERPO_AMAZON_VARIOS), [
    { tarjeta: 'NA', total: '1465.99', fecha: '', hora: '', desc: 'Amazon', match: true,
      pedido: '702-2435325-1682668', sufijo: '1682668' },
    { tarjeta: 'NA', total: '1002.23', fecha: '', hora: '', desc: 'Amazon', match: true,
      pedido: '702-4694837-5698660', sufijo: '5698660' }
  ]);
});

test('amazon · sin Total no devuelve nada', () => {
  assert.equal(ctx.parseAmazon('Pedido n.º 702-1111111-1111111\nProducto A x1\n'), null);
});

// ── Amazon · artículo ────────────────────────────────────────────────────────

test('amazon · el artículo son las primeras 3 palabras de la primera línea "* "', () => {
  const cuerpo = `Pedido n.º 702-1111111-1111111
* Colgate Enjuague Bucal Plax Ice Infinity 500ml
* Otro producto secundario

Total
201.6 MXN
`;
  igual(ctx.parseAmazon(cuerpo), [
    { tarjeta: 'NA', total: '201.60', fecha: '', hora: '', desc: 'Amazon', match: true,
      pedido: '702-1111111-1111111', sufijo: '1111111', articulo: 'Colgate Enjuague Bucal' }
  ]);
});

test('amazon · un pedido partido en envíos no reinicia el artículo en el segundo bloque', () => {
  // El número de pedido se repite en el segundo bloque de envío: el artículo
  // debe quedarse con el del PRIMER bloque, no con el del segundo.
  const cuerpo = `Pedido n.º 702-2435325-1682668
* Cepillo de Vapor Multiusos

Pedido n.º 702-2435325-1682668
* Repuesto Adicional Otro

Total
1465.99 MXN
`;
  igual(ctx.parseAmazon(cuerpo), [
    { tarjeta: 'NA', total: '1465.99', fecha: '', hora: '', desc: 'Amazon', match: true,
      pedido: '702-2435325-1682668', sufijo: '1682668', articulo: 'Cepillo de Vapor' }
  ]);
});

test('amazon · sin líneas "* " el registro no trae articulo', () => {
  const r = ctx.parseAmazon(CUERPO_AMAZON_UN_PEDIDO);
  assert.equal('articulo' in r[0], false);
});

test('primerasPalabras · corta a n tokens y limpia puntuación colgante', () => {
  assert.equal(ctx.primerasPalabras('Colgate Enjuague Bucal Plax Ice Infinity 500ml', 3),
    'Colgate Enjuague Bucal');
  assert.equal(ctx.primerasPalabras('Fresh Step Multi-Cat con el Poder de Febreze', 3),
    'Fresh Step Multi-Cat');
  assert.equal(ctx.primerasPalabras('Truper A-31-90, Aceite multiusos, protección', 3),
    'Truper A-31-90, Aceite');
  // El guión suelto cuenta como token: se prefiere que queden 2 palabras a
  // arrastrar un "-" colgando.
  assert.equal(ctx.primerasPalabras("Nature's Miracle - Polvo antiolor Just for Cats", 3),
    "Nature's Miracle");
});

// ── normalizarSalida ─────────────────────────────────────────────────────────

test('normalizarSalida · null, un objeto o un arreglo quedan siempre en arreglo', () => {
  igual(ctx.normalizarSalida(null), []);
  igual(ctx.normalizarSalida({ a: 1 }), [{ a: 1 }]);
  igual(ctx.normalizarSalida([{ a: 1 }, { a: 2 }]), [{ a: 1 }, { a: 2 }]);
});

test('pesos · formatea el number en que se guarda el importe', () => {
  assert.equal(ctx.pesos(195.7),   '$195.70');
  assert.equal(ctx.pesos(1372.23), '$1,372.23');
  assert.equal(ctx.pesos(87),      '$87.00');
  assert.equal(ctx.pesos(1234567), '$1,234,567.00');
});

// ── Horario silencioso ───────────────────────────────────────────────────────
// De 0:00 a 6:00 CDMX, `procesarCompras` sale de inmediato sin leer correo ni
// escribir nada. Solo esa función: el correo diario de `resumenPendientes` sale
// siempre. Lo de la madrugada se detecta en la primera corrida después de las
// 6:00, y como el push es uno por corrida, llega en un solo aviso.

test('la madrugada entera está en silencio', () => {
  [0, 1, 3, 5].forEach(h => assert.equal(cargar({ horaLocal: h }).enSilencio(), true, `${h}:00`));
});

test('a las 6:00 en punto ya avisa: el límite es exclusivo', () => {
  assert.equal(cargar({ horaLocal: 6 }).enSilencio(), false);
});

test('el resto del día no está en silencio', () => {
  [6, 7, 12, 18, 23].forEach(h => assert.equal(cargar({ horaLocal: h }).enSilencio(), false, `${h}:00`));
});

console.log(`\n${pasadas} pruebas ok`);
