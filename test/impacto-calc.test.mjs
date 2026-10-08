/**
 * getPlazosMes / getPagosDiferidosMes (js/utils/impacto-calc.js).
 * Sin framework: `node test/impacto-calc.test.mjs`.
 */
import assert from 'node:assert/strict';
import { getPlazosMes, getPagosDiferidosMes, getGastosFijosPendientes, getCreditosMes, calcularEstimadoTarjeta, getContadoMes } from '../js/utils/impacto-calc.js';

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

// ── fechaEfectiva: ubica el periodo en vez de fechaCompra cuando está presente ──

const contadoItem = (over = {}) => ({ id: 'c1', tarjetaId: TARJETA_ID, fechaCompra: '2026-01-10', total: 500, ...over });

test('getContadoMes: sin fechaEfectiva, ubica por fechaCompra (comportamiento de siempre)', () => {
  const r = getContadoMes([contadoItem()], TARJETA_ID, CICLO, '2026-01', FESTIVOS);
  assert.equal(r.length, 1);
});

test('getContadoMes: con fechaEfectiva, ubica por esa fecha en vez de fechaCompra', () => {
  // fechaCompra en enero, fechaEfectiva en marzo — debe aparecer en marzo, no en enero.
  const c = contadoItem({ fechaEfectiva: '2026-03-10' });
  assert.equal(getContadoMes([c], TARJETA_ID, CICLO, '2026-01', FESTIVOS).length, 0);
  assert.equal(getContadoMes([c], TARJETA_ID, CICLO, '2026-03', FESTIVOS).length, 1);
});

// ── Diferida de Contado sin resolver: se recorre al siguiente ciclo si el
// CORTE del ciclo original ya pasó (no espera hasta la fecha de pago) ───────

test('getContadoMes: diferida sin vencer (antes de su corte) se queda en su mes natural', () => {
  // Corte 20-ene, pago 4-feb. "Hoy" todavía antes del corte → sin recorrer.
  const c = contadoItem({ diferido: true, total: 500, totalDiferido: 500 });
  assert.equal(getContadoMes([c], TARJETA_ID, CICLO, '2026-01', FESTIVOS, '2026-01-15').length, 1);
});

test('getContadoMes: diferida con su corte ya pasado (aunque falte para el pago) y sin pagos registrados se recorre al siguiente ciclo', () => {
  // Corte 20-ene ya pasó para "hoy" 25-ene, aunque el pago (4-feb) todavía no
  // llegue. Debe desaparecer de enero y aparecer en febrero (corte 20-feb).
  const c = contadoItem({ diferido: true, total: 500, totalDiferido: 500 });
  assert.equal(getContadoMes([c], TARJETA_ID, CICLO, '2026-01', FESTIVOS, '2026-01-25').length, 0);
  assert.equal(getContadoMes([c], TARJETA_ID, CICLO, '2026-02', FESTIVOS, '2026-01-25').length, 1);
});

test('getContadoMes: diferida con corte pasado y pago parcial también se recorre (lo que falta, no lo ya registrado)', () => {
  const c = contadoItem({ diferido: true, total: 300, totalDiferido: 500 }); // $200 ya registrados aparte
  assert.equal(getContadoMes([c], TARJETA_ID, CICLO, '2026-01', FESTIVOS, '2026-01-25').length, 0);
  assert.equal(getContadoMes([c], TARJETA_ID, CICLO, '2026-02', FESTIVOS, '2026-01-25').length, 1);
});

test('getContadoMes: diferida ya completamente registrada no se recorre ni aparece en ningún mes', () => {
  const c = contadoItem({ diferido: true, total: 0, totalDiferido: 500 });
  assert.equal(getContadoMes([c], TARJETA_ID, CICLO, '2026-01', FESTIVOS, '2026-02-10').length, 0);
  assert.equal(getContadoMes([c], TARJETA_ID, CICLO, '2026-02', FESTIVOS, '2026-02-10').length, 0);
});

test('getPlazosMes: con fechaEfectiva, el calendario de cuotas arranca desde esa fecha', () => {
  // fechaCompra en enero, fechaEfectiva en marzo — la primera cuota debe caer
  // en el ciclo de marzo, no en el de enero.
  const m = msi({ fechaEfectiva: '2026-03-10', mesesPagados: 0 });
  assert.equal(getPlazosMes([m], TARJETA_ID, CICLO, '2026-01', FESTIVOS).length, 0);
  assert.equal(getPlazosMes([m], TARJETA_ID, CICLO, '2026-03', FESTIVOS).length, 1);
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

// ── getCreditosMes ───────────────────────────────────────────────────────────

const credito = (over = {}) => ({
  id: 'cr1', tarjetaId: TARJETA_ID, fecha: '2026-01-10', monto: 150, origen: 'cancelacion', ...over,
});

test('getCreditosMes: ubica el crédito en el mes de pago del ciclo que contiene su fecha', () => {
  // Corte 20, pago +15 días: una compra/crédito del 10-ene cae en el ciclo que
  // corta el 20-ene y paga a principios de feb -> nomina de ese pago cae en enero.
  const r = getCreditosMes([credito()], TARJETA_ID, CICLO, '2026-01', FESTIVOS);
  assert.equal(r.length, 1);
});

test('getCreditosMes: otra tarjeta u otro mes no entra', () => {
  assert.equal(getCreditosMes([credito({ tarjetaId: 'otra' })], TARJETA_ID, CICLO, '2026-01', FESTIVOS).length, 0);
  assert.equal(getCreditosMes([credito()], TARJETA_ID, CICLO, '2026-02', FESTIVOS).length, 0);
});

// Corte 20-ene, pago 4-feb (+15d). Un crédito registrado DESPUÉS del corte
// (ej. 25-ene) ya pertenece al siguiente estado de cuenta: igual que una
// compra, se paga con el pago del ciclo siguiente.
test('getCreditosMes: crédito posterior al corte cae en el pago del ciclo siguiente', () => {
  const c = credito({ fecha: '2026-01-25' });
  assert.equal(getCreditosMes([c], TARJETA_ID, CICLO, '2026-01', FESTIVOS).length, 0);
  assert.equal(getCreditosMes([c], TARJETA_ID, CICLO, '2026-02', FESTIVOS).length, 1);
});

test('getCreditosMes: un crédito anterior al corte entra al ciclo que corta', () => {
  const c = credito({ fecha: '2026-01-19' });
  assert.equal(getCreditosMes([c], TARJETA_ID, CICLO, '2026-01', FESTIVOS).length, 1);
});

test('calcularEstimadoTarjeta: resta los créditos aplicados del estimadoTotal', () => {
  const tarjeta = { id: TARJETA_ID, ciclo: CICLO };
  const contadoItems = [{ id: 'c1', tarjetaId: TARJETA_ID, fechaCompra: '2026-01-05', total: 500 }];
  const sinCredito = calcularEstimadoTarjeta(tarjeta, contadoItems, [], [], FESTIVOS, '2026-01', [], []);
  const conCredito = calcularEstimadoTarjeta(tarjeta, contadoItems, [], [], FESTIVOS, '2026-01', [], [credito({ monto: 150 })]);
  assert.equal(sinCredito.estimadoTotal, 500);
  assert.equal(conCredito.creditosAplicados, 150);
  assert.equal(conCredito.estimadoTotal, 350);
});

test('calcularEstimadoTarjeta: el saldo a favor que sobra se arrastra y se aplica a los cargos del mes siguiente', () => {
  const tarjeta = { id: TARJETA_ID, ciclo: CICLO };
  const contadoItems = [
    { id: 'c1', tarjetaId: TARJETA_ID, fechaCompra: '2026-01-05', total: 200 },
    { id: 'c2', tarjetaId: TARJETA_ID, fechaCompra: '2026-02-05', total: 500 },
  ];
  const cred = [credito({ monto: 650 })]; // enero: 650 − 200 = 450 de sobra
  const ene = calcularEstimadoTarjeta(tarjeta, contadoItems, [], [], FESTIVOS, '2026-01', [], cred);
  const feb = calcularEstimadoTarjeta(tarjeta, contadoItems, [], [], FESTIVOS, '2026-02', [], cred);
  assert.equal(ene.estimadoTotal, 0);
  assert.equal(ene.creditoArrastrado, 0);
  assert.equal(feb.creditoArrastrado, 450);
  assert.equal(feb.estimadoTotal, 50, '500 de cargos − 450 arrastrados');
});

test('calcularEstimadoTarjeta: el arrastre se consume y no reaparece dos meses después', () => {
  const tarjeta = { id: TARJETA_ID, ciclo: CICLO };
  const contadoItems = [
    { id: 'c2', tarjetaId: TARJETA_ID, fechaCompra: '2026-02-05', total: 500 },
    { id: 'c3', tarjetaId: TARJETA_ID, fechaCompra: '2026-03-05', total: 300 },
  ];
  const cred = [credito({ monto: 450 })]; // enero, sin cargos: sobran 450
  const mar = calcularEstimadoTarjeta(tarjeta, contadoItems, [], [], FESTIVOS, '2026-03', [], cred);
  assert.equal(mar.creditoArrastrado, 0, 'febrero se comió todo el crédito');
  assert.equal(mar.estimadoTotal, 300);
});

test('calcularEstimadoTarjeta: estimadoTotal no baja de 0 aunque el crédito del mes supere lo cobrado', () => {
  const tarjeta = { id: TARJETA_ID, ciclo: CICLO };
  const contadoItems = [{ id: 'c1', tarjetaId: TARJETA_ID, fechaCompra: '2026-01-05', total: 200 }];
  const r = calcularEstimadoTarjeta(tarjeta, contadoItems, [], [], FESTIVOS, '2026-01', [], [credito({ monto: 996.63 })]);
  assert.equal(r.creditosAplicados, 996.63, 'el crédito real se sigue reportando completo, sin recortar');
  assert.equal(r.estimadoTotal, 0, 'pero el monto a pagar tiene piso en 0');
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
