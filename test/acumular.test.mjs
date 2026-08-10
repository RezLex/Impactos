/**
 * Reglas de "Acumular compra" (js/utils/acumular.js).
 * Sin framework: `node test/acumular.test.mjs`.
 */
import assert from 'node:assert/strict';
import { opcionesAcumulables, totalAcumulado, MAX_COMPRAS } from '../js/utils/acumular.js';

const TARJETAS = [
  { id: 'tc-nu',      tipo: 'credito', numeros: [{ formato: 'fisica', numero: '5301 2233 4455 4321' }] },
  { id: 'tc-revolut', tipo: 'credito', numeros: [{ formato: 'digital', numero: '4111 9900 1122 2167' }] },
];

const noti = (id, tarjeta, extra = {}) => ({
  id, tipo: 'compra', estatus: 'pendiente',
  datos: { desc: 'X', total: 100, tarjeta, msgId: 'msg-' + id, ...extra },
});

const compra = (id, tarjetaId, fechaCompra, total = 50) => ({ id, tarjetaId, fechaCompra, total, compra: 'C-' + id });

let pasadas = 0;
const test = (nombre, fn) => { fn(); pasadas++; console.log('ok  ' + nombre); };

test('solo ofrece lo de la tarjeta elegida', () => {
  const r = opcionesAcumulables({
    tarjetaId: 'tc-nu',
    notificaciones: [noti('a', '4321'), noti('b', '2167')],
    contado: [compra('c1', 'tc-nu', '2026-08-01'), compra('c2', 'tc-revolut', '2026-08-02')],
    tarjetas: TARJETAS,
  });
  assert.deepEqual(r.notificaciones.map(n => n.id), ['a']);
  assert.deepEqual(r.compras.map(c => c.id), ['c1']);
});

test('la notificación se resuelve por terminación, no por tarjetaId', () => {
  // La notificación no guarda tarjetaId; si se filtrara por ese campo (que no
  // existe en el documento) la lista saldría siempre vacía.
  const r = opcionesAcumulables({
    tarjetaId: 'tc-revolut',
    notificaciones: [noti('a', '2167')],
    tarjetas: TARJETAS,
  });
  assert.deepEqual(r.notificaciones.map(n => n.id), ['a']);
});

test('no se ofrece acumularse consigo misma', () => {
  const abierta = noti('a', '4321');
  const r = opcionesAcumulables({
    tarjetaId: 'tc-nu',
    notificaciones: [abierta, noti('b', '4321')],
    tarjetas: TARJETAS,
    msgIdActual: abierta.datos.msgId,
  });
  assert.deepEqual(r.notificaciones.map(n => n.id), ['b']);
});

test('ignora notificaciones ya cerradas y de otro tipo', () => {
  const r = opcionesAcumulables({
    tarjetaId: 'tc-nu',
    notificaciones: [
      { ...noti('proc', '4321'), estatus: 'procesada' },
      { ...noti('desc', '4321'), estatus: 'descartada' },
      { ...noti('otro', '4321'), tipo: 'recordatorio' },
      noti('viva', '4321'),
    ],
    tarjetas: TARJETAS,
  });
  assert.deepEqual(r.notificaciones.map(n => n.id), ['viva']);
});

test(`toma las ${MAX_COMPRAS} compras más recientes, no las primeras del array`, () => {
  const r = opcionesAcumulables({
    tarjetaId: 'tc-nu',
    contado: [
      compra('vieja',  'tc-nu', '2026-07-01'),
      compra('nueva',  'tc-nu', '2026-08-09T20:00:00'),
      compra('media1', 'tc-nu', '2026-08-05'),
      compra('media2', 'tc-nu', '2026-08-04'),
      compra('media3', 'tc-nu', '2026-08-03'),
      compra('media4', 'tc-nu', '2026-08-02'),
    ],
    tarjetas: TARJETAS,
  });
  assert.equal(r.compras.length, MAX_COMPRAS);
  assert.deepEqual(r.compras.map(c => c.id), ['nueva', 'media1', 'media2', 'media3', 'media4']);
  assert.ok(!r.compras.some(c => c.id === 'vieja'));
});

test('sin tarjeta elegida no ofrece nada: acumular es siempre dentro de la misma', () => {
  const r = opcionesAcumulables({
    tarjetaId: '',
    notificaciones: [noti('a', '4321')],
    contado: [compra('c1', 'tc-nu', '2026-08-01')],
    tarjetas: TARJETAS,
  });
  assert.deepEqual(r, { notificaciones: [], compras: [] });
});

test('una compra sin fecha no rompe el orden ni desaparece', () => {
  const r = opcionesAcumulables({
    tarjetaId: 'tc-nu',
    contado: [compra('sinfecha', 'tc-nu', undefined), compra('con', 'tc-nu', '2026-08-01')],
    tarjetas: TARJETAS,
  });
  assert.deepEqual(r.compras.map(c => c.id), ['con', 'sinfecha']);
});

test('el total suma y se redondea a dos decimales', () => {
  assert.equal(totalAcumulado(1372.23, { total: 195.7 }), 1567.93);
  // Sin r2 esto daría 0.30000000000000004
  assert.equal(totalAcumulado(0.1, { total: 0.2 }), 0.3);
});

test('sin opción elegida el total es el del formulario', () => {
  assert.equal(totalAcumulado(500, null), 500);
  assert.equal(totalAcumulado('500', undefined), 500);   // el input llega como string
  assert.equal(totalAcumulado('', null), 0);
});

console.log(`\n${pasadas} pruebas ok`);
