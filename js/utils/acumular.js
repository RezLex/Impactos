/**
 * Qué se le puede acumular a una compra de contado.
 *
 * Un cargo que en realidad continúa a otro anterior (la segunda mitad de una
 * cuenta, un cobro partido en dos) se registra como una sola compra por la
 * suma. Lo acumulable son dos cosas distintas de la misma tarjeta:
 *
 *   - una **notificación pendiente**, que nunca llegó a ser compra;
 *   - una **compra ya registrada**, que al absorberse se elimina.
 *
 * Vive aquí y no en `quick-add.js` porque es una regla, no interfaz: así se
 * prueba en Node (`test/acumular.test.mjs`).
 */

import { matchTarjetaPorTerminacion } from './prefill-compra.js';
import { r2 } from './formatters.js';

/** Cuántas compras registradas se ofrecen. Más que esto es una lista para buscar, no para elegir. */
export const MAX_COMPRAS = 5;

/**
 * @param {object}   opts
 * @param {string}   opts.tarjetaId       tarjeta elegida en el formulario
 * @param {object[]} opts.notificaciones  la colección `notificaciones`
 * @param {object[]} opts.contado         la colección `contado`
 * @param {object[]} opts.tarjetas        para resolver la terminación de cada notificación
 * @param {string}   [opts.msgIdActual]   si el modal se abrió desde una notificación,
 *                                        la suya: no se ofrece acumularse consigo misma
 * @returns {{notificaciones: object[], compras: object[]}}
 */
export function opcionesAcumulables({ tarjetaId, notificaciones = [], contado = [], tarjetas = [], msgIdActual = '' }) {
  // Sin tarjeta no hay nada que ofrecer: acumular siempre es dentro de la misma
  if (!tarjetaId) return { notificaciones: [], compras: [] };

  const notis = notificaciones.filter(n => {
    if (n.tipo !== 'compra' || n.estatus !== 'pendiente') return false;
    if (msgIdActual && n.datos?.msgId === msgIdActual) return false;
    // La notificación guarda la terminación, no el tarjetaId
    return matchTarjetaPorTerminacion(n.datos?.tarjeta, tarjetas)?.tarjetaId === tarjetaId;
  });

  const compras = contado
    .filter(c => c.tarjetaId === tarjetaId)
    .sort((a, b) => String(b.fechaCompra || '').localeCompare(String(a.fechaCompra || '')))
    .slice(0, MAX_COMPRAS);

  return { notificaciones: notis, compras };
}

/**
 * Total de la compra nueva. Se redondea a dos decimales porque los importes
 * vienen de fuentes distintas (formulario y documento) y sumarlos en binario
 * deja colas como 1372.2300000000002.
 */
export function totalAcumulado(totalFormulario, opcion) {
  return r2((Number(totalFormulario) || 0) + (Number(opcion?.total) || 0));
}
