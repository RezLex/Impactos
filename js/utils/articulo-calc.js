/**
 * Motor de cálculo del módulo de Artículos Recurrentes. Puro, sin Firestore ni DOM —
 * toma el `artículo` (con su array `registros`) tal como sale de Firestore.
 */
import { convertir } from './unidades.js';
import { diasEntre } from './rendimiento.js';

/** Precio neto de un registro tras aplicar su descuento (mismo criterio que `bonificacion` en compras). */
export function precioNeto(registro) {
  const precio = Number(registro?.precio) || 0;
  const d = registro?.descuento;
  if (!d || !d.tipo) return precio;
  const monto = d.tipo === 'porcentaje' ? precio * (Number(d.valor) / 100) : Number(d.valor) || 0;
  return precio - monto;
}

/**
 * Precio por unidad de contenido (en `unidadPreferida`), o `null` si el contenido es 0.
 *
 * Usa el precio BRUTO, sin descuento: el descuento es una promoción puntual de ese
 * registro y no representa el costo real del artículo para comparar entre registros
 * o entre marcas.
 */
export function precioPorUnidad(registro, unidadPreferida) {
  if (!registro) return null;
  const contenido = convertir(registro.contenidoValor, registro.contenidoUnidad, unidadPreferida);
  if (!contenido) return null;
  return (Number(registro.precio) || 0) / contenido;
}

/**
 * Precio NETO (ya con descuento) por unidad de contenido — solo para mostrarlo junto
 * al precio sin descuento en el inventario; los promedios y comparaciones usan siempre
 * `precioPorUnidad`.
 */
export function precioNetoPorUnidad(registro, unidadPreferida) {
  if (!registro) return null;
  const contenido = convertir(registro.contenidoValor, registro.contenidoUnidad, unidadPreferida);
  if (!contenido) return null;
  return precioNeto(registro) / contenido;
}

/** El registro con la `fechaComprado` más próxima y posterior a la de `registro`, dentro de `registros`. */
function siguienteCompra(registros, registro) {
  const posteriores = (registros || [])
    .filter(r => r !== registro && r.fechaComprado && r.fechaComprado > registro.fechaComprado);
  if (!posteriores.length) return null;
  return posteriores.reduce((a, r) => (r.fechaComprado < a.fechaComprado ? r : a));
}

/**
 * Días que duró el registro.
 *
 * Con seguimiento normal: `fechaEnUso` → `fechaTerminado`, `null` si no está `terminado`
 * o le falta alguna fecha.
 *
 * Sin seguimiento (`registro.sinSeguimiento`): se estima como `fechaComprado` de este
 * registro → `fechaComprado` del siguiente registro comprado del mismo artículo (los
 * demás elementos de `registros`) — `null` si es el más reciente, porque todavía no hay
 * un "siguiente" con quién compararlo.
 */
export function duracionDias(registro, registros = []) {
  if (registro?.sinSeguimiento) {
    if (!registro.fechaComprado) return null;
    const siguiente = siguienteCompra(registros, registro);
    if (!siguiente) return null;
    const dias = diasEntre(registro.fechaComprado, siguiente.fechaComprado);
    return dias >= 0 ? dias : null;
  }
  if (registro?.estatus !== 'terminado' || !registro?.fechaEnUso || !registro?.fechaTerminado) return null;
  const dias = diasEntre(registro.fechaEnUso, registro.fechaTerminado);
  return dias >= 0 ? dias : null;
}

/** Duración en días por unidad de contenido (en `unidadPreferida`), o `null` si no aplica. */
export function duracionPorUnidad(registro, unidadPreferida, registros = []) {
  const dias = duracionDias(registro, registros);
  if (dias == null) return null;
  const contenido = convertir(registro.contenidoValor, registro.contenidoUnidad, unidadPreferida);
  if (!contenido) return null;
  return dias / contenido;
}

function promedio(valores) {
  const v = valores.filter(x => x != null && !Number.isNaN(x));
  if (!v.length) return null;
  return v.reduce((s, x) => s + x, 0) / v.length;
}

/**
 * Resumen de un artículo para su card: promedios de precio y duración por unidad,
 * y el conteo de registros por estatus.
 *
 * El promedio de precio toma TODOS los registros (precio/contenido se conocen desde
 * la compra) y es sin descuento (ver `precioPorUnidad`). El promedio de duración toma
 * los registros `terminado` con `fechaEnUso`, más los `sinSeguimiento` que ya tengan un
 * "siguiente" registro con quién compararse (ver `duracionDias`) — `duracionPorUnidad`
 * devuelve `null` para el resto y `promedio()` los ignora.
 */
export function resumenArticulo(articulo) {
  const registros = Array.isArray(articulo?.registros) ? articulo.registros : [];
  const unidad = articulo?.unidadPreferida;

  const promedioPrecioPorUnidad = promedio(registros.map(r => precioPorUnidad(r, unidad)));
  const promedioDuracionPorUnidad = promedio(registros.map(r => duracionPorUnidad(r, unidad, registros)));

  const stock = { comprado: 0, enUso: 0, terminado: 0, sinSeguimiento: 0 };
  registros.forEach(r => {
    if (r.sinSeguimiento) stock.sinSeguimiento++;
    else if (stock[r.estatus] != null) stock[r.estatus]++;
  });

  return { promedioPrecioPorUnidad, promedioDuracionPorUnidad, stock };
}
