/**
 * Billing cycle calculation for credit cards.
 * Computes cut-off (corte) and payment (pago) dates for a given period,
 * applying business-day adjustment using weekends + registered holidays.
 */

/**
 * Returns corte/pago dates for the current open billing period.
 * If today is on or after this month's corte, advances to next month.
 */
export function periodoActual(ciclo, festivosMX = []) {
  if (!ciclo?.diaCorte && !(ciclo?.diasAlCorte && ciclo?.diaPago)) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  let p = calcularMes(ciclo, hoy.getFullYear(), hoy.getMonth(), festivosMX);
  if (p.fechaCorte <= hoy) {
    const next = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
    p = calcularMes(ciclo, next.getFullYear(), next.getMonth(), festivosMX);
  }
  return p;
}

/**
 * Returns { fechaCorte: Date, fechaPago: Date|null } for the given year/month.
 * @param {object} ciclo  - { diaCorte, diaPago?, diasAlPago?, ajusteCorte, ajustePago }
 * @param {number} year
 * @param {number} month  - 0-indexed (Jan = 0)
 * @param {Array}  festivosMX - array of { fecha: 'YYYY-MM-DD' } or plain 'YYYY-MM-DD' strings
 */
export function calcularMes(ciclo, year, month, festivosMX = []) {
  const festivos = _normalizarFestivos(festivosMX);

  // Mode C: payment day is the anchor; cut-off is N days before payment
  if (ciclo.diasAlCorte) {
    const pagoOriginal = _clampDay(year, month, Number(ciclo.diaPago));
    let fechaPago = new Date(pagoOriginal);
    fechaPago = _ajustar(fechaPago, ciclo.ajustePago || 'siguiente', festivos);
    const baseC = ciclo.baseCalculo === 'original' ? pagoOriginal : fechaPago;
    let fechaCorte = new Date(baseC);
    fechaCorte.setDate(fechaCorte.getDate() - Number(ciclo.diasAlCorte));
    fechaCorte = _ajustar(fechaCorte, ciclo.ajusteCorte || 'siguiente', festivos);
    return { fechaCorte, fechaPago };
  }

  // Mode A/B: cut-off day is the anchor
  let fechaCorte = _clampDay(year, month, Number(ciclo.diaCorte));
  fechaCorte = _ajustar(fechaCorte, ciclo.ajusteCorte || 'siguiente', festivos);

  let fechaPago = null;
  if (ciclo.diasAlPago) {
    // Mode B: payment is N days after cut-off
    const baseB = ciclo.baseCalculo === 'original'
      ? _clampDay(year, month, Number(ciclo.diaCorte))
      : fechaCorte;
    fechaPago = new Date(baseB);
    fechaPago.setDate(fechaPago.getDate() + Number(ciclo.diasAlPago));
    fechaPago = _ajustar(fechaPago, ciclo.ajustePago || 'siguiente', festivos);
  } else if (ciclo.diaPago) {
    // Mode A: payment is a fixed day; if payment day ≤ cut-off day it falls next month
    let py = year, pm = month;
    if (Number(ciclo.diaPago) <= Number(ciclo.diaCorte)) {
      const d = new Date(year, month + 1, 1);
      py = d.getFullYear();
      pm = d.getMonth();
    }
    fechaPago = _clampDay(py, pm, Number(ciclo.diaPago));
    fechaPago = _ajustar(fechaPago, ciclo.ajustePago || 'siguiente', festivos);
  }

  return { fechaCorte, fechaPago };
}

/** Converts a Date to 'YYYY-MM-DD' string */
export function toISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Returns the latest payroll deposit date on or before `date`.
 * Payroll days: 15th and 30th each month (last day of February for the 30th entry).
 * Adjusted to the previous business day when the nominal day is non-business.
 */
export function anteriorNomina(date, festivosMX = []) {
  const festivos = _normalizarFestivos(festivosMX);
  const target   = new Date(date); target.setHours(0, 0, 0, 0);

  const nominaAjustada = (year, month, nomDay) => {
    const max = new Date(year, month + 1, 0).getDate();
    let d = new Date(year, month, Math.min(nomDay, max));
    let guard = 0;
    while (_esInhabil(d, festivos) && guard++ < 10) d.setDate(d.getDate() - 1);
    return d;
  };

  const candidates = [];
  for (let delta = 0; delta <= 1; delta++) {
    const ref = new Date(target.getFullYear(), target.getMonth() - delta, 1);
    candidates.push(nominaAjustada(ref.getFullYear(), ref.getMonth(), 15));
    candidates.push(nominaAjustada(ref.getFullYear(), ref.getMonth(), 30));
  }

  return candidates.filter(p => p <= target).sort((a, b) => b - a)[0] || null;
}

// ── Private helpers ────────────────────────────────────────────────────────────

/** Clamps day to the last valid day of the month (e.g. day 31 in Feb → 28/29) */
function _clampDay(year, month, day) {
  const max = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, max));
}

/**
 * Advances/retreats `fecha` until it lands on a business day.
 * @param {'siguiente'|'anterior'|'ninguno'} tipo
 */
function _ajustar(fecha, tipo, festivos) {
  if (tipo === 'ninguno') return fecha;
  const step = tipo === 'anterior' ? -1 : 1;
  const f = new Date(fecha);
  let guard = 0;
  while (_esInhabil(f, festivos) && guard++ < 10) {
    f.setDate(f.getDate() + step);
  }
  return f;
}

function _esInhabil(fecha, festivos) {
  const dow = fecha.getDay(); // 0 = Sun, 6 = Sat
  if (dow === 0 || dow === 6) return true;
  return festivos.includes(toISODate(fecha));
}

function _normalizarFestivos(festivosMX) {
  return festivosMX
    .map(f => (typeof f === 'string' ? f : f.fecha))
    .filter(Boolean);
}
