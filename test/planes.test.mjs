/**
 * Pruebas del cálculo de Planes de compra. Sin framework: `node test/planes.test.mjs`.
 */
import assert from 'node:assert/strict';
import { subtotalItem, claveOrden, calcularPlan, descuentoCupon, evaluarCupon, opcionDeItem, conDatosDeLista, mesesPermitidos } from '../js/utils/planes.js';

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
});
test('sin alcanzar el mínimo, porcentaje: el % sobre su precio, con advertencia', () => {
  const plan = { items: [
    { id: 'a', precio: 600, tienda: 'X', tarjetaId: 't', bonificacionId: 'b10' },
    { id: 'b', precio: 300, tienda: 'X', tarjetaId: 't', bonificacionId: 'b10' },
  ] };
  const r = calcularPlan(plan, [{ ...B10, montoMinimo: 1000 }]);
  assert.equal(r.porItem.get('a').califica, false);
  cerca(r.porItem.get('a').bonificacion, 60, '10% de 600');
  cerca(r.porItem.get('b').bonificacion, 30, '10% de 300');
  cerca(r.bonificacion, 90, 'lo que falta para el mínimo se queda con su parte');
  cerca(r.porItem.get('a').neto, 540, 'neto de a');
  cerca(r.porItem.get('a').faltante, 100, 'faltante');
  assert.equal(r.advertencias, 2);
});
test('alcanzando el mínimo se calcula sobre el precio, no sobre el mínimo', () => {
  const plan = { items: [{ id: 'a', precio: 2000, tienda: 'X', tarjetaId: 't', bonificacionId: 'b10' }] };
  const r = calcularPlan(plan, [{ ...B10, montoMinimo: 1000 }]);
  cerca(r.bonificacion, 200, '10% de 2000');
  assert.equal(r.advertencias, 0);
});
test('sin alcanzar el mínimo, cantidad fija: parte proporcional como si ya se hubiera alcanzado', () => {
  const r = calcularPlan({ items: [
    { id: 'a', precio: 600, tienda: 'X', tarjetaId: 't', bonificacionId: 'b' },
    { id: 'b', precio: 300, tienda: 'X', tarjetaId: 't', bonificacionId: 'b' },
  ] }, [{ id: 'b', tipo: 'cantidad', valor: 200, minimoPor: 'compra', montoMinimo: 1000 }]);
  cerca(r.porItem.get('a').bonificacion, 120, '600/1000 de 200');
  cerca(r.porItem.get('b').bonificacion, 60, '300/1000 de 200');
  cerca(r.bonificacion, 180, 'los $20 restantes corresponden a lo que falta');
});
test('cantidad fija al alcanzar el mínimo: se otorga completa', () => {
  const r = calcularPlan({ items: [{ id: 'a', precio: 1000, tienda: 'X', tarjetaId: 't', bonificacionId: 'b' }] },
    [{ id: 'b', tipo: 'cantidad', valor: 200, minimoPor: 'compra', montoMinimo: 1000 }]);
  cerca(r.bonificacion, 200, 'completa');
});
test('la bonificación simulada no pasa de lo que cuesta el artículo', () => {
  const r = calcularPlan({ items: [{ id: 'a', precio: 50, tienda: 'X', tarjetaId: 't', bonificacionId: 'b' }] },
    [{ id: 'b', tipo: 'cantidad', valor: 2000, minimoPor: 'compra', montoMinimo: 1000 }]);
  cerca(r.porItem.get('a').bonificacion, 50, 'topada al precio');
  cerca(r.porItem.get('a').neto, 0, 'total sin negativos');
});
test('simulando el mínimo: acumulado, tope e IVA', () => {
  const item = id => ({ id, precio: 300, tienda: id, tarjetaId: 't', bonificacionId: 'b10' });
  const acumulado = { ...B10, minimoPor: 'acumulado', montoMinimo: 1000 };
  cerca(calcularPlan({ items: [item('a'), item('b')] }, [acumulado]).bonificacion, 60, '10% de 600');
  cerca(calcularPlan({ items: [item('a'), item('b')] }, [{ ...acumulado, montoMaximo: 40 }]).bonificacion, 40, 'con tope');
  cerca(calcularPlan({ items: [item('a'), item('b')] }, [acumulado], () => true).bonificacion, 69.6, 'con IVA');
});
test('"Aplica a" no anula la bonificación: se calcula y queda como advertencia', () => {
  const soloMsi = { ...B10, aplicaA: 'msi', mesesAplican: [12] };
  const item = extra => ({ id: 'a', precio: 1000, tienda: 'X', tarjetaId: 't', bonificacionId: 'b10', ...extra });
  const contado = calcularPlan({ items: [item({ tipoPago: 'contado' })] }, [soloMsi]);
  assert.equal(contado.porItem.get('a').noAplica, true);
  cerca(contado.bonificacion, 100, 'calculada aunque es solo MSI');
  assert.equal(calcularPlan({ items: [item({ tipoPago: 'msi', meses: 6 })] }, [soloMsi]).porItem.get('a').noAplica, true);
  const ok = calcularPlan({ items: [item({ tipoPago: 'msi', meses: 12 })] }, [soloMsi]);
  assert.equal(ok.porItem.get('a').noAplica, false);
  assert.equal(ok.advertencias, 0);
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

grupo('restricciones de cupones');
const instDe = id => ({ t1: 'bbva', t2: 'nu' }[id] || null);
const carrito = (cupon, items) => calcularPlan({ cupones: { 'x|t1': 'c1' }, items }, [], () => false, [{ id: 'c1', ...cupon }], instDe);
const art = (id, precio, tipoPago) => ({ id, precio, tienda: 'X', tarjetaId: 't1', tipoPago });

test('evaluarCupon: sin restricciones aplica a todos', () => {
  const r = evaluarCupon({}, [{ id: 'a' }, { id: 'b', tipoPago: 'msi' }], null);
  assert.equal(r.elegibles.length, 2);
  assert.equal(r.motivo, null);
});
test('institución distinta: no aplica y no descuenta', () => {
  const r = carrito({ tipo: 'cantidad', valor: 100, institucionId: 'nu' }, [art('a', 1000)]);
  assert.equal(r.carritos[0].motivo, 'institucion');
  assert.equal(r.carritos[0].aplica, false);
  cerca(r.cupones, 0, 'sin descuento');
  cerca(r.neto, 1000, 'neto');
});
test('misma institución: aplica', () => {
  const r = carrito({ tipo: 'cantidad', valor: 100, institucionId: 'bbva' }, [art('a', 1000)]);
  assert.equal(r.carritos[0].aplica, true);
  cerca(r.cupones, 100, 'descuento');
});
test('cupón con institución en carrito sin tarjeta: no aplica', () => {
  const r = calcularPlan({ cupones: { 'x|': 'c1' }, items: [{ id: 'a', precio: 100, tienda: 'X' }] }, [], () => false,
    [{ id: 'c1', tipo: 'cantidad', valor: 10, institucionId: 'bbva' }], instDe);
  assert.equal(r.carritos[0].motivo, 'institucion');
});
test('solo MSI en carrito de contado: no aplica por forma de pago', () => {
  const r = carrito({ tipo: 'cantidad', valor: 100, aplicaA: 'msi' }, [art('a', 1000, 'contado')]);
  assert.equal(r.carritos[0].motivo, 'pago');
  cerca(r.cupones, 0, 'sin descuento');
});
test('sin tipoPago guardado cuenta como contado', () => {
  const r = carrito({ tipo: 'cantidad', valor: 100, aplicaA: 'contado' }, [art('a', 1000)]);
  assert.equal(r.carritos[0].aplica, true);
});
test('carrito mixto: descuenta solo a los elegibles', () => {
  const r = carrito({ tipo: 'porcentaje', valor: 10, aplicaA: 'msi' }, [art('a', 1000, 'msi'), art('b', 500, 'contado')]);
  cerca(r.porItem.get('a').cupon, 100, '10% del MSI');
  cerca(r.porItem.get('b').cupon, 0, 'contado sin cupón');
  assert.equal(r.carritos[0].elegibles, 1);
  cerca(r.carritos[0].subtotal, 1500, 'el subtotal del carrito no cambia');
});
test('carrito mixto: el mínimo se mide solo contra los elegibles', () => {
  const r = carrito({ tipo: 'cantidad', valor: 100, montoMinimo: 1200, aplicaA: 'msi' }, [art('a', 1000, 'msi'), art('b', 500, 'contado')]);
  assert.equal(r.carritos[0].aplica, false);
  assert.equal(r.carritos[0].motivo, null);
  cerca(r.carritos[0].faltante, 200, 'faltan 200 en MSI');
});
test('la bonificación se calcula sobre lo pagado por item tras el cupón restringido', () => {
  const items = [{ ...art('a', 1000, 'msi'), bonificacionId: 'b10' }, { ...art('b', 500, 'contado'), bonificacionId: 'b10' }];
  const r = calcularPlan({ cupones: { 'x|t1': 'c1' }, items }, [B10], () => false, [{ id: 'c1', tipo: 'cantidad', valor: 100, aplicaA: 'msi' }], instDe);
  cerca(r.porItem.get('a').bonificacion, 90, '10% de 900');
  cerca(r.porItem.get('b').bonificacion, 50, '10% de 500');
});

grupo('precio de los artículos de Lista');
const DESEOS = [{ id: 'd1', opciones: [{ id: 'o1', tienda: 'X', precio: 150 }] }];
const deLista = { id: 'a', origen: 'lista', deseoId: 'd1', opcionId: 'o1', precio: 100 };

test('un artículo de Lista toma el último precio de su opción', () => {
  const p = conDatosDeLista({ id: 'p', items: [deLista] }, DESEOS);
  assert.equal(p.items[0].precio, 150);
  assert.equal(p.id, 'p');
  assert.equal(deLista.precio, 100, 'no muta el original');
});
test('una opción de contado no admite MSI en el plan', () => {
  const contado = conDatosDeLista({ items: [{ ...deLista, tipoPago: 'msi', meses: 6 }] }, DESEOS).items[0];
  assert.equal(contado.tipoPago, 'contado', 'opción sin forma de pago cuenta como contado');
  assert.equal(contado.meses, null);
  assert.deepEqual(mesesPermitidos({ tipoPago: 'contado', meses: null }), []);
});
test('con MSI en Lista el plan puede elegir contado o menos meses', () => {
  const deseos = [{ id: 'd1', opciones: [{ id: 'o1', precio: 150, tipoPago: 'msi', meses: 12 }] }];
  const pago = extra => conDatosDeLista({ items: [{ ...deLista, ...extra }] }, deseos).items[0];
  assert.deepEqual(mesesPermitidos(deseos[0].opciones[0]), [3, 4, 6, 9, 12]);
  assert.equal(pago({ tipoPago: 'msi', meses: 6 }).meses, 6, 'menos meses se respetan');
  const contado = pago({ tipoPago: 'contado', meses: null });
  assert.equal(contado.tipoPago, 'contado', 'contado se respeta');
  assert.equal(contado.meses, null);
});
test('si el plan excede el máximo de Lista baja a ese máximo', () => {
  const deseos = [{ id: 'd1', opciones: [{ id: 'o1', precio: 150, tipoPago: 'msi', meses: 12 }] }];
  const it = conDatosDeLista({ items: [{ ...deLista, tipoPago: 'msi', meses: 18 }] }, deseos).items[0];
  assert.equal(it.tipoPago, 'msi');
  assert.equal(it.meses, 12);
});
test('un item sin forma de pago toma el máximo de Lista', () => {
  const deseos = [{ id: 'd1', opciones: [{ id: 'o1', precio: 150, tipoPago: 'msi', meses: 12 }] }];
  const it = conDatosDeLista({ items: [deLista] }, deseos).items[0];
  assert.equal(it.tipoPago, 'msi');
  assert.equal(it.meses, 12);
});
test('un máximo fuera de los plazos comunes también se puede elegir', () => {
  assert.deepEqual(mesesPermitidos({ tipoPago: 'msi', meses: 5 }), [3, 4, 5]);
});
test('la advertencia de "Aplica a" usa la forma de pago de la opción', () => {
  const deseos = [{ id: 'd1', opciones: [{ id: 'o1', precio: 1000, tipoPago: 'contado' }] }];
  const item = { ...deLista, tienda: 'X', tarjetaId: 't', bonificacionId: 'b10', tipoPago: 'msi', meses: 12 };
  const r = calcularPlan(conDatosDeLista({ items: [item] }, deseos), [{ ...B10, aplicaA: 'msi' }]);
  assert.equal(r.porItem.get('a').noAplica, true);
});
test('un personalizado conserva su precio', () => {
  const p = conDatosDeLista({ items: [{ id: 'b', origen: 'personalizado', deseoId: 'd1', opcionId: 'o1', precio: 80 }] }, DESEOS);
  assert.equal(p.items[0].precio, 80);
});
test('si la opción o el deseo ya no existen conserva su precio', () => {
  assert.equal(opcionDeItem({ ...deLista, opcionId: 'borrada' }, DESEOS), null);
  assert.equal(conDatosDeLista({ items: [deLista] }, []).items[0].precio, 100);
});
test('los totales del plan usan el precio de Lista', () => {
  const r = calcularPlan(conDatosDeLista({ items: [{ ...deLista, cantidad: 2 }] }, DESEOS), []);
  cerca(r.subtotal, 300, '150 × 2');
});

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas) process.exit(1);
