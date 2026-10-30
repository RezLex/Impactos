/**
 * Pruebas del cálculo del módulo Deseos. Sin framework: `node test/deseos.test.mjs`.
 */
import assert from 'node:assert/strict';
import {
  variacionPct, registrarPrecio, historialConVariacion, ultimaVariacion, mejorOpcion, nuevoIdOpcion,
} from '../js/utils/deseos.js';

let pasadas = 0, fallidas = 0;
const test = (nombre, fn) => {
  try { fn(); pasadas++; console.log(`  ok  ${nombre}`); }
  catch (e) { fallidas++; console.error(`FALLA  ${nombre}\n       ${e.message}`); }
};
const grupo = n => console.log(`\n── ${n} ${'─'.repeat(Math.max(0, 60 - n.length))}`);
const cerca = (a, b, msg, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} ≉ ${b}`);

grupo('variacionPct');
test('sube y baja', () => {
  cerca(variacionPct(100, 110), 10, 'sube 10%');
  cerca(variacionPct(200, 150), -25, 'baja 25%');
});
test('sin base (0 o vacío) devuelve null', () => {
  assert.equal(variacionPct(0, 50), null);
  assert.equal(variacionPct(undefined, 50), null);
});

grupo('registrarPrecio');
test('primer precio crea la primera entrada', () => {
  const o = registrarPrecio({ id: 'x', tienda: 'A' }, 500, '2026-10-01');
  assert.equal(o.precio, 500);
  assert.deepEqual(o.historial, [{ fecha: '2026-10-01', precio: 500 }]);
});
test('mismo precio no agrega entrada; precio distinto sí', () => {
  let o = registrarPrecio({ id: 'x' }, 500, '2026-10-01');
  o = registrarPrecio(o, 500, '2026-10-05');
  assert.equal(o.historial.length, 1);
  o = registrarPrecio(o, 450, '2026-10-09');
  assert.equal(o.historial.length, 2);
  assert.equal(o.precio, 450);
});
test('no muta la opción original', () => {
  const orig = { id: 'x', precio: 1, historial: [{ fecha: 'f', precio: 1 }] };
  registrarPrecio(orig, 2, 'g');
  assert.equal(orig.historial.length, 1);
  assert.equal(orig.precio, 1);
});

grupo('historialConVariacion / ultimaVariacion');
test('más reciente primero, cada una contra la anterior registrada', () => {
  const h = historialConVariacion([
    { fecha: '1', precio: 100 }, { fecha: '2', precio: 120 }, { fecha: '3', precio: 90 },
  ]);
  assert.deepEqual(h.map(x => x.fecha), ['3', '2', '1']);
  cerca(h[0].variacion, -25, '120 → 90');
  cerca(h[1].variacion, 20, '100 → 120');
  assert.equal(h[2].variacion, null);
});
test('última variación', () => {
  cerca(ultimaVariacion({ historial: [{ precio: 100 }, { precio: 80 }] }), -20, '100 → 80');
  assert.equal(ultimaVariacion({ historial: [{ precio: 100 }] }), null);
});

grupo('mejorOpcion / nuevoIdOpcion');
test('la más barata con precio > 0', () => {
  const m = mejorOpcion([{ id: 'a', precio: 300 }, { id: 'b', precio: 0 }, { id: 'c', precio: 250 }]);
  assert.equal(m.id, 'c');
  assert.equal(mejorOpcion([]), null);
});
test('ids distintos', () => {
  assert.notEqual(nuevoIdOpcion(), nuevoIdOpcion());
});

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas) process.exit(1);
