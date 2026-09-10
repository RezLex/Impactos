/**
 * getPlazosMes / getPagosDiferidosMes (js/utils/impacto-calc.js).
 * Sin framework: `node test/impacto-calc.test.mjs`.
 */
import assert from 'node:assert/strict';
import { getPlazosMes, getPagosDiferidosMes, getGastosFijosPendientes } from '../js/utils/impacto-calc.js';

let pasadas = 0;
const test = (nombre, fn) => { fn(); pasadas++; console.log('ok  ' + nombre); };

// Corte día 20, pago 15 días después — sin ajuste, para que las fechas sean
// deterministas y fáciles de razonar en las pruebas.
const CICLO = { diaCorte: 20, diasAlPago: 15, ajusteCorte: 'ninguno', ajustePago: 'ninguno', baseCalculo: 'calculada' };
const FESTIVOS = [];
const TARJETA_ID = 'tc1';

const msi = (over = {}) => ({
  id: 'm1', tarjetaId: TARJETA_ID, fechaCompra: '2026-01-10',
  mesesTotal: 6, mensualidad: 100, liquidado: false, ...over,
});

test('getPlazosMes: el resultado para un mes fijo no depende de mesesPagados', () => {
  // Antes del fix, registrar el pago (mesesPagados 0 -> 1) hacía que el MISMO
  // mes que se estaba cerrando dejara de encontrar su cuota — el "monto a
  // pagar" se iba a cero justo al pagar. El hecho de que hubo una cuota en
  // `mes` es fijo (depende de fechaCompra + ciclo), no de cuántas se han
  // pagado desde entonces.
  for (const mes of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']) {
    const antes    = getPlazosMes([msi({ mesesPagados: 0 })], TARJETA_ID, CICLO, mes, FESTIVOS);
    const despues  = getPlazosMes([msi({ mesesPagados: 1 })], TARJETA_ID, CICLO, mes, FESTIVOS);
    const muchoMas = getPlazosMes([msi({ mesesPagados: 6 })], TARJETA_ID, CICLO, mes, FESTIVOS); // ya liquidada hoy
    assert.equal(antes.length, 1, `mes ${mes} sin pagos previos`);
    assert.equal(despues.length, 1, `mes ${mes} con 1 pago ya registrado`);
    assert.equal(muchoMas.length, 1, `mes ${mes} mucho después, ya totalmente pagada`);
  }
});

test('getPlazosMes: no encuentra nada fuera del rango de mesesTotal', () => {
  const r = getPlazosMes([msi({ mesesPagados: 6 })], TARJETA_ID, CICLO, '2026-07', FESTIVOS);
  assert.equal(r.length, 0);
});

test('getPlazosMes: cada mes de la compra aparece exactamente una vez', () => {
  const encontrados = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']
    .filter(mes => getPlazosMes([msi({ mesesPagados: 0 })], TARJETA_ID, CICLO, mes, FESTIVOS).length === 1);
  assert.equal(encontrados.length, 6);
});

test('getPlazosMes: liquidado manualmente excluye sin importar el mes', () => {
  const r = getPlazosMes([msi({ mesesPagados: 0, liquidado: true })], TARJETA_ID, CICLO, '2026-01', FESTIVOS);
  assert.equal(r.length, 0);
});

test('getPlazosMes: otra tarjeta no entra aunque coincida la fecha', () => {
  const r = getPlazosMes([msi({ tarjetaId: 'otra' })], TARJETA_ID, CICLO, '2026-01', FESTIVOS);
  assert.equal(r.length, 0);
});

const pago = (over = {}) => ({ id: 'p1', tarjetaId: TARJETA_ID, compraId: 'c1', fecha: '2026-01-10', ...over });
const compraDiferida = (over = {}) => ({ id: 'c1', mesesTotal: 4, ...over });

test('getPagosDiferidosMes: el resultado para un mes fijo no depende de mesesPagados', () => {
  const diferidoMap = { c1: compraDiferida() };
  for (const mes of ['2026-01', '2026-02', '2026-03', '2026-04']) {
    const antes   = getPagosDiferidosMes([pago({ mesesPagados: 0 })], TARJETA_ID, CICLO, mes, FESTIVOS, diferidoMap);
    const despues = getPagosDiferidosMes([pago({ mesesPagados: 2 })], TARJETA_ID, CICLO, mes, FESTIVOS, diferidoMap);
    assert.equal(antes.length, 1, `mes ${mes} sin pagos previos`);
    assert.equal(despues.length, 1, `mes ${mes} con pagos ya avanzados`);
  }
});

test('getPagosDiferidosMes: sin registro de la compra padre no entra', () => {
  const r = getPagosDiferidosMes([pago()], TARJETA_ID, CICLO, '2026-01', FESTIVOS, {});
  assert.equal(r.length, 0);
});

// ── getGastosFijosPendientes ─────────────────────────────────────────────────

const gastoFijo = (over = {}) => ({
  id: 'gf1', nombre: 'Netflix', tarjetaId: TARJETA_ID, formaPago: 'transferencia',
  diaCobro: 20, importe: 199, ...over,
});

test('getGastosFijosPendientes: sin doc, antes de su fecha → pendiente, id null', () => {
  const [r] = getGastosFijosPendientes([gastoFijo()], [], '2026-03', FESTIVOS, '2026-03-10');
  assert.equal(r.id, null);
  assert.equal(r.estatus, 'pendiente');
  assert.equal(r.fechaPago, '2026-03-20');
  assert.equal(r.importe, 199);
});

test('getGastosFijosPendientes: sin doc, ya disponible → porConfirmar, id null', () => {
  const [r] = getGastosFijosPendientes([gastoFijo()], [], '2026-03', FESTIVOS, '2026-03-20');
  assert.equal(r.id, null);
  assert.equal(r.estatus, 'porConfirmar');
});

test('getGastosFijosPendientes: doc existente estado pendiente → porConfirmar, reusa su fecha/importe', () => {
  const doc = { id: 'doc1', gastaFijoId: 'gf1', mes: '2026-03', estado: 'pendiente', fechaPago: '2026-03-22', importe: 250 };
  const [r] = getGastosFijosPendientes([gastoFijo()], [doc], '2026-03', FESTIVOS, '2026-03-25');
  assert.equal(r.id, 'doc1');
  assert.equal(r.estatus, 'porConfirmar');
  assert.equal(r.fechaPago, '2026-03-22');
  assert.equal(r.importe, 250);
});

test('getGastosFijosPendientes: doc registrado o descartado no aparece', () => {
  const registrado = { id: 'doc1', gastaFijoId: 'gf1', mes: '2026-03', estado: 'registrado', fechaPago: '2026-03-20', importe: 199 };
  assert.equal(getGastosFijosPendientes([gastoFijo()], [registrado], '2026-03', FESTIVOS, '2026-03-25').length, 0);

  const descartado = { id: 'doc2', gastaFijoId: 'gf1', mes: '2026-03', estado: 'descartado', fechaPago: '2026-03-20', importe: 199 };
  assert.equal(getGastosFijosPendientes([gastoFijo()], [descartado], '2026-03', FESTIVOS, '2026-03-25').length, 0);
});

console.log(`\n${pasadas} pruebas ok`);
