/**
 * calcularSaldo / limitarDisponible (js/utils/saldo.js).
 * Sin framework: `node test/saldo.test.mjs`.
 */
import assert from 'node:assert/strict';
import { calcularSaldo, limitarDisponible, detalleEventosPosteriores } from '../js/utils/saldo.js';

let pasadas = 0;
const test = (nombre, fn) => { fn(); pasadas++; console.log('ok  ' + nombre); };

// ── calcularSaldo: crédito fechado "hoy" (sin hora) vs. actualización más
// temprano el mismo día ─────────────────────────────────────────────────────
// Antes del fix, new Date("2026-09-14") (medianoche UTC) comparaba como
// ANTERIOR a una fechaActualizacionSaldo del mismo día con hora real (p.ej.
// mediodía), así que el crédito nunca contaba como "posterior" y quedaba
// ignorado — el bug reportado ("sigue sin reflejar el saldo a favor").
const TARJETA = { id: 't1', tipo: 'credito', saldoDisponible: 1000, limiteTotal: 5000 };

test('calcularSaldo: crédito fechado "hoy" (sin hora) cuenta aunque la tarjeta se haya actualizado más temprano el mismo día', () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const tarjeta = { ...TARJETA, fechaActualizacionSaldo: `${hoy}T08:00:00.000Z` };
  const creditos = [{ tarjetaId: 't1', fecha: hoy, monto: 300 }];
  const r = calcularSaldo(tarjeta, [], [], [], [], creditos);
  assert.equal(r.disponible, 1300);
});

test('calcularSaldo: un cargo fechado "hoy" (sin hora) también cuenta como posterior', () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const tarjeta = { ...TARJETA, fechaActualizacionSaldo: `${hoy}T08:00:00.000Z` };
  const contado = [{ tarjetaId: 't1', fechaCompra: hoy, total: 150 }];
  const r = calcularSaldo(tarjeta, contado, [], [], [], []);
  assert.equal(r.disponible, 850);
});

test('calcularSaldo: fecha anterior (sin hora) a un día previo de actualización no cuenta', () => {
  const tarjeta = { ...TARJETA, fechaActualizacionSaldo: '2026-09-14T08:00:00.000Z' };
  const creditos = [{ tarjetaId: 't1', fecha: '2026-09-10', monto: 300 }];
  const r = calcularSaldo(tarjeta, [], [], [], [], creditos);
  assert.equal(r.disponible, 1000);
});

test('limitarDisponible: por debajo del límite no cambia nada', () => {
  const r = limitarDisponible(500, 1000);
  assert.equal(r.disponible, 500);
  assert.equal(r.excedente, 0);
});

test('limitarDisponible: igual al límite no genera excedente', () => {
  const r = limitarDisponible(1000, 1000);
  assert.equal(r.disponible, 1000);
  assert.equal(r.excedente, 0);
});

test('limitarDisponible: por encima del límite se recorta y el resto es excedente', () => {
  const r = limitarDisponible(1200, 1000);
  assert.equal(r.disponible, 1000);
  assert.equal(r.excedente, 200);
});

test('limitarDisponible: sin límite configurado no recorta', () => {
  assert.equal(limitarDisponible(1200, null).disponible, 1200);
  assert.equal(limitarDisponible(1200, 0).excedente, 0);
});

// ── detalleEventosPosteriores ────────────────────────────────────────────────

test('detalleEventosPosteriores: su suma coincide con gastoPosterior de calcularSaldo', () => {
  const tarjeta = { ...TARJETA, fechaActualizacionSaldo: '2026-09-14T08:00:00.000Z' };
  const contado = [{ id: 'c1', tarjetaId: 't1', compra: 'Amazon', fechaCompra: '2026-09-15', total: 200 }];
  const creditos = [{ id: 'cr1', tarjetaId: 't1', nota: 'Cancelación', fecha: '2026-09-16', monto: 50 }];
  const r = calcularSaldo(tarjeta, contado, [], [], [], creditos);
  const detalle = detalleEventosPosteriores(tarjeta, contado, [], [], [], creditos);
  const sumaDetalle = detalle.reduce((s, e) => s + e.monto, 0);
  assert.equal(sumaDetalle, r.gastoPosterior);
  assert.equal(detalle.length, 2);
});

test('detalleEventosPosteriores: créditos van con monto negativo (suman al disponible)', () => {
  const tarjeta = { ...TARJETA, fechaActualizacionSaldo: '2026-09-14T08:00:00.000Z' };
  const creditos = [{ id: 'cr1', tarjetaId: 't1', fecha: '2026-09-16', monto: 50 }];
  const detalle = detalleEventosPosteriores(tarjeta, [], [], [], [], creditos);
  assert.equal(detalle[0].tipo, 'credito');
  assert.equal(detalle[0].monto, -50);
});

test('detalleEventosPosteriores: ignora eventos anteriores a la referencia o de otra tarjeta', () => {
  const tarjeta = { ...TARJETA, fechaActualizacionSaldo: '2026-09-14T08:00:00.000Z' };
  const contado = [
    { id: 'c1', tarjetaId: 't1', fechaCompra: '2026-09-10', total: 200 }, // anterior
    { id: 'c2', tarjetaId: 'otra', fechaCompra: '2026-09-16', total: 200 }, // otra tarjeta
  ];
  assert.equal(detalleEventosPosteriores(tarjeta, contado).length, 0);
});

test('detalleEventosPosteriores: un pago diferido muestra el nombre de su compra padre, no un texto genérico', () => {
  const tarjeta = { ...TARJETA, fechaActualizacionSaldo: '2026-09-14T08:00:00.000Z' };
  const contado = [{ id: 'c1', tarjetaId: 't1', compra: 'Amazon Fresh', diferido: true, total: 50 }];
  const pagos = [{ id: 'p1', tarjetaId: 't1', compraId: 'c1', fecha: '2026-09-16', monto: 100 }];
  const detalle = detalleEventosPosteriores(tarjeta, contado, [], [], pagos);
  assert.equal(detalle.find(e => e.tipo === 'pagoDiferido').nombre, 'Pago diferido — Amazon Fresh');
});

test('detalleEventosPosteriores: pago diferido sin compra padre encontrada usa el texto genérico', () => {
  const tarjeta = { ...TARJETA, fechaActualizacionSaldo: '2026-09-14T08:00:00.000Z' };
  const pagos = [{ id: 'p1', tarjetaId: 't1', compraId: 'no-existe', fecha: '2026-09-16', monto: 100 }];
  const detalle = detalleEventosPosteriores(tarjeta, [], [], [], pagos);
  assert.equal(detalle[0].nombre, 'Pago diferido');
});

test('detalleEventosPosteriores: compra diferida "completa" (checkmark) no deja un residuo de redondeo del total guardado', () => {
  // totalDiferido 1177.40, pagos registrados suman exactamente eso — el campo
  // `total` guardado quedó en 0.03 por drift de redondeo (bug real reportado).
  const tarjeta = { ...TARJETA, fechaActualizacionSaldo: '2026-09-14T08:00:00.000Z' };
  const contado = [{
    id: 'c1', tarjetaId: 't1', compra: 'Amazon Fresh Step Cat', diferido: true,
    fechaCompra: '2026-09-24', totalDiferido: 1177.40, total: 0.03,
  }];
  const pagos = [
    { id: 'p1', tarjetaId: 't1', compraId: 'c1', fecha: '2026-09-25', monto: 220.60 },
    { id: 'p2', tarjetaId: 't1', compraId: 'c1', fecha: '2026-09-25', monto: 167.99 },
    { id: 'p3', tarjetaId: 't1', compraId: 'c1', fecha: '2026-09-25', monto: 168.85 },
    { id: 'p4', tarjetaId: 't1', compraId: 'c1', fecha: '2026-09-26', monto: 224.44 },
    { id: 'p5', tarjetaId: 't1', compraId: 'c1', fecha: '2026-09-26', monto: 395.52 },
  ];
  const detalle = detalleEventosPosteriores(tarjeta, contado, [], [], pagos);
  assert.equal(detalle.filter(e => e.tipo === 'contado').length, 0, 'no debe agregar el residuo de $0.03 del campo guardado');
  const total = detalle.reduce((s, e) => s + e.monto, 0);
  assert.equal(Math.round(total * 100) / 100, 1177.40, 'el total debe ser la suma de los pagos reales, no 1177.43');
});

console.log(`\n${pasadas} pruebas ok`);
