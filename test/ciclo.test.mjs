/**
 * Pruebas de disponibilidad de gastos fijos por forma de pago.
 * Sin framework ni dependencias: `node test/ciclo.test.mjs`.
 */
import assert from 'node:assert/strict';
import { gastoFijoDisponible, anteriorNomina, toISODate } from '../js/utils/ciclo.js';

let pasadas = 0, fallidas = 0;
const test = (nombre, fn) => {
  try { fn(); pasadas++; console.log(`  ok  ${nombre}`); }
  catch (e) { fallidas++; console.error(`FALLA  ${nombre}\n       ${e.message}`); }
};
const grupo = n => console.log(`\n── ${n} ${'─'.repeat(Math.max(0, 60 - n.length))}`);

const d = (y, m, day) => new Date(y, m - 1, day, 12);

// 20 de marzo 2026 (viernes) — quincena anterior es el 15 (domingo), ajustada
// al hábil anterior: 13 de marzo (viernes). Verificado contra anteriorNomina.
const FECHA_COBRO = d(2026, 3, 20);
const QUINCENA_ANTERIOR = toISODate(anteriorNomina(FECHA_COBRO, []));

// ─────────────────────────────────────────────────────────────────────────────
grupo('gastoFijoDisponible — automatico');

test('siempre disponible, incluso con la fecha calculada en el futuro', () => {
  assert.equal(gastoFijoDisponible('automatico', FECHA_COBRO, '2026-03-01'), true);
});
test('sigue disponible el día exacto y después', () => {
  assert.equal(gastoFijoDisponible('automatico', FECHA_COBRO, '2026-03-20'), true);
  assert.equal(gastoFijoDisponible('automatico', FECHA_COBRO, '2026-03-25'), true);
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('gastoFijoDisponible — retiro');

test('la quincena anterior calculada es la esperada (verificación del fixture)', () => {
  assert.equal(QUINCENA_ANTERIOR, '2026-03-13');
});
test('disponible desde la quincena anterior, antes de la fecha exacta de cobro', () => {
  assert.equal(gastoFijoDisponible('retiro', FECHA_COBRO, QUINCENA_ANTERIOR), true);
  assert.equal(gastoFijoDisponible('retiro', FECHA_COBRO, '2026-03-19'), true, 'después de la quincena, antes del cobro');
});
test('no disponible antes de que caiga la quincena anterior', () => {
  assert.equal(gastoFijoDisponible('retiro', FECHA_COBRO, '2026-03-12'), false);
});
test('sigue disponible el día exacto de cobro y después', () => {
  assert.equal(gastoFijoDisponible('retiro', FECHA_COBRO, '2026-03-20'), true);
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('gastoFijoDisponible — transferencia y sin especificar');

test('transferencia: mismo criterio original, fecha ≤ hoy', () => {
  assert.equal(gastoFijoDisponible('transferencia', FECHA_COBRO, '2026-03-19'), false);
  assert.equal(gastoFijoDisponible('transferencia', FECHA_COBRO, '2026-03-20'), true);
});
test('formaPago vacío o sin especificar: mismo criterio original', () => {
  assert.equal(gastoFijoDisponible('', FECHA_COBRO, '2026-03-19'), false);
  assert.equal(gastoFijoDisponible(undefined, FECHA_COBRO, '2026-03-20'), true);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${fallidas ? '✗' : '✓'} ${pasadas} pasadas, ${fallidas} fallidas\n`);
process.exit(fallidas ? 1 : 0);
