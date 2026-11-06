/**
 * Baja lógica de tarjetas y de sus números. Una tarjeta dada de baja (`baja: true`,
 * `fechaBaja`) se conserva para que sus compras y gastos sigan resolviendo nombre,
 * institución y ciclo, pero ya no se ofrece para registrar nada nuevo. Lo mismo un
 * número dentro de `tarjeta.numeros` (`{ formato, numero, fechaVencimiento, baja,
 * fechaBaja }`), que las compras siguen pudiendo mostrar por su `numeroTarjeta`.
 */

export function esTarjetaActiva(t) {
  return !t?.baja;
}

/**
 * Números que se pueden elegir en un selector: los activos, más el que ya tiene el
 * registro en edición (`numeroActual`) aunque esté dado de baja, para no perderlo.
 */
export function numerosSeleccionables(tarjeta, numeroActual = null) {
  const numeros = Array.isArray(tarjeta?.numeros) ? tarjeta.numeros : [];
  return numeros.filter(n => !n.baja || (numeroActual && n.numero === numeroActual));
}

/**
 * Número que representa a una tarjeta cuando el registro no guardó cuál usó: física
 * antes que digital, y activos antes que dados de baja (que siguen sirviendo para
 * identificar registros viejos si la tarjeta ya no tiene ninguno activo).
 */
export function numeroPorDefecto(numeros) {
  const lista = (Array.isArray(numeros) ? numeros : []).filter(n => n.numero);
  const fisicaPrimero = l => l.find(n => n.formato === 'fisica') || l[0];
  return fisicaPrimero(lista.filter(n => !n.baja)) || fisicaPrimero(lista) || null;
}

/**
 * Tarjetas que se pueden elegir en un selector: las activas y no ocultas, más la que
 * ya tiene el registro en edición (`actualId`) aunque esté oculta o dada de baja —
 * sin ella el select se quedaría sin opción elegida y se perdería la tarjeta al
 * guardar. Las dadas de baja llevan la marca en el nombre.
 */
export function tarjetasSeleccionables(tarjetas, actualId = null) {
  return (tarjetas || [])
    .filter(t => (esTarjetaActiva(t) && !t.oculta) || t.id === actualId)
    .map(t => (t.baja ? { ...t, nombre: `${t.nombre} (baja)` } : t));
}
