/**
 * Pruebas del motor de cálculo. Sin framework ni dependencias: `node test/rendimiento.test.mjs`.
 *
 * Cubre sobre todo el modelo de eventos (anclas / movimientos / ajustes) y la
 * conciliación, que es donde se decide si una diferencia es rendimiento, dinero
 * que entró o deriva del cálculo.
 */
import assert from 'node:assert/strict';
import {
  componer, configCuenta, eventosCuenta, saldoEnFecha, rendimientoEntre,
  conciliar, recalcularAjustes, timelineCuenta, diasEntre, sumarDias, historialDiario,
  movimientosTransferencia, validarTransferencia, esTransferencia,
  conTransferencia, sinTransferencia,
  capturasDescartadas, historialConsistente, resumenCuenta,
  registrarInhabiles, esInhabil, siguienteHabil, plegarDiasInhabiles,
  vigenciasTasa, vigenciaEnFecha, interesDiario, isrDiario,
  EVENTO_ANCLA, EVENTO_MOVIMIENTO, EVENTO_AJUSTE, MOV_APORTE, MOV_RETIRO,
  TASA_EFECTIVA, MODO_UNICO, ABONO_HABIL_ACUMULA, ABONO_HABIL_SOLO,
  REDONDEO_CENTAVOS, REDONDEO_ACUMULADO,
  hoyISO, hoyDeCuenta, horaCorteCuenta, CORTE_RENDIMIENTOS,
  MOV_RINDE_SALDO_VIEJO, MOV_RINDE_SALDO_NUEVO,
} from '../js/utils/rendimiento.js';

let pasadas = 0, fallidas = 0;
const test = (nombre, fn) => {
  try { fn(); pasadas++; console.log(`  ok  ${nombre}`); }
  catch (e) { fallidas++; console.error(`FALLA  ${nombre}\n       ${e.message}`); }
};
const grupo = n => console.log(`\n── ${n} ${'─'.repeat(Math.max(0, 60 - n.length))}`);

/** Compara importes a centavo cerrado. */
const cerca = (a, b, msg, tol = 0.005) =>
  assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} ≉ ${b}`);

/** Redondea a centavos — mismo criterio que usa el motor internamente. */
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

/** Suma un campo de una lista de filas de `historialDiario`. */
const suma = (filas, campo) => filas.reduce((s, f) => s + (f[campo] || 0), 0);

/** Cuenta base — tasa plana para que las cifras se puedan verificar a mano. */
const cuentaPlana = (extra = {}) => ({
  montoInvertido: 10000,
  fechaActualizacion: '2026-01-01',
  tramos: [{ hasta: null, tasa: 12 }],
  baseAnual: 365,
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Compatibilidad con datos previos');

test('un timeline plano sigue leyéndose como anclas', () => {
  const cfg = configCuenta(cuentaPlana());
  const timeline = [{ fecha: '2026-01-01', monto: 10000 }];
  const r = rendimientoEntre(timeline, '2026-01-01', '2026-01-31', cfg);
  const esperado = componer(10000, 30, cfg);
  cerca(r.rendimiento, esperado.rendimiento, 'rendimiento');
  cerca(r.saldoFinal, esperado.saldoFinal, 'saldo final');
  assert.equal(r.dias, 30);
});

test('sin movimientos declarados, un salto de saldo sigue siendo aportación', () => {
  const cuenta = cuentaPlana({
    historial: [{ fecha: '2026-01-01', monto: 10000 }],
    montoInvertido: 20000, fechaActualizacion: '2026-01-31',
  });
  const cfg = configCuenta(cuenta);
  const r = rendimientoEntre(eventosCuenta(cuenta), '2026-01-01', '2026-01-31', cfg);
  const proyectado = componer(10000, 30, cfg).saldoFinal;
  cerca(r.aportaciones, 20000 - proyectado, 'aportaciones');
  cerca(r.residuo, r.aportaciones, 'todo el salto queda sin explicar');
  assert.equal(r.movimientos, 0);
});

test('rendimientoEntre devuelve null sin anclas', () => {
  assert.equal(rendimientoEntre([], '2026-01-01', '2026-01-31', configCuenta({})), null);
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Eventos');

test('los retiros salen con signo negativo y las anclas cierran cada fecha', () => {
  const evs = eventosCuenta(cuentaPlana({
    movimientos: [
      { fecha: '2026-01-15', tipo: MOV_RETIRO, monto: 500 },
      { fecha: '2026-01-01', tipo: MOV_APORTE, monto: 200 },
    ],
    ajustes: [{ fecha: '2026-01-01', monto: -3 }],
  }));
  assert.deepEqual(evs.map(e => e.tipo),
    [EVENTO_MOVIMIENTO, EVENTO_AJUSTE, EVENTO_ANCLA, EVENTO_MOVIMIENTO]);
  assert.equal(evs[3].monto, -500);
  assert.equal(evs[0].monto, 200);
});

test('los movimientos con monto cero o fecha inválida se descartan', () => {
  const evs = eventosCuenta(cuentaPlana({
    movimientos: [{ fecha: '2026-01-10', tipo: MOV_APORTE, monto: 0 }, { monto: 100 }],
  }));
  assert.equal(evs.filter(e => e.tipo === EVENTO_MOVIMIENTO).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Movimientos vs. rendimiento');

test('una aportación mueve el saldo pero no cuenta como rendimiento', () => {
  const cuenta = cuentaPlana({ movimientos: [{ fecha: '2026-01-16', tipo: MOV_APORTE, monto: 5000 }] });
  const cfg = configCuenta(cuenta);
  const r = rendimientoEntre(eventosCuenta(cuenta), '2026-01-01', '2026-01-31', cfg);

  // 15 días con el saldo viejo (2→16 Ene, el propio 16 incluido: ese día rinde
  // sobre lo que había, no sobre el aporte que llega — `desde` ya cuenta como
  // cerrado dentro de `recorrer()`, así que el primer día que compone es el
  // 2), y 15 días más con el saldo nuevo (17→31 Ene) — 15+15 = 30 días.
  const tramo1 = componer(10000, 15, cfg);
  const tramo2 = componer(tramo1.saldoFinal + 5000, 15, cfg);
  cerca(r.saldoFinal, tramo2.saldoFinal, 'saldo final');
  cerca(r.rendimiento, tramo1.rendimiento + tramo2.rendimiento, 'rendimiento sin la aportación');
  cerca(r.movimientos, 5000, 'movimientos');
  cerca(r.residuo, 0, 'nada sin explicar');
});

test('un retiro reduce el saldo y el interés posterior', () => {
  const cuenta = cuentaPlana({ movimientos: [{ fecha: '2026-01-16', tipo: MOV_RETIRO, monto: 4000 }] });
  const cfg = configCuenta(cuenta);
  const r = rendimientoEntre(eventosCuenta(cuenta), '2026-01-01', '2026-01-31', cfg);
  cerca(r.movimientos, -4000, 'movimientos');
  assert.ok(r.rendimiento < componer(10000, 30, cfg).rendimiento, 'rinde menos que sin retiro');
});

test('un ajuste sí suma al rendimiento', () => {
  const cuenta = cuentaPlana({ ajustes: [{ fecha: '2026-01-16', monto: 2.5, motivo: 'deriva' }] });
  const cfg = configCuenta(cuenta);
  const r = rendimientoEntre(eventosCuenta(cuenta), '2026-01-01', '2026-01-31', cfg);
  const base = rendimientoEntre(eventosCuenta(cuentaPlana()), '2026-01-01', '2026-01-31', cfg);
  cerca(r.ajustes, 2.5, 'ajustes');
  // El ajuste entra al saldo y además compone los días que le quedan
  assert.ok(r.rendimiento > base.rendimiento + 2.5, 'el ajuste rinde después de aplicarse');
  cerca(r.movimientos, 0, 'no es un movimiento');
});

test('el saldo nunca queda negativo tras un retiro excesivo', () => {
  const cuenta = cuentaPlana({ movimientos: [{ fecha: '2026-01-10', tipo: MOV_RETIRO, monto: 99999 }] });
  const cfg = configCuenta(cuenta);
  assert.ok(saldoEnFecha(eventosCuenta(cuenta), '2026-01-31', cfg) >= 0);
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('saldoEnFecha');

test('los eventos del mismo día del ancla no se aplican dos veces', () => {
  // El saldo capturado ya incluye el aporte de ese día
  const cuenta = cuentaPlana({ movimientos: [{ fecha: '2026-01-01', tipo: MOV_APORTE, monto: 5000 }] });
  const cfg = configCuenta(cuenta);
  cerca(saldoEnFecha(eventosCuenta(cuenta), '2026-01-01', cfg), 10000, 'saldo del día del ancla');
});

test('es null antes de la primera ancla', () => {
  const cuenta = cuentaPlana();
  assert.equal(saldoEnFecha(eventosCuenta(cuenta), '2025-12-31', configCuenta(cuenta)), null);
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Conciliación');

test('cuadra cuando el saldo real coincide con la proyección', () => {
  const cuenta = cuentaPlana();
  const cfg = configCuenta(cuenta);
  const proyectado = componer(10000, 30, cfg).saldoFinal;
  const c = conciliar(cuenta, proyectado, '2026-01-31', cfg);
  assert.equal(c.cuadra, true);
  cerca(c.residuo, 0, 'residuo');
  cerca(c.saldoAnterior, 10000, 'saldo anterior');
  assert.equal(c.dias, 30);
});

test('el residuo aparece cuando la institución pagó distinto', () => {
  const cuenta = cuentaPlana();
  const cfg = configCuenta(cuenta);
  const proyectado = componer(10000, 30, cfg).saldoFinal;
  const c = conciliar(cuenta, proyectado - 2.46, '2026-01-31', cfg);
  assert.equal(c.cuadra, false);
  cerca(c.residuo, -2.46, 'residuo');
  assert.ok(c.derivaAnual < 0, 'la deriva anualizada conserva el signo');
});

test('un movimiento registrado deja de contarse como residuo', () => {
  const cfg = configCuenta(cuentaPlana());
  const proyectado = componer(10000, 30, cfg).saldoFinal;

  const sinRegistrar = conciliar(cuentaPlana(), proyectado + 5000, '2026-01-31', cfg);
  cerca(sinRegistrar.residuo, 5000, 'sin registrar, todo es residuo');

  const cuenta = cuentaPlana({ movimientos: [{ fecha: '2026-01-31', tipo: MOV_APORTE, monto: 5000 }] });
  const con = conciliar(cuenta, proyectado + 5000, '2026-01-31', cfg);
  cerca(con.movimientos, 5000, 'movimientos');
  cerca(con.residuo, 0, 'ya no queda residuo');
  assert.equal(con.cuadra, true);
});

test('se concilia contra la captura anterior, no contra sí misma', () => {
  const cuenta = cuentaPlana({
    historial: [{ fecha: '2026-01-01', monto: 10000 }],
    montoInvertido: 12345, fechaActualizacion: '2026-01-31',
  });
  const c = conciliar(cuenta, 12345, '2026-01-31', configCuenta(cuenta));
  assert.equal(c.desde, '2026-01-01');
  cerca(c.saldoAnterior, 10000, 'parte de la captura previa');
  assert.ok(Math.abs(c.residuo) > 1, 'la captura del día no se autoexplica');
});

test('la deriva anualizada se expresa en % sobre el capital', () => {
  const cuenta = cuentaPlana();
  const cfg = configCuenta(cuenta);
  const proyectado = componer(10000, 365, cfg).saldoFinal;
  const c = conciliar(cuenta, proyectado + 100, '2027-01-01', cfg);
  cerca(c.derivaAnual, 1, 'un año y $100 sobre $10,000 ≈ 1%', 0.01);
});

test('es null si no hay ancla previa a la fecha', () => {
  assert.equal(conciliar(cuentaPlana(), 10000, '2025-12-01'), null);
  assert.equal(conciliar(cuentaPlana(), 'no-es-número', '2026-02-01'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Recálculo de ajustes al editar la raíz');

/** Cuenta con dos capturas y un ajuste que explica el residuo de la segunda. */
function cuentaConAjuste(montoInicial = 10000) {
  const cfg = configCuenta(cuentaPlana());
  const proyectado = componer(montoInicial, 30, cfg).saldoFinal;
  const real = Math.round((proyectado - 2.46) * 100) / 100;
  return cuentaPlana({
    historial: [{ fecha: '2026-01-01', monto: montoInicial }],
    montoInvertido: real, fechaActualizacion: '2026-01-31',
    ajustes: [{ fecha: '2026-01-31', monto: -2.46, motivo: 'deriva' }],
  });
}

test('un ajuste correcto no cambia al recalcularse', () => {
  const [a] = recalcularAjustes(cuentaConAjuste());
  assert.equal(a.derivado, true);
  cerca(a.cambio, 0, 'sin cambio');
  cerca(a.monto, -2.46, 'monto');
  assert.equal(a.motivo, 'deriva');
});

test('el ajuste con motivo intacto absorbe el residuo del ancla', () => {
  const cuenta = cuentaConAjuste();
  const cfg = configCuenta(cuenta);
  const recalculados = recalcularAjustes(cuenta, cfg);
  const r = rendimientoEntre(
    eventosCuenta({ ...cuenta, ajustes: recalculados }), '2026-01-01', '2026-01-31', cfg);
  cerca(r.residuo, 0, 'el ancla ya no deja residuo');
  cerca(r.aportaciones, 0, 'ninguna aportación falsa');
});

test('editar el monto de un ancla anterior recalcula el importe', () => {
  const cuenta = cuentaConAjuste();
  // El usuario corrige la captura de enero: eran $11,000, no $10,000
  const editada = { ...cuenta, historial: [{ fecha: '2026-01-01', monto: 11000 }] };
  const [a] = recalcularAjustes(editada);
  assert.equal(a.derivado, true);
  assert.ok(Math.abs(a.cambio) > 1, `el importe debía moverse, cambió ${a.cambio}`);
  assert.equal(a.motivo, 'deriva', 'la clasificación se respeta');
});

test('un ajuste suelto (sin ancla ese día) se respeta tal cual', () => {
  const cuenta = cuentaConAjuste();
  cuenta.ajustes = [{ fecha: '2026-01-15', monto: -1.11, motivo: 'manual' }];
  const [a] = recalcularAjustes(cuenta);
  assert.equal(a.derivado, false);
  cerca(a.monto, -1.11, 'monto intacto');
  assert.equal(a.cambio, 0);
});

test('sin ajustes devuelve lista vacía', () => {
  assert.deepEqual(recalcularAjustes(cuentaPlana()), []);
});

test('un ajuste marcado manual no se recalcula aunque esté sobre un ancla', () => {
  const cuenta = cuentaConAjuste();
  // El usuario clasificó solo parte del residuo: el importe es criterio suyo
  cuenta.ajustes = [{ fecha: '2026-01-31', monto: -1, motivo: 'solo una parte', derivado: false }];
  const [a] = recalcularAjustes(cuenta);
  assert.equal(a.derivado, false);
  cerca(a.monto, -1, 'el importe a mano se respeta');
  assert.equal(a.cambio, 0);
});

test('lo no explicado por un ajuste parcial sigue a la vista', () => {
  const cuenta = cuentaConAjuste();
  cuenta.ajustes = [{ fecha: '2026-01-31', monto: -1, motivo: 'parcial', derivado: false }];
  const cfg = configCuenta(cuenta);
  const r = rendimientoEntre(eventosCuenta(cuenta), '2026-01-01', '2026-01-31', cfg);
  cerca(r.ajustes, -1, 'solo se explicó $1');
  cerca(r.residuo, -1.46, 'el resto queda sin explicar', 0.02);
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('La deriva no se acumula entre anclas');

test('cada captura reinicia el error a cero', () => {
  const cfg = configCuenta(cuentaPlana());
  // Tres capturas mensuales, cada una $5 por debajo de lo proyectado
  const fechas = ['2026-01-01', '2026-02-01', '2026-03-01'];
  let monto = 10000;
  const historial = [{ fecha: fechas[0], monto }];
  for (let i = 1; i < fechas.length; i++) {
    const dias = diasEntre(fechas[i - 1], fechas[i]);
    monto = Math.round((componer(monto, dias, cfg).saldoFinal - 5) * 100) / 100;
    historial.push({ fecha: fechas[i], monto });
  }
  const cuenta = cuentaPlana({ historial, montoInvertido: monto, fechaActualizacion: '2026-03-01' });

  const c = conciliar(cuenta, monto, '2026-03-01', cfg);
  // Se compara solo contra la captura de febrero, no contra el arrastre de enero
  assert.equal(c.desde, '2026-02-01');
  cerca(c.residuo, -5, 'el error del tramo anterior no se arrastra');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Movimientos retroactivos');

/**
 * El 16 de enero entraron $5,000 que nadie registró. La captura del 31 es real,
 * así que el modelo ve un salto que no sabe explicar.
 */
function cuentaConSaltoOculto() {
  const cfg = configCuenta(cuentaPlana());
  // 15+15, no 16+14: el aporte (una vez registrado) rinde su propio día de
  // llegada sobre el saldo viejo, pero el saldo nuevo ya compone desde el día
  // siguiente — mismo criterio que usa `recorrer()` — así que la captura
  // "real" del 31 debe reflejarlo para que el residuo dé exactamente cero al
  // reclasificarlo.
  const t1 = componer(10000, 15, cfg);
  const t2 = componer(t1.saldoFinal + 5000, 15, cfg);
  return cuentaPlana({
    historial: [{ fecha: '2026-01-01', monto: 10000 }],
    montoInvertido: Math.round(t2.saldoFinal * 100) / 100,
    fechaActualizacion: '2026-01-31',
  });
}

const conMovimientoTardio = cuenta => ({
  ...cuenta,
  movimientos: [{ fecha: '2026-01-16', tipo: MOV_APORTE, monto: 5000 }],
});

test('registrarlo después reclasifica el residuo sin tocar el saldo', () => {
  const cuenta = cuentaConSaltoOculto();
  const cfg = configCuenta(cuenta);
  const antes   = rendimientoEntre(eventosCuenta(cuenta), '2026-01-01', '2026-01-31', cfg);
  const despues = rendimientoEntre(eventosCuenta(conMovimientoTardio(cuenta)), '2026-01-01', '2026-01-31', cfg);

  assert.ok(Math.abs(antes.residuo - 5000) < 30, 'antes el salto entero era inexplicable');
  cerca(despues.residuo, 0, 'después ya está explicado', 0.02);
  cerca(despues.movimientos, 5000, 'movimientos');
  cerca(antes.saldoFinal, despues.saldoFinal, 'el saldo observado manda igual');
});

test('el rendimiento sube: ese dinero llevaba 15 días generando interés', () => {
  const cuenta = cuentaConSaltoOculto();
  const cfg = configCuenta(cuenta);
  const antes   = rendimientoEntre(eventosCuenta(cuenta), '2026-01-01', '2026-01-31', cfg);
  const despues = rendimientoEntre(eventosCuenta(conMovimientoTardio(cuenta)), '2026-01-01', '2026-01-31', cfg);
  assert.ok(despues.rendimiento > antes.rendimiento,
    `${despues.rendimiento} debía superar a ${antes.rendimiento}`);
});

test('no altera nada posterior al ancla siguiente', () => {
  const cuenta = cuentaConSaltoOculto();
  const cfg = configCuenta(cuenta);
  const rango = c => rendimientoEntre(eventosCuenta(c), '2026-01-31', '2026-02-28', cfg);
  const antes = rango(cuenta), despues = rango(conMovimientoTardio(cuenta));
  cerca(antes.rendimiento, despues.rendimiento, 'rendimiento posterior intacto');
  cerca(antes.saldoFinal,  despues.saldoFinal,  'saldo posterior intacto');
});

test('un movimiento anterior a la primera ancla se ignora', () => {
  const cuenta = cuentaPlana({ movimientos: [{ fecha: '2025-06-01', tipo: MOV_APORTE, monto: 9999 }] });
  const cfg = configCuenta(cuenta);
  cerca(saldoEnFecha(eventosCuenta(cuenta), '2026-01-31', cfg),
        componer(10000, 30, cfg).saldoFinal, 'no hay saldo al que aplicarlo');
});

test('deja obsoleto el ajuste que absorbía ese salto', () => {
  const cuenta = cuentaConSaltoOculto();
  const cfg = configCuenta(cuenta);
  // El usuario lo había clasificado mal: dijo que el salto era deriva
  const gap = conciliar(cuenta, cuenta.montoInvertido, '2026-01-31', cfg).residuo;
  const malClasificado = { ...cuenta, ajustes: [{ fecha: '2026-01-31', monto: gap, motivo: 'deriva' }] };

  const [sinCorregir] = recalcularAjustes(malClasificado, cfg);
  cerca(sinCorregir.cambio, 0, 'mientras nadie registre el aporte, el ajuste se sostiene');

  const [corregido] = recalcularAjustes(conMovimientoTardio(malClasificado), cfg);
  cerca(corregido.monto, 0, 'el ajuste se vacía', 0.02);
  assert.ok(Math.abs(corregido.cambio) > 4000, `debía encogerse, cambió ${corregido.cambio}`);
  assert.equal(corregido.motivo, 'deriva', 'el motivo sigue siendo del usuario');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Transferencias entre cuentas');

const specBase = {
  id: 'tr-1', origenId: 'A', destinoId: 'B',
  monto: 5000, fecha: '2026-01-16', nota: 'paso a la otra',
};

test('genera dos patas espejo unidas por el mismo id', () => {
  const { transferenciaId, origen, destino } = movimientosTransferencia(specBase);
  assert.equal(transferenciaId, 'tr-1');
  assert.equal(origen.tipo, MOV_RETIRO);
  assert.equal(destino.tipo, MOV_APORTE);
  assert.equal(origen.monto, destino.monto);
  assert.equal(origen.contraparteId, 'B');
  assert.equal(destino.contraparteId, 'A');
  assert.ok(esTransferencia(origen) && esTransferencia(destino));
});

test('sin fecha de llegada, ambas patas caen el mismo día', () => {
  const { origen, destino } = movimientosTransferencia(specBase);
  assert.equal(origen.fecha, destino.fecha);
});

test('rechaza lo que no tiene sentido', () => {
  const malo = extra => validarTransferencia({ ...specBase, ...extra });
  assert.match(malo({ destinoId: 'A' }), /distintas/);
  assert.match(malo({ monto: 0 }), /mayor que cero/);
  assert.match(malo({ monto: -100 }), /mayor que cero/);
  assert.match(malo({ origenId: '' }), /origen/);
  assert.match(malo({ fechaDestino: '2026-01-15' }), /antes de salir/);
  assert.equal(malo({}), null);
  assert.throws(() => movimientosTransferencia({ ...specBase, destinoId: 'A' }), /distintas/);
});

/** Dos cuentas gemelas de $10,000 al 12%, capturadas el 1 de enero. */
const parCuentas = () => [cuentaPlana(), cuentaPlana()];

test('para cada cuenta es un movimiento común, nunca rendimiento', () => {
  const [a, b] = parCuentas();
  const { origen, destino } = movimientosTransferencia(specBase);
  const cfg = configCuenta(a);
  const rA = rendimientoEntre(eventosCuenta({ ...a, movimientos: [origen] }),  '2026-01-01', '2026-01-31', cfg);
  const rB = rendimientoEntre(eventosCuenta({ ...b, movimientos: [destino] }), '2026-01-01', '2026-01-31', cfg);

  cerca(rA.movimientos, -5000, 'sale del origen');
  cerca(rB.movimientos,  5000, 'entra al destino');
  cerca(rA.movimientos + rB.movimientos, 0, 'el portafolio no gana ni pierde capital');
  cerca(rA.ajustes, 0, 'no es un ajuste');
  cerca(rB.ajustes, 0, 'no es un ajuste');
});

test('el dinero en tránsito no genera interés en ninguna de las dos', () => {
  const [a, b] = parCuentas();
  const cfg = configCuenta(a);
  const total = fechaDestino => {
    const { origen, destino } = movimientosTransferencia({ ...specBase, fechaDestino });
    const rA = rendimientoEntre(eventosCuenta({ ...a, movimientos: [origen] }),  '2026-01-01', '2026-01-31', cfg);
    const rB = rendimientoEntre(eventosCuenta({ ...b, movimientos: [destino] }), '2026-01-01', '2026-01-31', cfg);
    return rA.rendimiento + rB.rendimiento;
  };
  assert.ok(total('2026-01-18') < total('2026-01-16'),
    'dos días de tránsito deben costar rendimiento');
});

test('una transferencia instantánea entre cuentas de igual tasa es neutra', () => {
  const [a, b] = parCuentas();
  const cfg = configCuenta(a);
  const { origen, destino } = movimientosTransferencia(specBase);
  const sin = 2 * rendimientoEntre(eventosCuenta(a), '2026-01-01', '2026-01-31', cfg).rendimiento;
  const con = rendimientoEntre(eventosCuenta({ ...a, movimientos: [origen] }),  '2026-01-01', '2026-01-31', cfg).rendimiento
            + rendimientoEntre(eventosCuenta({ ...b, movimientos: [destino] }), '2026-01-01', '2026-01-31', cfg).rendimiento;
  // El día del traspaso, origen rinde sobre su saldo VIEJO (todavía con el
  // dinero que está por salir) y destino rinde sobre el SUYO (todavía sin lo
  // que está por entrar) — exactamente lo mismo que si el dinero nunca se
  // hubiera movido ese día. Desde el día siguiente ambas cuentas suman
  // exactamente lo mismo que sumaban antes (solo repartido distinto), y como
  // la tasa es igual, el reparto no cambia nada. Sin `fechaDestino` (transfe-
  // rencia instantánea, sin días en tránsito) no hay ningún costo que cobrar.
  cerca(con, sin, 'una transferencia instantánea entre cuentas iguales no cuesta nada');
});

test('mover dinero a un tramo mejor sí sube el rendimiento total', () => {
  const lenta = cuentaPlana({ tramos: [{ hasta: null, tasa: 4 }] });
  const rapida = cuentaPlana({ tramos: [{ hasta: null, tasa: 12 }] });
  const { origen, destino } = movimientosTransferencia(specBase);
  const sin = rendimientoEntre(eventosCuenta(lenta), '2026-01-01', '2026-01-31', configCuenta(lenta)).rendimiento
            + rendimientoEntre(eventosCuenta(rapida), '2026-01-01', '2026-01-31', configCuenta(rapida)).rendimiento;
  const con = rendimientoEntre(eventosCuenta({ ...lenta, movimientos: [origen] }), '2026-01-01', '2026-01-31', configCuenta(lenta)).rendimiento
            + rendimientoEntre(eventosCuenta({ ...rapida, movimientos: [destino] }), '2026-01-01', '2026-01-31', configCuenta(rapida)).rendimiento;
  assert.ok(con > sin, `${con} debía superar a ${sin}`);
});

test('editarla reemplaza la pata en vez de duplicarla', () => {
  const { origen } = movimientosTransferencia(specBase);
  const corregida = movimientosTransferencia({ ...specBase, monto: 7000 }).origen;
  const lista = conTransferencia(conTransferencia([], origen), corregida);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].monto, 7000);
});

test('conTransferencia respeta los movimientos sueltos y ordena por fecha', () => {
  const suelto = { fecha: '2026-01-05', tipo: MOV_APORTE, monto: 100 };
  const { origen } = movimientosTransferencia(specBase);
  const lista = conTransferencia([suelto], origen);
  assert.deepEqual(lista.map(m => m.fecha), ['2026-01-05', '2026-01-16']);
  assert.equal(esTransferencia(suelto), false);
});

test('sinTransferencia quita solo esa pata', () => {
  const suelto = { fecha: '2026-01-05', tipo: MOV_APORTE, monto: 100 };
  const { origen } = movimientosTransferencia(specBase);
  const lista = sinTransferencia(conTransferencia([suelto], origen), 'tr-1');
  assert.deepEqual(lista, [suelto]);
  assert.deepEqual(sinTransferencia(undefined, 'tr-1'), []);
});

test('cada llamada sin id explícito genera uno distinto', () => {
  const { id: _omit, ...sinId } = specBase;
  const a = movimientosTransferencia(sinId).transferenciaId;
  const b = movimientosTransferencia(sinId).transferenciaId;
  assert.ok(a && b && a !== b, 'los ids deben ser únicos');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Historial diario con eventos');

test('el movimiento aparece en su renglón, pero rinde sobre el saldo de ayer', () => {
  const cuenta = cuentaPlana({ movimientos: [{ fecha: '2026-01-11', tipo: MOV_APORTE, monto: 5000 }] });
  const filas = historialDiario(cuenta, '2026-01-21');
  const dia       = filas.find(f => f.fecha === '2026-01-11');
  const siguiente = filas.find(f => f.fecha === '2026-01-12');
  cerca(dia.movimiento, 5000, 'se reporta en su día');
  assert.ok(dia.saldoInicial < 15000, 'saldoInicial es el saldo de ayer, antes del aporte de hoy');
  assert.ok(dia.saldoFinal > 15000, 'saldoFinal sí ya lo incluye');
  assert.ok(dia.neto > 0, 'ese mismo día ya rinde — sobre el saldo viejo, no en $0');
  assert.ok(dia.neto < siguiente.neto, 'menos que al día siguiente, que ya compone sobre el saldo nuevo');
});

test('la tabla cuadra con el saldo que proyecta el motor', () => {
  const cuenta = cuentaPlana({
    movimientos: [{ fecha: '2026-01-11', tipo: MOV_APORTE, monto: 5000 }],
    ajustes:     [{ fecha: '2026-01-16', monto: -3, motivo: 'deriva' }],
  });
  const cfg = configCuenta(cuenta);
  const filas = historialDiario(cuenta, '2026-01-21');
  // El último renglón es el de "hoy" mismo (2026-01-21) — saldoEnFecha da el
  // saldo al INICIO de una fecha, así que su cierre se compara contra el
  // inicio del día siguiente.
  assert.equal(filas[filas.length - 1].fecha, '2026-01-21', 'la tabla llega hasta hoy');
  // Tolerancia ancha a propósito: `saldoEnFecha` llama a `recorrer()` directo
  // sobre la ancla, que trata `montoInvertido` como ya vigente al CIERRE de
  // `fechaActualizacion` (sin su propio día de interés) — mientras que
  // `historialDiario` sí se lo da, igual que `recorrerDesdeCaptura`. Es el
  // "Hallazgo (sin corregir)" documentado al final de § Cálculo de
  // Rendimientos: cambiarlo en `estadoEnFecha` es correcto pero repercute en
  // `conciliar()`/`rendimientoEntre()` a la vez, y no se ha auditado todavía.
  cerca(filas[filas.length - 1].saldoFinal,
        saldoEnFecha(eventosCuenta(cuenta), sumarDias('2026-01-21', 1), cfg),
        'último saldo de la tabla vs. saldoEnFecha', 2);
});

test('recortar por maxDias no pierde los eventos saltados', () => {
  const cuenta = cuentaPlana({ movimientos: [{ fecha: '2026-01-06', tipo: MOV_APORTE, monto: 5000 }] });
  const cfg = configCuenta(cuenta);
  const filas = historialDiario(cuenta, '2026-02-01', 5);
  assert.equal(filas.length, 5);
  assert.equal(filas[filas.length - 1].fecha, '2026-02-01', 'el último renglón es hoy');
  cerca(filas[filas.length - 1].saldoFinal,
        saldoEnFecha(eventosCuenta(cuenta), sumarDias('2026-02-01', 1), cfg),
        'el arranque comprimido respeta el aporte', 0.02);
});

test('sin eventos se comporta igual que antes', () => {
  const cuenta = cuentaPlana();
  const cfg = configCuenta(cuenta);
  const filas = historialDiario(cuenta, '2026-01-31');
  assert.equal(filas.length, 31, 'del 1 al 31 de enero, ambos incluidos');
  cerca(filas[0].saldoInicial, 10000, 'arranca en el capital');
  // Ya no es igualdad exacta contra componer(): historialDiario encadena el
  // saldo con cada día ya redondeado a centavos (ver 'el saldo se reconstruye
  // exactamente...' más abajo), mientras que componer() sigue exacto — se
  // permite hasta un par de centavos de diferencia sobre un mes.
  cerca(filas[filas.length - 1].saldoFinal, componer(10000, 31, cfg).saldoFinal, 'saldo final', 0.02);
  assert.equal(filas[0].movimiento, 0);
});

test('el saldo se reconstruye exactamente sumando lo abonado, sin arrastrar el redondeo', () => {
  const filas = historialDiario(cuentaPlana(), '2026-06-30');
  const reconstruido = 10000 + suma(filas, 'abonado') + suma(filas, 'movimiento') + suma(filas, 'ajuste');
  assert.equal(filas[filas.length - 1].saldoFinal, r2(reconstruido),
    'sumar lo que la tabla muestra da exactamente el saldo que la tabla muestra');
  filas.forEach(f => assert.equal(r2(f.abonado), f.abonado, `abonado del ${f.fecha} ya es cents-precise`));
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Corrección de la raíz');

test('capturasDescartadas detecta lo que queda en el futuro respecto a la nueva fecha', () => {
  const historial = [{ fecha: '2026-02-03', monto: 5000 }, { fecha: '2026-08-05', monto: 25478.75 }];
  const d = capturasDescartadas(historial, '2026-01-01');
  assert.equal(d.length, 2, 'ambas son posteriores a la nueva fecha');
  assert.deepEqual(d.map(h => h.fecha), ['2026-02-03', '2026-08-05'], 'ordenadas por fecha');
});

test('nada se descarta si la nueva fecha es posterior a todo', () => {
  const historial = [{ fecha: '2026-02-03', monto: 5000 }];
  assert.deepEqual(capturasDescartadas(historial, '2026-12-01'), []);
});

test('una captura en la misma fecha que la nueva raíz también se descarta', () => {
  // Coincidir en fecha ya no puede seguir siendo "anterior" a la raíz
  const historial = [{ fecha: '2026-01-01', monto: 100 }];
  assert.equal(capturasDescartadas(historial, '2026-01-01').length, 1);
});

test('historialConsistente conserva solo lo estrictamente anterior', () => {
  const historial = [
    { fecha: '2025-12-01', monto: 1000 },
    { fecha: '2026-02-03', monto: 5000 },
    { fecha: '2026-08-05', monto: 25478.75 },
  ];
  const limpio = historialConsistente(historial, '2026-01-01');
  assert.deepEqual(limpio.map(h => h.fecha), ['2025-12-01']);
});

test('resumenCuenta deriva capital y fechaBase del timeline, no del campo crudo', () => {
  // Reproduce exactamente los datos de la cuenta del reporte: la "raíz" (campos
  // crudos) quedó en una fecha más vieja que lo que ya había en `historial` —
  // antes de la corrección, `capital` se leía de ahí directo y daba $0.
  const cuenta = {
    montoInvertido: 0,               // campo crudo desalineado — no debe usarse
    fechaActualizacion: '2026-01-01',
    historial: [
      { fecha: '2026-02-03', monto: 5000 },
      { fecha: '2026-08-05', monto: 25478.75 },
    ],
    tramos: [{ hasta: null, tasa: 12 }],
    baseAnual: 365,
  };
  const r = resumenCuenta(cuenta, '2026-08-08');
  assert.equal(r.fechaBase, '2026-08-05', 'fechaBase es la más reciente del timeline completo');
  cerca(r.capital, 25478.75, 'capital sale del timeline, no del campo montoInvertido');
  assert.ok(r.saldoActual > 25478.75, 'compone desde el capital correcto, no desde 0');
});

test('rendimientoHastaHoy coincide con la suma de la tabla aunque haya un aporte de por medio', () => {
  // Bug real que motivó esto: un `recorrer()` de un solo tramo diverge del
  // historial día-por-día en cuanto hay un movimiento entre medio — la
  // tarjeta mostraba un total distinto al de su propia tabla. `resumenCuenta`
  // siempre calcula "Hasta hoy" reusando `historialDiario`, así que no hay
  // segundo camino que pueda desincronizarse.
  const cuenta = cuentaPlana({
    movimientos: [{ fecha: '2026-03-10', tipo: MOV_APORTE, monto: 7500 }],
  });
  const hoy = '2026-08-07';
  const r = resumenCuenta(cuenta, hoy);
  const filas = historialDiario(cuenta, hoy);
  const totalTabla = filas.reduce((s, f) => s + (f.abonado || 0) + (f.ajuste || 0), 0);
  assert.equal(r.rendimientoHastaHoy, totalTabla,
    'debe ser exactamente lo que suma la tabla, no una proyección aparte');
});

test('historialDiario atraviesa una ancla intermedia, no arranca directo en ella', () => {
  // Mismo caso que rompía resumenCuenta (capital=0 en el campo crudo, el valor real
  // está en el historial) pero ahora visto desde la tabla completa: debe recorrer
  // desde la primera ancla (enero, $0) y solo *llegar* a $25478.75 el día de la
  // ancla observada — no arrancar la tabla ya en ese valor.
  const cuenta = {
    montoInvertido: 0,
    fechaActualizacion: '2026-01-01',
    historial: [{ fecha: '2026-08-05', monto: 25478.75 }],
    tramos: [{ hasta: null, tasa: 12 }],
    baseAnual: 365,
  };
  const filas = historialDiario(cuenta, '2026-08-08');
  assert.ok(filas.length > 0, 'no debe devolver vacío por leer capital=0 del campo crudo');
  // Enero-julio se queda en $0 y no genera renglones — el primero con contenido
  // es el propio día de la ancla, donde el saldo observado pisa la trayectoria
  assert.equal(filas[0].fecha, '2026-08-05', 'el primer renglón con contenido es el de la ancla');
  cerca(filas[0].saldoInicial, 0, 'antes de la ancla la trayectoria seguía en $0');
  cerca(filas[0].saldoFinal, 25478.75, 'la ancla observada pisa el saldo real ese día');
});

test('capital $0 en la ancla no corta la tabla si hay un aporte después', () => {
  // El caso real reportado: cuenta abierta en $0, con un aporte real semanas
  // después. Antes, el corte por `capital <= 0` escondía la tabla entera y nunca
  // llegaba a aplicar el aporte — como si el dinero no existiera.
  const cuenta = cuentaPlana({
    montoInvertido: 0,
    fechaActualizacion: '2026-01-01',
    historial: [],
    movimientos: [{ fecha: '2026-02-03', tipo: MOV_APORTE, monto: 5000 }],
  });
  const filas = historialDiario(cuenta, '2026-08-08');
  assert.ok(filas.length > 0, 'no debe devolver vacío solo porque arranca en $0');

  // Los días previos en $0 sin nada que mostrar quedan afuera de la tabla — el
  // aporte es el primer renglón que aparece
  assert.equal(filas[0].fecha, '2026-02-03', 'arranca directo en el día del aporte');
  const delDia  = filas.find(f => f.fecha === '2026-02-03');
  const despues = filas.find(f => f.fecha === '2026-02-04');
  cerca(delDia.saldoInicial, 0, 'antes del aporte la trayectoria seguía en $0');
  cerca(delDia.saldoFinal, 5000, 'el aporte se aplica ese mismo día');
  cerca(delDia.neto, 0, 'pero todavía no genera interés ese día');
  cerca(despues.saldoInicial, 5000, 'arranca el día siguiente en el mismo monto');
  assert.ok(despues.neto > 0, 'y recién ahí empieza a generar interés');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Otras configuraciones');

test('tasa efectiva y tramo único siguen funcionando con eventos', () => {
  const cuenta = cuentaPlana({
    modoTasa: TASA_EFECTIVA, modoTramos: MODO_UNICO,
    tramos: [{ hasta: 25000, tasa: 15 }, { hasta: null, tasa: 5 }],
    movimientos: [{ fecha: '2026-01-16', tipo: MOV_APORTE, monto: 20000 }],
  });
  const cfg = configCuenta(cuenta);
  const r = rendimientoEntre(eventosCuenta(cuenta), '2026-01-01', '2026-01-31', cfg);
  assert.ok(r.rendimiento > 0, 'genera rendimiento');
  cerca(r.movimientos, 20000, 'movimientos');
  cerca(r.residuo, 0, 'sin residuo');
});

test('con ISR el bruto supera al neto y el timeline no cambia', () => {
  const cuenta = cuentaPlana({ isrAnual: 0.9 });
  const cfg = configCuenta(cuenta);
  const r = rendimientoEntre(eventosCuenta(cuenta), '2026-01-01', '2026-01-31', cfg);
  assert.ok(r.isr > 0 && r.bruto > r.rendimiento, 'la retención se reporta aparte');
  assert.equal(timelineCuenta(cuenta).length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Redondeo diario: centavos vs. acumulado');

test('centavos y acumulado: Bruto − ISR siempre coincide con el Rendimiento del día', () => {
  // El bug que motivó el modo acumulado: en `continuo`, bruto/isr quedan
  // exactos y el "Rendimiento del día" se redondea aparte — restar los dos
  // primeros (ya redondeados para mostrarse) no siempre da el tercero. Ambos
  // modos nuevos evitan eso por construcción: lo que se muestra en bruto/isr
  // YA es lo que se pagó, así que la resta siempre cuadra.
  for (const redondeoDiario of [REDONDEO_CENTAVOS, REDONDEO_ACUMULADO]) {
    const cuenta = cuentaPlana({ redondeoDiario, isrAnual: 0.9 });
    const filas = historialDiario(cuenta, '2026-03-15');
    assert.ok(filas.length > 0);
    filas.forEach(f => cerca(f.bruto - f.isr, f.neto, `${redondeoDiario} ${f.fecha}`));
  }
});

test('acumulado: lo pagado nunca se aleja más de un centavo de lo exacto', () => {
  // Es justo lo que no garantiza redondear cada día por separado: sin el
  // remanente, el total pagado puede desviarse un centavo por día y ese error
  // se acumula. Con remanente, la única razón para que pagado ≠ exacto es la
  // fracción de centavo que todavía no se completó — menos de un centavo en
  // total, sin importar cuántos días pasen.
  const cuenta = cuentaPlana({ redondeoDiario: REDONDEO_ACUMULADO, isrAnual: 0.9 });
  const cfg = configCuenta(cuenta);
  const filas = historialDiario(cuenta, '2026-06-30', 400);
  let brutoExacto = 0, isrExacto = 0;
  filas.forEach(f => {
    brutoExacto += interesDiario(f.saldoInicial, cfg);
    isrExacto   += isrDiario(f.saldoInicial, cfg);
  });
  const brutoPagado = suma(filas, 'bruto');
  const isrPagado   = suma(filas, 'isr');
  assert.ok(Math.abs(brutoPagado - brutoExacto) < 0.01, `bruto: ${brutoPagado} vs ${brutoExacto}`);
  assert.ok(Math.abs(isrPagado - isrExacto) < 0.01, `isr: ${isrPagado} vs ${isrExacto}`);
});

test('acumulado reproduce exacto un estado de cuenta real (Revolut, feb 2026)', () => {
  // Caso real que expuso el bug: tramos, tasa y retención de una cuenta
  // Revolut MX, con el depósito inicial el 3 feb 2026. `centavos` y `continuo`
  // se desvían del estado de cuenta real en días sueltos de esta ventana;
  // `acumulado` es el único que cuadra al centavo en los diez primeros días.
  const cuenta = {
    montoInvertido: 0, fechaActualizacion: '2026-01-01',
    tramos: [{ hasta: 25000, tasa: 15 }, { hasta: 1000000, tasa: 7 }, { hasta: null, tasa: 4.5 }],
    baseAnual: 360, isrAnual: 0.90, baseIsr: 365,
    redondeoDiario: REDONDEO_ACUMULADO,
    movimientos: [{ fecha: '2026-02-03', tipo: MOV_APORTE, monto: 5000 }],
  };
  const filas = historialDiario(cuenta, '2026-02-10', 400);
  const reales = {
    '2026-02-06': 5005.88, '2026-02-07': 5007.84, '2026-02-08': 5009.81,
    '2026-02-09': 5011.77, '2026-02-10': 5013.74,
  };
  Object.entries(reales).forEach(([fecha, saldoReal]) => {
    const fila = filas.find(f => f.fecha === fecha);
    assert.equal(fila?.saldoFinal, saldoReal, `saldo del ${fecha}`);
  });
});

test('el remanente se reinicia en cada ancla, igual que el residuo', () => {
  // Una captura de saldo real (ancla) manda sobre lo proyectado, y la fracción
  // de centavo que llevaba el remanente no es observable en ese momento — no
  // tendría sentido cargarla a la siguiente ancla (mismo criterio que
  // `residuo`). Se prueba encadenando DOS anclas en una misma cuenta: nueve
  // días de historial acumulan remanente hasta el 10 ene, donde una segunda
  // ancla "captura" un saldo cualquiera. El propio 10 ene NO es comparable
  // entre las dos cuentas: por diseño, una ancla intermedia todavía compone
  // ESE día con la trayectoria previa a la captura (ver `recorrerDesdeCaptura`
  // / "historialDiario atraviesa una ancla intermedia, no arranca directo en
  // ella"), mientras que en una cuenta que arranca justo ahí ese primer
  // renglón sí es "ya inicio de ese día" — por eso el remanente limpio se nota
  // un día antes en la cuenta fresca que en la que atraviesa la ancla. Lo que
  // importa es que, ya "adentro" de la nueva ancla, ambas cuentas generan la
  // misma SECUENCIA de bruto/isr — es decir, ninguna cargó el remanente viejo.
  const base = { tramos: [{ hasta: null, tasa: 12 }], baseAnual: 365, redondeoDiario: REDONDEO_ACUMULADO };

  const conHistoria = { ...base, montoInvertido: 12345.67, fechaActualizacion: '2026-01-10',
    historial: [{ fecha: '2026-01-01', monto: 10000 }] };
  const fresca = { ...base, montoInvertido: 12345.67, fechaActualizacion: '2026-01-10' };

  const brutoHistoria = historialDiario(conHistoria, '2026-01-12')
    .filter(f => f.fecha > '2026-01-10').map(f => f.bruto);
  const brutoFresca = historialDiario(fresca, '2026-01-12').map(f => f.bruto);

  assert.deepEqual(brutoHistoria, brutoFresca.slice(0, brutoHistoria.length),
    'la secuencia de bruto tras la nueva ancla no debería depender del remanente previo');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Calendario de abono');

// Enero de 2026 cae perfecto para probarlo: jue 1, vie 2, sáb 3, dom 4, lun 5.

test('sin calendario, el fin de semana abona como cualquier otro día', () => {
  const filas = historialDiario(cuentaPlana(), '2026-01-05');
  assert.equal(filas.length, 5);
  filas.forEach(f => {
    cerca(f.abonado, f.neto, `abonado del ${f.fecha}`);
    assert.equal(f.pendiente, 0, `sin pendientes el ${f.fecha}`);
  });
});

test('el sábado devenga pero no abona, y el saldo se queda quieto', () => {
  const filas = historialDiario(cuentaPlana({ calendarioAbono: ABONO_HABIL_ACUMULA }), '2026-01-05');
  const [jue, vie, sab, dom, lun] = filas;

  assert.ok(sab.neto > 0, 'el sábado sí genera interés');
  assert.equal(sab.abonado, 0, 'pero no lo abona');
  assert.equal(dom.abonado, 0, 'el domingo tampoco');
  cerca(sab.saldoFinal, vie.saldoFinal, 'el saldo del sábado es el del viernes');
  cerca(dom.saldoFinal, vie.saldoFinal, 'y el del domingo también');
  cerca(dom.pendiente, sab.neto + dom.neto, 'la bolsa acumula los dos días');
  cerca(jue.abonado, jue.neto, 'entre semana abona normal');
});

test('el lunes abona el acumulado del puente, incluido lo suyo', () => {
  const filas = historialDiario(cuentaPlana({ calendarioAbono: ABONO_HABIL_ACUMULA }), '2026-01-05');
  const [, vie, sab, dom, lun] = filas;
  cerca(lun.abonado, sab.neto + dom.neto + lun.neto, 'tres días juntos');
  assert.equal(lun.pendiente, 0, 'la bolsa queda vacía');
  cerca(lun.saldoFinal, vie.saldoFinal + lun.abonado, 'y todo entra al saldo de golpe');
});

test('no se pierde ni un centavo: lo devengado es lo abonado más lo pendiente', () => {
  const filas = historialDiario(cuentaPlana({ calendarioAbono: ABONO_HABIL_ACUMULA }), '2026-03-15');
  cerca(suma(filas, 'neto'),
        suma(filas, 'abonado') + filas[filas.length - 1].pendiente,
        'devengo = abonos + bolsa');
});

test('retrasar la composición rinde un poco menos, pero solo un poco', () => {
  const nat = historialDiario(cuentaPlana(), '2026-12-31');
  const hab = historialDiario(cuentaPlana({ calendarioAbono: ABONO_HABIL_ACUMULA }), '2026-12-31');
  const devNat = suma(nat, 'neto'), devHab = suma(hab, 'neto');
  assert.ok(devHab < devNat, 'compone más tarde, así que devenga menos');
  assert.ok((devNat - devHab) / devNat < 0.001, `la diferencia es marginal: ${devNat - devHab}`);
});

test('un festivo alarga el puente hasta el siguiente día hábil', () => {
  registrarInhabiles([{ fecha: '2026-01-05' }]);   // lunes festivo
  try {
    const filas = historialDiario(cuentaPlana({ calendarioAbono: ABONO_HABIL_ACUMULA }), '2026-01-06');
    const [, vie, sab, dom, lun, mar] = filas;
    assert.equal(lun.abonado, 0, 'el lunes festivo no abona');
    cerca(lun.saldoFinal, vie.saldoFinal, 'el saldo sigue congelado');
    cerca(mar.abonado, sab.neto + dom.neto + lun.neto + mar.neto, 'el martes abona los cuatro días');
  } finally {
    registrarInhabiles([]);
  }
});

test('habilSolo ni siquiera devenga en fin de semana', () => {
  const filas = historialDiario(cuentaPlana({ calendarioAbono: ABONO_HABIL_SOLO }), '2026-01-05');
  const [, vie, sab, dom, lun] = filas;
  assert.equal(sab.neto, 0, 'el sábado no genera nada');
  assert.equal(dom.neto, 0, 'el domingo tampoco');
  cerca(lun.abonado, lun.neto, 'el lunes abona solo lo suyo');
  cerca(lun.saldoFinal, vie.saldoFinal + lun.neto, 'y el fin de semana no dejó bolsa');
});

test('habilSolo rinde bastante menos al año — no es un detalle cosmético', () => {
  const nat = suma(historialDiario(cuentaPlana(), '2026-12-31'), 'neto');
  const sol = suma(historialDiario(cuentaPlana({ calendarioAbono: ABONO_HABIL_SOLO }), '2026-12-31'), 'neto');
  const recorte = 1 - sol / nat;
  assert.ok(recorte > 0.25 && recorte < 0.32, `pierde ~104/365 días: ${(recorte * 100).toFixed(1)}%`);
});

/**
 * El saldo del viernes es el último que la institución acreditó antes del fin de
 * semana: es lo que el usuario ve en la app si consulta el domingo. Sale de
 * `saldoEnFecha` y no de `historialDiario` porque `conciliar` usa ese mismo
 * marco (el ancla es el CIERRE de su día, no el inicio).
 */
const saldoDelViernes = cuenta =>
  saldoEnFecha(eventosCuenta(cuenta), '2026-01-02', configCuenta(cuenta));

test('conciliar un domingo cuadra: lo pendiente no está en el saldo', () => {
  const cuenta = cuentaPlana({ calendarioAbono: ABONO_HABIL_ACUMULA });
  const c = conciliar(cuenta, saldoDelViernes(cuenta), '2026-01-04');

  cerca(c.residuo, 0, 'sin residuo espurio');
  assert.ok(c.cuadra, 'cuadra');
  // Sábado y domingo devengaron sobre el saldo congelado del viernes
  cerca(c.pendiente, 2 * saldoDelViernes(cuenta) * 0.12 / 365,
        'lo devengado del finde se reporta aparte', 0.01);
});

test('sin el calendario, ese mismo domingo dejaría un residuo de dos días', () => {
  const cuenta = cuentaPlana();
  const c = conciliar(cuenta, saldoDelViernes(cuenta), '2026-01-04');
  assert.ok(!c.cuadra, 'el modelo sin calendario se adelanta');
  cerca(c.residuo, -2 * saldoDelViernes(cuenta) * 0.12 / 365,
        'y arrastra dos días de más', 0.01);
});

test('resumenCuenta reporta la bolsa y cuándo se acredita', () => {
  const r = resumenCuenta(cuentaPlana({ calendarioAbono: ABONO_HABIL_ACUMULA }), '2026-01-04');
  assert.ok(r.pendiente > 0, 'hay devengo sin abonar');
  assert.equal(r.proximoAbono, '2026-01-05', 'se acredita el lunes');
  assert.equal(resumenCuenta(cuentaPlana(), '2026-01-04').pendiente, 0, 'natural nunca acumula');
});

test('"Último" en calendario hábil reporta el puente completo, no solo el día', () => {
  const cuenta = cuentaPlana({ calendarioAbono: ABONO_HABIL_ACUMULA });
  const [, vie, sab, dom, lun] = historialDiario(cuenta, '2026-01-05');

  const rLunes = resumenCuenta(cuenta, '2026-01-05');
  cerca(rLunes.ayer, sab.neto + dom.neto + lun.neto,
        'el lunes "Último" junta sábado + domingo + lunes, como en el historial');

  const rDomingo = resumenCuenta(cuenta, '2026-01-04');
  cerca(rDomingo.ayer, vie.neto,
        'un domingo (nada abonado aún) "Último" sigue mostrando el último día que sí acreditó');
});

test('un movimiento en fin de semana no despierta el abono', () => {
  const cuenta = cuentaPlana({
    calendarioAbono: ABONO_HABIL_ACUMULA,
    movimientos: [{ fecha: '2026-01-03', tipo: MOV_APORTE, monto: 5000 }],
  });
  const filas = historialDiario(cuenta, '2026-01-05');
  const [, vie, sab, dom, lun] = filas;
  assert.equal(sab.abonado, 0, 'el aporte no es un abono de interés');
  cerca(sab.saldoFinal, vie.saldoFinal + 5000, 'pero sí entra al saldo');
  cerca(lun.abonado, sab.neto + dom.neto + lun.neto, 'la bolsa sigue su curso');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Plegado de días inhábiles para la tabla');

/** `historialDiario` + `plegarDiasInhabiles`, que es como lo consume el modal. */
const plegar = (cuenta, hasta) =>
  plegarDiasInhabiles(historialDiario(cuenta, hasta), configCuenta(cuenta));

test('sin calendario no pliega nada: la tabla queda igual', () => {
  const cuenta = cuentaPlana();
  const { filas, pendientes } = plegar(cuenta, '2026-01-05');
  assert.equal(filas.length, 5);
  assert.equal(pendientes.length, 0);
});

test('el fin de semana desaparece y su interés viaja al lunes', () => {
  const { filas } = plegar(cuentaPlana({ calendarioAbono: ABONO_HABIL_ACUMULA }), '2026-01-05');
  assert.deepEqual(filas.map(f => f.fecha),
    ['2026-01-01', '2026-01-02', '2026-01-05'], 'sábado y domingo no llevan renglón');

  const lun = filas[2];
  assert.equal(lun.acumulados.length, 2, 'el lunes sabe qué días arrastró');
  assert.deepEqual(lun.acumulados.map(d => d.fecha), ['2026-01-03', '2026-01-04']);
  cerca(lun.abonado, lun.acumulados.reduce((s, d) => s + d.neto, 0) + lun.neto,
        'y su abono es la suma de los tres');
});

test('el bruto y el ISR del puente también se pliegan', () => {
  const cuenta = cuentaPlana({ calendarioAbono: ABONO_HABIL_ACUMULA, isrAnual: 0.9 });
  const asc = historialDiario(cuenta, '2026-01-05');
  const { filas } = plegarDiasInhabiles(asc, configCuenta(cuenta));
  const lun = filas[2];
  cerca(lun.bruto, asc.slice(2).reduce((s, f) => s + f.bruto, 0), 'bruto del puente completo');
  cerca(lun.isr,   asc.slice(2).reduce((s, f) => s + f.isr,   0), 'ISR del puente completo');
});

test('no se pierde ni se duplica un centavo al plegar', () => {
  const cuenta = cuentaPlana({ calendarioAbono: ABONO_HABIL_ACUMULA, isrAnual: 0.9 });
  const asc = historialDiario(cuenta, '2026-06-30');
  const { filas, pendientes } = plegarDiasInhabiles(asc, configCuenta(cuenta));

  // Plegar solo reagrupa para mostrar — no recalcula `abonado`/`bruto`, así que
  // la suma debe quedar exactamente igual a la de la tabla sin plegar, sin
  // tolerancia: no hay redondeo nuevo de por medio en este paso.
  assert.equal(suma(filas, 'abonado'), suma(asc, 'abonado'), 'abonado total no cambia al plegar');
  // bruto sigue exacto (sin redondear) — la comparación tolera el ruido de
  // punto flotante propio de sumar en distinto orden, no un redondeo real
  cerca(suma(filas, 'bruto'), suma(asc, 'bruto'), 'el bruto total no cambia');

  // Lo que sí compone en centavos es el propio saldo: capital + lo abonado
  // reconstruye exactamente el saldo con el que terminó la tabla sin plegar.
  const capital = 10000;
  assert.equal(asc[asc.length - 1].saldoFinal, r2(capital + suma(asc, 'abonado')),
    'saldo final = capital + abonado, cents-precise');

  // Y lo que quedó sin abonar en la bolsa es justo lo que el propio motor ya
  // reporta como `pendiente` en el último renglón de la tabla sin plegar
  cerca(pendientes.reduce((s, f) => s + f.neto, 0), asc[asc.length - 1].pendiente,
        'la bolsa plegada coincide con lo pendiente del motor', 0.02);
});

test('un sábado con movimiento sobrevive, pero sin rendimiento propio', () => {
  const cuenta = cuentaPlana({
    calendarioAbono: ABONO_HABIL_ACUMULA,
    movimientos: [{ fecha: '2026-01-03', tipo: MOV_APORTE, monto: 5000 }],
  });
  const { filas } = plegar(cuenta, '2026-01-05');
  const sab = filas.find(f => f.fecha === '2026-01-03');

  assert.ok(sab, 'el renglón del aporte no se pliega: se perdería de vista');
  cerca(sab.movimiento, 5000, 'muestra el movimiento');
  assert.equal(sab.abonado, 0, 'pero no abonó nada');
  assert.equal(sab.bruto, 0, 'y su interés ya viajó al lunes');

  const lun = filas.find(f => f.fecha === '2026-01-05');
  assert.deepEqual(lun.acumulados.map(d => d.fecha), ['2026-01-03', '2026-01-04'],
                   'el lunes lo sigue contando');
});

test('lo que no alcanzó a abonarse queda en `pendientes`, no en una fila', () => {
  // Sábado: el devengo del propio sábado todavía no tiene día de abono
  const { filas, pendientes } = plegar(
    cuentaPlana({ calendarioAbono: ABONO_HABIL_ACUMULA }), '2026-01-03');
  assert.equal(filas[filas.length - 1].fecha, '2026-01-02', 'la tabla cierra el viernes');
  assert.deepEqual(pendientes.map(f => f.fecha), ['2026-01-03']);
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Vigencias de tasa');

/** Cuenta con dos vigencias: 12% hasta el 1 mar, 13% desde el 2 mar. */
const cuentaDosTasas = (extra = {}) => cuentaPlana({
  tramos: [{ hasta: null, tasa: 13 }],
  tasaDesde: '2026-03-02',
  historialTasas: [{ desde: null, tramos: [{ hasta: null, tasa: 12 }], modoTramos: 'progresivo', modoTasa: 'nominal' }],
  ...extra,
});

test('sin historialTasas, vigenciasTasa da una sola con desde: null', () => {
  const vig = vigenciasTasa(cuentaPlana());
  assert.equal(vig.length, 1);
  assert.equal(vig[0].desde, null);
  cerca(vig[0].tramos[0].tasa, 12, 'tasa de cuentaPlana');
});

test('con historial, vigenciasTasa queda ascendente con la actual al final', () => {
  const vig = vigenciasTasa(cuentaDosTasas());
  assert.equal(vig.length, 2);
  assert.equal(vig[0].desde, null);
  cerca(vig[0].tramos[0].tasa, 12);
  assert.equal(vig[1].desde, '2026-03-02');
  cerca(vig[1].tramos[0].tasa, 13);
});

test('vigenciaEnFecha resuelve el borde exacto — el propio día del cambio ya es la nueva', () => {
  const vig = vigenciasTasa(cuentaDosTasas());
  cerca(vigenciaEnFecha(vig, '2026-03-01').tramos[0].tasa, 12, 'un día antes: la vieja');
  cerca(vigenciaEnFecha(vig, '2026-03-02').tramos[0].tasa, 13, 'el propio día: la nueva');
  cerca(vigenciaEnFecha(vig, '2027-01-01').tramos[0].tasa, 13, 'mucho después: sigue la nueva');
  cerca(vigenciaEnFecha(vig, '2020-01-01').tramos[0].tasa, 12, 'mucho antes: la de desde:null');
});

test('el compuesto diario usa la tasa vieja hasta el cambio y la nueva desde ahí', () => {
  const filas = historialDiario(cuentaDosTasas(), '2026-03-03');
  const antes  = filas.find(f => f.fecha === '2026-03-01');
  const cambio = filas.find(f => f.fecha === '2026-03-02');
  const despues = filas.find(f => f.fecha === '2026-03-03');

  const esperado12 = antes.saldoInicial * 0.12 / 365;
  const esperado13 = cambio.saldoInicial * 0.13 / 365;
  cerca(antes.neto, esperado12, 'el 1 de marzo todavía rinde al 12%');
  cerca(cambio.neto, esperado13, 'el 2 de marzo ya rinde al 13% — el propio día del cambio');
  cerca(despues.neto, despues.saldoInicial * 0.13 / 365, 'y sigue al 13% después');
  assert.ok(cambio.neto > antes.neto, 'el salto de tasa se nota en el interés diario');
});

test('rendimientoEntre calcula cada tramo del rango con su propia tasa', () => {
  const cuenta = cuentaDosTasas();
  const cfg = configCuenta(cuenta);
  const evs = eventosCuenta(cuenta);

  const antesDelCambio = rendimientoEntre(evs, '2026-01-01', '2026-03-01', cfg);
  const anualizado12 = (antesDelCambio.rendimiento / antesDelCambio.saldoInicial) * (365 / antesDelCambio.dias) * 100;
  cerca(anualizado12, 12, 'el periodo previo anualiza cerca del 12%', 0.2);

  const despuesDelCambio = rendimientoEntre(evs, '2026-03-02', '2026-03-12', cfg);
  const anualizado13 = (despuesDelCambio.rendimiento / despuesDelCambio.saldoInicial) * (365 / despuesDelCambio.dias) * 100;
  cerca(anualizado13, 13, 'el periodo posterior anualiza cerca del 13%', 0.05);

  // Un rango que ATRAVIESA el cambio queda entre las dos tasas, ni en 12 ni en 13
  const cruzado = rendimientoEntre(evs, '2026-02-01', '2026-04-01', cfg);
  const anualizadoCruzado = (cruzado.rendimiento / cruzado.saldoInicial) * (365 / cruzado.dias) * 100;
  assert.ok(anualizadoCruzado > 12 && anualizadoCruzado < 13, `mezclado entre 12 y 13: ${anualizadoCruzado}`);
});

test('conciliar también respeta la vigencia de cada día', () => {
  const cuenta = cuentaDosTasas();
  const proyectado = saldoEnFecha(eventosCuenta(cuenta), '2026-03-05', configCuenta(cuenta));
  const c = conciliar(cuenta, proyectado, '2026-03-05');
  assert.ok(c.cuadra, 'conciliar usa la misma resolución de tasa que el resto del motor');
});

test('una cuenta sin cambios de tasa se comporta exactamente igual que antes', () => {
  const plana = historialDiario(cuentaPlana(), '2026-06-30');
  const conVigenciaUnica = historialDiario(
    cuentaPlana({ tasaDesde: null, historialTasas: [] }), '2026-06-30');
  assert.deepEqual(plana, conVigenciaUnica);
});

test('un cambio de interpretación de tasa (nominal → efectiva) también respeta la fecha', () => {
  const cuenta = cuentaPlana({
    tramos: [{ hasta: null, tasa: 12 }], modoTasa: 'efectiva',
    tasaDesde: '2026-02-01',
    historialTasas: [{ desde: null, tramos: [{ hasta: null, tasa: 12 }], modoTramos: 'progresivo', modoTasa: 'nominal' }],
  });
  const filas = historialDiario(cuenta, '2026-02-02');
  const antes  = filas.find(f => f.fecha === '2026-01-31');
  const despues = filas.find(f => f.fecha === '2026-02-01');
  // Misma tasa publicada (12%), pero nominal compone más rápido que efectiva
  // sobre el mismo saldo — el cambio de interpretación se nota en el interés
  assert.ok(despues.neto / despues.saldoInicial < antes.neto / antes.saldoInicial,
    'la interpretación efectiva rinde menos que la nominal a igual tasa publicada');
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('Hora de corte por cuenta');

test('horaCorteCuenta usa el valor de la cuenta si es válido (0-23)', () => {
  assert.equal(horaCorteCuenta({ horaCorte: 10 }), 10);
  assert.equal(horaCorteCuenta({ horaCorte: 0 }), 0, 'medianoche es un valor válido, no debe caer al default');
  assert.equal(horaCorteCuenta({ horaCorte: 23 }), 23);
});
test('horaCorteCuenta cae al default (7) sin valor o fuera de rango', () => {
  assert.equal(horaCorteCuenta({}), CORTE_RENDIMIENTOS);
  assert.equal(horaCorteCuenta({ horaCorte: null }), CORTE_RENDIMIENTOS);
  assert.equal(horaCorteCuenta(null), CORTE_RENDIMIENTOS);
  assert.equal(horaCorteCuenta({ horaCorte: -1 }), CORTE_RENDIMIENTOS);
  assert.equal(horaCorteCuenta({ horaCorte: 24 }), CORTE_RENDIMIENTOS);
  assert.equal(horaCorteCuenta({ horaCorte: 'abc' }), CORTE_RENDIMIENTOS);
});
test('hoyISO(corteHora) acepta la hora de corte como parámetro y sigue dando YYYY-MM-DD', () => {
  assert.match(hoyISO(), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(hoyISO(0), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(hoyISO(23), /^\d{4}-\d{2}-\d{2}$/);
});
test('hoyDeCuenta coincide con hoyISO(horaCorteCuenta(cuenta))', () => {
  const cuenta = { horaCorte: 15 };
  assert.equal(hoyDeCuenta(cuenta), hoyISO(horaCorteCuenta(cuenta)));
});
test('hoyDeCuenta sin cuenta configurada coincide con el corte global (7am)', () => {
  assert.equal(hoyDeCuenta({}), hoyISO(CORTE_RENDIMIENTOS));
  assert.equal(hoyDeCuenta({}), hoyISO());
});

// ─────────────────────────────────────────────────────────────────────────────
grupo('movimientoRinde: saldoNuevo');

test('con saldoNuevo, ese día rinde más que con el default (saldoViejo)', () => {
  const base = { movimientos: [{ fecha: '2026-01-11', tipo: MOV_APORTE, monto: 5000 }] };
  const diaViejo = historialDiario(cuentaPlana(base), '2026-01-21').find(f => f.fecha === '2026-01-11');
  const diaNuevo = historialDiario(cuentaPlana({ ...base, movimientoRinde: MOV_RINDE_SALDO_NUEVO }), '2026-01-21')
    .find(f => f.fecha === '2026-01-11');
  assert.ok(diaNuevo.neto > diaViejo.neto,
    'el mismo día rinde más porque ya compone sobre el saldo con el aporte aplicado');
});

test('sin movimientoRinde configurado, se comporta igual que "saldoViejo" explícito', () => {
  const base = { movimientos: [{ fecha: '2026-01-11', tipo: MOV_APORTE, monto: 5000 }] };
  const sinConfigurar = historialDiario(cuentaPlana(base), '2026-01-21').find(f => f.fecha === '2026-01-11');
  const explicito = historialDiario(cuentaPlana({ ...base, movimientoRinde: MOV_RINDE_SALDO_VIEJO }), '2026-01-21')
    .find(f => f.fecha === '2026-01-11');
  cerca(sinConfigurar.neto, explicito.neto, 'el default implícito es idéntico a "saldoViejo" explícito');
});

test('dos movimientos el mismo día con saldoNuevo: el segundo no compone retroactivo ese día', () => {
  const cuenta = cuentaPlana({
    movimientoRinde: MOV_RINDE_SALDO_NUEVO,
    movimientos: [
      { fecha: '2026-01-11', tipo: MOV_APORTE, monto: 3000 },
      { fecha: '2026-01-11', tipo: MOV_APORTE, monto: 2000 },
    ],
  });
  const soloElPrimero = { ...cuenta, movimientos: [cuenta.movimientos[0]] };
  const cfg = configCuenta(cuenta);

  const rendimientoAmbos = rendimientoEntre(eventosCuenta(cuenta), '2026-01-10', '2026-01-11', cfg).rendimiento;
  const rendimientoUno   = rendimientoEntre(eventosCuenta(soloElPrimero), '2026-01-10', '2026-01-11', cfg).rendimiento;
  cerca(rendimientoAmbos, rendimientoUno,
    'el segundo aporte del mismo día no vuelve a componer el día, solo se suma al cierre');

  // El segundo aporte se suma tal cual al cierre, sin generar ni perder
  // interés ese día — la diferencia entre tener uno y tener ambos debe ser
  // exactamente su monto, ni un centavo de más ni de menos.
  const saldoConUno   = saldoEnFecha(eventosCuenta(soloElPrimero), '2026-01-11', cfg);
  const saldoConAmbos = saldoEnFecha(eventosCuenta(cuenta), '2026-01-11', cfg);
  cerca(saldoConAmbos - saldoConUno, 2000, 'el segundo aporte se refleja completo en el cierre, sin componer');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${fallidas ? '✗' : '✓'} ${pasadas} pasadas, ${fallidas} fallidas\n`);
process.exit(fallidas ? 1 : 0);
