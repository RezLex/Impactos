/**
 * Planes de compra (tab "Planes" del módulo Deseos) — cálculo puro.
 *
 * Un plan (colección `planesCompra`): `{ nombre, notas, items: [item] }`.
 * Un item es un registro propio del plan (no se sincroniza con Lista ni con
 * otros planes): `{ id, origen: 'lista'|'personalizado', deseoId?, opcionId?,
 * nombre, tienda, enlace, precio, cantidad, tarjetaId, bonificacionId }`.
 *
 * No tiene relación con Compras ni Impacto: la bonificación de cada item se
 * calcula solo contra los demás items del mismo plan, con el mismo repartidor
 * que el módulo Bonificaciones (mínimo, tope, IVA). Con mínimo "por compra",
 * los items de la misma tienda pagados con la misma tarjeta son una sola orden.
 */
import { calcularDistribucion } from './bonificaciones.js';

export function subtotalItem(item) {
  return (Number(item?.precio) || 0) * (Number(item?.cantidad) || 1);
}

/** Clave de orden de un item: misma tienda (sin importar mayúsculas/espacios) + misma tarjeta. */
export function claveOrden(item) {
  return `${String(item?.tienda || '').trim().toLowerCase()}|${item?.tarjetaId || ''}`;
}

const r2 = n => Math.round(n * 100) / 100;

/**
 * Descuento de un cupón (catálogo `cuponesPlan`: `{ nombre, tienda, tipo:
 * 'porcentaje'|'cantidad', valor, montoMinimo, montoMaximo }`) sobre el subtotal
 * de un carrito. Si no alcanza `montoMinimo` no aplica. `montoMaximo` solo topa
 * los de porcentaje; uno de cantidad fija descuenta su valor. Nunca más que el subtotal.
 */
export function descuentoCupon(cupon, subtotal) {
  if (!cupon) return { descuento: 0, aplica: false, faltante: 0 };
  const minimo = Number(cupon.montoMinimo) || 0;
  if (minimo && subtotal < minimo) return { descuento: 0, aplica: false, faltante: r2(minimo - subtotal) };
  const valor = Number(cupon.valor) || 0;
  let descuento = cupon.tipo === 'porcentaje' ? subtotal * valor / 100 : valor;
  const maximo = Number(cupon.montoMaximo) || 0;
  if (cupon.tipo === 'porcentaje' && maximo > 0) descuento = Math.min(descuento, maximo);
  return { descuento: r2(Math.min(descuento, subtotal)), aplica: true, faltante: 0 };
}

/**
 * Totales de un plan.
 *
 * Los items se agrupan en carritos (misma tarjeta + misma tienda, `claveOrden`).
 * 1. El cupón asignado al carrito (`plan.cupones[clave]`) se descuenta de su
 *    subtotal y se reparte entre sus items en proporción a su subtotal.
 * 2. La bonificación se calcula sobre lo que se paga ya con el cupón.
 *
 * @param {object}   plan
 * @param {object[]} bonificaciones  catálogo del módulo Bonificaciones
 * @param {(institucionId:string)=>boolean} conIvaDe  si la institución bonifica con IVA
 * @param {object[]} cupones  catálogo de cupones de la tab Planes
 * @returns {{
 *   porItem: Map<string, {subtotal:number, cupon:number, pagado:number, bonificacion:number, neto:number, pct:number, califica:boolean|null, faltante:number, bonif:object|null}>,
 *   carritos: {clave:string, tarjetaId:string|null, tienda:string, items:object[], subtotal:number, cupon:object|null, descuento:number, aplica:boolean, faltante:number, bonificacion:number, neto:number}[],
 *   subtotal:number, cupones:number, bonificacion:number, neto:number,
 *   porBonificacion: {bonif:object, esperado:number, topado:boolean, sinTope:number}[]
 * }}
 */
export function calcularPlan(plan, bonificaciones, conIvaDe = () => false, cupones = []) {
  const items = Array.isArray(plan?.items) ? plan.items : [];
  const bonifMap = new Map((bonificaciones || []).map(b => [b.id, b]));
  const cuponMap = new Map((cupones || []).map(c => [c.id, c]));
  const porItem = new Map();
  items.forEach(it => {
    const subtotal = subtotalItem(it);
    porItem.set(it.id, { subtotal, cupon: 0, pagado: subtotal, bonificacion: 0, neto: subtotal, pct: 0, califica: null, faltante: 0, bonif: null });
  });

  // 1. Carritos y cupones.
  const carritosMap = new Map();
  items.forEach(it => {
    const clave = claveOrden(it);
    if (!carritosMap.has(clave)) carritosMap.set(clave, { clave, tarjetaId: it.tarjetaId || null, tienda: it.tienda || '', items: [] });
    carritosMap.get(clave).items.push(it);
  });
  const carritos = [...carritosMap.values()].map(c => {
    const subtotal = c.items.reduce((s, it) => s + subtotalItem(it), 0);
    const cupon = cuponMap.get(plan?.cupones?.[c.clave]) || null;
    const { descuento, aplica, faltante } = descuentoCupon(cupon, subtotal);
    // Reparto proporcional; el redondeo sobrante va al último item para que sume exacto.
    let asignado = 0;
    c.items.forEach((it, i) => {
      const r = porItem.get(it.id);
      const parte = i === c.items.length - 1
        ? r2(descuento - asignado)
        : (subtotal > 0 ? r2(descuento * r.subtotal / subtotal) : 0);
      asignado += parte;
      r.cupon  = parte;
      r.pagado = r.subtotal - parte;
      r.neto   = r.pagado;
    });
    return { ...c, subtotal, cupon, descuento, aplica, faltante };
  });

  const porBonificacion = [];
  const grupos = new Map();
  items.forEach(it => {
    if (!it.bonificacionId || !bonifMap.has(it.bonificacionId)) return;
    if (!grupos.has(it.bonificacionId)) grupos.set(it.bonificacionId, []);
    grupos.get(it.bonificacionId).push(it);
  });

  grupos.forEach((suyos, bonifId) => {
    const bonif = bonifMap.get(bonifId);
    const porOrden = bonif.minimoPor !== 'acumulado';
    const compras = suyos.map(it => ({ id: it.id, total: porItem.get(it.id).pagado, folioOrden: porOrden ? claveOrden(it) : null }));
    const dist = calcularDistribucion(bonif, compras, !!conIvaDe(bonif.institucionId));
    const faltantePorClave = new Map(dist.grupos.map(g => [g.clave, g.faltante]));
    suyos.forEach(it => {
      const d = dist.porCompra.get(it.id);
      const r = porItem.get(it.id);
      r.bonif        = bonif;
      r.bonificacion = d.monto;
      r.pct          = d.pct;
      r.califica     = d.califica;
      r.faltante     = faltantePorClave.get(porOrden ? claveOrden(it) : '__todas__') || 0;
      r.neto         = r.pagado - d.monto;
    });
    porBonificacion.push({ bonif, esperado: dist.esperado, topado: dist.topado, sinTope: dist.sinTope });
  });

  carritos.forEach(c => {
    c.bonificacion = c.items.reduce((s, it) => s + porItem.get(it.id).bonificacion, 0);
    c.neto         = c.items.reduce((s, it) => s + porItem.get(it.id).neto, 0);
  });

  const valores = [...porItem.values()];
  const subtotal     = valores.reduce((s, r) => s + r.subtotal, 0);
  const cuponesTot   = valores.reduce((s, r) => s + r.cupon, 0);
  const bonificacion = valores.reduce((s, r) => s + r.bonificacion, 0);
  return { porItem, carritos, subtotal, cupones: cuponesTot, bonificacion, neto: subtotal - cuponesTot - bonificacion, porBonificacion };
}
