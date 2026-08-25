/**
 * Pruebas del motor de cálculo de Artículos Recurrentes. Sin framework:
 * `node test/articulo-calc.test.mjs`.
 */
import assert from 'node:assert/strict';
import {
  precioNeto, precioPorUnidad, precioNetoPorUnidad, duracionDias, duracionPorUnidad, resumenArticulo,
} from '../js/utils/articulo-calc.js';

let pasadas = 0, fallidas = 0;
const test = (nombre, fn) => {
  try { fn(); pasadas++; console.log(`  ok  ${nombre}`); }
  catch (e) { fallidas++; console.error(`FALLA  ${nombre}\n       ${e.message}`); }
};
const grupo = n => console.log(`\n── ${n} ${'─'.repeat(Math.max(0, 60 - n.length))}`);
const cerca = (a, b, msg, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} ≉ ${b}`);

// ─────────────────────────────────────────────────────────────────────────────
grupo('precioNeto');

test('sin descuento devuelve el precio bruto', () => {
  cerca(precioNeto({ precio: 100 }), 100, 'sin descuento');
});
test('descuento porcentaje', () => {
  cerca(precioNeto({ precio: 100, descuento: { tipo: 'porcentaje', valor: 10 } }), 90, '10% de 100');
});
test('descuento cantidad', () => {
  cerca(precioNeto({ precio: 100, descuento: { tipo: 'cantidad', valor: 15 } }), 85, '$15 de 100');
});
test('descuento tipo final: el valor YA es el precio neto, sin restar', () => {
  cerca(precioNeto({ precio: 549, descuento: { tipo: 'final', valor: 510.36 } }), 510.36, 'precio final capturado directo');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('precioPorUnidad');

test('litro a partir de contenido en ml', () => {
  const r = { precio: 45, contenidoValor: 900, contenidoUnidad: 'ml' };
  cerca(precioPorUnidad(r, 'L'), 50, '45 / 0.9L');
});
test('kilo a partir de contenido en g, ignora el descuento (usa precio bruto)', () => {
  const r = { precio: 100, contenidoValor: 500, contenidoUnidad: 'g', descuento: { tipo: 'porcentaje', valor: 20 } };
  cerca(precioPorUnidad(r, 'kg'), 200, '100 / 0.5kg, sin aplicar el 20% de descuento');
});
test('pieza usa la misma unidad libre sin convertir', () => {
  const r = { precio: 40, contenidoValor: 4, contenidoUnidad: 'rollo' };
  cerca(precioPorUnidad(r, 'rollo'), 10, '40 / 4 rollos');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('precioNetoPorUnidad');

test('sin descuento coincide con precioPorUnidad', () => {
  const r = { precio: 45, contenidoValor: 900, contenidoUnidad: 'ml' };
  cerca(precioNetoPorUnidad(r, 'L'), precioPorUnidad(r, 'L'), 'sin descuento, mismo valor');
});
test('con descuento sí lo aplica, a diferencia de precioPorUnidad', () => {
  const r = { precio: 100, contenidoValor: 500, contenidoUnidad: 'g', descuento: { tipo: 'porcentaje', valor: 20 } };
  cerca(precioNetoPorUnidad(r, 'kg'), 160, '80 / 0.5kg, con el 20% aplicado');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('duracionDias / duracionPorUnidad');

test('null en otro estatus (comprado)', () => {
  assert.equal(duracionDias({ estatus: 'comprado', fechaEnUso: '2026-01-01' }), null);
});
test('null si falta fechaEnUso', () => {
  assert.equal(duracionDias({ estatus: 'terminado', fechaTerminado: '2026-01-20' }), null);
});
test('días entre fechaEnUso y fechaTerminado', () => {
  const r = { estatus: 'terminado', fechaEnUso: '2026-01-01', fechaTerminado: '2026-01-21' };
  assert.equal(duracionDias(r), 20);
});
test('duración por litro', () => {
  const r = {
    estatus: 'terminado', fechaEnUso: '2026-01-01', fechaTerminado: '2026-01-11',
    contenidoValor: 1, contenidoUnidad: 'L',
  };
  cerca(duracionPorUnidad(r, 'L'), 10, '10 días / 1L');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('duracionDias en uso (hasta hoy)');

const haceDias = n => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('en uso se cuenta desde fechaEnUso hasta hoy', () => {
  assert.equal(duracionDias({ estatus: 'enUso', fechaEnUso: haceDias(5) }), 5);
});
test('en uso sin fechaEnUso es null', () => {
  assert.equal(duracionDias({ estatus: 'enUso' }), null);
});
test('en uso marcado hoy mismo da 0 días', () => {
  assert.equal(duracionDias({ estatus: 'enUso', fechaEnUso: haceDias(0) }), 0);
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('duracionDias sin seguimiento');

test('se estima con la fechaComprado del siguiente registro', () => {
  const r1 = { sinSeguimiento: true, fechaComprado: '2026-01-01' };
  const r2 = { sinSeguimiento: true, fechaComprado: '2026-01-21' };
  assert.equal(duracionDias(r1, [r1, r2]), 20);
});
test('null si es el registro más reciente (sin siguiente)', () => {
  const r1 = { sinSeguimiento: true, fechaComprado: '2026-01-01' };
  const r2 = { sinSeguimiento: true, fechaComprado: '2026-01-21' };
  assert.equal(duracionDias(r2, [r1, r2]), null);
});
test('ignora registros del mismo día (mismo lote de "cantidad")', () => {
  const r1 = { sinSeguimiento: true, fechaComprado: '2026-01-01' };
  const r1b = { sinSeguimiento: true, fechaComprado: '2026-01-01' };
  const r2 = { sinSeguimiento: true, fechaComprado: '2026-01-11' };
  assert.equal(duracionDias(r1, [r1, r1b, r2]), 10);
});
test('estatus se ignora cuando sinSeguimiento es true', () => {
  const r1 = { sinSeguimiento: true, estatus: 'comprado', fechaComprado: '2026-01-01' };
  const r2 = { fechaComprado: '2026-01-16' };
  assert.equal(duracionDias(r1, [r1, r2]), 15);
});
test('si el siguiente ya está en uso, se usa su fechaEnUso (no su fechaComprado)', () => {
  const r1 = { sinSeguimiento: true, fechaComprado: '2026-01-01' };
  const r2 = { estatus: 'enUso', fechaComprado: '2026-01-10', fechaEnUso: '2026-01-16' };
  assert.equal(duracionDias(r1, [r1, r2]), 15); // hasta el 16, no hasta el 10
});
test('si el siguiente ya está terminado, también se usa su fechaEnUso', () => {
  const r1 = { sinSeguimiento: true, fechaComprado: '2026-01-01' };
  const r2 = { estatus: 'terminado', fechaComprado: '2026-01-10', fechaEnUso: '2026-01-16', fechaTerminado: '2026-01-30' };
  assert.equal(duracionDias(r1, [r1, r2]), 15);
});
test('si el siguiente sigue comprado (sin fechaEnUso), se usa su fechaComprado', () => {
  const r1 = { sinSeguimiento: true, fechaComprado: '2026-01-01' };
  const r2 = { estatus: 'comprado', fechaComprado: '2026-01-10' };
  assert.equal(duracionDias(r1, [r1, r2]), 9);
});
test('si el siguiente es sinSeguimiento, se usa su fechaComprado aunque arrastre una fechaEnUso vieja', () => {
  const r1 = { sinSeguimiento: true, fechaComprado: '2026-01-01' };
  const r2 = { sinSeguimiento: true, fechaComprado: '2026-01-10', fechaEnUso: '2026-01-05' }; // fecha vieja, de antes de marcarse sin seguimiento
  assert.equal(duracionDias(r1, [r1, r2]), 9); // usa el 10, no el 5
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('resumenArticulo');

test('promedio de precio incluye todos los estatus', () => {
  const articulo = {
    unidadPreferida: 'L',
    registros: [
      { estatus: 'comprado',  precio: 50, contenidoValor: 1, contenidoUnidad: 'L' },
      { estatus: 'terminado', precio: 60, contenidoValor: 1, contenidoUnidad: 'L', fechaEnUso: '2026-01-01', fechaTerminado: '2026-01-11' },
    ],
  };
  cerca(resumenArticulo(articulo).promedioPrecioPorUnidad, 55, 'promedio (50+60)/2');
});
test('promedio de duración solo cuenta terminado con fechaEnUso', () => {
  const articulo = {
    unidadPreferida: 'L',
    registros: [
      { estatus: 'comprado',  precio: 50, contenidoValor: 1, contenidoUnidad: 'L' }, // sin uso, no cuenta
      { estatus: 'enUso',     precio: 50, contenidoValor: 1, contenidoUnidad: 'L', fechaEnUso: '2026-01-01' }, // no terminado, no cuenta
      { estatus: 'terminado', precio: 50, contenidoValor: 1, contenidoUnidad: 'L', fechaEnUso: '2026-01-01', fechaTerminado: '2026-01-11' }, // 10 días
      { estatus: 'terminado', precio: 50, contenidoValor: 2, contenidoUnidad: 'L', fechaEnUso: '2026-02-01', fechaTerminado: '2026-02-21' }, // 20/2 = 10 días/L
    ],
  };
  cerca(resumenArticulo(articulo).promedioDuracionPorUnidad, 10, 'promedio (10+10)/2');
});
test('stock cuenta registros por estatus', () => {
  const articulo = {
    unidadPreferida: 'L',
    registros: [
      { estatus: 'comprado', precio: 1, contenidoValor: 1, contenidoUnidad: 'L' },
      { estatus: 'comprado', precio: 1, contenidoValor: 1, contenidoUnidad: 'L' },
      { estatus: 'enUso',    precio: 1, contenidoValor: 1, contenidoUnidad: 'L' },
    ],
  };
  assert.deepEqual(resumenArticulo(articulo).stock, { comprado: 2, enUso: 1, terminado: 0, sinSeguimiento: 0 });
});
test('stock cuenta sinSeguimiento aparte, sin importar su estatus', () => {
  const articulo = {
    unidadPreferida: 'L',
    registros: [
      { sinSeguimiento: true, estatus: 'comprado', precio: 1, contenidoValor: 1, contenidoUnidad: 'L' },
      { estatus: 'comprado', precio: 1, contenidoValor: 1, contenidoUnidad: 'L' },
    ],
  };
  assert.deepEqual(resumenArticulo(articulo).stock, { comprado: 1, enUso: 0, terminado: 0, sinSeguimiento: 1 });
});
test('promedio de duración combina terminado y sinSeguimiento', () => {
  const articulo = {
    unidadPreferida: 'L',
    registros: [
      { estatus: 'terminado', precio: 50, contenidoValor: 1, contenidoUnidad: 'L', fechaEnUso: '2026-01-01', fechaTerminado: '2026-01-11' }, // 10 días/L
      { sinSeguimiento: true, precio: 50, contenidoValor: 2, contenidoUnidad: 'L', fechaComprado: '2026-02-01' },
      { sinSeguimiento: true, precio: 50, contenidoValor: 2, contenidoUnidad: 'L', fechaComprado: '2026-02-21' }, // 20/2 = 10 días/L; la última queda sin siguiente
    ],
  };
  cerca(resumenArticulo(articulo).promedioDuracionPorUnidad, 10, 'promedio (10+10)/2, ignorando la más reciente');
});
test('artículo sin registros no rompe', () => {
  const r = resumenArticulo({ unidadPreferida: 'L', registros: [] });
  assert.equal(r.promedioPrecioPorUnidad, null);
  assert.equal(r.promedioDuracionPorUnidad, null);
  assert.deepEqual(r.stock, { comprado: 0, enUso: 0, terminado: 0, sinSeguimiento: 0 });
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${fallidas ? '✗' : '✓'} ${pasadas} pasadas, ${fallidas} fallidas\n`);
process.exit(fallidas ? 1 : 0);
