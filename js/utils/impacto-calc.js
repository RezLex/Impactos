import { calcularMes, toISODate, anteriorNomina } from './ciclo.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ── Private helpers ─────────────────────────────────────────────────────────

function _fechaPagoFromDate(fechaISO, ciclo, festivosMX) {
  if (!ciclo || !fechaISO) return null;
  const d = _d(fechaISO);
  let year = d.getFullYear(), month = d.getMonth();
  let p = calcularMes(ciclo, year, month, festivosMX);
  if (p.fechaCorte < d) {
    const nx = new Date(year, month + 1, 1);
    p = calcularMes(ciclo, nx.getFullYear(), nx.getMonth(), festivosMX);
  }
  return p.fechaPago || null;
}

function _enMes(fechaPago, mes, festivosMX) {
  if (!fechaPago) return false;
  const nom = anteriorNomina(fechaPago, festivosMX);
  return !!nom && toISODate(nom).slice(0, 7) === mes;
}

function _primerCiclo(ciclo, fechaCompra, festivosMX) {
  if (!ciclo || !fechaCompra) return null;
  const d = _d(fechaCompra);
  let year = d.getFullYear(), month = d.getMonth();
  const p = calcularMes(ciclo, year, month, festivosMX);
  if (p.fechaCorte < d) {
    const nx = new Date(year, month + 1, 1);
    return { cicloYear: nx.getFullYear(), cicloMonth: nx.getMonth() };
  }
  return { cicloYear: year, cicloMonth: month };
}

function _mesInt(mes) {
  const [y, m] = mes.split('-').map(Number);
  return y * 12 + m;
}

const _d = s => s ? new Date(String(s).includes('T') ? s : s + 'T12:00:00') : null;

function _sigHabil(date, festivosMX) {
  const festSet = new Set(festivosMX.map(f => f.fecha));
  const d = new Date(date);
  while (d.getDay() === 0 || d.getDay() === 6 || festSet.has(toISODate(d))) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function _calcularFechaGastoMes(gasto, year, month, festivosMX) {
  if (gasto.semanaDelMes && gasto.diaSemana) {
    const jsDay = gasto.diaSemana === 7 ? 0 : gasto.diaSemana;
    if (gasto.semanaDelMes === -1) {
      const d = new Date(year, month + 1, 0);
      while (d.getDay() !== jsDay) d.setDate(d.getDate() - 1);
      return _sigHabil(d, festivosMX);
    }
    let count = 0;
    const d = new Date(year, month, 1);
    while (d.getMonth() === month) {
      if (d.getDay() === jsDay) { count++; if (count === gasto.semanaDelMes) return _sigHabil(new Date(d), festivosMX); }
      d.setDate(d.getDate() + 1);
    }
    return null;
  }
  if (gasto.diasIntervalo && gasto.fechaInicio) {
    const inicio = new Date(gasto.fechaInicio + 'T12:00:00');
    const monthStart = new Date(year, month, 1);
    const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59);
    const n = Math.ceil(Math.ceil((monthStart - inicio) / 86400000) / gasto.diasIntervalo);
    for (let i = Math.max(0, n - 1); i <= n + 2; i++) {
      const d = new Date(inicio); d.setDate(d.getDate() + i * gasto.diasIntervalo);
      if (d >= monthStart && d <= monthEnd) return _sigHabil(d, festivosMX);
    }
    return null;
  }
  if (gasto.diaCobro) {
    const day = parseInt(gasto.diaCobro, 10);
    if (!isNaN(day) && day >= 1 && day <= 31) {
      return new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()));
    }
  }
  return null;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Finds the billing period whose anteriorNomina(fechaPago) falls in mes.
 * Checks current month and the previous one (some cards pay early next month).
 * Returns { fechaCorte: Date, fechaPago: Date } or null if not found.
 */
export function calcularCicloParaMes(ciclo, mes, festivosMX) {
  if (!ciclo) return null;
  const [y, mo] = mes.split('-').map(Number);
  // Check next month (+1), current (0) and previous (-1) — payment on day 1 maps to next month's ciclo
  for (let delta = -1; delta <= 1; delta++) {
    const d = new Date(y, mo - 1 - delta, 1);
    const p = calcularMes(ciclo, d.getFullYear(), d.getMonth(), festivosMX);
    if (!p.fechaPago) continue;
    const nom = anteriorNomina(p.fechaPago, festivosMX);
    if (nom && toISODate(nom).slice(0, 7) === mes) return p;
  }
  return null;
}

/** Finds the ciclo payment date for a billing period containing fechaISO. */
export function calcularFechaPagoFromDate(fechaISO, ciclo, festivosMX) {
  return _fechaPagoFromDate(fechaISO, ciclo, festivosMX);
}

/** De Contado items for a tarjeta whose anteriorNomina(fechaPago) falls in mes.
 *  Diferido items are excluded once total < 0.005 (fully registered via pagos). */
export function getContadoMes(contadoItems, tarjetaId, ciclo, mes, festivosMX) {
  return contadoItems.filter(c => {
    if (c.tarjetaId !== tarjetaId) return false;
    if (c.diferido && (Number(c.total) || 0) < 0.005) return false;
    return _enMes(_fechaPagoFromDate(c.fechaCompra, ciclo, festivosMX), mes, festivosMX);
  });
}

/** Pagos diferidos (contado or msi) for a tarjeta whose próximo pago anteriorNomina falls in mes. */
export function getPagosDiferidosMes(pagosDiferidos, tarjetaId, ciclo, mes, festivosMX, diferidoMap) {
  if (!ciclo) return [];
  return pagosDiferidos.filter(p => {
    if (p.tarjetaId !== tarjetaId) return false;
    const compra = diferidoMap[p.compraId];
    if (!compra) return false;
    const mesesPag = Number(p.mesesPagados) || 0;
    // mesesTotal || 1: contado diferido pagos are single-occurrence; they retire after cerrarMes.
    if (mesesPag >= (Number(compra.mesesTotal) || 1)) return false;
    const pc = _primerCiclo(ciclo, p.fecha, festivosMX);
    if (!pc) return false;
    const nx = new Date(pc.cicloYear, pc.cicloMonth + mesesPag, 1);
    const pp = calcularMes(ciclo, nx.getFullYear(), nx.getMonth(), festivosMX);
    return _enMes(pp.fechaPago, mes, festivosMX);
  });
}

/** A Plazos items for a tarjeta whose próximo pago anteriorNomina falls in mes. */
export function getPlazosMes(msiItems, tarjetaId, ciclo, mes, festivosMX) {
  if (!ciclo) return [];
  return msiItems.filter(m => {
    if (m.tarjetaId !== tarjetaId || m.liquidado) return false;
    if (m.diferido && (Number(m.total) || 0) < 0.005) return false; // ya todo registrado en pagos
    if (Number(m.mesesPagados) >= Number(m.mesesTotal)) return false;
    const pc = _primerCiclo(ciclo, m.fechaCompra, festivosMX);
    if (!pc) return false;
    const nx = new Date(pc.cicloYear, pc.cicloMonth + (Number(m.mesesPagados) || 0), 1);
    const p  = calcularMes(ciclo, nx.getFullYear(), nx.getMonth(), festivosMX);
    return _enMes(p.fechaPago, mes, festivosMX);
  });
}

/** Confirmed credit gastos for a tarjeta whose anteriorNomina(fechaPago ciclo) falls in mes. */
export function getGastosCreditoMes(gastosItems, tarjetaId, ciclo, mes, festivosMX) {
  return gastosItems.filter(g => {
    if (g.tarjetaId !== tarjetaId || g.estado !== 'registrado') return false;
    return _enMes(_fechaPagoFromDate(g.fechaPago, ciclo, festivosMX), mes, festivosMX);
  });
}

/** Registered debit gastos for mes (filtered by fechaPago directly). */
export function getGastosDebitoMes(gastosItems, mes, debitoIds = null) {
  return gastosItems.filter(g => {
    if (g.estado !== 'registrado') return false;
    if ((g.fechaPago || '').slice(0, 7) !== mes) return false;
    if (debitoIds && !debitoIds.has(g.tarjetaId)) return false;
    return true;
  });
}

/**
 * Returns all debit items for a month:
 * - Gastos fijos with debit card (sin_registro | pendiente | registrado), excluding descartado
 * - Manual debit gastos (registrado, no gastaFijoId)
 */
export function getGastosDebitoCompleto(gastosItems, gastosFijosItems, mes, debitoIds, tarjetas, festivosMX) {
  const [y, mo] = mes.split('-').map(Number);
  const month = mo - 1; // 0-indexed

  // Map gastaFijoId → gastos record for this month
  const fichaMap = new Map(
    gastosItems
      .filter(g => g.gastaFijoId && g.mes === mes && g.estado !== 'descartado')
      .map(g => [g.gastaFijoId, g])
  );

  const result = [];

  // 1. Gastos fijos con tarjeta débito para este mes
  gastosFijosItems.forEach(gasto => {
    const card = tarjetas.find(t => t.id === gasto.tarjetaId);
    if (!card || card.tipo !== 'debito') return;
    const fecha = _calcularFechaGastoMes(gasto, y, month, festivosMX);
    if (!fecha) return;
    const fechaISO = toISODate(fecha);
    if (!fechaISO.startsWith(mes)) return;

    // Check if descartado
    const existing = gastosItems.find(g => g.gastaFijoId === gasto.id && g.mes === mes);
    if (existing?.estado === 'descartado') return;

    const estado = existing?.estado || 'sin_registro';
    result.push({
      gastaFijoId: gasto.id,
      nombre:    gasto.nombre,
      tarjetaId: gasto.tarjetaId,
      formaPago: gasto.formaPago,
      fechaPago: estado === 'registrado' ? existing.fechaPago : fechaISO,
      importe:   estado === 'registrado' ? (Number(existing.importe) || 0) : (Number(gasto.importe) || 0),
      estado,
    });
  });

  // 2. Manuales registrados (sin gastaFijoId)
  gastosItems
    .filter(g =>
      g.estado === 'registrado' &&
      (g.fechaPago || '').slice(0, 7) === mes &&
      debitoIds.has(g.tarjetaId) &&
      !g.gastaFijoId
    )
    .forEach(g => result.push({ ...g, estado: 'registrado' }));

  return result.sort((a, b) => (a.fechaPago || '').localeCompare(b.fechaPago || ''));
}

/** Calculates estimated amounts for one credit/loan card in a given month. */
export function calcularEstimadoTarjeta(tarjeta, contadoItems, msiItems, gastosItems, festivosMX, mes, pagosDiferidos = []) {
  const ciclo = tarjeta.ciclo || null;
  const tid   = tarjeta.id;

  // Unified map covers both MSI and contado diferido parents.
  const diferidoMap = {};
  msiItems.forEach(m => { if (m.diferido) diferidoMap[m.id] = m; });
  contadoItems.forEach(c => { if (c.diferido) diferidoMap[c.id] = c; });

  const pagosDifMes = getPagosDiferidosMes(pagosDiferidos, tid, ciclo, mes, festivosMX, diferidoMap);

  // Pre-compute total registered monto per compraId across ALL pagos (guards against stale c.total).
  const pagosMontoMap = {};
  pagosDiferidos.forEach(p => {
    pagosMontoMap[p.compraId] = (pagosMontoMap[p.compraId] || 0) + (Number(p.monto) || 0);
  });

  // estimadoContado: non-diferido at full total; diferido at trueRemaining (totalDiferido − pagos).
  // pendienteContado: the diferido portion only — used in the tooltip.
  let estimadoContado  = 0;
  let pendienteContado = 0;
  getContadoMes(contadoItems, tid, ciclo, mes, festivosMX).forEach(c => {
    if (!c.diferido) { estimadoContado += Number(c.total) || 0; return; }
    const totalOrig     = Number(c.totalDiferido || c.total) || 0;
    const trueRemaining = Math.max(0, totalOrig - (pagosMontoMap[c.id] || 0));
    estimadoContado  += trueRemaining;
    pendienteContado += trueRemaining;
  });

  // estimadoPlazos: non-diferido at mensualidad; diferido at total/mesesTotal (m.total decrements with pagos).
  // pendientePlazos: the diferido monthly portion only — used in the tooltip.
  let estimadoPlazos  = 0;
  let pendientePlazos = 0;
  getPlazosMes(msiItems, tid, ciclo, mes, festivosMX).forEach(m => {
    if (!m.diferido) { estimadoPlazos += Number(m.mensualidad) || 0; return; }
    const portion = r2(Number(m.total) / Math.max(1, Number(m.mesesTotal)));
    estimadoPlazos  += portion;
    pendientePlazos += portion;
  });

  const estimadoGastos = getGastosCreditoMes(gastosItems, tid, ciclo, mes, festivosMX)
    .reduce((s, g) => s + (Number(g.importe) || 0), 0);

  let pagosDifContado = 0;
  let pagosDifPlazos  = 0;
  pagosDifMes.forEach(p => {
    const compra = diferidoMap[p.compraId];
    // Contado: single payment, always use p.monto (mesesTotal absent → NaN → falsy).
    // MSI: mensualidad chain → compra.mensualidad → p.monto fallback.
    const men = Number(compra?.mesesTotal)
      ? (p.mensualidad != null ? Number(p.mensualidad)
        : compra?.mensualidad != null ? Number(compra.mensualidad)
        : Number(p.monto))
      : Number(p.monto);
    if (Number(compra?.mesesTotal)) pagosDifPlazos  += men || 0;
    else                             pagosDifContado += men || 0;
  });

  return {
    estimadoContado, estimadoPlazos, estimadoGastos,
    pendienteContado, pendientePlazos,
    pagosDifContado, pagosDifPlazos,
    estimadoTotal: r2(estimadoContado + estimadoPlazos + estimadoGastos + pagosDifContado + pagosDifPlazos),
  };
}

/** Calculates credit summary totals from an impacto's tarjetas[] array. */
export function calcularTotalesCredito(tarjetasImpacto) {
  let creditoTotal = 0, creditoDisponible = 0;
  tarjetasImpacto.forEach(t => {
    creditoTotal      += Number(t.limiteTotalConf  ?? t.limiteTotal     ?? 0);
    creditoDisponible += Number(t.saldoDispConf    ?? t.saldoDisponible ?? 0);
  });
  return {
    creditoTotal,
    creditoDisponible,
    deudaTotal: r2(Math.max(0, creditoTotal - creditoDisponible)),
  };
}

/**
 * Calculates live totals for an active impacto given current gastos débito.
 * Does NOT mutate the impacto object.
 */
export function recalcTotalesImpacto(impacto, gastosDebitoLive, nominaOverride = null, saldoVivoMap = null, limiteVivoMap = null) {
  const pagoCredito     = impacto.tarjetas.reduce((s, t) => s + (t.pagado ? (Number(t.montoAPagar) || 0) : 0), 0);
  const gastoDebito     = gastosDebitoLive.reduce((s, g) => s + (Number(g.importe) || 0), 0);
  const estimadoCredito = impacto.tarjetas.reduce((s, t) =>
    s + (t.montoAPagar != null ? Number(t.montoAPagar) : (Number(t.estimadoTotal) || 0)), 0);
  const nomRef          = nominaOverride ?? Number(impacto.nominaRef) ?? 0;

  let creditoTotal = 0, creditoDisponible = 0;
  impacto.tarjetas.forEach(t => {
    if (limiteVivoMap && limiteVivoMap[t.tarjetaId] != null) {
      creditoTotal += limiteVivoMap[t.tarjetaId];
    } else {
      creditoTotal += Number(t.limiteTotalConf ?? t.limiteTotal ?? 0);
    }
    if (saldoVivoMap && saldoVivoMap[t.tarjetaId] != null) {
      creditoDisponible += saldoVivoMap[t.tarjetaId];
    } else if (t.saldoDispConf != null) {
      creditoDisponible += Number(t.saldoDispConf);
    } else {
      creditoDisponible += Number(t.saldoDisponible ?? 0);
    }
  });

  return {
    estimadoCredito, pagoCredito, gastoDebito,
    restanteEsperado: r2(nomRef - estimadoCredito - gastoDebito),
    restante:         r2((Number(impacto.presupuesto) || 0) - pagoCredito - gastoDebito),
    creditoTotal,
    creditoDisponible,
    deudaTotal: r2(Math.max(0, creditoTotal - creditoDisponible)),
  };
}

/**
 * Projects estimated impacto data for a future month.
 * Simulates progressive monthly payment of A Plazos.
 */
export function proyectarMes(mes, currentMes, msiItems, contadoItems, gastosItems, tarjetasCredito, nominaAprox, festivosMX, gastosFijosItems = [], todasTarjetas = [], pagosDiferidos = []) {
  const targetInt = _mesInt(mes);

  // Simulate msiItems with projected mesesPagados
  const msiProjected = msiItems.map(m => {
    const tarjeta = tarjetasCredito.find(t => t.id === m.tarjetaId);
    const ciclo   = tarjeta?.ciclo;
    if (!ciclo || m.liquidado) return m;
    const mesesPag = Number(m.mesesPagados) || 0;
    const mesesTot = Number(m.mesesTotal)   || 0;
    if (mesesPag >= mesesTot) return m;
    const pc = _primerCiclo(ciclo, m.fechaCompra, festivosMX);
    if (!pc) return m;
    const nx  = new Date(pc.cicloYear, pc.cicloMonth + mesesPag, 1);
    const pp  = calcularMes(ciclo, nx.getFullYear(), nx.getMonth(), festivosMX);
    if (!pp.fechaPago) return m;
    const nom = anteriorNomina(pp.fechaPago, festivosMX);
    if (!nom) return m;
    const proximoInt = _mesInt(toISODate(nom).slice(0, 7));
    if (targetInt <= proximoInt) return m;
    return { ...m, mesesPagados: Math.min(mesesPag + (targetInt - proximoInt), mesesTot) };
  });

  const [py, pmo] = mes.split('-').map(Number);
  const debitoIds = new Set(todasTarjetas.filter(t => t.tipo === 'debito').map(t => t.id));

  const tarjetas = tarjetasCredito.map(t => {
    const est = calcularEstimadoTarjeta(t, contadoItems, msiProjected, gastosItems, festivosMX, mes, pagosDiferidos);

    // Gastos fijos de crédito: incluir si el card tiene pago en este mes (vía nómina anterior)
    // y el gasto fijo ocurre en el mes calendario objetivo
    let estimadoGastosFijos = 0;
    if (gastosFijosItems.length && t.ciclo) {
      const periodo = calcularCicloParaMes(t.ciclo, mes, festivosMX);
      if (periodo?.fechaPago) {
        // El ciclo de pago de este mes cubre cargos hasta la fecha de corte.
        // Un gasto confirmado en el mes del corte (mesCorte) o en el mes proyectado
        // ya está capturado por getGastosCreditoMes — no duplicar en estimadoGastosFijos.
        const mesCorte = periodo.fechaCorte ? toISODate(periodo.fechaCorte).slice(0, 7) : mes;
        gastosFijosItems.forEach(gf => {
          if (gf.tarjetaId !== t.id) return;
          const yaRegistrado = gastosItems.some(g =>
            g.gastaFijoId === gf.id &&
            g.estado === 'registrado' &&
            (g.mes === mes || g.mes === mesCorte)
          );
          if (yaRegistrado) return;
          const fecha = _calcularFechaGastoMes(gf, py, pmo - 1, festivosMX);
          if (fecha && toISODate(fecha).startsWith(mes))
            estimadoGastosFijos += Number(gf.importe) || 0;
        });
      }
    }
    let fechaCorte = null, fechaPago = null;
    if (t.ciclo) {
      const p = calcularCicloParaMes(t.ciclo, mes, festivosMX);
      fechaCorte = p?.fechaCorte ? toISODate(p.fechaCorte) : null;
      fechaPago  = p?.fechaPago  ? toISODate(p.fechaPago)  : null;
    }
    const estimadoGastos = r2(est.estimadoGastos + estimadoGastosFijos);
    return {
      tarjetaId: t.id, nombre: t.nombre, institucion: '', color: '#607d8b',
      limiteTotal: Number(t.limiteTotal) || 0, saldoDisponible: t.saldoDisponible ?? null,
      fechaCorte, fechaPago,
      ...est,
      estimadoGastos,
      estimadoTotal: r2(est.estimadoContado + est.estimadoPlazos + estimadoGastos + (est.pagosDifContado || 0) + (est.pagosDifPlazos || 0)),
      confirmado: false, pagado: false,
    };
  });

  const gastosDeb   = gastosFijosItems.length
    ? getGastosDebitoCompleto(gastosItems, gastosFijosItems, mes, debitoIds, todasTarjetas, festivosMX)
    : getGastosDebitoMes(gastosItems, mes);
  const gastoDebito = r2(gastosDeb.reduce((s, g) => s + (Number(g.importe) || 0), 0));
  const estCredito  = r2(tarjetas.reduce((s, t) => s + t.estimadoTotal, 0));

  return {
    mes, estado: 'proyeccion', presupuesto: nominaAprox, nominaRef: nominaAprox,
    tarjetas, gastosDebito: gastosDeb,
    totales: {
      estimadoCredito: estCredito, pagoCredito: 0, gastoDebito,
      restanteEsperado: r2(nominaAprox - estCredito - gastoDebito),
      restante:         r2(nominaAprox - estCredito - gastoDebito),
      ...calcularTotalesCredito(tarjetas),
    },
  };
}
