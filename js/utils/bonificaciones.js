/**
 * Bonificaciones por institución (colección `bonificaciones`) — motor de cálculo.
 * Puro, sin Firestore ni DOM.
 *
 * Una bonificación: `{ nombre, institucionId, tipo: 'porcentaje'|'cantidad', valor,
 * fechaMaxima, enlace, enlaceTyc, montoMinimo, minimoPor: 'compra'|'acumulado',
 * montoMaximo, aplicada, aplicaA: 'contado'|'msi'|'ambos', mesesAplican }`.
 *
 * `aplicaA` restringe la bonificación a compras de contado, a plazos (MSI) o
 * ambas; sin ese campo (bonificaciones anteriores a esto) se trata como 'ambos'.
 * Con `aplicaA` distinto de 'contado', `mesesAplican` (array de números de mes,
 * ej. `[3, 6, 12]`) puede acotarla además a esas mensualidades; vacío o ausente
 * significa "cualquier mensualidad".
 *
 * Una compra (contado o msi) se liga con `bonificacionId`; si la bonificación
 * valida el mínimo por compra, además lleva `folioOrden` — los registros con el
 * mismo folio son una misma orden de compra y se suman para validar el mínimo.
 */

export const IVA_FACTOR = 1.16;

/** Mensualidades comunes ofrecidas al configurar a qué plazos de MSI aplica una bonificación. */
export const MESES_COMUNES = [3, 4, 6, 9, 12, 15, 18, 24];

/**
 * ¿Una bonificación aplica a una compra de tipo `tipo` ('contado'|'msi')? Con
 * 'msi', si además tiene `mesesAplican` capturados, `meses` debe estar entre ellos.
 */
export function aplicaBonificacion(bonif, tipo, meses = null) {
  const aplicaA = bonif?.aplicaA || 'ambos';
  if (aplicaA !== 'ambos' && aplicaA !== tipo) return false;
  if (tipo === 'msi' && Array.isArray(bonif?.mesesAplican) && bonif.mesesAplican.length) {
    return bonif.mesesAplican.includes(Number(meses));
  }
  return true;
}

/** Monto sobre el que se calcula la bonificación de una compra: su total original. */
export function baseCompra(c) {
  return Number(c?.diferido ? (c.totalDiferido || c.total) : c?.total) || 0;
}

/** Estado de una bonificación: 'aplicada' | 'vencida' | 'vigente'. */
export function estadoBonificacion(b, hoyISO) {
  if (b?.aplicada) return 'aplicada';
  if (b?.fechaMaxima && b.fechaMaxima < hoyISO) return 'vencida';
  return 'vigente';
}

/** Texto corto de la regla: "10% · mín. $1,000 por compra · máx. $500". `fmt` formatea montos. */
export function reglaBonificacion(b, fmt) {
  const partes = [b.tipo === 'porcentaje' ? `${b.valor}%` : fmt(b.valor)];
  if (Number(b.montoMinimo) > 0) partes.push(`mín. ${fmt(b.montoMinimo)} ${b.minimoPor === 'acumulado' ? 'acumulado' : 'por compra'}`);
  if (Number(b.montoMaximo) > 0) partes.push(`máx. ${fmt(b.montoMaximo)}`);
  const meses = Array.isArray(b.mesesAplican) && b.mesesAplican.length ? ` a ${b.mesesAplican.join('/')} meses` : '';
  if (b.aplicaA === 'contado') partes.push('solo de contado');
  else if (b.aplicaA === 'msi') partes.push(`solo MSI${meses}`);
  else if (meses) partes.push(`MSI solo${meses}`);
  return partes.join(' · ');
}

/**
 * Reparte la bonificación esperada entre sus compras ligadas.
 *
 * 1. Grupos que validan el mínimo: con `minimoPor: 'compra'`, cada folio de orden
 *    (una compra sin folio es su propio grupo); con 'acumulado', todas juntas.
 *    Un grupo califica si su suma ≥ `montoMinimo` (o si no hay mínimo).
 * 2. Monto por compra que califica:
 *    - 'porcentaje': `valor`% de su base.
 *    - 'cantidad': `valor` por grupo que califica (por orden, o una sola vez si
 *      es acumulado), repartido entre sus compras en proporción a su base.
 *    Con `conIva` (la institución bonifica con IVA) se multiplica por 1.16, igual
 *    que la bonificación manual de una compra.
 * 3. Si la suma pasa de `montoMaximo`, se escala todo proporcionalmente al tope.
 *
 * @param {object}   bonif
 * @param {object[]} compras  compras ligadas a `bonif` (con `id`, `folioOrden`, total)
 * @param {boolean}  conIva
 * @returns {{
 *   porCompra: Map<string, {monto:number, pct:number, base:number, califica:boolean, folio:string|null, grupoBase:number}>,
 *   grupos: {clave:string, folio:string|null, base:number, califica:boolean, faltante:number, compras:object[]}[],
 *   sumaBase:number, esperado:number, sinTope:number, topado:boolean
 * }}
 */
export function calcularDistribucion(bonif, compras, conIva = false, { simularMinimo = false } = {}) {
  const minimo  = Number(bonif?.montoMinimo) || 0;
  const maximo  = Number(bonif?.montoMaximo) || 0;
  const valor   = Number(bonif?.valor) || 0;
  const factor  = conIva ? IVA_FACTOR : 1;
  const porOrden = bonif?.minimoPor !== 'acumulado';

  const gruposMap = new Map();
  for (const c of compras) {
    const clave = porOrden ? (c.folioOrden || `__${c.id}`) : '__todas__';
    if (!gruposMap.has(clave)) gruposMap.set(clave, { clave, folio: porOrden ? (c.folioOrden || null) : null, base: 0, compras: [] });
    const g = gruposMap.get(clave);
    g.base += baseCompra(c);
    g.compras.push(c);
  }
  const grupos = [...gruposMap.values()].map(g => ({
    ...g,
    califica: !minimo || g.base >= minimo,
    faltante: Math.max(0, minimo - g.base),
  }));

  const porCompra = new Map();
  let sinTope = 0;
  for (const g of grupos) {
    for (const c of g.compras) {
      const base = baseCompra(c);
      let monto = 0;
      if (g.califica) {
        monto = bonif.tipo === 'porcentaje'
          ? base * valor / 100
          : (g.base > 0 ? valor * base / g.base : 0);
        monto *= factor;
      } else if (simularMinimo && g.base > 0) {
        // Simulación de Planes: la bonificación se reparte como si ya se hubiera llegado
        // al mínimo, y lo que falta para alcanzarlo se queda con su parte. Con porcentaje
        // equivale al % sobre el precio; con cantidad, a la parte proporcional al mínimo.
        // `califica` sigue en false para que quien llama pueda advertirlo.
        const bonifGrupo = bonif.tipo === 'porcentaje' ? minimo * valor / 100 : valor;
        monto = Math.min(bonifGrupo * factor * base / minimo, base);
      }
      sinTope += monto;
      porCompra.set(c.id, { monto, pct: 0, base, califica: g.califica, folio: g.folio, grupoBase: g.base });
    }
  }

  const topado = maximo > 0 && sinTope > maximo;
  const escala = topado ? maximo / sinTope : 1;
  for (const d of porCompra.values()) {
    d.monto = Math.round(d.monto * escala * 100) / 100;
    d.pct   = d.base > 0 ? d.monto / d.base * 100 : 0;
  }

  return {
    porCompra,
    grupos,
    sumaBase: grupos.reduce((s, g) => s + g.base, 0),
    esperado: topado ? maximo : Math.round(sinTope * 100) / 100,
    sinTope,
    topado,
  };
}

/** Clave de institución para el folio: nombre sin acentos ni símbolos, en mayúsculas. */
export function claveInstitucion(nombre) {
  return String(nombre || 'INST').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'INST';
}

/**
 * Folio de orden nuevo: `[Institución]-[DDMMAA]-[NN]`, con la fecha de la compra
 * y NN el siguiente consecutivo (2 dígitos) entre los folios existentes con el
 * mismo prefijo en `compras`.
 */
export function generarFolio(institucionNombre, fechaISO, compras) {
  const [y, m, d] = String(fechaISO || '').slice(0, 10).split('-');
  const prefijo = `${claveInstitucion(institucionNombre)}-${d}${m}${(y || '').slice(2)}`;
  const max = compras.reduce((mx, c) => {
    const f = c.folioOrden || '';
    if (!f.startsWith(prefijo + '-')) return mx;
    const n = parseInt(f.slice(prefijo.length + 1), 10);
    return Number.isFinite(n) && n > mx ? n : mx;
  }, 0);
  return `${prefijo}-${String(max + 1).padStart(2, '0')}`;
}
