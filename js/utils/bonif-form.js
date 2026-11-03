/**
 * Sección "Esperar bonificación / cashback" de los modales de compra (De Contado,
 * A Plazos y Registro Rápido). Dos modos:
 *  - Manual: los campos de siempre, guardados en `compra.bonificacion`.
 *  - Ligada: elige una bonificación de la institución de la tarjeta (módulo
 *    Bonificaciones) y se guarda `compra.bonificacionId`. Si esa bonificación
 *    valida el mínimo por compra, también se elige el folio de orden
 *    (`compra.folioOrden`): uno existente o "Nuevo", que se genera al guardar.
 *
 * Uso: `bonifFieldsHTML(item)` dentro del <form>, `wireBonifFields(formId, item, tipo)`
 * después de abrir el modal (`tipo`: 'contado'|'msi', según el modal) y
 * `await saveBonif(data)` al guardar.
 */
import { getAll } from './db.js';
import { currency, fmtDate } from './formatters.js';
import { toISODate } from './ciclo.js';
import { generarFolio, reglaBonificacion, estadoBonificacion, baseCompra, aplicaBonificacion } from './bonificaciones.js';

const NUEVO = '__nuevo__';

// Contexto del modal abierto (solo hay uno a la vez).
let _ctxPromise = null;

function _cargarContexto() {
  return Promise.all([getAll('bonificaciones'), getAll('contado'), getAll('msi'), getAll('instituciones'), getAll('tarjetas')])
    .then(([bonificaciones, contado, msi, instituciones, tarjetas]) => ({
      bonificaciones, instituciones, tarjetas,
      ligadas: [...contado, ...msi].filter(c => c.bonificacionId),
    }));
}

export function bonifFieldsHTML(item) {
  const b = item?.bonificacion;
  const tiene = !!(b || item?.bonificacionId);
  return `
    <div class="col-12">
      <div class="form-check mb-1">
        <input class="form-check-input" type="checkbox" id="has-bonif" ${tiene ? 'checked' : ''}>
        <label class="form-check-label" for="has-bonif" style="font-size:0.85rem">Esperar bonificación / cashback</label>
      </div>
      <div id="bonif-fields" ${tiene ? '' : 'style="display:none"'}>
        <div id="bonif-modo-wrap" class="mb-2" style="display:none">
          <div class="btn-group btn-group-sm w-100" role="group">
            <input type="radio" class="btn-check" name="bonifModo" id="bonif-modo-ligada" value="ligada">
            <label class="btn btn-outline-primary" for="bonif-modo-ligada"><i class="bi bi-link-45deg me-1"></i>Bonificación de la institución</label>
            <input type="radio" class="btn-check" name="bonifModo" id="bonif-modo-manual" value="manual">
            <label class="btn btn-outline-primary" for="bonif-modo-manual"><i class="bi bi-pencil me-1"></i>Manual</label>
          </div>
        </div>
        <div id="bonif-ligada-campos" style="display:none">
          <div id="bonif-sel-wrap" class="mb-2"></div>
          <div id="bonif-folio-wrap"></div>
        </div>
        <div id="bonif-manual-campos">
          <div class="row g-2">
            <div class="col-4">
              <select class="form-select form-select-sm" name="bonificacionTipo">
                <option value="porcentaje" ${(!b || b.tipo === 'porcentaje') ? 'selected' : ''}>% Porcentaje</option>
                <option value="cantidad"   ${b?.tipo === 'cantidad' ? 'selected' : ''}>$ Cantidad</option>
              </select>
            </div>
            <div class="col-4">
              <input type="number" class="form-control form-control-sm" name="bonificacionValor"
                     value="${b?.valor ?? ''}" min="0" step="0.01" placeholder="Valor">
            </div>
            <div class="col-4">
              <input type="date" class="form-control form-control-sm" name="bonificacionFecha"
                     value="${b?.fechaMaxima ?? ''}">
            </div>
            <div class="col-12">
              <input type="url" class="form-control form-control-sm" name="bonificacionEnlace"
                     value="${b?.enlace ?? ''}" placeholder="Enlace de la promoción (opcional)">
            </div>
            <div class="col-12">
              <div class="form-check">
                <input class="form-check-input" type="checkbox" name="bonificacionAplicada" id="bonif-aplicada" ${b?.aplicada ? 'checked' : ''}>
                <label class="form-check-label text-success" for="bonif-aplicada" style="font-size:0.82rem">Ya recibida / aplicada</label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

export function wireBonifFields(formId, item, tipo = 'contado') {
  const form = document.getElementById(formId);
  const chk  = document.getElementById('has-bonif');
  const flds = document.getElementById('bonif-fields');
  chk?.addEventListener('change', () => { flds.style.display = chk.checked ? '' : 'none'; });

  _ctxPromise = _cargarContexto();
  // Modo elegido por el usuario; null = el que corresponda a `item` / la tarjeta.
  let modo = item?.bonificacionId ? 'ligada' : item?.bonificacion ? 'manual' : null;
  let seleccionId = item?.bonificacionId || null;

  const pintar = ctx => {
    const tarjetaId = (form?.querySelector('[name="tarjetaId"]')?.value || '').split('::')[0];
    const tc    = ctx.tarjetas.find(t => t.id === tarjetaId);
    const hoy   = toISODate(new Date());
    const meses = tipo === 'msi' ? (Number(form?.querySelector('[name="mesesTotal"]')?.value) || null) : null;
    const disponibles = ctx.bonificaciones
      .filter(b => tc && b.institucionId === tc.institucionId && (!b.aplicada || b.id === item?.bonificacionId) && aplicaBonificacion(b, tipo, meses))
      .sort((a, b) => (b.fechaMaxima || '').localeCompare(a.fechaMaxima || ''));

    const modoWrap = document.getElementById('bonif-modo-wrap');
    const ligada   = document.getElementById('bonif-ligada-campos');
    const manual   = document.getElementById('bonif-manual-campos');
    if (!modoWrap) return; // el modal ya se cerró

    if (!disponibles.length) {
      modoWrap.style.display = 'none';
      ligada.style.display   = 'none';
      manual.style.display   = '';
      return;
    }
    const modoEfectivo = modo || 'ligada';
    modoWrap.style.display = '';
    document.getElementById('bonif-modo-ligada').checked = modoEfectivo === 'ligada';
    document.getElementById('bonif-modo-manual').checked = modoEfectivo === 'manual';
    ligada.style.display = modoEfectivo === 'ligada' ? '' : 'none';
    manual.style.display = modoEfectivo === 'manual' ? '' : 'none';

    if (!disponibles.some(b => b.id === seleccionId)) seleccionId = disponibles[0].id;
    const sel = disponibles.find(b => b.id === seleccionId);
    const estado = estadoBonificacion(sel, hoy);
    const detalle = `
      <div class="form-text mt-1">
        ${reglaBonificacion(sel, currency)} · vence ${fmtDate(sel.fechaMaxima)}${estado === 'vencida' ? ' <span class="text-danger">(vencida)</span>' : ''}
        ${sel.enlace ? ` · <a href="${sel.enlace}" target="_blank" rel="noopener">Promoción</a>` : ''}
        ${sel.enlaceTyc ? ` · <a href="${sel.enlaceTyc}" target="_blank" rel="noopener">TyCs</a>` : ''}
      </div>`;
    document.getElementById('bonif-sel-wrap').innerHTML = disponibles.length > 1
      ? `<select class="form-select form-select-sm" name="bonificacionId" id="bonif-sel">
           ${disponibles.map(b => `<option value="${b.id}" ${b.id === seleccionId ? 'selected' : ''}>${b.nombre}</option>`).join('')}
         </select>${detalle}`
      : `<input type="hidden" name="bonificacionId" value="${sel.id}">
         <div class="fw-500" style="font-size:0.9rem"><i class="bi bi-gift me-1 text-success"></i>${sel.nombre}</div>${detalle}`;

    // Folio de orden: solo cuando el mínimo se valida por compra.
    const folioWrap = document.getElementById('bonif-folio-wrap');
    if (sel.minimoPor === 'acumulado') { folioWrap.innerHTML = ''; return; }
    const porFolio = new Map();
    ctx.ligadas
      .filter(c => c.bonificacionId === sel.id && c.folioOrden && c.id !== item?.id)
      .forEach(c => {
        const f = porFolio.get(c.folioOrden) || { n: 0, suma: 0 };
        f.n++; f.suma += baseCompra(c);
        porFolio.set(c.folioOrden, f);
      });
    const actual = item?.bonificacionId === sel.id ? item?.folioOrden : null;
    if (actual && !porFolio.has(actual)) porFolio.set(actual, { n: 0, suma: 0 });
    const folios = [...porFolio.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    folioWrap.innerHTML = `
      <label class="form-label mb-1" style="font-size:0.8rem">Folio de orden</label>
      <select class="form-select form-select-sm" name="folioOrden">
        <option value="${NUEVO}" ${!actual ? 'selected' : ''}>Nuevo (se genera al guardar)</option>
        ${folios.map(([folio, f]) => `<option value="${folio}" ${folio === actual ? 'selected' : ''}>${folio}${f.n ? ` · ${f.n} compra${f.n !== 1 ? 's' : ''} · ${currency(f.suma)}` : ''}</option>`).join('')}
      </select>
      <div class="form-text">Las compras con el mismo folio son una sola orden: se suman para validar el mínimo por compra.</div>`;
  };

  _ctxPromise.then(ctx => {
    pintar(ctx);
    form?.querySelector('[name="tarjetaId"]')?.addEventListener('change', () => pintar(ctx));
    if (tipo === 'msi') form?.querySelector('[name="mesesTotal"]')?.addEventListener('input', () => pintar(ctx));
    document.getElementById('bonif-modo-ligada')?.addEventListener('change', () => { modo = 'ligada'; pintar(ctx); });
    document.getElementById('bonif-modo-manual')?.addEventListener('change', () => { modo = 'manual'; pintar(ctx); });
    document.getElementById('bonif-sel-wrap')?.addEventListener('change', e => {
      if (e.target.id === 'bonif-sel') { seleccionId = e.target.value; pintar(ctx); }
    });
  }).catch(() => { /* sin bonificaciones cargadas: queda solo el modo manual */ });
}

/**
 * Traduce lo capturado a la compra: `bonificacion` (manual), o `bonificacionId` +
 * `folioOrden` (ligada); el modo que no aplica queda en null. Genera el folio si
 * se eligió "Nuevo". Necesita `data.fechaCompra` ya armada.
 */
export async function saveBonif(data) {
  const modo      = data.bonifModo;
  const bonifId   = data.bonificacionId;
  const folio     = data.folioOrden;
  const tipo      = data.bonificacionTipo;
  const valor     = Number(data.bonificacionValor);
  const fecha     = data.bonificacionFecha;
  const enlace    = data.bonificacionEnlace || '';
  const aplicada  = !!data.bonificacionAplicada;
  ['bonifModo', 'bonificacionId', 'folioOrden', 'bonificacionTipo', 'bonificacionValor',
   'bonificacionFecha', 'bonificacionEnlace', 'bonificacionAplicada'].forEach(k => delete data[k]);

  data.bonificacion   = null;
  data.bonificacionId = null;
  data.folioOrden     = null;
  if (!document.getElementById('has-bonif')?.checked) return;

  if (modo === 'ligada' && bonifId) {
    data.bonificacionId = bonifId;
    const ctx   = await (_ctxPromise || _cargarContexto());
    const bonif = ctx.bonificaciones.find(b => b.id === bonifId);
    if (bonif?.minimoPor !== 'acumulado') {
      if (folio && folio !== NUEVO) {
        data.folioOrden = folio;
      } else {
        const inst = ctx.instituciones.find(i => i.id === bonif?.institucionId);
        data.folioOrden = generarFolio(inst?.nombre, data.fechaCompra || toISODate(new Date()), ctx.ligadas);
      }
    }
    return;
  }

  if (valor > 0 && fecha) {
    data.bonificacion = {
      tipo, valor, fechaMaxima: fecha,
      ...(enlace   ? { enlace }   : {}),
      ...(aplicada ? { aplicada } : {}),
    };
  }
}
