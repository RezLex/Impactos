/**
 * Pruebas de disponibilidad de gastos fijos por forma de pago.
 * Sin framework ni dependencias: `node test/ciclo.test.mjs`.
 */
import assert from 'node:assert/strict';
import { gastoFijoDisponible, toISODate, calcularMes } from '../js/utils/ciclo.js';

let pasadas = 0, fallidas = 0;
const test = (nombre, fn) => {
  try { fn(); pasadas++; console.log(`  ok  ${nombre}`); }
  catch (e) { fallidas++; console.error(`FALLA  ${nombre}\n       ${e.message}`); }
};
const grupo = n => console.log(`\n── ${n} ${'─'.repeat(Math.max(0, 60 - n.length))}`);

const d = (y, m, day) => new Date(y, m - 1, day, 12);

const FECHA_COBRO = d(2026, 3, 20);

// ─────────────────────────────────────────────────────────────────────────────
// Disponible solo cuando la fecha ya llegó — sin importar la forma de pago
// (antes 'automatico' estaba siempre disponible y 'retiro' desde la quincena
// anterior; se simplificó a un único criterio para las tres formas de pago).
grupo('gastoFijoDisponible');

test('no disponible antes de que llegue la fecha, sin importar la forma de pago', () => {
  assert.equal(gastoFijoDisponible('automatico', FECHA_COBRO, '2026-03-19'), false);
  assert.equal(gastoFijoDisponible('retiro', FECHA_COBRO, '2026-03-19'), false);
  assert.equal(gastoFijoDisponible('transferencia', FECHA_COBRO, '2026-03-19'), false);
  assert.equal(gastoFijoDisponible(undefined, FECHA_COBRO, '2026-03-19'), false);
});
test('disponible el día exacto de la fecha y después, sin importar la forma de pago', () => {
  assert.equal(gastoFijoDisponible('automatico', FECHA_COBRO, '2026-03-20'), true);
  assert.equal(gastoFijoDisponible('retiro', FECHA_COBRO, '2026-03-20'), true);
  assert.equal(gastoFijoDisponible('transferencia', FECHA_COBRO, '2026-03-25'), true);
  assert.equal(gastoFijoDisponible('', FECHA_COBRO, '2026-03-20'), true);
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('calcularMes — corteSoloCalculo');

// Corte día 26, +20 días al pago. 26-sep-2026 cae sábado.
const CICLO_B = { diaCorte: 26, diasAlPago: 20, ajusteCorte: 'siguiente', ajustePago: 'siguiente' };

test('sin corteSoloCalculo: corte y pago se calculan ambos desde el hábil siguiente (28-sep)', () => {
  const p = calcularMes(CICLO_B, 2026, 8, []); // septiembre (0-indexed)
  assert.equal(toISODate(p.fechaCorte), '2026-09-28');
  assert.equal(toISODate(p.fechaPago), '2026-10-19');
});

test('con corteSoloCalculo: se muestra el corte nominal (26) pero el pago se sigue contando desde el hábil siguiente', () => {
  const p = calcularMes({ ...CICLO_B, corteSoloCalculo: true }, 2026, 8, []);
  assert.equal(toISODate(p.fechaCorte), '2026-09-26');
  assert.equal(toISODate(p.fechaPago), '2026-10-19');
});

test('corteSoloCalculo no afecta un corte que ya cae en día hábil', () => {
  // 20-nov-2026 es viernes, ya hábil — nominal y ajustado coinciden.
  const p1 = calcularMes(CICLO_B, 2026, 10, []);
  const p2 = calcularMes({ ...CICLO_B, corteSoloCalculo: true }, 2026, 10, []);
  assert.equal(toISODate(p1.fechaCorte), toISODate(p2.fechaCorte));
  assert.equal(toISODate(p1.fechaPago), toISODate(p2.fechaPago));
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${fallidas ? '✗' : '✓'} ${pasadas} pasadas, ${fallidas} fallidas\n`);
process.exit(fallidas ? 1 : 0);
