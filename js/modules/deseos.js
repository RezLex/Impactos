import { getAll, create, update, remove } from '../utils/db.js';
import { currency, fmtDate } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import { toISODate } from '../utils/ciclo.js';
import {
  nuevoIdOpcion, variacionPct, registrarPrecio, historialConVariacion, ultimaVariacion, mejorOpcion,
  editarHistorial, eliminarHistorial,
} from '../utils/deseos.js';
import { calcularPlan, evaluarCupon, opcionDeItem, conDatosDeLista, mesesPermitidos } from '../utils/planes.js';
import { tarjetasSeleccionables } from '../utils/tarjetas.js';
import { reglaBonificacion, estadoBonificacion, aplicaBonificacion, MESES_COMUNES } from '../utils/bonificaciones.js';

const COL = 'deseos';
const COL_PLANES = 'planesCompra';
const COL_CUPONES = 'cuponesPlan';

// Se recuerda entre navegaciones dentro de la sesión.
let tabActivo = 'lista';

/** "+4.8%" en rojo si subió, verde si bajó (mismo criterio que la variación del inventario). */
function variacionHTML(pct) {
  if (pct == null) return '<span class="text-muted">—</span>';
  const cls = pct > 0.05 ? 'text-danger' : pct < -0.05 ? 'text-success' : 'text-muted';
  return `<span class="${cls} fw-bold">${pct > 0 ? '+' : ''}${pct.toFixed(1)}%</span>`;
}

export async function render(container) {
  await renderView(container);
}

async function renderView(container) {
  try {
    const [deseosRaw, planesRaw, tarjetas, instituciones, bonificaciones, cuponesRaw] = await Promise.all([
      getAll(COL), getAll(COL_PLANES), getAll('tarjetas'), getAll('instituciones'), getAll('bonificaciones'), getAll(COL_CUPONES),
    ]);
    const cupones = cuponesRaw.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    const deseos = deseosRaw.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    const planes = planesRaw.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    const tiendas = [...new Set([
      ...deseos.flatMap(d => (d.opciones || []).map(o => o.tienda)),
      ...planes.flatMap(p => (p.items || []).map(i => i.tienda)),
    ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

    const subtitulo = {
      lista:  `${deseos.length} artículo${deseos.length !== 1 ? 's' : ''} deseado${deseos.length !== 1 ? 's' : ''}`,
      planes: `${planes.length} plan${planes.length !== 1 ? 'es' : ''} de compra`,
    };
    const boton = { lista: 'Nuevo Deseo', planes: 'Nuevo Plan' };

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Deseos</h2>
          <p id="deseos-subtitle">${subtitulo[tabActivo]}</p>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-outline-primary btn-sm ${tabActivo === 'planes' ? '' : 'd-none'}" id="btn-cupones">
            <i class="bi bi-ticket-perforated me-1"></i>Cupones
          </button>
          <button class="btn btn-primary btn-sm" id="btn-nuevo-deseo">
            <i class="bi bi-plus-lg me-1"></i><span id="btn-nuevo-deseo-label">${boton[tabActivo]}</span>
          </button>
        </div>
      </div>
      <ul class="nav nav-tabs mb-3" id="deseos-tabs">
        <li class="nav-item"><button class="nav-link ${tabActivo === 'lista'  ? 'active' : ''}" data-tab="lista">Lista</button></li>
        <li class="nav-item"><button class="nav-link ${tabActivo === 'planes' ? 'active' : ''}" data-tab="planes">Planes</button></li>
      </ul>
      <div id="deseos-tab-content"></div>`;

    // Recarga desde Firestore conservando el scroll (tras guardar desde un modal).
    const recargar = () => {
      const y = window.scrollY;
      return renderView(container).then(() => window.scrollTo(0, y));
    };

    const ctx = { deseos, planes, cupones, tiendas, tarjetas, instituciones, bonificaciones, recargar };
    const pintarTab = () => {
      document.querySelectorAll('#deseos-tabs .nav-link').forEach(b => b.classList.toggle('active', b.dataset.tab === tabActivo));
      document.getElementById('deseos-subtitle').textContent = subtitulo[tabActivo];
      document.getElementById('btn-nuevo-deseo-label').textContent = boton[tabActivo];
      document.getElementById('btn-cupones').classList.toggle('d-none', tabActivo !== 'planes');
      if (tabActivo === 'planes') renderPlanes(ctx);
      else                        renderLista(ctx);
    };
    pintarTab();

    document.getElementById('deseos-tabs').addEventListener('click', e => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      tabActivo = btn.dataset.tab;
      pintarTab();
    });
    document.getElementById('btn-nuevo-deseo').addEventListener('click', () => {
      if (tabActivo === 'planes') nuevoPlan(ctx);
      else                        showDeseoModal(null, recargar);
    });
    document.getElementById('btn-cupones').addEventListener('click', () => abrirCupones(ctx));
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

// ── Tab Lista ─────────────────────────────────────────────────────────────────

function renderLista({ deseos, tiendas, recargar }) {
  const content = document.getElementById('deseos-tab-content');
  content.innerHTML = deseos.length === 0
    ? `<div class="empty-state"><i class="bi bi-stars"></i><p>Sin artículos deseados.<br>Agrega uno y registra en qué tiendas lo encuentras.</p></div>`
    : deseos.map(renderDeseo).join('');

  const deseoDe = el => deseos.find(d => d.id === el.closest('[data-deseo]').dataset.deseo);
  const opcionDe = (d, el) => (d.opciones || []).find(o => o.id === el.dataset.opcion);
  const on = (sel, fn) => content.querySelectorAll(sel).forEach(btn => btn.addEventListener('click', () => fn(btn)));

  on('.btn-edit-deseo', btn => showDeseoModal(deseoDe(btn), recargar));
  on('.btn-del-deseo', async btn => {
    const d = deseoDe(btn);
    if (!confirmDelete(d.nombre)) return;
    try {
      await remove(COL, d.id);
      toast('Deseo eliminado');
      recargar();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
  on('.btn-add-opcion', btn => showOpcionModal(deseoDe(btn), null, tiendas, recargar));
  on('.btn-edit-opcion', btn => { const d = deseoDe(btn); showOpcionModal(d, opcionDe(d, btn), tiendas, recargar); });
  on('.btn-precio-opcion', btn => { const d = deseoDe(btn); showPrecioModal(d, opcionDe(d, btn), recargar); });
  on('.btn-historial-opcion', btn => { const d = deseoDe(btn); showHistorialModal(d, opcionDe(d, btn), recargar); });
  on('.btn-del-opcion', async btn => {
    const d = deseoDe(btn);
    const o = opcionDe(d, btn);
    if (!confirmDelete(o.tienda || 'esta opción')) return;
    try {
      await update(COL, d.id, { opciones: (d.opciones || []).filter(x => x.id !== o.id) });
      toast('Opción eliminada');
      recargar();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

function renderDeseo(d) {
  const opciones = [...(d.opciones || [])].sort((a, b) => (Number(a.precio) || 0) - (Number(b.precio) || 0));
  const mejor = mejorOpcion(opciones);

  const filas = opciones.map(o => {
    const h = o.historial || [];
    const ultimo = h[h.length - 1];
    const anterior = h[h.length - 2];
    return `<tr>
      <td>
        <span class="fw-500">${o.tienda || '—'}</span>
        ${o.tipoPago === 'msi' ? `<span class="badge bg-primary-subtle text-primary ms-1">MSI ${o.meses || '—'}m</span>` : ''}
        ${mejor && o.id === mejor.id && opciones.length > 1 ? '<span class="badge bg-success-subtle text-success ms-1">Mejor precio</span>' : ''}
      </td>
      <td class="text-end fw-bold">${currency(o.precio)}</td>
      <td class="text-end">
        ${variacionHTML(ultimaVariacion(o))}
        ${anterior ? `<br><small class="text-muted">antes ${currency(anterior.precio)}</small>` : ''}
      </td>
      <td style="white-space:nowrap">${ultimo?.fecha ? fmtDate(ultimo.fecha) : '—'}</td>
      <td>${o.enlace ? `<a href="${o.enlace}" target="_blank" rel="noopener" title="Abrir enlace"><i class="bi bi-box-arrow-up-right"></i></a>` : '—'}</td>
      <td>
        <div class="d-flex gap-1 justify-content-end">
          <button class="btn-icon btn-precio-opcion" data-opcion="${o.id}" title="Actualizar precio"><i class="bi bi-currency-dollar"></i></button>
          <button class="btn-icon btn-historial-opcion" data-opcion="${o.id}" title="Historial de precios (${h.length})"><i class="bi bi-clock-history"></i></button>
          <button class="btn-icon btn-edit-opcion" data-opcion="${o.id}" title="Editar opción"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger btn-del-opcion" data-opcion="${o.id}" title="Eliminar opción"><i class="bi bi-trash3"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');

  return `
    <div class="data-card" data-deseo="${d.id}">
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 p-3">
        <div>
          <div class="fw-bold"><i class="bi bi-stars me-1 text-warning"></i>${d.nombre}</div>
          ${d.notas ? `<small class="text-muted d-block">${d.notas}</small>` : ''}
          <small class="text-muted">
            ${opciones.length} opci${opciones.length !== 1 ? 'ones' : 'ón'}${mejor ? ` · Mejor precio <strong class="text-success">${currency(mejor.precio)}</strong> en ${mejor.tienda || '—'}` : ''}
          </small>
        </div>
        <div class="d-flex gap-1">
          <button class="btn btn-outline-primary btn-sm btn-add-opcion"><i class="bi bi-plus-lg me-1"></i>Opción</button>
          <button class="btn-icon btn-edit-deseo" title="Editar deseo"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger btn-del-deseo" title="Eliminar deseo"><i class="bi bi-trash3"></i></button>
        </div>
      </div>
      ${opciones.length === 0
        ? `<div class="px-3 pb-3 text-muted" style="font-size:0.85rem">Sin opciones. Agrega la tienda, precio y enlace donde lo encontraste.</div>`
        : `<div class="table-wrapper">
            <table class="table mb-0">
              <thead><tr>
                <th>Tienda</th><th class="text-end">Precio</th><th class="text-end">Variación</th>
                <th>Actualizado</th><th>Enlace</th><th></th>
              </tr></thead>
              <tbody>${filas}</tbody>
            </table>
          </div>`}
    </div>`;
}

// ── Modales ───────────────────────────────────────────────────────────────────

function showDeseoModal(deseo, onSaved) {
  const isEdit = !!deseo;
  openModal({
    title: isEdit ? 'Editar Deseo' : 'Nuevo Deseo',
    body: `
      <form id="deseo-form">
        <div class="mb-3">
          <label class="form-label">Artículo *</label>
          <input type="text" class="form-control" name="nombre" value="${deseo?.nombre || ''}" required placeholder="Ej: Audífonos inalámbricos">
        </div>
        <div class="mb-1">
          <label class="form-label">Notas</label>
          <textarea class="form-control" name="notas" rows="2" placeholder="Opcional: modelo, color, características…">${deseo?.notas || ''}</textarea>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-deseo">${isEdit ? 'Guardar' : 'Crear'}</button>`,
  });

  document.getElementById('btn-save-deseo').addEventListener('click', async () => {
    const form = document.getElementById('deseo-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw = Object.fromEntries(new FormData(form));
    const data = { nombre: raw.nombre.trim(), notas: (raw.notas || '').trim() };
    try {
      if (isEdit) await update(COL, deseo.id, data);
      else        await create(COL, { ...data, opciones: [] });
      closeModal();
      toast(isEdit ? 'Deseo actualizado' : 'Deseo creado');
      onSaved?.();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

/**
 * Alta / edición de una opción. Si el precio cambia, se registra en el historial
 * con la fecha capturada (por defecto hoy).
 */
function showOpcionModal(deseo, opcion, tiendas, onSaved) {
  const isEdit = !!opcion;
  const hoy = toISODate(new Date());
  openModal({
    title: `${deseo.nombre} — ${isEdit ? 'Editar opción' : 'Nueva opción'}`,
    body: `
      <form id="opcion-form">
        <div class="mb-3">
          <label class="form-label">Tienda *</label>
          <input type="text" class="form-control" name="tienda" list="tiendas-datalist" value="${opcion?.tienda || ''}" required placeholder="Ej: Amazon">
          <datalist id="tiendas-datalist">${tiendas.map(t => `<option value="${t}">`).join('')}</datalist>
        </div>
        <div class="row g-2">
          <div class="col-6 mb-3">
            <label class="form-label">Precio *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="precio" value="${opcion?.precio ?? ''}" required min="0" step="0.01">
            </div>
          </div>
          <div class="col-6 mb-3">
            <label class="form-label">Fecha del precio</label>
            <input type="date" class="form-control" name="fecha" value="${hoy}" required>
            ${isEdit ? '<div class="form-text">Solo se usa si cambias el precio.</div>' : ''}
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label">Enlace</label>
          <input type="url" class="form-control" name="enlace" value="${opcion?.enlace || ''}" placeholder="https://...">
        </div>
        <div class="row g-2">
          <div class="col-6 mb-1">
            <label class="form-label">Forma de pago</label>
            <select class="form-select" name="tipoPago" id="opcion-tipo-pago">
              <option value="contado" ${opcion?.tipoPago !== 'msi' ? 'selected' : ''}>De Contado</option>
              <option value="msi"     ${opcion?.tipoPago === 'msi' ? 'selected' : ''}>A Plazos (MSI)</option>
            </select>
          </div>
          <div class="col-6 mb-1" id="opcion-meses-wrap" style="${opcion?.tipoPago === 'msi' ? '' : 'display:none'}">
            <label class="form-label">Meses</label>
            <select class="form-select" name="meses">
              ${MESES_COMUNES.map(m => `<option value="${m}" ${Number(opcion?.meses) === m ? 'selected' : ''}>${m} meses</option>`).join('')}
            </select>
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-opcion">${isEdit ? 'Guardar' : 'Agregar'}</button>`,
  });

  document.getElementById('opcion-tipo-pago').addEventListener('change', e =>
    document.getElementById('opcion-meses-wrap').style.display = e.target.value === 'msi' ? '' : 'none');

  document.getElementById('btn-save-opcion').addEventListener('click', async () => {
    const form = document.getElementById('opcion-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw = Object.fromEntries(new FormData(form));
    const esMsi = raw.tipoPago === 'msi';
    const base = {
      ...(opcion || { id: nuevoIdOpcion(), historial: [] }),
      tienda: raw.tienda.trim(), enlace: raw.enlace || '',
      tipoPago: esMsi ? 'msi' : 'contado', meses: esMsi ? Number(raw.meses) || null : null,
    };
    const nueva = registrarPrecio(base, raw.precio, raw.fecha);
    const opciones = isEdit
      ? (deseo.opciones || []).map(o => o.id === opcion.id ? nueva : o)
      : [...(deseo.opciones || []), nueva];
    await guardarOpciones(deseo, opciones, isEdit ? 'Opción actualizada' : 'Opción agregada', onSaved);
  });
}

/** Captura rápida de un precio nuevo para la opción, con vista previa de la variación. */
function showPrecioModal(deseo, opcion, onSaved) {
  const hoy = toISODate(new Date());
  openModal({
    title: `${deseo.nombre} — ${opcion.tienda}`,
    body: `
      <form id="precio-form">
        <div class="row g-2">
          <div class="col-6 mb-2">
            <label class="form-label">Precio nuevo *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="precio" id="input-precio-nuevo" value="${opcion.precio ?? ''}" required min="0" step="0.01">
            </div>
          </div>
          <div class="col-6 mb-2">
            <label class="form-label">Fecha *</label>
            <input type="date" class="form-control" name="fecha" value="${hoy}" required>
          </div>
        </div>
        <div id="preview-variacion" class="alert alert-secondary py-2 mb-0" style="font-size:0.85rem"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-precio">Registrar</button>`,
  });

  const input = document.getElementById('input-precio-nuevo');
  const preview = () => {
    const nuevo = Number(input.value);
    const pct = variacionPct(opcion.precio, nuevo);
    document.getElementById('preview-variacion').innerHTML = !input.value || nuevo === Number(opcion.precio)
      ? `Precio actual: <strong>${currency(opcion.precio)}</strong> · sin cambio, no se agrega al historial`
      : `Actual ${currency(opcion.precio)} → <strong>${currency(nuevo)}</strong> ${variacionHTML(pct)}`;
  };
  input.addEventListener('input', preview);
  preview();
  input.select();

  document.getElementById('btn-save-precio').addEventListener('click', async () => {
    const form = document.getElementById('precio-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw = Object.fromEntries(new FormData(form));
    if (Number(raw.precio) === Number(opcion.precio)) { closeModal(); return; }
    const nueva = registrarPrecio(opcion, raw.precio, raw.fecha);
    const opciones = (deseo.opciones || []).map(o => o.id === opcion.id ? nueva : o);
    await guardarOpciones(deseo, opciones, 'Precio registrado', onSaved);
  });
}

/**
 * Historial de precios de una opción, con edición en línea (fecha y precio) y
 * eliminación de entradas. Cada cambio se guarda al momento y repinta el modal sin
 * cerrarlo; el precio vigente de la opción queda siempre en el de la entrada más
 * reciente (ver editarHistorial / eliminarHistorial).
 */
function showHistorialModal(deseo, opcion, onSaved) {
  let actual = opcion;
  let editando = null; // idx de la entrada en edición
  openModal({
    title: `${deseo.nombre} — ${opcion.tienda}`,
    body: '<div id="historial-body"></div>',
  });
  const cont = document.getElementById('historial-body');

  const guardar = async (nueva, mensaje) => {
    const opciones = (deseo.opciones || []).map(o => o.id === actual.id ? nueva : o);
    try {
      await update(COL, deseo.id, { opciones });
      deseo = { ...deseo, opciones };
      actual = nueva;
      editando = null;
      toast(mensaje);
      pintar();
      onSaved?.();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  };

  const pintar = () => {
    const filas = historialConVariacion(actual.historial);
    const unica = filas.length <= 1;
    cont.innerHTML = filas.length === 0
      ? '<p class="text-muted mb-0">Sin precios registrados.</p>'
      : `<div class="table-wrapper">
          <table class="table mb-0">
            <thead><tr><th>Fecha</th><th class="text-end">Precio</th><th class="text-end">Variación</th><th></th></tr></thead>
            <tbody>
              ${filas.map((h, i) => h.idx === editando
                ? `<tr>
                    <td><input type="date" class="form-control form-control-sm" id="hist-fecha" value="${String(h.fecha || '').slice(0, 10)}" required></td>
                    <td><input type="number" class="form-control form-control-sm text-end" id="hist-precio" value="${h.precio}" min="0" step="0.01" required style="min-width:100px"></td>
                    <td class="text-end text-muted">—</td>
                    <td>
                      <div class="d-flex gap-1 justify-content-end">
                        <button class="btn-icon btn-hist-guardar" title="Guardar"><i class="bi bi-check-lg"></i></button>
                        <button class="btn-icon btn-hist-cancelar" title="Cancelar"><i class="bi bi-x-lg"></i></button>
                      </div>
                    </td>
                  </tr>`
                : `<tr>
                    <td style="white-space:nowrap">${fmtDate(h.fecha)}${i === 0 ? ' <span class="badge bg-primary-subtle text-primary ms-1">Actual</span>' : ''}</td>
                    <td class="text-end fw-bold">${currency(h.precio)}</td>
                    <td class="text-end">${variacionHTML(h.variacion)}</td>
                    <td>
                      <div class="d-flex gap-1 justify-content-end">
                        <button class="btn-icon btn-hist-editar" data-idx="${h.idx}" title="Editar" ${editando != null ? 'disabled' : ''}><i class="bi bi-pencil"></i></button>
                        <button class="btn-icon danger btn-hist-eliminar" data-idx="${h.idx}" ${unica || editando != null ? 'disabled' : ''}
                                title="${unica ? 'La opción necesita al menos un precio' : 'Eliminar'}"><i class="bi bi-trash3"></i></button>
                      </div>
                    </td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="form-text mt-2">El precio vigente de la opción es siempre el del registro más reciente.</div>`;

    cont.querySelectorAll('.btn-hist-editar').forEach(btn => btn.addEventListener('click', () => {
      editando = Number(btn.dataset.idx);
      pintar();
      document.getElementById('hist-precio')?.select();
    }));
    cont.querySelector('.btn-hist-cancelar')?.addEventListener('click', () => { editando = null; pintar(); });
    cont.querySelector('.btn-hist-guardar')?.addEventListener('click', () => {
      const fecha  = document.getElementById('hist-fecha');
      const precio = document.getElementById('hist-precio');
      if (!fecha.checkValidity()) { fecha.reportValidity(); return; }
      if (!precio.checkValidity() || precio.value === '') { precio.reportValidity(); return; }
      guardar(editarHistorial(actual, editando, { fecha: fecha.value, precio: precio.value }), 'Precio actualizado');
    });
    cont.querySelectorAll('.btn-hist-eliminar').forEach(btn => btn.addEventListener('click', () => {
      const h = actual.historial[Number(btn.dataset.idx)];
      if (!confirm(`¿Eliminar el precio de ${currency(h.precio)} del ${fmtDate(h.fecha)}?`)) return;
      guardar(eliminarHistorial(actual, Number(btn.dataset.idx)), 'Precio eliminado del historial');
    }));
  };
  pintar();
}

async function guardarOpciones(deseo, opciones, mensaje, onSaved) {
  try {
    await update(COL, deseo.id, { opciones });
    closeModal();
    toast(mensaje);
    onSaved?.();
  } catch (e) { toast('Error: ' + e.message, 'danger'); }
}

// ── Tab Planes ────────────────────────────────────────────────────────────────
// Planes de compra para comparar: solo planeación, sin relación con Compras ni
// Impacto. Cada item es un registro propio del plan (ver utils/planes.js).
//
// Se edita un plan a la vez (selector) sobre un BORRADOR: los cambios en la tabla
// no se guardan hasta "Guardar"; "Guardar como nuevo plan" crea otro plan con el
// borrador y deja intacto el original. El borrador vive en el módulo, así que
// sobrevive a cambiar de pestaña y a las recargas tras administrar cupones.

const ORIGEN_BADGE = {
  lista:         '<span class="badge bg-warning-subtle text-warning-emphasis" title="Tomado de la tab Lista">Lista</span>',
  personalizado: '<span class="badge bg-secondary-subtle text-secondary-emphasis" title="Artículo propio del plan">Personalizado</span>',
};

let planSelId = null;   // plan elegido en el selector (null = plan nuevo sin guardar)
let borrador  = null;   // { id|null, nombre, notas, items, cupones } — copia editable
let sucio     = false;  // hay cambios sin guardar en el borrador

const copiarPlan = p => ({
  id: p.id, nombre: p.nombre || '', notas: p.notas || '',
  items: (p.items || []).map(i => ({ ...i })),
  cupones: { ...(p.cupones || {}) },
});
const planVacio = n => ({ id: null, nombre: `Plan ${n}`, notas: '', items: [], cupones: {} });

/** Botón "Nuevo Plan" del encabezado: abre una tabla vacía (no se guarda hasta "Guardar"). */
function nuevoPlan(ctx) {
  if (sucio && !confirm('Hay cambios sin guardar en el plan actual. ¿Descartarlos?')) return;
  planSelId = null;
  borrador  = planVacio(ctx.planes.length + 1);
  sucio     = false;
  renderPlanes(ctx);
}

function renderPlanes(ctx) {
  const { cupones, tarjetas, instituciones, bonificaciones, deseos, tiendas, recargar } = ctx;
  // Totales y comparativa siempre con el último precio de Lista y el pago dentro de su máximo.
  const planes   = ctx.planes.map(p => conDatosDeLista(p, deseos));
  const instMap  = Object.fromEntries(instituciones.map(i => [i.id, i]));
  const cardMap  = Object.fromEntries(tarjetas.map(t => [t.id, { ...t, inst: instMap[t.institucionId] }]));
  const conIvaDe = instId => !!instMap[instId]?.bonificacionConIva;

  // Borrador: se conserva si tiene cambios o si es un plan nuevo sin guardar; si no,
  // se toma del plan guardado elegido (o del primero, o uno vacío si no hay planes).
  const guardado = planSelId ? planes.find(p => p.id === planSelId) : null;
  if (borrador && (sucio || !borrador.id)) { /* se conserva */ }
  else if (guardado)      borrador = copiarPlan(guardado);
  else if (planes.length) { planSelId = planes[0].id; borrador = copiarPlan(planes[0]); }
  else                    borrador = planVacio(1);
  // No marca cambios sin guardar: los datos de Lista no son una edición del plan.
  borrador = conDatosDeLista(borrador, deseos);
  // Cupones borrados del catálogo dejan de estar asignados.
  const cuponIds = new Set(cupones.map(c => c.id));
  borrador.cupones = Object.fromEntries(Object.entries(borrador.cupones || {}).filter(([, id]) => cuponIds.has(id)));

  const institucionDe = tarjetaId => cardMap[tarjetaId]?.institucionId || null;
  const calculos = new Map(planes.map(p => [p.id, calcularPlan(p, bonificaciones, conIvaDe, cupones, institucionDe)]));
  const calc = calcularPlan(borrador, bonificaciones, conIvaDe, cupones, institucionDe);

  // Comparativa entre planes guardados (clic en una fila para abrirlo).
  const conItems  = planes.filter(p => (p.items || []).length);
  const mejorNeto = conItems.length ? Math.min(...conItems.map(p => calculos.get(p.id).neto)) : null;
  const esMejor   = p => conItems.length > 1 && calculos.get(p.id).neto === mejorNeto;
  const comparativa = conItems.length < 2 ? '' : `
    <div class="data-card">
      <div class="data-card-header"><span><i class="bi bi-bar-chart-steps me-2"></i>Comparativa</span><small class="fw-normal">Planes guardados · clic para abrir</small></div>
      <div class="table-wrapper">
        <table class="table mb-0">
          <thead><tr>
            <th>Plan</th><th class="text-center">Artículos</th><th class="text-end">Subtotal</th>
            <th class="text-end">Cupones</th><th class="text-end">Bonificación</th><th class="text-end">Total</th><th class="text-end">vs. mejor</th>
          </tr></thead>
          <tbody>
            ${[...conItems].sort((a, b) => calculos.get(a.id).neto - calculos.get(b.id).neto).map(p => {
              const c = calculos.get(p.id);
              const dif = c.neto - mejorNeto;
              return `<tr class="${esMejor(p) ? 'table-success' : ''}" data-abrir-plan="${p.id}" style="cursor:pointer">
                <td class="fw-500">${p.id === borrador.id ? '<i class="bi bi-caret-right-fill text-primary me-1"></i>' : ''}${p.nombre}${esMejor(p) ? ' <span class="badge bg-success ms-1">Más conveniente</span>' : ''}${c.advertencias ? ` <i class="bi bi-exclamation-triangle text-warning ms-1" title="${c.advertencias} artículo(s) con una bonificación que no cumple sus condiciones"></i>` : ''}</td>
                <td class="text-center">${(p.items || []).reduce((s, i) => s + (Number(i.cantidad) || 1), 0)}</td>
                <td class="text-end">${currency(c.subtotal)}</td>
                <td class="text-end text-success">${c.cupones ? '−' + currency(c.cupones) : '—'}</td>
                <td class="text-end text-success">${c.bonificacion ? '−' + currency(c.bonificacion) : '—'}</td>
                <td class="text-end fw-bold">${currency(c.neto)}</td>
                <td class="text-end ${dif > 0.005 ? 'text-danger' : 'text-muted'}">${dif > 0.005 ? '+' + currency(dif) : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  const esNuevo = !borrador.id;
  const content = document.getElementById('deseos-tab-content');

  // El tooltip vive en <body>: si su ícono se repinta sin cerrarlo, queda flotando.
  content.querySelectorAll('.aviso-bonif').forEach(el => bootstrap.Tooltip.getInstance(el)?.dispose());

  // Foco a restaurar tras repintar (los cambios repintan la tabla completa).
  const activo = document.activeElement;
  const focoItem  = activo?.closest?.('[data-item]')?.dataset.item;
  const focoClase = activo && [...(activo.classList || [])].find(c => c.startsWith('it-'));

  content.innerHTML = `<div id="planes-root">` + comparativa + `
    <div class="data-card">
      <div class="d-flex flex-wrap gap-2 align-items-center p-3">
        <select class="form-select form-select-sm" id="plan-sel" style="width:auto;max-width:240px" title="Plan">
          ${esNuevo ? '<option value="" selected>— Plan nuevo —</option>' : ''}
          ${planes.map(p => `<option value="${p.id}" ${p.id === borrador.id ? 'selected' : ''}>${p.nombre}</option>`).join('')}
        </select>
        <input type="text" class="form-control form-control-sm" id="plan-nombre" value="${(borrador.nombre || '').replace(/"/g, '&quot;')}"
               placeholder="Nombre del plan" style="width:auto;min-width:180px;max-width:260px" title="Nombre del plan">
        ${esNuevo ? '<span class="badge bg-info-subtle text-info-emphasis">Sin guardar</span>'
          : sucio ? '<span class="badge bg-warning-subtle text-warning-emphasis"><i class="bi bi-pencil me-1"></i>Cambios sin guardar</span>' : ''}
        <div class="ms-auto d-flex flex-wrap gap-1">
          <button class="btn btn-primary btn-sm" id="plan-guardar" ${!esNuevo && !sucio ? 'disabled' : ''}>
            <i class="bi bi-floppy me-1"></i>Guardar
          </button>
          ${esNuevo ? '' : `
          <button class="btn btn-outline-primary btn-sm" id="plan-guardar-nuevo"
                  title="Crea otro plan con estos artículos y los cambios sin guardar; este plan queda como estaba">
            <i class="bi bi-copy me-1"></i>Guardar como nuevo plan
          </button>`}
          <button class="btn btn-outline-secondary btn-sm" id="plan-descartar" ${sucio ? '' : 'disabled'}>Descartar</button>
          ${esNuevo ? '' : '<button class="btn-icon danger" id="plan-eliminar" title="Eliminar plan"><i class="bi bi-trash3"></i></button>'}
        </div>
      </div>
      <div class="px-3 pb-2 text-muted" style="font-size:0.85rem">
        Subtotal ${currency(calc.subtotal)}
        ${calc.cupones ? ` · Cupones <span class="text-success">−${currency(calc.cupones)}</span>` : ''}
        ${calc.bonificacion ? ` · Bonificación <span class="text-success">−${currency(calc.bonificacion)}</span>` : ''}
        · Total <strong class="text-body">${currency(calc.neto)}</strong>
        ${calc.advertencias ? ` <span class="badge bg-warning-subtle text-warning-emphasis" title="Se calcularon, pero no cumplen el mínimo o &quot;Aplica a&quot;"><i class="bi bi-exclamation-triangle me-1"></i>${calc.advertencias} con advertencia</span>` : ''}
        ${calc.porBonificacion.filter(b => b.topado).map(b => ` <span class="badge bg-secondary-subtle text-secondary-emphasis" title="Sin tope serían ${currency(b.sinTope)}">${b.bonif.nombre}: tope ${currency(b.esperado)}</span>`).join('')}
      </div>
      ${tablaPlan(calc, { cardMap, instMap, tarjetas, bonificaciones, deseos, cupones, planes, tiendas })}
    </div>
  </div>`;

  // Los listeners van en #planes-root, que se recrea en cada repintado (en el
  // contenedor de la pestaña se acumularían).
  const root = document.getElementById('planes-root');
  if (focoItem && focoClase) root.querySelector(`[data-item="${focoItem}"] .${focoClase}`)?.focus();

  wirePlanes(ctx, root);
}

/**
 * Bonificaciones del módulo de la institución de la tarjeta (no aplicadas, o la
 * ya asignada) que además apliquen a la forma de pago del item (`tipoPago` /
 * `meses`, igual que al ligar una compra real de Contado o A Plazos).
 */
function bonifsDeTarjeta(tarjetas, bonificaciones, tarjetaId, actualId = null) {
  const tc = tarjetas.find(t => t.id === tarjetaId);
  if (!tc) return [];
  return bonificaciones.filter(b => b.institucionId === tc.institucionId && (!b.aplicada || b.id === actualId));
}

/** ¿La bonificación aplica a la forma de pago del item? En Planes solo genera una advertencia. */
const bonifAplicaAItem = (b, it) => aplicaBonificacion(b, it.tipoPago === 'msi' ? 'msi' : 'contado', it.meses);

function opcionesTarjetaHTML(tarjetas, instMap, sel) {
  const porInst = {};
  tarjetasSeleccionables(tarjetas, sel).forEach(t => { (porInst[t.institucionId || '__'] ||= []).push(t); });
  return `<option value="">Sin tarjeta</option>` + Object.entries(porInst)
    .sort(([a], [b]) => (instMap[a]?.nombre || '').localeCompare(instMap[b]?.nombre || '', 'es'))
    .map(([instId, ts]) => `<optgroup label="${instMap[instId]?.nombre || 'Sin institución'}">
        ${ts.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${t.nombre}</option>`).join('')}
      </optgroup>`).join('');
}

/**
 * Tabla del plan en edición: grupos por tarjeta → tienda (carrito, donde se elige
 * el cupón) → artículos con sus controles. Al final, la fila para agregar.
 */
function tablaPlan(calc, { cardMap, instMap, tarjetas, bonificaciones, deseos, cupones, planes, tiendas }) {
  const COLS = 11;
  const hoy = toISODate(new Date());
  const normTienda = s => String(s || '').trim().toLowerCase();
  const itemsPorId = new Map(borrador.items.map(i => [i.id, i]));

  const filaItem = it => {
    const r = calc.porItem.get(it.id);
    const deseo = it.origen === 'lista' ? deseos.find(d => d.id === it.deseoId) : null;
    const opciones = deseo?.opciones || [];

    // Todo en una línea: así la celda mide lo mismo con o sin input y los controles
    // de las demás columnas quedan alineados en todas las filas.
    const articulo = `<div class="d-flex align-items-center gap-2">
        ${it.origen === 'lista' && deseo
          ? `<span class="fw-500">${it.nombre}</span>`
          : `<input type="text" class="form-control form-control-sm it-nombre" value="${(it.nombre || '').replace(/"/g, '&quot;')}" placeholder="Artículo" style="min-width:140px">`}
        <div class="d-flex align-items-center gap-2 ms-auto flex-shrink-0">
          ${it.enlace ? `<a href="${it.enlace}" target="_blank" rel="noopener" class="text-muted" title="Abrir enlace"><i class="bi bi-box-arrow-up-right" style="font-size:0.72rem"></i></a>` : ''}
          <span class="text-end" style="min-width:92px">${ORIGEN_BADGE[it.origen] || ''}</span>
        </div>
      </div>`;

    const tienda = opciones.length
      // Cerrado solo se ve la tienda (etiqueta encima); el precio aparece al desplegar.
      ? `<div class="select-etiqueta" title="${(it.tienda || '').replace(/"/g, '&quot;')}">
           <select class="form-select form-select-sm it-opcion" aria-label="Opción del deseo">
             ${opciones.some(o => o.id === it.opcionId) ? '' : `<option value="" selected>${it.tienda || '—'} (otra)</option>`}
             ${[...opciones].sort((a, b) => (Number(a.precio) || 0) - (Number(b.precio) || 0))
               .map(o => `<option value="${o.id}" ${o.id === it.opcionId ? 'selected' : ''}>${o.tienda || '—'} · ${currency(o.precio)}</option>`).join('')}
           </select>
           <span class="select-etiqueta-texto">${it.tienda || '—'}</span>
         </div>`
      : `<input type="text" class="form-control form-control-sm it-tienda" list="plan-tiendas-datalist" value="${(it.tienda || '').replace(/"/g, '&quot;')}" placeholder="Tienda" style="width:130px">`;

    const disponibles = bonifsDeTarjeta(tarjetas, bonificaciones, it.tarjetaId, it.bonificacionId);
    const aplicaAlItem = b => bonifAplicaAItem(b, it);
    // Una sola que aplica se muestra como texto; si es la única pero no aplica, se usa
    // el select para poder elegirla o dejar "Sin bonificación" a propósito.
    const conSelect = disponibles.length > 1 || (disponibles.length === 1 && !aplicaAlItem(disponibles[0]));
    let bonifCtrl = '';
    if (conSelect) {
      bonifCtrl = `<select class="form-select form-select-sm it-bonif" style="width:140px">
          <option value="">Sin bonificación</option>
          ${disponibles.map(b => `<option value="${b.id}" ${b.id === it.bonificacionId ? 'selected' : ''}>${b.nombre}${estadoBonificacion(b, hoy) === 'vencida' ? ' (vencida)' : ''}${aplicaAlItem(b) ? '' : ' (no aplica)'}</option>`).join('')}
        </select>`;
    } else if (r.bonif) {
      bonifCtrl = `<small class="text-muted" title="${reglaBonificacion(r.bonif, currency)}"><i class="bi bi-gift me-1"></i>${r.bonif.nombre}</small>`;
    }
    const bonifMonto = !r.bonif ? (conSelect ? '' : '<span class="text-muted">—</span>')
      : `<span><span class="text-success fw-bold">−${currency(r.bonificacion)}</span> <small class="text-muted">(${r.pct.toFixed(1)}%)</small></span>`;
    const avisos = !r.bonif ? [] : [
      r.califica ? '' : `Faltan ${currency(r.faltante)} para el mínimo`,
      r.noAplica ? `No aplica a ${it.tipoPago === 'msi' ? `MSI ${it.meses || ''}m` : 'contado'}` : '',
    ].filter(Boolean);
    // Con tabindex el tooltip también abre al tocar en móvil (ver wirePlanes).
    // El hueco del ícono se reserva siempre para que los montos queden alineados.
    const avisoIcono = avisos.length
      ? `<span class="aviso-bonif text-warning" style="width:16px" tabindex="0" role="img" aria-label="${avisos.join(' · ')}" data-bs-title="${avisos.join(' · ')}"><i class="bi bi-exclamation-triangle"></i></span>`
      : '<span style="width:16px"></span>';
    // Control a la izquierda y monto a la derecha: los selectores quedan en columna
    // aunque los montos midan distinto.
    const bonifCell = `<div class="d-flex align-items-center gap-2" style="white-space:nowrap">${bonifCtrl}
      <div class="d-flex align-items-center gap-2 ms-auto">${bonifMonto}${avisoIcono}</div>
    </div>`;

    const pagoVal = it.tipoPago === 'msi' ? `msi:${it.meses || ''}` : 'contado';
    // De Lista: hasta el máximo de su opción; si es de contado no hay nada que elegir.
    const opcionLista = opcionDeItem(it, deseos);
    const mesesPago = opcionLista ? mesesPermitidos(opcionLista) : MESES_COMUNES;
    const pagoCtrl = opcionLista && !mesesPago.length
      ? `<span style="white-space:nowrap" title="De contado en la tab Lista: no admite MSI">Contado</span>`
      : `<select class="form-select form-select-sm it-pago" style="min-width:100px" title="${opcionLista ? `Hasta MSI ${mesesPago[mesesPago.length - 1]}m, según la tab Lista` : 'Forma de pago'}">
      <option value="contado" ${pagoVal === 'contado' ? 'selected' : ''}>Contado</option>
      ${mesesPago.map(m => `<option value="msi:${m}" ${pagoVal === `msi:${m}` ? 'selected' : ''}>MSI ${m}m</option>`).join('')}
    </select>`;

    return `<tr data-item="${it.id}">
      <td style="padding-left:28px">${articulo}</td>
      <td>${tienda}</td>
      <td>${pagoCtrl}</td>
      <td><select class="form-select form-select-sm it-tarjeta" style="min-width:140px">${opcionesTarjetaHTML(tarjetas, instMap, it.tarjetaId || '')}</select></td>
      <td><input type="number" class="form-control form-control-sm text-center it-cantidad" value="${Number(it.cantidad) || 1}" min="1" step="1" style="width:64px"></td>
      <td class="text-end">${opcionDeItem(it, deseos)
        ? `<span title="Último precio registrado en la tab Lista">${currency(it.precio)}</span>`
        : `<input type="number" class="form-control form-control-sm text-end it-precio" value="${Number(it.precio) || 0}" min="0" step="0.01" style="width:110px">`}</td>
      <td class="text-end">${currency(r.subtotal)}</td>
      <td class="text-end">${r.cupon ? `<span class="text-success">−${currency(r.cupon)}</span>` : '<span class="text-muted">—</span>'}</td>
      <td class="text-end">${bonifCell}</td>
      <td class="text-end fw-bold">${currency(r.neto)}</td>
      <td>
        <div class="d-flex gap-1 justify-content-end">
          <button type="button" class="btn-icon it-enlace" title="${it.enlace ? 'Editar enlace' : 'Agregar enlace'}"><i class="bi bi-link-45deg"></i></button>
          <button class="btn-icon danger it-quitar" title="Quitar del plan"><i class="bi bi-trash3"></i></button>
        </div>
      </td>
    </tr>`;
  };

  const filaCarrito = c => {
    // Se ofrecen los de la tienda que este carrito puede usar. El ya asignado siempre
    // se lista: si dejó de aplicar (cambió la forma de pago o se editó el cupón) se explica abajo.
    const institucion = cardMap[c.tarjetaId]?.institucionId || null;
    const disponibles = cupones.filter(cu => cu.id === c.cupon?.id
      || ((!cu.tienda || normTienda(cu.tienda) === normTienda(c.tienda)) && !evaluarCupon(cu, c.items, institucion).motivo));
    const parcial = c.aplica && c.elegibles < c.items.length ? ` <small class="text-muted">en ${c.elegibles} de ${c.items.length} artículos</small>` : '';
    const estado = !c.cupon ? ''
      : c.motivo === 'institucion'
        ? `<small class="text-danger">No aplica: solo con ${instMap[c.cupon.institucionId]?.nombre || 'otra institución'}</small>`
      : c.motivo === 'pago'
        ? `<small class="text-danger">No aplica: solo ${c.cupon.aplicaA === 'msi' ? 'a MSI' : 'de contado'}</small>`
      : c.aplica
        ? `<span class="text-success fw-bold">−${currency(c.descuento)}</span>${parcial}`
        : `<small class="text-danger">Faltan ${currency(c.faltante)} para el mínimo del cupón</small>`;
    return `<tr style="background:rgba(127,127,127,.05)">
      <td colspan="${COLS}" style="padding-left:18px">
        <div class="d-flex align-items-center flex-wrap gap-2">
          <i class="bi bi-shop text-muted"></i><span class="fw-500">${c.tienda || 'Sin tienda'}</span>
          <small class="text-muted">· ${currency(c.subtotal)}</small>
          ${disponibles.length ? `
          <select class="form-select form-select-sm sel-cupon ms-auto" data-clave="${c.clave}" style="width:auto;max-width:260px" title="Cupón para esta tienda con esta tarjeta">
            <option value="">Sin cupón</option>
            ${disponibles.map(cu => `<option value="${cu.id}" ${cu.id === c.cupon?.id ? 'selected' : ''}>${cu.nombre} · ${reglaCupon(cu, instMap)}</option>`).join('')}
          </select>` : '<small class="text-muted ms-auto">Sin cupones disponibles</small>'}
          ${estado}
        </div>
      </td>
    </tr>`;
  };

  // Tarjeta → carritos (tiendas). Dentro del carrito, los items en el orden del plan.
  const porTarjeta = new Map();
  calc.carritos.forEach(c => {
    const k = c.tarjetaId || '';
    if (!porTarjeta.has(k)) porTarjeta.set(k, []);
    porTarjeta.get(k).push(c);
  });
  const nombreTarjeta = k => cardMap[k]?.nombre || '~';
  const cuerpo = [...porTarjeta.entries()]
    .sort(([a], [b]) => nombreTarjeta(a).localeCompare(nombreTarjeta(b), 'es'))
    .map(([tarjetaId, carritos]) => {
      const tc = cardMap[tarjetaId];
      return `<tr style="background:rgba(127,127,127,.12)">
          <td colspan="${COLS}">
            <div class="d-flex align-items-center gap-2">
              ${tc
                ? `<span class="d-inline-block rounded-circle" style="width:10px;height:10px;background:${tc.inst?.color || '#607d8b'}"></span>
                   <span class="fw-bold">${tc.nombre}</span><small class="text-muted">${tc.inst?.nombre || ''}</small>`
                : '<i class="bi bi-credit-card text-muted"></i><span class="fw-bold text-muted">Sin tarjeta</span>'}
              <span class="ms-auto fw-bold">${currency(carritos.reduce((s, c) => s + c.neto, 0))}</span>
            </div>
          </td>
        </tr>`
        + carritos
          .sort((a, b) => (a.tienda || '').localeCompare(b.tienda || '', 'es'))
          .map(c => filaCarrito(c) + c.items.map(i => filaItem(itemsPorId.get(i.id))).join(''))
          .join('');
    }).join('');

  const deseosConOpciones = deseos.filter(d => (d.opciones || []).length);
  const otros = planes.filter(p => p.id !== borrador.id && (p.items || []).length);
  const agregar = `
    <tr>
      <td colspan="${COLS}">
        <select class="form-select form-select-sm" id="plan-agregar" style="width:auto;max-width:100%">
          <option value="">＋ Agregar artículo…</option>
          ${deseosConOpciones.length ? `<optgroup label="De Lista">
            ${deseosConOpciones.map(d => `<option value="lista::${d.id}">${d.nombre}</option>`).join('')}
          </optgroup>` : ''}
          ${otros.map(p => `<optgroup label="De ${p.nombre}">
            ${(p.items || []).map(i => `<option value="plan::${p.id}::${i.id}">${i.nombre} · ${i.tienda || '—'} · ${currency(i.precio)}</option>`).join('')}
          </optgroup>`).join('')}
          <optgroup label="Otro"><option value="pers">Artículo personalizado</option></optgroup>
        </select>
      </td>
    </tr>`;

  return `
    <div class="table-wrapper">
      <datalist id="plan-tiendas-datalist">${tiendas.map(t => `<option value="${t}">`).join('')}</datalist>
      <table class="table mb-0">
        <thead><tr>
          <th>Artículo</th><th>Tienda</th><th>Pago</th><th>Tarjeta</th><th class="text-center">Cant.</th><th class="text-end">Precio</th>
          <th class="text-end">Subtotal</th><th class="text-end">Cupón</th><th class="text-end">Bonificación</th><th class="text-end">Total</th><th></th>
        </tr></thead>
        <tbody>
          ${borrador.items.length ? cuerpo : `<tr><td colspan="${COLS}" class="text-muted text-center py-3">Sin artículos. Agrégalos desde la fila de abajo.</td></tr>`}
          ${agregar}
        </tbody>
        ${borrador.items.length ? `
        <tfoot><tr class="fw-bold">
          <td colspan="6" class="text-end">Totales</td>
          <td class="text-end">${currency(calc.subtotal)}</td>
          <td class="text-end text-success">${calc.cupones ? '−' + currency(calc.cupones) : '—'}</td>
          <td class="text-end text-success">${calc.bonificacion ? '−' + currency(calc.bonificacion) : '—'}</td>
          <td class="text-end">${currency(calc.neto)}</td>
          <td></td>
        </tr></tfoot>` : ''}
      </table>
    </div>`;
}

/**
 * Enlace de un artículo del plan. Aplicar solo cambia el borrador (`onApply`): se
 * guarda con el resto de los cambios del plan, y no toca la opción en Lista.
 */
function showEnlaceItemModal(item, onApply) {
  openModal({
    title: `${item.nombre || 'Artículo'} — Enlace`,
    body: `
      <form id="enlace-item-form">
        <label class="form-label">Enlace</label>
        <input type="url" class="form-control" name="enlace" value="${(item.enlace || '').replace(/"/g, '&quot;')}" placeholder="https://...">
        <div class="form-text">Déjalo vacío para quitarlo. Se guarda con el botón Guardar del plan.</div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-aplicar-enlace">Aplicar</button>`,
  });

  const form = document.getElementById('enlace-item-form');
  const aplicar = () => {
    if (!form.checkValidity()) { form.reportValidity(); return; }
    item.enlace = form.elements.enlace.value.trim();
    closeModal();
    onApply();
  };
  document.getElementById('btn-aplicar-enlace').addEventListener('click', aplicar);
  form.addEventListener('submit', e => { e.preventDefault(); aplicar(); });
}

function wirePlanes(ctx, content) {
  content.querySelectorAll('.aviso-bonif').forEach(el => new bootstrap.Tooltip(el));

  const { planes, deseos, tarjetas, bonificaciones, recargar } = ctx;
  const repintar = () => renderPlanes(ctx);
  const marcar = () => { sucio = true; repintar(); };
  const itemDe = el => borrador.items.find(i => i.id === el.closest('[data-item]')?.dataset.item);

  // Con la tarjeta elegida, la bonificación: se conserva si sigue disponible; si
  // no, la única disponible o la primera de varias (se puede cambiar en su select).
  const ajustarBonif = it => {
    const disp = bonifsDeTarjeta(tarjetas, bonificaciones, it.tarjetaId, it.bonificacionId);
    if (!disp.some(b => b.id === it.bonificacionId)) it.bonificacionId = disp.find(b => bonifAplicaAItem(b, it))?.id || null;
  };

  const abrirPlan = id => {
    if (id === borrador.id) return;
    if (sucio && !confirm('Hay cambios sin guardar en el plan actual. ¿Descartarlos?')) { repintar(); return; }
    planSelId = id;
    borrador  = copiarPlan(planes.find(p => p.id === id));
    sucio     = false;
    repintar();
  };
  content.querySelector('#plan-sel').addEventListener('change', e => { if (e.target.value) abrirPlan(e.target.value); });
  content.querySelectorAll('[data-abrir-plan]').forEach(tr => tr.addEventListener('click', () => abrirPlan(tr.dataset.abrirPlan)));

  content.querySelector('#plan-nombre').addEventListener('change', e => { borrador.nombre = e.target.value.trim(); marcar(); });

  // Cambios en los controles de los artículos (change, no input: se repinta la tabla).
  content.addEventListener('change', e => {
    const el = e.target;
    if (el.classList.contains('sel-cupon')) {
      if (el.value) borrador.cupones[el.dataset.clave] = el.value;
      else delete borrador.cupones[el.dataset.clave];
      marcar();
      return;
    }
    const it = itemDe(el);
    if (!it) return;
    if (el.classList.contains('it-nombre'))   it.nombre = el.value.trim();
    else if (el.classList.contains('it-tienda'))   it.tienda = el.value.trim();
    else if (el.classList.contains('it-cantidad')) it.cantidad = Math.max(1, Math.round(Number(el.value) || 1));
    else if (el.classList.contains('it-precio'))   it.precio = Math.max(0, Number(el.value) || 0);
    else if (el.classList.contains('it-bonif'))    it.bonificacionId = el.value || null;
    else if (el.classList.contains('it-pago')) {
      const [tipo, meses] = el.value.split(':');
      it.tipoPago = tipo === 'msi' ? 'msi' : 'contado';
      it.meses    = tipo === 'msi' ? Number(meses) || null : null;
      ajustarBonif(it);
    }
    else if (el.classList.contains('it-tarjeta')) { it.tarjetaId = el.value || null; ajustarBonif(it); }
    else if (el.classList.contains('it-opcion')) {
      const o = (deseos.find(d => d.id === it.deseoId)?.opciones || []).find(x => x.id === el.value);
      if (!o) return;
      Object.assign(it, {
        opcionId: o.id, tienda: o.tienda || '', precio: Number(o.precio) || 0, enlace: o.enlace || '',
        tipoPago: o.tipoPago === 'msi' ? 'msi' : 'contado', meses: o.tipoPago === 'msi' ? (Number(o.meses) || null) : null,
      });
      ajustarBonif(it);
    } else return;
    marcar();
  });
  content.querySelectorAll('.it-enlace').forEach(btn => btn.addEventListener('click', () =>
    showEnlaceItemModal(itemDe(btn), marcar)));
  content.querySelectorAll('.it-quitar').forEach(btn => btn.addEventListener('click', () => {
    const it = itemDe(btn);
    borrador.items = borrador.items.filter(i => i !== it);
    marcar();
  }));

  // Agregar: de Lista (opción más barata), copia de otro plan o personalizado.
  content.querySelector('#plan-agregar').addEventListener('change', e => {
    const [tipo, a, b] = e.target.value.split('::');
    if (!tipo) return;
    const ultimaTarjeta = borrador.items[borrador.items.length - 1]?.tarjetaId || null;
    let nuevo;
    if (tipo === 'lista') {
      const d = deseos.find(x => x.id === a);
      const o = mejorOpcion(d?.opciones) || d?.opciones?.[0];
      if (!d || !o) return;
      nuevo = { origen: 'lista', deseoId: d.id, opcionId: o.id, nombre: d.nombre, tienda: o.tienda || '',
                enlace: o.enlace || '', precio: Number(o.precio) || 0, cantidad: 1, tarjetaId: ultimaTarjeta, bonificacionId: null,
                tipoPago: o.tipoPago === 'msi' ? 'msi' : 'contado', meses: o.tipoPago === 'msi' ? (Number(o.meses) || null) : null };
    } else if (tipo === 'plan') {
      const src = planes.find(p => p.id === a)?.items?.find(i => i.id === b);
      if (!src) return;
      nuevo = { ...src };
    } else {
      nuevo = { origen: 'personalizado', deseoId: null, opcionId: null, nombre: '', tienda: '', enlace: '',
                precio: 0, cantidad: 1, tarjetaId: ultimaTarjeta, bonificacionId: null, tipoPago: 'contado', meses: null };
    }
    nuevo.id = nuevoIdOpcion();
    if (tipo !== 'plan') ajustarBonif(nuevo);
    borrador.items.push(nuevo);
    sucio = true;
    repintar();
    if (tipo === 'pers') document.querySelector(`[data-item="${nuevo.id}"] .it-nombre`)?.focus();
  });

  // Guardar / Guardar como nuevo / Descartar / Eliminar.
  const validar = () => {
    if (!borrador.nombre.trim()) { toast('Ponle nombre al plan', 'warning'); content.querySelector('#plan-nombre').focus(); return false; }
    const incompleto = borrador.items.find(i => !String(i.nombre || '').trim() || !String(i.tienda || '').trim());
    if (incompleto) {
      toast('Completa el nombre y la tienda de todos los artículos', 'warning');
      content.querySelector(`[data-item="${incompleto.id}"] .it-nombre, [data-item="${incompleto.id}"] .it-tienda`)?.focus();
      return false;
    }
    return true;
  };
  const datos = nombre => ({ nombre, notas: borrador.notas || '', items: borrador.items, cupones: borrador.cupones });

  content.querySelector('#plan-guardar').addEventListener('click', async () => {
    if (!validar()) return;
    try {
      if (borrador.id) await update(COL_PLANES, borrador.id, datos(borrador.nombre));
      else             planSelId = await create(COL_PLANES, datos(borrador.nombre));
      sucio = false;
      borrador = null;
      toast('Plan guardado');
      recargar();
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
  });
  content.querySelector('#plan-guardar-nuevo')?.addEventListener('click', async () => {
    if (!validar()) return;
    const nombre = prompt('Nombre del nuevo plan:', `${borrador.nombre} (variante)`);
    if (!nombre || !nombre.trim()) return;
    try {
      const items = borrador.items.map(i => ({ ...i, id: nuevoIdOpcion() }));
      planSelId = await create(COL_PLANES, { ...datos(nombre.trim()), items });
      sucio = false;
      borrador = null;
      toast('Plan nuevo creado; el original quedó sin cambios');
      recargar();
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
  });
  content.querySelector('#plan-descartar').addEventListener('click', () => {
    if (!confirm('¿Descartar los cambios sin guardar?')) return;
    const guardado = planes.find(p => p.id === borrador.id);
    borrador = guardado ? copiarPlan(guardado) : planVacio(planes.length + 1);
    sucio = false;
    repintar();
  });
  content.querySelector('#plan-eliminar')?.addEventListener('click', async () => {
    if (!confirmDelete(borrador.nombre)) return;
    try {
      await remove(COL_PLANES, borrador.id);
      planSelId = null;
      borrador  = null;
      sucio     = false;
      toast('Plan eliminado');
      recargar();
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
  });
}

/** Texto corto de un cupón: "20% (máx. $150) · mín. $1,000 · solo BBVA · solo MSI". */
function reglaCupon(c, instMap = {}) {
  const partes = [c.tipo === 'porcentaje'
    ? `${c.valor}%${Number(c.montoMaximo) > 0 ? ` (máx. ${currency(c.montoMaximo)})` : ''}`
    : currency(c.valor)];
  if (Number(c.montoMinimo) > 0) partes.push(`mín. ${currency(c.montoMinimo)}`);
  if (c.institucionId) partes.push(`solo ${instMap[c.institucionId]?.nombre || 'otra institución'}`);
  if (c.aplicaA === 'contado') partes.push('solo de contado');
  else if (c.aplicaA === 'msi') partes.push('solo MSI');
  return partes.join(' · ');
}

// ── Cupones (modal desde el botón "Cupones" del encabezado) ───────────────────

/** Lee de nuevo cupones y planes (tras un cambio) y abre la lista de cupones. */
async function abrirCupones(ctx) {
  const [cupones, planes] = await Promise.all([getAll(COL_CUPONES), getAll(COL_PLANES)]);
  cupones.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
  showCuponesModal({ ...ctx, cupones, planes });
}

function showCuponesModal(ctx) {
  const { cupones, planes, tiendas, instituciones, recargar } = ctx;
  const instMap = Object.fromEntries(instituciones.map(i => [i.id, i]));
  const usos = id => planes.reduce((s, p) => s + Object.values(p.cupones || {}).filter(x => x === id).length, 0);
  // Tras crear/editar/borrar: se repinta la página (el borrador se conserva) y se vuelve a la lista.
  const alTerminar = async () => { await recargar(); abrirCupones(ctx); };

  openModal({
    title: '<i class="bi bi-ticket-perforated me-2"></i>Cupones',
    size: 'lg',
    body: cupones.length === 0
      ? '<p class="text-muted mb-0">Sin cupones. Dalos de alta con su tienda y asígnalos a los carritos de esa tienda en tus planes.</p>'
      : `<div class="table-wrapper">
          <table class="table mb-0">
            <thead><tr><th>Cupón</th><th>Tienda</th><th>Descuento</th><th class="text-center">Asignado en</th><th></th></tr></thead>
            <tbody>
              ${cupones.map(c => {
                const n = usos(c.id);
                return `<tr>
                  <td class="fw-500">${c.nombre}</td>
                  <td>${c.tienda || '<span class="text-muted">—</span>'}</td>
                  <td>${reglaCupon(c, instMap)}</td>
                  <td class="text-center">${n ? `${n} carrito${n !== 1 ? 's' : ''}` : '<span class="text-muted">—</span>'}</td>
                  <td>
                    <div class="d-flex gap-1 justify-content-end">
                      <button class="btn-icon btn-edit-cupon" data-cupon="${c.id}" title="Editar"><i class="bi bi-pencil"></i></button>
                      <button class="btn-icon danger btn-del-cupon" data-cupon="${c.id}" title="Eliminar"><i class="bi bi-trash3"></i></button>
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="form-text mt-2">El cupón se asigna en la tabla del plan, en la fila de cada tienda (carrito).</div>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cerrar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-nuevo-cupon"><i class="bi bi-plus-lg me-1"></i>Nuevo cupón</button>`,
  });

  const back = () => abrirCupones(ctx);
  document.getElementById('btn-nuevo-cupon').addEventListener('click', () => showCuponModal(null, tiendas, instituciones, alTerminar, back));
  document.querySelectorAll('#app-modal .btn-edit-cupon').forEach(btn => btn.addEventListener('click', () =>
    showCuponModal(cupones.find(c => c.id === btn.dataset.cupon), tiendas, instituciones, alTerminar, back)));
  document.querySelectorAll('#app-modal .btn-del-cupon').forEach(btn => btn.addEventListener('click', async () => {
    const c = cupones.find(x => x.id === btn.dataset.cupon);
    if (!confirmDelete(c.nombre)) return;
    try {
      // Se quita de los carritos de los planes guardados; el borrador lo limpia al repintar.
      const usados = planes.filter(p => Object.values(p.cupones || {}).includes(c.id));
      await Promise.all(usados.map(p => update(COL_PLANES, p.id, {
        cupones: Object.fromEntries(Object.entries(p.cupones).filter(([, id]) => id !== c.id)),
      })));
      await remove(COL_CUPONES, c.id);
      toast('Cupón eliminado');
      alTerminar();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  }));
}

/** Alta / edición de un cupón. `onCancel` regresa a la lista de cupones. */
function showCuponModal(cupon, tiendas, instituciones, onSaved, onCancel) {
  const isEdit = !!cupon;
  const insts = [...instituciones].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
  openModal({
    title: isEdit ? 'Editar Cupón' : 'Nuevo Cupón',
    body: `
      <form id="cupon-form">
        <div class="row g-2">
          <div class="col-md-7 mb-2">
            <label class="form-label">Cupón *</label>
            <input type="text" class="form-control" name="nombre" value="${cupon?.nombre || ''}" required placeholder="Ej: BUENFIN20">
          </div>
          <div class="col-md-5 mb-2">
            <label class="form-label">Tienda *</label>
            <input type="text" class="form-control" name="tienda" list="cupon-tiendas-datalist" value="${cupon?.tienda || ''}" required placeholder="Ej: Amazon">
            <datalist id="cupon-tiendas-datalist">${tiendas.map(t => `<option value="${t}">`).join('')}</datalist>
          </div>
          <div class="col-4 mb-2">
            <label class="form-label">Tipo *</label>
            <select class="form-select" name="tipo" id="sel-cupon-tipo">
              <option value="porcentaje" ${(!cupon || cupon.tipo === 'porcentaje') ? 'selected' : ''}>% Porcentaje</option>
              <option value="cantidad"   ${cupon?.tipo === 'cantidad' ? 'selected' : ''}>$ Cantidad fija</option>
            </select>
          </div>
          <div class="col-4 mb-2">
            <label class="form-label">Valor *</label>
            <input type="number" class="form-control" name="valor" value="${cupon?.valor ?? ''}" required min="0" step="0.01">
          </div>
          <div class="col-4 mb-2">
            <label class="form-label">Compra mínima</label>
            <input type="number" class="form-control" name="montoMinimo" value="${cupon?.montoMinimo || ''}" min="0" step="0.01" placeholder="Sin mínimo">
          </div>
          <div class="col-md-6 mb-1">
            <label class="form-label">Descuento máximo</label>
            <input type="number" class="form-control" name="montoMaximo" id="input-cupon-max" value="${cupon?.montoMaximo || ''}" min="0" step="0.01" placeholder="Sin tope">
            <div class="form-text">Solo aplica a cupones de porcentaje.</div>
          </div>
          <div class="col-md-6 mb-1">
            <label class="form-label">Forma de pago</label>
            <select class="form-select" name="aplicaA">
              <option value="ambos"   ${!cupon?.aplicaA || cupon.aplicaA === 'ambos' ? 'selected' : ''}>Contado y MSI</option>
              <option value="contado" ${cupon?.aplicaA === 'contado' ? 'selected' : ''}>Solo de contado</option>
              <option value="msi"     ${cupon?.aplicaA === 'msi' ? 'selected' : ''}>Solo MSI</option>
            </select>
          </div>
          <div class="col-md-6 mb-1">
            <label class="form-label">Institución</label>
            <select class="form-select" name="institucionId">
              <option value="">Cualquiera</option>
              ${insts.map(i => `<option value="${i.id}" ${cupon?.institucionId === i.id ? 'selected' : ''}>${i.nombre}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-text">En cada plan solo se ofrece en los carritos de su tienda que cumplan estas condiciones. El mínimo se valida contra los artículos del carrito que pueden usarlo.</div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-cupon">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-cupon">${isEdit ? 'Guardar' : 'Crear'}</button>`,
  });

  const selTipo = document.getElementById('sel-cupon-tipo');
  const inputMax = document.getElementById('input-cupon-max');
  const sync = () => { inputMax.disabled = selTipo.value === 'cantidad'; };
  selTipo.addEventListener('change', sync);
  sync();

  document.getElementById('btn-cancel-cupon').addEventListener('click', () => { if (onCancel) onCancel(); else closeModal(); });
  document.getElementById('btn-save-cupon').addEventListener('click', async () => {
    const form = document.getElementById('cupon-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw = Object.fromEntries(new FormData(form));
    const data = {
      nombre:      raw.nombre.trim(),
      tienda:      (raw.tienda || '').trim(),
      tipo:        raw.tipo === 'cantidad' ? 'cantidad' : 'porcentaje',
      valor:       Number(raw.valor) || 0,
      montoMinimo: Number(raw.montoMinimo) || 0,
      montoMaximo: raw.tipo === 'cantidad' ? 0 : Number(raw.montoMaximo) || 0,
      institucionId: raw.institucionId || '',
      aplicaA:     ['contado', 'msi'].includes(raw.aplicaA) ? raw.aplicaA : 'ambos',
    };
    try {
      if (isEdit) await update(COL_CUPONES, cupon.id, data);
      else        await create(COL_CUPONES, data);
      toast(isEdit ? 'Cupón actualizado' : 'Cupón creado');
      onSaved?.();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
