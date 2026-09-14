/**
 * calcularSaldo / limitarDisponible (js/utils/saldo.js).
 * Sin framework: `node test/saldo.test.mjs`.
 */
import assert from 'node:assert/strict';
import { calcularSaldo, limitarDisponible } from '../js/utils/saldo.js';

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

console.log(`\n${pasadas} pruebas ok`);
