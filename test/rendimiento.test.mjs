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
  EVENTO_ANCLA, EVENTO_MOVIMIENTO, EVENTO_AJUSTE, MOV_APORTE, MOV_RETIRO,
  TASA_EFECTIVA, MODO_UNICO,
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

  // 16 días con el saldo viejo (1→16 Ene, el propio 16 incluido: ese día rinde
  // sobre lo que había, no sobre el aporte que llega), y 14 días más con el
  // saldo nuevo (17→31 Ene) — 16+14 = 30, los días del rango completos.
  const tramo1 = componer(10000, 16, cfg);
  const tramo2 = componer(tramo1.saldoFinal + 5000, 14, cfg);
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
  // 16, no 15: el aporte (una vez registrado) rinde su propio día de llegada
  // sobre el saldo viejo, así que la captura "real" del 31 debe reflejar ese
  // mismo criterio para que el residuo dé exactamente cero al reclasificarlo.
  const t1 = componer(10000, 16, cfg);
  const t2 = componer(t1.saldoFinal + 5000, 14, cfg);
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

test('una transferencia entre cuentas de igual tasa cuesta el día del traspaso, no más', () => {
  const [a, b] = parCuentas();
  const cfg = configCuenta(a);
  const { origen, destino } = movimientosTransferencia(specBase);
  const sin = 2 * rendimientoEntre(eventosCuenta(a), '2026-01-01', '2026-01-31', cfg).rendimiento;
  const con = rendimientoEntre(eventosCuenta({ ...a, movimientos: [origen] }),  '2026-01-01', '2026-01-31', cfg).rendimiento
            + rendimientoEntre(eventosCuenta({ ...b, movimientos: [destino] }), '2026-01-01', '2026-01-31', cfg).rendimiento;
  // Ya no es perfectamente neutro: el día del traspaso no genera nada en ninguna
  // de las dos cuentas (mismo criterio que "el dinero en tránsito no genera
  // interés" de abajo) — se pierde un poco, pero solo eso, no más.
  assert.ok(con < sin, 'el día del traspaso no genera nada en ninguna de las dos');
  assert.ok(sin - con < sin * 0.1, 'la pérdida es acotada al día del traspaso, no desproporcionada');
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
  cerca(filas[filas.length - 1].saldoFinal,
        saldoEnFecha(eventosCuenta(cuenta), sumarDias('2026-01-21', 1), cfg),
        'último saldo de la tabla vs. saldoEnFecha', 0.02);
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
  cerca(filas[filas.length - 1].saldoFinal, componer(10000, 31, cfg).saldoFinal, 'saldo final');
  assert.equal(filas[0].movimiento, 0);
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
console.log(`\n${fallidas ? '✗' : '✓'} ${pasadas} pasadas, ${fallidas} fallidas\n`);
process.exit(fallidas ? 1 : 0);
