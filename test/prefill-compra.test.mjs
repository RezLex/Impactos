/**
 * Pruebas de la traducción "compra detectada → precarga del modal".
 * Sin framework ni dependencias: `node test/prefill-compra.test.mjs`.
 *
 * Importa porque la comparten dos entradas con formas distintas del mismo dato:
 * la sección Notificaciones (mapa de Firestore, números como number) y el
 * pre-registro por URL, que quedó como fallback (query string, todo string).
 * Las dos tienen que producir exactamente el mismo `prefill`.
 */
import assert from 'node:assert/strict';
import { prefillDesdeDatos, matchTarjetaPorTerminacion } from '../js/utils/prefill-compra.js';
import { toISODate } from '../js/utils/ciclo.js';

const TARJETAS = [
  {
    id: 'tc-nu', tipo: 'credito',
    numeros: [{ formato: 'fisica', numero: '5301 2233 4455 4321' }],
  },
  {
    id: 'tc-revolut', tipo: 'credito',
    numeros: [
      { formato: 'digital', numero: '4111 9900 1122 2167' },
      { formato: 'fisica',  numero: '4111 5566 7788 6734' },
    ],
  },
  // Misma terminación en física y digital: debe ganar la física
  {
    id: 'tc-dup', tipo: 'credito',
    numeros: [
      { formato: 'digital', numero: '3000 0000 0000 9999' },
      { formato: 'fisica',  numero: '3111 1111 1111 9999' },
    ],
  },
  { id: 'tc-oculta', tipo: 'credito', oculta: true, numeros: [{ formato: 'fisica', numero: '1111 1111 1111 7777' }] },
  { id: 'td-debito',  tipo: 'debito',  numeros: [{ formato: 'fisica', numero: '2222 2222 2222 8888' }] },
];

const HOY = toISODate(new Date());
let pasadas = 0;
const test = (nombre, fn) => { fn(); pasadas++; console.log('ok  ' + nombre); };

// ── matchTarjetaPorTerminacion ───────────────────────────────────────────────

test('encuentra la tarjeta por los últimos 4 dígitos', () => {
  assert.deepEqual(matchTarjetaPorTerminacion('4321', TARJETAS),
    { tarjetaId: 'tc-nu', numero: '5301 2233 4455 4321' });
});

test('con física y digital de la misma terminación gana la física', () => {
  assert.equal(matchTarjetaPorTerminacion('9999', TARJETAS).numero, '3111 1111 1111 9999');
});

test('ignora tarjetas ocultas y de débito, y el centinela NA', () => {
  assert.equal(matchTarjetaPorTerminacion('7777', TARJETAS), null);
  assert.equal(matchTarjetaPorTerminacion('8888', TARJETAS), null);
  assert.equal(matchTarjetaPorTerminacion('NA', TARJETAS),   null);
  assert.equal(matchTarjetaPorTerminacion('', TARJETAS),     null);
});

// ── prefillDesdeDatos ────────────────────────────────────────────────────────

test('compra de contado: mapa de Firestore y query string dan lo mismo', () => {
  const firestore = { desc: 'Amazon', total: 1499, fecha: '2026-08-08', hora: '18:41',
                      tarjeta: '4321', msgId: 'm1', asunto: 'Compra', match: true };
  const url = Object.fromEntries(new URLSearchParams(
    'desc=Amazon&total=1499&fecha=2026-08-08&hora=18:41&tarjeta=4321&msgId=m1'));

  const esperado = {
    tipo: 'contado',
    datos: {
      compra: 'Amazon', total: 1499, fechaCompra: '2026-08-08T18:41:00', hora: '18:41',
      tarjetaId: 'tc-nu', numeroTarjeta: '5301 2233 4455 4321', msgId: 'm1',
    },
  };
  assert.deepEqual(prefillDesdeDatos(firestore, TARJETAS, [], []), esperado);
  assert.deepEqual(prefillDesdeDatos(url,       TARJETAS, [], []), esperado);
});

test('compra a plazos: `meses` decide el tipo, en number y en string', () => {
  const firestore = { desc: 'API Global', total: 1372.23, fecha: '2026-08-07', hora: '11:04',
                      tarjeta: '6734', meses: 6, mensualidad: 228.71, msgId: 'm2' };
  const url = Object.fromEntries(new URLSearchParams(
    'desc=API Global&total=1372.23&fecha=2026-08-07&hora=11:04&tarjeta=6734&meses=6&mensualidad=228.71&msgId=m2'));

  for (const raw of [firestore, url]) {
    const r = prefillDesdeDatos(raw, TARJETAS, [], []);
    assert.equal(r.tipo, 'msi');
    assert.equal(r.datos.mesesTotal, 6);
    // La mensualidad del banco manda: no se recalcula como total/meses (228.705)
    assert.equal(r.datos.mensualidad, 228.71);
    assert.equal(r.datos.tarjetaId, 'tc-revolut');
  }
});

test('`meses` en 0 o vacío no la vuelve a plazos', () => {
  const base = { desc: 'X', total: 10, fecha: '2026-08-08', tarjeta: 'NA' };
  assert.equal(prefillDesdeDatos({ ...base, meses: 0 },  TARJETAS, [], []).tipo, 'contado');
  assert.equal(prefillDesdeDatos({ ...base, meses: '' }, TARJETAS, [], []).tipo, 'contado');
  assert.equal(prefillDesdeDatos(base,                   TARJETAS, [], []).tipo, 'contado');
});

test('sin terminación reconocible el select queda vacío, no adivina', () => {
  const r = prefillDesdeDatos({ desc: 'Steam', total: 249, fecha: '2026-08-05', tarjeta: 'NA' },
    TARJETAS, [], []);
  assert.equal(r.datos.tarjetaId, '');
  assert.equal(r.datos.numeroTarjeta, '');
});

test('detecta duplicado por msgId en cualquiera de las dos colecciones', () => {
  const raw = { desc: 'Amazon', total: 1499, fecha: '2026-08-08', tarjeta: '4321', msgId: 'm1' };
  assert.equal(prefillDesdeDatos(raw, TARJETAS, [{ msgId: 'm1' }], []), 'duplicado');
  assert.equal(prefillDesdeDatos(raw, TARJETAS, [], [{ msgId: 'm1' }]), 'duplicado');
  assert.notEqual(prefillDesdeDatos(raw, TARJETAS, [{ msgId: 'otro' }], []), 'duplicado');
});

test('sin descripción o sin total válido devuelve null', () => {
  assert.equal(prefillDesdeDatos({ total: 10, fecha: '2026-08-08' }, TARJETAS, [], []), null);
  assert.equal(prefillDesdeDatos({ desc: 'X', total: 'abc' },        TARJETAS, [], []), null);
  assert.equal(prefillDesdeDatos({ desc: 'X' },                      TARJETAS, [], []), null);
});

test('fecha con otro formato cae a hoy', () => {
  // PayPal manda "8 ago 2026" en el cuerpo; el Apps Script ya la reemplaza por
  // la fecha del correo, pero si algo se colara, la vista no debe romperse.
  const r = prefillDesdeDatos({ desc: 'X', total: 10, fecha: '8 ago 2026' }, TARJETAS, [], []);
  assert.equal(r.datos.fechaCompra, HOY);
  assert.equal(r.datos.hora, undefined);
});

test('hora con forma inválida se descarta entera', () => {
  // El filtro es de FORMA, no de validez: '9:05' se descarta por no tener dos
  // dígitos, pero un imposible bien formado como '25:99' pasaría. La única
  // fuente real es Utilities.formatDate(…, 'HH:mm'), que nunca produce eso.
  const r = prefillDesdeDatos({ desc: 'X', total: 10, fecha: '2026-08-08', hora: '9:05' },
    TARJETAS, [], []);
  assert.equal(r.datos.fechaCompra, '2026-08-08');
  assert.equal(r.datos.hora, undefined);
});

test('la hora viaja aparte del datetime para no confundir mediodía real con el centinela', () => {
  const r = prefillDesdeDatos({ desc: 'X', total: 10, fecha: '2026-08-08', hora: '12:00' },
    TARJETAS, [], []);
  assert.equal(r.datos.fechaCompra, '2026-08-08T12:00:00');
  assert.equal(r.datos.hora, '12:00');
});

console.log(`\n${pasadas} pruebas ok`);
