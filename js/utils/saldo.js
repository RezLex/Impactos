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

/**
 * Detalle de los eventos (compras, gastos, pagos diferidos, saldo a favor)
 * posteriores a `fechaActualizacionSaldo` de la tarjeta — lo mismo que suma
 * `calcularSaldo()` en `gastoPosterior`, pero como lista para mostrarla.
 *
 * @returns {Array<{tipo: 'contado'|'msi'|'gasto'|'pagoDiferido'|'credito',
 *   nombre: string, fecha: string, monto: number, id: string}>} `monto` con
 *   signo: positivo resta del disponible, negativo lo suma (saldo a favor).
 */
export function detalleEventosPosteriores(tarjeta, contado = [], msi = [], gastos = [], pagosDiferidos = [], creditosTarjeta = []) {
  const fechaRef  = tarjeta.fechaActualizacionSaldo || null;
  const refDate   = fechaRef ? new Date(fechaRef) : null;
  const posterior = (fecha) => !!fecha && (refDate ? _fechaComparable(fecha) > refDate : true);

  const eventos = [];

  contado.forEach(c => {
    if (c.tarjetaId !== tarjeta.id || !posterior(c.fechaCompra)) return;
    if (!c.diferido) {
      eventos.push({ tipo: 'contado', nombre: c.compra || 'Compra de contado', fecha: c.fechaCompra, monto: Number(c.total) || 0, id: c.id });
      return;
    }
    // Diferida: `c.total` (el campo guardado) puede arrastrar un residuo de
    // redondeo frente a los pagos realmente registrados — se recalcula en
    // vivo (totalDiferido − pagos), igual que ya hace la UI para pintar el
    // check de "completa", en vez de confiar en el campo guardado.
    const totalOrig  = Number(c.totalDiferido ?? c.total) || 0;
    const registrado = pagosDiferidos
      .filter(p => p.compraId === c.id)
      .reduce((s, p) => s + (Number(p.monto) || 0), 0);
    const pendienteReal = totalOrig - registrado;
    if (pendienteReal >= 0.005) {
      eventos.push({ tipo: 'contado', nombre: c.compra || 'Compra de contado', fecha: c.fechaCompra, monto: pendienteReal, id: c.id });
    }
  });

  msi.forEach(m => {
    if (m.diferido) return; // límites solo afectados por pagosDiferidos registrados
    if (m.tarjetaId === tarjeta.id && posterior(m.fechaCompra))
      eventos.push({ tipo: 'msi', nombre: m.compra || 'Compra a MSI', fecha: m.fechaCompra, monto: Number(m.total) || 0, id: m.id });
  });

  gastos.forEach(g => {
    if (g.tarjetaId === tarjeta.id && g.estado === 'registrado' && posterior(g.fechaPago))
      eventos.push({ tipo: 'gasto', nombre: g.nombre || 'Gasto', fecha: g.fechaPago, monto: Number(g.importe) || 0, id: g.id });
  });

  // Pagos diferidos restan por su propia fecha (independiente del registro padre)
  pagosDiferidos.forEach(p => {
    if (p.tarjetaId === tarjeta.id && posterior(p.fecha)) {
      const compra = contado.find(c => c.id === p.compraId) || msi.find(m => m.id === p.compraId);
      eventos.push({
        tipo: 'pagoDiferido',
        nombre: compra?.compra ? `Pago diferido — ${compra.compra}` : 'Pago diferido',
        fecha: p.fecha, monto: Number(p.monto) || 0, id: p.id,
      });
    }
  });

  // Créditos a favor (bonificación, cancelación, conversión) suman disponible por su propia fecha
  creditosTarjeta.forEach(c => {
    if (c.tarjetaId === tarjeta.id && posterior(c.fecha))
      eventos.push({ tipo: 'credito', nombre: c.nota || 'Saldo a favor', fecha: c.fecha, monto: -(Number(c.monto) || 0), id: c.id });
  });

  return eventos.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

export function calcularSaldo(tarjeta, contado = [], msi = [], gastos = [], pagosDiferidos = [], creditosTarjeta = []) {
  if (tarjeta.saldoDisponible == null || tarjeta.tipo === 'debito') return null;

  const limite   = tarjeta.limiteTotal != null ? Number(tarjeta.limiteTotal) : null;
  const baseDisp = Number(tarjeta.saldoDisponible);

  const gastoPosterior = detalleEventosPosteriores(tarjeta, contado, msi, gastos, pagosDiferidos, creditosTarjeta)
    .reduce((s, e) => s + e.monto, 0);

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
