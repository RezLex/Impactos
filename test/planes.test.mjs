/**
 * Pruebas del cálculo de Planes de compra. Sin framework: `node test/planes.test.mjs`.
 */
import assert from 'node:assert/strict';
import { subtotalItem, claveOrden, calcularPlan, descuentoCupon } from '../js/utils/planes.js';

let pasadas = 0, fallidas = 0;
const test = (nombre, fn) => {
  try { fn(); pasadas++; console.log(`  ok  ${nombre}`); }
  catch (e) { fallidas++; console.error(`FALLA  ${nombre}\n       ${e.message}`); }
};
const grupo = n => console.log(`\n── ${n} ${'─'.repeat(Math.max(0, 60 - n.length))}`);
const cerca = (a, b, msg, tol = 0.01) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} ≉ ${b}`);

const B10 = { id: 'b10', institucionId: 'bbva', tipo: 'porcentaje', valor: 10, minimoPor: 'compra' };
const B5  = { id: 'b5',  institucionId: 'nu',   tipo: 'porcentaje', valor: 5,  minimoPor: 'compra' };

grupo('básicos');
test('subtotal = precio × cantidad (cantidad por defecto 1)', () => {
  assert.equal(subtotalItem({ precio: 250, cantidad: 3 }), 750);
  assert.equal(subtotalItem({ precio: 250 }), 250);
});
test('clave de orden ignora mayúsculas y espacios de la tienda', () => {
  assert.equal(claveOrden({ tienda: ' Amazon ', tarjetaId: 't1' }), claveOrden({ tienda: 'amazon', tarjetaId: 't1' }));
  assert.notEqual(claveOrden({ tienda: 'amazon', tarjetaId: 't1' }), claveOrden({ tienda: 'amazon', tarjetaId: 't2' }));
});

grupo('calcularPlan');
test('sin bonificación: neto = subtotal', () => {
  const r = calcularPlan({ items: [{ id: 'a', precio: 100, cantidad: 2 }] }, []);
  cerca(r.subtotal, 200, 'subtotal'); cerca(r.bonificacion, 0, 'bonif'); cerca(r.neto, 200, 'neto');
  assert.equal(r.porItem.get('a').califica, null);
});
test('el caso del ejemplo: más caro con mayor bonificación sale más barato', () => {
  const planA = { items: [{ id: 'x', precio: 1050, tienda: 'Liverpool', tarjetaId: 't-bbva', bonificacionId: 'b10' }] };
  const planB = { items: [{ id: 'x', precio: 1000, tienda: 'Amazon',    tarjetaId: 't-nu',   bonificacionId: 'b5'  }] };
  const a = calcularPlan(planA, [B10, B5]);
  const b = calcularPlan(planB, [B10, B5]);
  cerca(a.neto, 945, 'A: 1050 - 105');
  cerca(b.neto, 950, 'B: 1000 - 50');
  assert.ok(a.neto < b.neto);
});
test('mínimo por compra: misma tienda + tarjeta se suman como un carrito', () => {
  const bonif = { ...B10, montoMinimo: 1000 };
  const plan = { items: [
    { id: 'a', precio: 600, tienda: 'Amazon', tarjetaId: 't1', bonificacionId: 'b10' },
    { id: 'b', precio: 500, tienda: 'amazon', tarjetaId: 't1', bonificacionId: 'b10' },
    { id: 'c', precio: 900, tienda: 'Amazon', tarjetaId: 't2', bonificacionId: 'b10' },
  ] };
  const r = calcularPlan(plan, [bonif]);
  assert.equal(r.porItem.get('a').califica, true);
  assert.equal(r.porItem.get('b').califica, true);
  assert.equal(r.porItem.get('c').califica, false);
  cerca(r.porItem.get('c').faltante, 100, 'faltante de c');
  cerca(r.bonificacion, 110, 'solo el carrito de t1');
});
test('tope de la bonificación cuenta solo dentro del plan', () => {
  const bonif = { ...B10, montoMaximo: 50 };
  const r = calcularPlan({ items: [
    { id: 'a', precio: 400, tienda: 'X', tarjetaId: 't', bonificacionId: 'b10' },
    { id: 'b', precio: 600, tienda: 'Y', tarjetaId: 't', bonificacionId: 'b10' },
  ] }, [bonif]);
  cerca(r.bonificacion, 50, 'topado');
  cerca(r.porItem.get('a').bonificacion, 20, 'a: 40% del tope');
  assert.equal(r.porBonificacion[0].topado, true);
});
test('IVA por institución', () => {
  const r = calcularPlan({ items: [{ id: 'a', precio: 1000, tienda: 'X', tarjetaId: 't', bonificacionId: 'b10' }] },
    [B10], inst => inst === 'bbva');
  cerca(r.bonificacion, 116, 'con IVA');
});
test('bonificación inexistente se ignora', () => {
  const r = calcularPlan({ items: [{ id: 'a', precio: 100, bonificacionId: 'borrada' }] }, [B10]);
  cerca(r.neto, 100, 'neto');
});

grupo('descuentoCupon');
test('porcentaje con tope', () => {
  assert.equal(descuentoCupon({ tipo: 'porcentaje', valor: 20, montoMaximo: 150 }, 1000).descuento, 150);
  assert.equal(descuentoCupon({ tipo: 'porcentaje', valor: 20, montoMaximo: 500 }, 1000).descuento, 200);
});
test('cantidad fija ignora el máximo y nunca pasa del subtotal', () => {
  assert.equal(descuentoCupon({ tipo: 'cantidad', valor: 300, montoMaximo: 100 }, 1000).descuento, 300);
  assert.equal(descuentoCupon({ tipo: 'cantidad', valor: 300 }, 200).descuento, 200);
});
test('no alcanza el mínimo: no aplica y reporta el faltante', () => {
  const r = descuentoCupon({ tipo: 'cantidad', valor: 100, montoMinimo: 1500 }, 1200);
  assert.equal(r.aplica, false); assert.equal(r.descuento, 0); assert.equal(r.faltante, 300);
});

grupo('calcularPlan con cupones');
test('el cupón se aplica por carrito (tarjeta + tienda) y se reparte por subtotal', () => {
  const plan = {
    cupones: { 'amazon|t1': 'c1' },
    items: [
      { id: 'a', precio: 300, tienda: 'Amazon', tarjetaId: 't1' },
      { id: 'b', precio: 700, tienda: 'Amazon', tarjetaId: 't1' },
      { id: 'c', precio: 500, tienda: 'Amazon', tarjetaId: 't2' },
    ],
  };
  const r = calcularPlan(plan, [], () => false, [{ id: 'c1', tipo: 'cantidad', valor: 100, montoMinimo: 800 }]);
  cerca(r.porItem.get('a').cupon, 30, 'a: 30% del cupón');
  cerca(r.porItem.get('b').cupon, 70, 'b: 70% del cupón');
  cerca(r.porItem.get('c').cupon, 0, 'c: otro carrito sin cupón');
  cerca(r.cupones, 100, 'total cupones');
  cerca(r.neto, 1400, 'neto');
  const carrito = r.carritos.find(c => c.clave === 'amazon|t1');
  assert.equal(carrito.aplica, true);
  cerca(carrito.subtotal, 1000, 'subtotal del carrito');
});
test('la bonificación se calcula sobre lo pagado después del cupón', () => {
  const plan = {
    cupones: { 'amazon|t1': 'c1' },
    items: [{ id: 'a', precio: 1000, tienda: 'Amazon', tarjetaId: 't1', bonificacionId: 'b10' }],
  };
  const r = calcularPlan(plan, [B10], () => false, [{ id: 'c1', tipo: 'porcentaje', valor: 20 }]);
  cerca(r.porItem.get('a').cupon, 200, 'cupón 20%');
  cerca(r.porItem.get('a').bonificacion, 80, '10% de 800');
  cerca(r.neto, 720, '1000 - 200 - 80');
});
test('el mínimo de la bonificación también usa lo pagado', () => {
  const plan = {
    cupones: { 'x|t1': 'c1' },
    items: [{ id: 'a', precio: 1000, tienda: 'X', tarjetaId: 't1', bonificacionId: 'b10' }],
  };
  const r = calcularPlan(plan, [{ ...B10, montoMinimo: 1000 }], () => false, [{ id: 'c1', tipo: 'cantidad', valor: 50 }]);
  assert.equal(r.porItem.get('a').califica, false);
  cerca(r.porItem.get('a').faltante, 50, 'pagado 950 → faltan 50');
});
test('el reparto con redondeo suma exacto el descuento', () => {
  const plan = {
    cupones: { 'x|t': 'c1' },
    items: [1, 2, 3].map(n => ({ id: `i${n}`, precio: 33.33, tienda: 'X', tarjetaId: 't' })),
  };
  const r = calcularPlan(plan, [], () => false, [{ id: 'c1', tipo: 'cantidad', valor: 10 }]);
  cerca(r.cupones, 10, 'suma exacta');
});

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas) process.exit(1);
