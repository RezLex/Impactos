/**
 * Pruebas de conversión de unidades. Sin framework: `node test/unidades.test.mjs`.
 */
import assert from 'node:assert/strict';
import { convertir, familiaDeUnidad, UNIDADES_VOLUMEN, UNIDADES_MASA } from '../js/utils/unidades.js';

let pasadas = 0, fallidas = 0;
const test = (nombre, fn) => {
  try { fn(); pasadas++; console.log(`  ok  ${nombre}`); }
  catch (e) { fallidas++; console.error(`FALLA  ${nombre}\n       ${e.message}`); }
};
const grupo = n => console.log(`\n── ${n} ${'─'.repeat(Math.max(0, 60 - n.length))}`);
const cerca = (a, b, msg, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} ≉ ${b}`);

// ─────────────────────────────────────────────────────────────────────────────
grupo('Volumen');

test('litros a mililitros', () => cerca(convertir(2, 'L', 'ml'), 2000, 'L→ml'));
test('mililitros a litros', () => cerca(convertir(500, 'ml', 'L'), 0.5, 'ml→L'));
test('galones a litros', () => cerca(convertir(1, 'gal', 'L'), 3.785411784, 'gal→L'));
test('litros a galones (ida y vuelta)', () => cerca(convertir(convertir(10, 'L', 'gal'), 'gal', 'L'), 10, 'L→gal→L'));

// ─────────────────────────────────────────────────────────────────────────────
grupo('Masa');

test('kilos a gramos', () => cerca(convertir(1.5, 'kg', 'g'), 1500, 'kg→g'));
test('libras a kilos', () => cerca(convertir(1, 'lb', 'kg'), 0.45359237, 'lb→kg'));
test('gramos a libras (ida y vuelta)', () => cerca(convertir(convertir(2000, 'g', 'lb'), 'lb', 'g'), 2000, 'g→lb→g'));

// ─────────────────────────────────────────────────────────────────────────────
grupo('Misma unidad y unidades libres (pieza)');

test('misma unidad no convierte', () => cerca(convertir(5, 'L', 'L'), 5, 'L→L'));
test('unidad libre igual a sí misma pasa directo', () => cerca(convertir(4, 'rollo', 'rollo'), 4, 'rollo→rollo'));
test('familiaDeUnidad devuelve null para unidades libres', () => assert.equal(familiaDeUnidad('rollo'), null));
test('familiaDeUnidad reconoce volumen y masa', () => {
  assert.equal(familiaDeUnidad('L'), 'volumen');
  assert.equal(familiaDeUnidad('kg'), 'masa');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Errores');

test('familias distintas lanzan error', () => assert.throws(() => convertir(1, 'L', 'kg')));
test('unidades libres distintas lanzan error', () => assert.throws(() => convertir(4, 'rollo', 'pieza')));
test('catálogos de unidades exportados', () => {
  assert.deepEqual(UNIDADES_VOLUMEN, ['ml', 'L', 'gal']);
  assert.deepEqual(UNIDADES_MASA, ['g', 'kg', 'lb']);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${fallidas ? '✗' : '✓'} ${pasadas} pasadas, ${fallidas} fallidas\n`);
process.exit(fallidas ? 1 : 0);
