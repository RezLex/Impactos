/**
 * Módulo Deseos — cálculo puro, sin Firestore ni DOM.
 *
 * Un deseo (colección `deseos`): `{ nombre, notas, opciones: [opcion] }`.
 * Una opción: `{ id, tienda, precio, enlace, historial: [{ fecha, precio }] }` —
 * `precio` es el vigente y `historial` guarda cada precio registrado (el primero
 * al crear la opción), en el orden en que se registraron.
 */

/** Id estable para una opción (las opciones viven en un array del deseo). */
export function nuevoIdOpcion() {
  return (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
}

/** Variación porcentual de `anterior` a `actual`, o null si no hay base para compararla. */
export function variacionPct(anterior, actual) {
  const a = Number(anterior), b = Number(actual);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return (b - a) / a * 100;
}

/**
 * Registra `precio` en la opción: actualiza el vigente y agrega una entrada al
 * historial solo si cambió (o si el historial está vacío). Devuelve una opción nueva.
 */
export function registrarPrecio(opcion, precio, fecha) {
  const p = Number(precio) || 0;
  const historial = Array.isArray(opcion?.historial) ? [...opcion.historial] : [];
  const ultimo = historial[historial.length - 1];
  if (!ultimo || Number(ultimo.precio) !== p) historial.push({ fecha, precio: p });
  return { ...opcion, precio: p, historial };
}

/**
 * Historial de más reciente a más antiguo, cada entrada con `variacion`: el % de
 * diferencia contra la entrada registrada justo antes (null en la primera).
 */
export function historialConVariacion(historial) {
  const lista = Array.isArray(historial) ? historial : [];
  return lista
    .map((h, i) => ({ ...h, variacion: i === 0 ? null : variacionPct(lista[i - 1].precio, h.precio) }))
    .reverse();
}

/** Variación del último cambio de precio de la opción (null si solo tiene un precio). */
export function ultimaVariacion(opcion) {
  const h = Array.isArray(opcion?.historial) ? opcion.historial : [];
  return h.length < 2 ? null : variacionPct(h[h.length - 2].precio, h[h.length - 1].precio);
}

/** La opción más barata de un deseo, o null si no tiene opciones con precio. */
export function mejorOpcion(opciones) {
  const conPrecio = (opciones || []).filter(o => Number(o.precio) > 0);
  if (!conPrecio.length) return null;
  return conPrecio.reduce((a, o) => (Number(o.precio) < Number(a.precio) ? o : a));
}
