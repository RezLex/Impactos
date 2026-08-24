/**
 * Convierte una compra detectada por el Apps Script en la precarga (`prefill`)
 * del modal de Registro Rápido.
 *
 * Dos caminos alimentan esta conversión con los MISMOS nombres de campo:
 *   - La sección Notificaciones (`#/notificaciones`), con el mapa `datos` del
 *     documento de Firestore. Es el camino normal.
 *   - El pre-registro por URL (`#/compras?desc=...&total=...`), con el query
 *     string parseado. Quedó como fallback: el script ya no manda ese enlace,
 *     pero los correos viejos siguen funcionando.
 *
 * Por eso vive aquí y no en `msi.js`: una sola traducción, no dos que puedan
 * desalinearse.
 */

import { toISODate } from './ciclo.js';

/**
 * Busca la tarjeta que termina en esos 4 dígitos.
 * @returns {{tarjetaId: string, numero: string}|null}
 */
export function matchTarjetaPorTerminacion(terminacion, tarjetas) {
  const digits = (terminacion || '').replace(/\D/g, '');
  if (!digits) return null; // incluye 'NA' y "PP" (PayPal/cuenta), que no matchean ninguna tarjeta
  // Solo crédito: los selectores de De Contado y A Plazos únicamente listan
  // tarjetas de crédito, así que casar con una de débito daría un tarjetaId
  // sin opción correspondiente y el campo quedaría vacío sin explicación.
  const coincidencias = [];
  for (const t of tarjetas.filter(x => !x.oculta && x.tipo === 'credito')) {
    (Array.isArray(t.numeros) ? t.numeros : []).forEach(n => {
      if (n.numero && String(n.numero).replace(/\D/g, '').slice(-4) === digits)
        coincidencias.push({ tarjetaId: t.id, numero: n.numero, formato: n.formato });
    });
  }
  if (!coincidencias.length) return null;
  // Con varias coincidencias gana la física: es la que suele aparecer en el
  // cargo del banco, y el orden del array no garantiza cuál viene primero.
  const elegida = coincidencias.find(c => c.formato === 'fisica') || coincidencias[0];
  return { tarjetaId: elegida.tarjetaId, numero: elegida.numero };
}

/**
 * @param {object} raw  { desc, total, fecha, hora, tarjeta, msgId, asunto,
 *                        match, meses?, mensualidad?, articulo?, pedido? }.
 *                        `meses` y `mensualidad` solo vienen en compras a
 *                        plazos; `articulo` y `pedido` solo en Amazon —
 *                        `pedido` no se usa para mostrar nada, solo como señal
 *                        de que la fuente es Amazon (ver `diferido` abajo).
 *                        Los campos que no aplican se omiten, nunca llegan
 *                        vacíos. Los números pueden llegar como string (URL)
 *                        o como number (Firestore).
 * @returns {'duplicado'|null|{tipo: 'contado'|'msi', datos: object}}
 */
export function prefillDesdeDatos(raw, tarjetas, contadoItems, msiItems) {
  const total = parseFloat(raw.total);
  if (!raw.desc || !Number.isFinite(total)) return null;
  // El artículo (solo Amazon) distingue pedidos que si no compartirían la
  // misma descripción cruda: los tres quedarían como "Amazon" a secas.
  const desc = raw.articulo ? `${raw.desc} ${raw.articulo}` : raw.desc;

  // El tipo lo decide la PRESENCIA de `meses`, no un campo aparte
  const meses = parseInt(raw.meses, 10);
  const esMsi = raw.meses != null && raw.meses !== '' && Number.isFinite(meses) && meses > 0;

  // El msgId se busca en las DOS colecciones: desde el modal se puede cambiar
  // de contado a plazos, así que pudo guardarse en cualquiera de las dos.
  const msgId = raw.msgId || '';
  if (msgId && [...contadoItems, ...msiItems].some(c => c.msgId === msgId)) return 'duplicado';

  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(raw.fecha || '') ? raw.fecha : toISODate(new Date());
  const hora  = /^\d{2}:\d{2}$/.test(raw.hora || '') ? raw.hora : '';
  // `tarjeta` llega como 'NA' cuando el correo no revela la terminación
  const match = matchTarjetaPorTerminacion(raw.tarjeta, tarjetas);

  const datos = {
    compra: desc,
    total,
    fechaCompra: hora ? `${fecha}T${hora}:00` : fecha,
    // La hora va aparte porque la fuente puede traer 12:00 como hora real, y
    // en el resto de la app mediodía es el centinela de "sin hora capturada":
    // deducirla del datetime la perdería justo en ese caso.
    ...(hora ? { hora } : {}),
    tarjetaId: match?.tarjetaId || '',
    numeroTarjeta: match?.numero || '',
    ...(msgId ? { msgId } : {}),
    // Amazon confirma al ordenar, no al cobrar, y el cargo real puede tardar
    // días: se preselecciona "Pagos diferidos" para no inflar de inmediato el
    // saldo usado con un cargo que todavía no llega al estado de cuenta.
    ...(raw.pedido ? { diferido: true } : {}),
  };
  if (esMsi) {
    datos.mesesTotal = meses;
    // La mensualidad real del banco manda: puede no ser exactamente total/meses
    const mensualidad = parseFloat(raw.mensualidad);
    if (Number.isFinite(mensualidad)) datos.mensualidad = mensualidad;
  }
  return { tipo: esMsi ? 'msi' : 'contado', datos };
}
