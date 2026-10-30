/**
 * Pruebas del motor de Bonificaciones por institución. Sin framework:
 * `node test/bonificaciones.test.mjs`.
 */
import assert from 'node:assert/strict';
import {
  baseCompra, estadoBonificacion, calcularDistribucion, claveInstitucion, generarFolio,
} from '../js/utils/bonificaciones.js';

let pasadas = 0, fallidas = 0;
const test = (nombre, fn) => {
  try { fn(); pasadas++; console.log(`  ok  ${nombre}`); }
  catch (e) { fallidas++; console.error(`FALLA  ${nombre}\n       ${e.message}`); }
};
const grupo = n => console.log(`\n── ${n} ${'─'.repeat(Math.max(0, 60 - n.length))}`);
const cerca = (a, b, msg, tol = 0.01) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} ≉ ${b}`);

const pct10 = extra => ({ tipo: 'porcentaje', valor: 10, minimoPor: 'compra', ...extra });

// ─────────────────────────────────────────────────────────────────────────────
grupo('baseCompra / estadoBonificacion');

test('base: total; diferida usa totalDiferido (total es el pendiente)', () => {
  assert.equal(baseCompra({ total: 500 }), 500);
  assert.equal(baseCompra({ diferido: true, total: 100, totalDiferido: 900 }), 900);
});
test('estado: aplicada > vencida > vigente', () => {
  assert.equal(estadoBonificacion({ aplicada: true, fechaMaxima: '2020-01-01' }, '2026-10-30'), 'aplicada');
  assert.equal(estadoBonificacion({ fechaMaxima: '2026-10-29' }, '2026-10-30'), 'vencida');
  assert.equal(estadoBonificacion({ fechaMaxima: '2026-10-30' }, '2026-10-30'), 'vigente');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('calcularDistribucion: porcentaje');

test('sin mínimo ni tope: valor% de cada compra', () => {
  const d = calcularDistribucion(pct10(), [{ id: 'a', total: 1000 }, { id: 'b', total: 500 }]);
  cerca(d.porCompra.get('a').monto, 100, 'a');
  cerca(d.porCompra.get('b').monto, 50, 'b');
  cerca(d.porCompra.get('a').pct, 10, '% de a');
  cerca(d.esperado, 150, 'esperado');
  assert.equal(d.topado, false);
});
test('con IVA multiplica por 1.16', () => {
  const d = calcularDistribucion(pct10(), [{ id: 'a', total: 1000 }], true);
  cerca(d.porCompra.get('a').monto, 116, 'a con IVA');
});
test('tope: se escala proporcionalmente y el esperado es el máximo', () => {
  const d = calcularDistribucion(pct10({ montoMaximo: 90 }), [{ id: 'a', total: 1000 }, { id: 'b', total: 500 }]);
  assert.equal(d.topado, true);
  cerca(d.esperado, 90, 'esperado topado');
  cerca(d.porCompra.get('a').monto, 60, 'a = 2/3 del tope');
  cerca(d.porCompra.get('b').monto, 30, 'b = 1/3 del tope');
  cerca(d.porCompra.get('a').pct, 6, '% efectivo de a');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('calcularDistribucion: mínimo por compra (folio)');

test('compras del mismo folio se suman para el mínimo', () => {
  const d = calcularDistribucion(pct10({ montoMinimo: 1000 }), [
    { id: 'a', total: 600, folioOrden: 'X-01' },
    { id: 'b', total: 500, folioOrden: 'X-01' },
    { id: 'c', total: 900, folioOrden: 'X-02' },
  ]);
  assert.equal(d.porCompra.get('a').califica, true);
  assert.equal(d.porCompra.get('b').califica, true);
  assert.equal(d.porCompra.get('c').califica, false);
  cerca(d.porCompra.get('c').monto, 0, 'c no califica');
  cerca(d.esperado, 110, 'solo la orden X-01');
  const g2 = d.grupos.find(g => g.folio === 'X-02');
  cerca(g2.faltante, 100, 'faltante de X-02');
});
test('compra sin folio es su propia orden', () => {
  const d = calcularDistribucion(pct10({ montoMinimo: 1000 }), [{ id: 'a', total: 600 }, { id: 'b', total: 600 }]);
  assert.equal(d.porCompra.get('a').califica, false);
  assert.equal(d.porCompra.get('b').califica, false);
});
test('cantidad fija: se otorga por cada orden que califica, repartida por su base', () => {
  const d = calcularDistribucion({ tipo: 'cantidad', valor: 200, minimoPor: 'compra', montoMinimo: 1000 }, [
    { id: 'a', total: 750, folioOrden: 'X-01' },
    { id: 'b', total: 250, folioOrden: 'X-01' },
    { id: 'c', total: 1500, folioOrden: 'X-02' },
  ]);
  cerca(d.porCompra.get('a').monto, 150, 'a: 3/4 de 200');
  cerca(d.porCompra.get('b').monto, 50, 'b: 1/4 de 200');
  cerca(d.porCompra.get('c').monto, 200, 'c: su orden completa');
  cerca(d.esperado, 400, 'dos órdenes');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('calcularDistribucion: mínimo acumulado');

test('no alcanza el acumulado: nadie recibe y se reporta el faltante', () => {
  const d = calcularDistribucion(pct10({ minimoPor: 'acumulado', montoMinimo: 2000 }), [
    { id: 'a', total: 600, folioOrden: 'ignorado' }, { id: 'b', total: 900 },
  ]);
  assert.equal(d.grupos.length, 1);
  assert.equal(d.grupos[0].califica, false);
  cerca(d.grupos[0].faltante, 500, 'faltante');
  cerca(d.esperado, 0, 'esperado');
});
test('alcanza el acumulado: cantidad fija una sola vez, repartida', () => {
  const d = calcularDistribucion({ tipo: 'cantidad', valor: 300, minimoPor: 'acumulado', montoMinimo: 1000 }, [
    { id: 'a', total: 400 }, { id: 'b', total: 800 },
  ]);
  cerca(d.porCompra.get('a').monto, 100, 'a: 1/3');
  cerca(d.porCompra.get('b').monto, 200, 'b: 2/3');
  cerca(d.esperado, 300, 'una sola vez');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('folios');

test('clave de institución: sin acentos, símbolos ni espacios, en mayúsculas', () => {
  assert.equal(claveInstitucion('Banco Azteca'), 'BANCOAZTECA');
  assert.equal(claveInstitucion('Crédito-Nú'), 'CREDITONU');
  assert.equal(claveInstitucion(''), 'INST');
});
test('primer folio del día termina en 01', () => {
  assert.equal(generarFolio('BBVA', '2026-10-30', []), 'BBVA-301026-01');
});
test('consecutivo sobre el máximo del mismo prefijo; otros prefijos no cuentan', () => {
  const compras = [
    { folioOrden: 'BBVA-301026-01' }, { folioOrden: 'BBVA-301026-04' },
    { folioOrden: 'BBVA-311026-09' }, { folioOrden: 'NU-301026-07' }, {},
  ];
  assert.equal(generarFolio('BBVA', '2026-10-30T18:22:00', compras), 'BBVA-301026-05');
});

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas) process.exit(1);
