/**
 * Conversión entre unidades de medida para el módulo de Artículos Recurrentes.
 * Puro, sin dependencias de Firestore ni del DOM.
 */

// Factores a la unidad base de cada familia (ml para volumen, g para masa).
const FACTORES = { ml: 1, L: 1000, gal: 3785.411784, g: 1, kg: 1000, lb: 453.59237 };
const FAMILIA  = { ml: 'volumen', L: 'volumen', gal: 'volumen', g: 'masa', kg: 'masa', lb: 'masa' };

export const UNIDADES_VOLUMEN = ['ml', 'L', 'gal'];
export const UNIDADES_MASA    = ['g', 'kg', 'lb'];

/** Familia de una unidad conocida (`volumen`/`masa`), o `null` si es una unidad libre (tipo `pieza`). */
export function familiaDeUnidad(unidad) {
  return FAMILIA[unidad] || null;
}

/**
 * Convierte `valor` de `deUnidad` a `aUnidad`. Misma unidad siempre se acepta
 * (incluidas las etiquetas libres de artículos `pieza`, que no tienen familia).
 * Unidades de familias distintas —o una unidad libre contra otra distinta— lanzan error.
 */
export function convertir(valor, deUnidad, aUnidad) {
  const v = Number(valor) || 0;
  if (deUnidad === aUnidad) return v;
  const fDe = FAMILIA[deUnidad];
  const fA  = FAMILIA[aUnidad];
  if (!fDe || !fA || fDe !== fA) {
    throw new Error(`No se puede convertir de "${deUnidad}" a "${aUnidad}"`);
  }
  return v * FACTORES[deUnidad] / FACTORES[aUnidad];
}
