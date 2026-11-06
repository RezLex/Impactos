/**
 * Planes de compra (tab "Planes" del módulo Deseos) — cálculo puro.
 *
 * Un plan (colección `planesCompra`): `{ nombre, notas, items: [item] }`.
 * Un item es un registro propio del plan (no se sincroniza con otros planes, y de
 * Lista toma el precio y el tope de la forma de pago, ver `conDatosDeLista`): `{ id,
 * origen: 'lista'|'personalizado', deseoId?, opcionId?,
 * nombre, tienda, enlace, precio, cantidad, tarjetaId, bonificacionId,
 * tipoPago: 'contado'|'msi', meses }`. `tipoPago`/`meses` acotan qué
 * bonificaciones de la tarjeta se pueden ligar (ver `bonifsDeTarjeta` en
 * modules/deseos.js), igual que en una compra real de Contado o A Plazos.
 *
 * No tiene relación con Compras ni Impacto: la bonificación de cada item se
 * calcula solo contra los demás items del mismo plan, con el mismo repartidor
 * que el módulo Bonificaciones (mínimo, tope, IVA). Con mínimo "por compra",
 * los items de la misma tienda pagados con la misma tarjeta son una sola orden.
 */
import { calcularDistribucion, aplicaBonificacion, MESES_COMUNES } from './bonificaciones.js';

/** La opción de la tab Lista de la que viene un item, o null si es personalizado o ya no existe. */
export function opcionDeItem(item, deseos) {
  if (item?.origen !== 'lista') return null;
  const deseo = (deseos || []).find(d => d.id === item.deseoId);
  return (deseo?.opciones || []).find(o => o.id === item.opcionId) || null;
}

/**
 * Plazos que puede elegir en Planes un item de esta opción de Lista: la forma de pago
 * registrada es el máximo. Vacío si la opción es de contado (no admite MSI); con MSI,
 * los plazos comunes hasta sus meses. Contado siempre se puede elegir.
 */
export function mesesPermitidos(opcion) {
  if (opcion?.tipoPago !== 'msi') return [];
  const tope = Number(opcion.meses) || 0;
  if (!tope) return [...MESES_COMUNES];
  return [...new Set([...MESES_COMUNES.filter(m => m <= tope), tope])].sort((a, b) => a - b);
}

/** Forma de pago de un item de Lista: la elegida en el plan si la opción la permite; si no, su máximo. */
function pagoDentroDelTope(item, opcion) {
  const meses = mesesPermitidos(opcion);
  if (!meses.length || item.tipoPago === 'contado') return { tipoPago: 'contado', meses: null };
  const elegidos = Number(item.meses);
  return { tipoPago: 'msi', meses: meses.includes(elegidos) ? elegidos : meses[meses.length - 1] };
}

/**
 * El plan con los datos de Lista aplicados a sus items vinculados: el último precio,
 * que no se edita en Planes, y la forma de pago elegida acotada al máximo de la opción
 * (si en Lista bajan los meses, el item baja con ellos). Si la opción ya no existe, el
 * item conserva los suyos.
 */
export function conDatosDeLista(plan, deseos) {
  return {
    ...plan,
    items: (plan?.items || []).map(it => {
      const o = opcionDeItem(it, deseos);
      if (!o) return it;
      return { ...it, precio: Number(o.precio) || 0, ...pagoDentroDelTope(it, o) };
    }),
  };
}

export function subtotalItem(item) {
  return (Number(item?.precio) || 0) * (Number(item?.cantidad) || 1);
}

/** Clave de orden de un item: misma tienda (sin importar mayúsculas/espacios) + misma tarjeta. */
export function claveOrden(item) {
  return `${String(item?.tienda || '').trim().toLowerCase()}|${item?.tarjetaId || ''}`;
}

const r2 = n => Math.round(n * 100) / 100;

/**
 * Qué items de un carrito pueden usar un cupón (catálogo `cuponesPlan`), según sus
 * restricciones opcionales: `institucionId` (la de la tarjeta del carrito; vacío =
 * cualquiera) y `aplicaA` ('contado'|'msi'|'ambos'; ausente = 'ambos', comparado
 * contra el `tipoPago` de cada item, porque un carrito puede mezclar ambos).
 *
 * @returns {{elegibles: object[], motivo: null|'institucion'|'pago'}} `motivo` dice
 *   por qué no aplica a ninguno.
 */
export function evaluarCupon(cupon, items, institucionId = null) {
  if (cupon?.institucionId && cupon.institucionId !== institucionId) return { elegibles: [], motivo: 'institucion' };
  const aplicaA = cupon?.aplicaA || 'ambos';
  const elegibles = (items || []).filter(it => aplicaA === 'ambos' || aplicaA === (it.tipoPago === 'msi' ? 'msi' : 'contado'));
  return { elegibles, motivo: elegibles.length ? null : 'pago' };
}

/**
 * Descuento de un cupón (`{ nombre, tienda, tipo: 'porcentaje'|'cantidad', valor,
 * montoMinimo, montoMaximo, institucionId, aplicaA }`) sobre el subtotal de los
 * items elegibles de un carrito. Si no alcanza `montoMinimo` no aplica.
 * `montoMaximo` solo topa los de porcentaje; uno de cantidad fija descuenta su
 * valor. Nunca más que el subtotal.
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
 * 1. El cupón asignado al carrito (`plan.cupones[clave]`) se valida (`evaluarCupon`)
 *    y se descuenta del subtotal de sus items elegibles, repartido entre ellos en
 *    proporción a su subtotal. El mínimo también se mide contra esos items.
 * 2. La bonificación se calcula sobre lo que se paga ya con el cupón. Al ser una
 *    simulación, el mínimo y "Aplica a" no la anulan: sin el mínimo se reparte como si
 *    ya se hubiera alcanzado (ver `simularMinimo`), y ambos quedan como advertencia en
 *    cada item (`califica` false, `noAplica` true).
 *
 * @param {object}   plan
 * @param {object[]} bonificaciones  catálogo del módulo Bonificaciones
 * @param {(institucionId:string)=>boolean} conIvaDe  si la institución bonifica con IVA
 * @param {object[]} cupones  catálogo de cupones de la tab Planes
 * @param {(tarjetaId:string|null)=>string|null} institucionDe  institución de una tarjeta
 * @returns {{
 *   porItem: Map<string, {subtotal:number, cupon:number, pagado:number, bonificacion:number, neto:number, pct:number, califica:boolean|null, faltante:number, noAplica:boolean, bonif:object|null}>,
 *   carritos: {clave:string, tarjetaId:string|null, tienda:string, items:object[], subtotal:number, cupon:object|null, descuento:number, aplica:boolean, faltante:number, motivo:null|'institucion'|'pago', elegibles:number, bonificacion:number, neto:number}[],
 *   subtotal:number, cupones:number, bonificacion:number, neto:number, advertencias:number,
 *   porBonificacion: {bonif:object, esperado:number, topado:boolean, sinTope:number}[]
 * }}
 */
export function calcularPlan(plan, bonificaciones, conIvaDe = () => false, cupones = [], institucionDe = () => null) {
  const items = Array.isArray(plan?.items) ? plan.items : [];
  const bonifMap = new Map((bonificaciones || []).map(b => [b.id, b]));
  const cuponMap = new Map((cupones || []).map(c => [c.id, c]));
  const porItem = new Map();
  items.forEach(it => {
    const subtotal = subtotalItem(it);
    porItem.set(it.id, { subtotal, cupon: 0, pagado: subtotal, bonificacion: 0, neto: subtotal, pct: 0, califica: null, faltante: 0, noAplica: false, bonif: null });
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
    const { elegibles, motivo } = cupon ? evaluarCupon(cupon, c.items, institucionDe(c.tarjetaId)) : { elegibles: [], motivo: null };
    const base = elegibles.reduce((s, it) => s + subtotalItem(it), 0);
    const { descuento, aplica, faltante } = descuentoCupon(motivo ? null : cupon, base);
    // Reparto proporcional; el redondeo sobrante va al último item para que sume exacto.
    let asignado = 0;
    elegibles.forEach((it, i) => {
      const r = porItem.get(it.id);
      const parte = i === elegibles.length - 1
        ? r2(descuento - asignado)
        : (base > 0 ? r2(descuento * r.subtotal / base) : 0);
      asignado += parte;
      r.cupon  = parte;
      r.pagado = r.subtotal - parte;
      r.neto   = r.pagado;
    });
    return { ...c, subtotal, cupon, descuento, aplica, faltante, motivo, elegibles: elegibles.length };
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
    const dist = calcularDistribucion(bonif, compras, !!conIvaDe(bonif.institucionId), { simularMinimo: true });
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
      r.noAplica     = !aplicaBonificacion(bonif, it.tipoPago === 'msi' ? 'msi' : 'contado', it.meses);
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
  const advertencias = valores.filter(r => r.bonif && (r.califica === false || r.noAplica)).length;
  return { porItem, carritos, subtotal, cupones: cuponesTot, bonificacion, neto: subtotal - cuponesTot - bonificacion, advertencias, porBonificacion };
}
