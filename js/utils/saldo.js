/**
 * Calcula el saldo disponible y usado de una tarjeta de crédito o préstamo,
 * descontando compras y gastos registrados después de la última actualización.
 *
 * Para compras diferidas:
 *  - El campo `total` del registro padre = monto pendiente (resta por fechaCompra original).
 *  - Cada pagoDiferido resta por su propia `fecha`.
 *
 * @param {object} tarjeta         - { id, tipo, saldoDisponible, fechaActualizacionSaldo, limiteTotal }
 * @param {Array}  contado         - Items colección contado
 * @param {Array}  msi             - Items colección msi
 * @param {Array}  gastos          - Items colección gastos
 * @param {Array}  pagosDiferidos  - Items colección pagosDiferidos
 * @param {Array}  creditosTarjeta - Items colección creditosTarjeta (saldo a favor)
 * @returns {{ disponible: number, usado: number|null, ajustado: boolean, gastoPosterior: number } | null}
 */
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Una fecha "YYYY-MM-DD" (sin hora, típica de un <input type="date">) se
// interpreta nativamente como medianoche UTC — casi siempre ANTES que
// `fechaActualizacionSaldo` (que sí lleva hora real), aunque sea el mismo
// día. Se ancla al final del día para que un evento fechado "hoy" cuente
// como posterior a una actualización hecha más temprano ese mismo día.
const _fechaComparable = s => {
  if (!s) return null;
  return new Date(String(s).length === 10 ? s + 'T23:59:59' : s);
};

export function calcularSaldo(tarjeta, contado = [], msi = [], gastos = [], pagosDiferidos = [], creditosTarjeta = []) {
  if (tarjeta.saldoDisponible == null || tarjeta.tipo === 'debito') return null;

  const fechaRef = tarjeta.fechaActualizacionSaldo || null;
  const limite   = tarjeta.limiteTotal != null ? Number(tarjeta.limiteTotal) : null;
  const baseDisp = Number(tarjeta.saldoDisponible);

  let gastoPosterior = 0;

  const refDate   = fechaRef ? new Date(fechaRef) : null;
  const posterior = (fecha) => !!fecha && (refDate ? _fechaComparable(fecha) > refDate : true);

  contado.forEach(c => {
    if (c.tarjetaId === tarjeta.id && posterior(c.fechaCompra))
      gastoPosterior += Number(c.total) || 0;
  });

  msi.forEach(m => {
    if (m.diferido) return; // límites solo afectados por pagosDiferidos registrados
    if (m.tarjetaId === tarjeta.id && posterior(m.fechaCompra))
      gastoPosterior += Number(m.total) || 0;
  });

  gastos.forEach(g => {
    if (g.tarjetaId === tarjeta.id && g.estado === 'registrado' && posterior(g.fechaPago))
      gastoPosterior += Number(g.importe) || 0;
  });

  // Pagos diferidos restan por su propia fecha (independiente del registro padre)
  pagosDiferidos.forEach(p => {
    if (p.tarjetaId === tarjeta.id && posterior(p.fecha))
      gastoPosterior += Number(p.monto) || 0;
  });

  // Créditos a favor (bonificación, cancelación, conversión) suman disponible por su propia fecha
  creditosTarjeta.forEach(c => {
    if (c.tarjetaId === tarjeta.id && posterior(c.fecha))
      gastoPosterior -= Number(c.monto) || 0;
  });

  const disponible = r2(Math.max(0, baseDisp - gastoPosterior));
  const usado      = limite != null ? r2(Math.max(0, limite - disponible)) : null;

  return { disponible, usado, ajustado: gastoPosterior > 0, gastoPosterior };
}

/**
 * Limita un disponible propuesto al límite total de la tarjeta. El excedente
 * (si lo hay) no se guarda en `saldoDisponible` — el llamador debe registrarlo
 * aparte como saldo a favor (colección `creditosTarjeta`).
 *
 * @param {number} disponiblePropuesto
 * @param {number|null|undefined} limiteTotal
 * @returns {{ disponible: number, excedente: number }}
 */
export function limitarDisponible(disponiblePropuesto, limiteTotal) {
  const lim  = Number(limiteTotal) || 0;
  const disp = Number(disponiblePropuesto) || 0;
  if (!lim || disp <= lim) return { disponible: r2(disp), excedente: 0 };
  return { disponible: r2(lim), excedente: r2(disp - lim) };
}
