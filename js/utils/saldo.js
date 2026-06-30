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
 * @returns {{ disponible: number, usado: number|null, ajustado: boolean, gastoPosterior: number } | null}
 */
export function calcularSaldo(tarjeta, contado = [], msi = [], gastos = [], pagosDiferidos = []) {
  if (tarjeta.saldoDisponible == null || tarjeta.tipo === 'debito') return null;

  const fechaRef = tarjeta.fechaActualizacionSaldo || null;
  const limite   = tarjeta.limiteTotal != null ? Number(tarjeta.limiteTotal) : null;
  const baseDisp = Number(tarjeta.saldoDisponible);

  let gastoPosterior = 0;

  const refDate   = fechaRef ? new Date(fechaRef) : null;
  const posterior = (fecha) => !!fecha && (refDate ? new Date(fecha) > refDate : true);

  contado.forEach(c => {
    if (c.tarjetaId === tarjeta.id && posterior(c.fechaCompra))
      gastoPosterior += Number(c.total) || 0;
  });

  msi.forEach(m => {
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

  const disponible = Math.max(0, baseDisp - gastoPosterior);
  const usado      = limite != null ? Math.max(0, limite - disponible) : null;

  return { disponible, usado, ajustado: gastoPosterior > 0, gastoPosterior };
}
