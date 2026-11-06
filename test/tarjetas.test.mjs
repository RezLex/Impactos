/**
 * Pruebas de la baja lógica de tarjetas. Sin framework: `node test/tarjetas.test.mjs`.
 */
import assert from 'node:assert/strict';
import { esTarjetaActiva, tarjetasSeleccionables, numerosSeleccionables, numeroPorDefecto } from '../js/utils/tarjetas.js';
import { tarjetasCreditoDelMes } from '../js/utils/impacto-calc.js';
import { matchTarjetaPorTerminacion } from '../js/utils/prefill-compra.js';

let pasadas = 0, fallidas = 0;
const test = (nombre, fn) => {
  try { fn(); pasadas++; console.log(`  ok  ${nombre}`); }
  catch (e) { fallidas++; console.error(`FALLA  ${nombre}\n       ${e.message}`); }
};
const grupo = n => console.log(`\n── ${n} ${'─'.repeat(Math.max(0, 60 - n.length))}`);

const ACTIVA = { id: 'a', nombre: 'Activa', tipo: 'credito' };
const OCULTA = { id: 'o', nombre: 'Oculta', tipo: 'credito', oculta: true };
const BAJA   = { id: 'b', nombre: 'Vieja', tipo: 'credito', baja: true, fechaBaja: '2026-11-01' };

grupo('selectores');
test('esTarjetaActiva', () => {
  assert.equal(esTarjetaActiva(ACTIVA), true);
  assert.equal(esTarjetaActiva(BAJA), false);
});
test('sin registro en edición: solo activas y no ocultas', () => {
  assert.deepEqual(tarjetasSeleccionables([ACTIVA, OCULTA, BAJA]).map(t => t.id), ['a']);
});
test('la tarjeta dada de baja del registro en edición sigue disponible y marcada', () => {
  const r = tarjetasSeleccionables([ACTIVA, BAJA], 'b');
  assert.deepEqual(r.map(t => t.nombre), ['Activa', 'Vieja (baja)']);
  assert.equal(BAJA.nombre, 'Vieja', 'no muta el original');
});
test('la tarjeta oculta del registro en edición también sigue disponible', () => {
  assert.deepEqual(tarjetasSeleccionables([ACTIVA, OCULTA], 'o').map(t => t.id), ['a', 'o']);
});

grupo('detección por terminación');
test('no se casa con una tarjeta dada de baja', () => {
  const num = [{ numero: '4111111111111234', formato: 'fisica' }];
  assert.equal(matchTarjetaPorTerminacion('1234', [{ ...BAJA, numeros: num }]), null);
  assert.equal(matchTarjetaPorTerminacion('1234', [{ ...ACTIVA, numeros: num }])?.tarjetaId, 'a');
});

grupo('tarjetasCreditoDelMes');
const CICLO = { modo: 'dia', diaCorte: 10, diaPago: 28 };
test('activas siempre; débito nunca; baja sin cargos fuera', () => {
  const r = tarjetasCreditoDelMes([ACTIVA, BAJA, { id: 'd', tipo: 'debito' }], [], [], [], [], '2026-11');
  assert.deepEqual(r.map(t => t.id), ['a']);
});
test('baja con cargos en el mes sigue contando; en otro mes no', () => {
  const baja = { ...BAJA, ciclo: CICLO };
  const compra = { id: 'c', tarjetaId: 'b', total: 500, fechaCompra: '2026-10-20T12:00:00' };
  const conCargo = [10, 11, 12].map(m => `2026-${m}`)
    .filter(mes => tarjetasCreditoDelMes([baja], [compra], [], [], [], mes).length);
  assert.equal(conCargo.length, 1, `esperaba un solo mes con cargo, salieron: ${conCargo}`);
});

grupo('números dados de baja');
const F_BAJA = { formato: 'fisica', numero: '1111', baja: true, fechaBaja: '2026-11-01' };
const F_OK   = { formato: 'fisica', numero: '2222' };
const D_OK   = { formato: 'digital', numero: '3333' };
test('el selector solo ofrece activos', () => {
  assert.deepEqual(numerosSeleccionables({ numeros: [F_BAJA, D_OK] }).map(n => n.numero), ['3333']);
});
test('el número dado de baja del registro en edición sigue disponible', () => {
  assert.deepEqual(numerosSeleccionables({ numeros: [F_BAJA, D_OK] }, '1111').map(n => n.numero), ['1111', '3333']);
});
test('tarjeta sin números: lista vacía', () => {
  assert.deepEqual(numerosSeleccionables({}), []);
  assert.equal(numeroPorDefecto(undefined), null);
});
test('número por defecto: física activa, luego cualquier activo', () => {
  assert.equal(numeroPorDefecto([D_OK, F_OK]).numero, '2222');
  assert.equal(numeroPorDefecto([F_BAJA, D_OK]).numero, '3333');
});
test('número por defecto: sin activos usa el dado de baja', () => {
  assert.equal(numeroPorDefecto([F_BAJA]).numero, '1111');
});
test('la detección por terminación ignora números dados de baja', () => {
  const t = { ...ACTIVA, numeros: [{ formato: 'fisica', numero: '4111111111111234', baja: true }] };
  assert.equal(matchTarjetaPorTerminacion('1234', [t]), null);
  const conDigital = { ...ACTIVA, numeros: [...t.numeros, { formato: 'digital', numero: '5222222222221234' }] };
  assert.equal(matchTarjetaPorTerminacion('1234', [conDigital]).numero, '5222222222221234');
});

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas) process.exit(1);
