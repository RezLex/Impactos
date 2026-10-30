import { getAll, create, update, remove } from '../utils/db.js';
import { currency, fmtDate } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import { toISODate } from '../utils/ciclo.js';
import {
  nuevoIdOpcion, variacionPct, registrarPrecio, historialConVariacion, ultimaVariacion, mejorOpcion,
} from '../utils/deseos.js';
import { calcularPlan } from '../utils/planes.js';
import { reglaBonificacion, estadoBonificacion } from '../utils/bonificaciones.js';

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
        <button class="btn btn-primary btn-sm" id="btn-nuevo-deseo">
          <i class="bi bi-plus-lg me-1"></i><span id="btn-nuevo-deseo-label">${boton[tabActivo]}</span>
        </button>
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
      if (tabActivo === 'planes') showPlanModal(null, recargar);
      else                        showDeseoModal(null, recargar);
    });
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
  on('.btn-historial-opcion', btn => { const d = deseoDe(btn); showHistorialModal(d, opcionDe(d, btn)); });
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
        <div class="mb-1">
          <label class="form-label">Enlace</label>
          <input type="url" class="form-control" name="enlace" value="${opcion?.enlace || ''}" placeholder="https://...">
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-opcion">${isEdit ? 'Guardar' : 'Agregar'}</button>`,
  });

  document.getElementById('btn-save-opcion').addEventListener('click', async () => {
    const form = document.getElementById('opcion-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw = Object.fromEntries(new FormData(form));
    const base = { ...(opcion || { id: nuevoIdOpcion(), historial: [] }), tienda: raw.tienda.trim(), enlace: raw.enlace || '' };
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

function showHistorialModal(deseo, opcion) {
  const filas = historialConVariacion(opcion.historial);
  openModal({
    title: `${deseo.nombre} — ${opcion.tienda}`,
    body: filas.length === 0
      ? '<p class="text-muted mb-0">Sin precios registrados.</p>'
      : `<div class="table-wrapper">
          <table class="table mb-0">
            <thead><tr><th>Fecha</th><th class="text-end">Precio</th><th class="text-end">Variación</th></tr></thead>
            <tbody>
              ${filas.map((h, i) => `<tr>
                <td style="white-space:nowrap">${fmtDate(h.fecha)}${i === 0 ? ' <span class="badge bg-primary-subtle text-primary ms-1">Actual</span>' : ''}</td>
                <td class="text-end fw-bold">${currency(h.precio)}</td>
                <td class="text-end">${variacionHTML(h.variacion)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`,
  });
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

const ORIGEN_BADGE = {
  lista:         '<span class="badge bg-warning-subtle text-warning-emphasis" title="Tomado de la tab Lista">Lista</span>',
  personalizado: '<span class="badge bg-secondary-subtle text-secondary-emphasis" title="Artículo propio del plan">Personalizado</span>',
};

function renderPlanes(ctx) {
  const { planes, cupones, tarjetas, instituciones, bonificaciones, tiendas, recargar } = ctx;
  const instMap = Object.fromEntries(instituciones.map(i => [i.id, i]));
  const cardMap = Object.fromEntries(tarjetas.map(t => [t.id, { ...t, inst: instMap[t.institucionId] }]));
  const conIvaDe = instId => !!instMap[instId]?.bonificacionConIva;
  const calculos = new Map(planes.map(p => [p.id, calcularPlan(p, bonificaciones, conIvaDe, cupones)]));

  // El más conveniente: menor total neto entre los planes con artículos.
  const conItems = planes.filter(p => (p.items || []).length);
  const mejorNeto = conItems.length ? Math.min(...conItems.map(p => calculos.get(p.id).neto)) : null;
  const esMejor = p => conItems.length > 1 && (p.items || []).length > 0 && calculos.get(p.id).neto === mejorNeto;

  const comparativa = conItems.length < 2 ? '' : `
    <div class="data-card">
      <div class="data-card-header"><span><i class="bi bi-bar-chart-steps me-2"></i>Comparativa</span></div>
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
              return `<tr class="${esMejor(p) ? 'table-success' : ''}">
                <td class="fw-500">${p.nombre}${esMejor(p) ? ' <span class="badge bg-success ms-1">Más conveniente</span>' : ''}</td>
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

  const content = document.getElementById('deseos-tab-content');
  content.innerHTML = renderCupones(cupones, planes)
    + (planes.length === 0
      ? `<div class="empty-state"><i class="bi bi-clipboard-check"></i><p>Sin planes de compra.<br>Crea varios con distintas tiendas, tarjetas, cupones y bonificaciones para ver cuál conviene.</p></div>`
      : comparativa + planes.map(p => renderPlan(p, calculos.get(p.id), cardMap, cupones, esMejor(p))).join(''));

  const planDe = el => planes.find(p => p.id === el.closest('[data-plan]').dataset.plan);
  const on = (sel, fn) => content.querySelectorAll(sel).forEach(btn => btn.addEventListener('click', () => fn(btn)));

  // Cupones (catálogo de la tab)
  on('.btn-nuevo-cupon', () => showCuponModal(null, tiendas, recargar));
  on('.btn-edit-cupon', btn => showCuponModal(cupones.find(c => c.id === btn.dataset.cupon), tiendas, recargar));
  on('.btn-del-cupon', async btn => {
    const c = cupones.find(x => x.id === btn.dataset.cupon);
    if (!confirmDelete(c.nombre)) return;
    try {
      // Se quita de los carritos donde estaba asignado.
      const usados = planes.filter(p => Object.values(p.cupones || {}).includes(c.id));
      await Promise.all(usados.map(p => update(COL_PLANES, p.id, {
        cupones: Object.fromEntries(Object.entries(p.cupones).filter(([, id]) => id !== c.id)),
      })));
      await remove(COL_CUPONES, c.id);
      toast('Cupón eliminado');
      recargar();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
  content.querySelectorAll('.sel-cupon').forEach(sel => sel.addEventListener('change', async () => {
    const p = planDe(sel);
    const asignados = { ...(p.cupones || {}) };
    if (sel.value) asignados[sel.dataset.clave] = sel.value;
    else delete asignados[sel.dataset.clave];
    try {
      await update(COL_PLANES, p.id, { cupones: asignados });
      recargar();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  }));

  // Planes
  on('.btn-edit-plan', btn => showPlanModal(planDe(btn), recargar));
  on('.btn-dup-plan', async btn => {
    const p = planDe(btn);
    try {
      await create(COL_PLANES, {
        nombre: `${p.nombre} (copia)`, notas: p.notas || '',
        items: (p.items || []).map(i => ({ ...i, id: nuevoIdOpcion() })),
        cupones: { ...(p.cupones || {}) },
      });
      toast('Plan duplicado');
      recargar();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
  on('.btn-del-plan', async btn => {
    const p = planDe(btn);
    if (!confirmDelete(p.nombre)) return;
    try {
      await remove(COL_PLANES, p.id);
      toast('Plan eliminado');
      recargar();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
  on('.btn-add-item', btn => showItemModal(planDe(btn), null, ctx));
  on('.btn-edit-item', btn => {
    const p = planDe(btn);
    showItemModal(p, (p.items || []).find(i => i.id === btn.dataset.item), ctx);
  });
  on('.btn-del-item', async btn => {
    const p = planDe(btn);
    const it = (p.items || []).find(i => i.id === btn.dataset.item);
    if (!confirmDelete(it.nombre)) return;
    try {
      await update(COL_PLANES, p.id, { items: (p.items || []).filter(i => i.id !== it.id) });
      toast('Artículo quitado del plan');
      recargar();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

/** Texto corto de un cupón: "20% (máx. $150) · mín. $1,000". */
function reglaCupon(c) {
  const partes = [c.tipo === 'porcentaje'
    ? `${c.valor}%${Number(c.montoMaximo) > 0 ? ` (máx. ${currency(c.montoMaximo)})` : ''}`
    : currency(c.valor)];
  if (Number(c.montoMinimo) > 0) partes.push(`mín. ${currency(c.montoMinimo)}`);
  return partes.join(' · ');
}

/** Catálogo de cupones de la tab: se asignan después a los carritos (tarjeta + tienda) de cualquier plan. */
function renderCupones(cupones, planes) {
  const usos = id => planes.reduce((s, p) => s + Object.values(p.cupones || {}).filter(x => x === id).length, 0);
  return `
    <div class="data-card">
      <div class="data-card-header">
        <span><i class="bi bi-ticket-perforated me-2"></i>Cupones</span>
        <button class="btn btn-sm btn-light btn-nuevo-cupon"><i class="bi bi-plus-lg me-1"></i>Nuevo cupón</button>
      </div>
      ${cupones.length === 0
        ? `<div class="p-3 text-muted" style="font-size:0.85rem">Sin cupones. Dalos de alta con su tienda y asígnalos a los carritos de esa tienda en tus planes.</div>`
        : `<div class="table-wrapper">
            <table class="table mb-0">
              <thead><tr><th>Cupón</th><th>Tienda</th><th>Descuento</th><th class="text-center">Asignado en</th><th></th></tr></thead>
              <tbody>
                ${cupones.map(c => {
                  const n = usos(c.id);
                  return `<tr>
                    <td class="fw-500"><i class="bi bi-ticket-perforated me-1 text-success"></i>${c.nombre}</td>
                    <td>${c.tienda || '<span class="text-muted">—</span>'}</td>
                    <td>${reglaCupon(c)}</td>
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
          </div>`}
    </div>`;
}

/**
 * Tarjeta de un plan: items agrupados por tarjeta y, dentro, por tienda (cada
 * tienda es un carrito: ahí se asigna el cupón y se valida su mínimo).
 */
function renderPlan(p, calc, cardMap, cupones, mejor) {
  const items = p.items || [];
  const COLS = 8;
  const normTienda = s => String(s || '').trim().toLowerCase();

  const filaItem = it => {
    const r = calc.porItem.get(it.id);
    let bonifCell = '<span class="text-muted">—</span>';
    if (r.bonif) {
      bonifCell = r.califica
        ? `<span class="text-success fw-bold">−${currency(r.bonificacion)}</span> <small class="text-muted">(${r.pct.toFixed(1)}%)</small>
           <br><small class="text-muted"><i class="bi bi-gift me-1"></i>${r.bonif.nombre}</small>`
        : `<span class="text-muted">$0.00</span>
           <br><small class="text-danger" title="${r.bonif.nombre}"><i class="bi bi-gift me-1"></i>Faltan ${currency(r.faltante)} para el mínimo</small>`;
    }
    return `<tr>
      <td style="padding-left:32px">
        <div class="fw-500">${it.nombre}${it.enlace ? ` <a href="${it.enlace}" target="_blank" rel="noopener" class="ms-1 text-muted" title="Abrir enlace"><i class="bi bi-box-arrow-up-right" style="font-size:0.72rem"></i></a>` : ''}</div>
        ${ORIGEN_BADGE[it.origen] || ''}
      </td>
      <td class="text-center">${Number(it.cantidad) || 1}</td>
      <td class="text-end">${currency(it.precio)}</td>
      <td class="text-end">${currency(r.subtotal)}</td>
      <td class="text-end">${r.cupon ? `<span class="text-success">−${currency(r.cupon)}</span>` : '<span class="text-muted">—</span>'}</td>
      <td class="text-end">${bonifCell}</td>
      <td class="text-end fw-bold">${currency(r.neto)}</td>
      <td>
        <div class="d-flex gap-1 justify-content-end">
          <button class="btn-icon btn-edit-item" data-item="${it.id}" title="Editar"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger btn-del-item" data-item="${it.id}" title="Quitar del plan"><i class="bi bi-trash3"></i></button>
        </div>
      </td>
    </tr>`;
  };

  const filaCarrito = c => {
    const disponibles = cupones.filter(cu => !cu.tienda || normTienda(cu.tienda) === normTienda(c.tienda) || cu.id === c.cupon?.id);
    const estado = !c.cupon ? ''
      : c.aplica
        ? `<span class="text-success fw-bold">−${currency(c.descuento)}</span>`
        : `<small class="text-danger">Faltan ${currency(c.faltante)} para el mínimo del cupón</small>`;
    return `<tr style="background:rgba(127,127,127,.05)">
      <td colspan="${COLS}" style="padding-left:18px">
        <div class="d-flex align-items-center flex-wrap gap-2">
          <i class="bi bi-shop text-muted"></i><span class="fw-500">${c.tienda || 'Sin tienda'}</span>
          <small class="text-muted">· ${currency(c.subtotal)}</small>
          <select class="form-select form-select-sm sel-cupon ms-auto" data-clave="${c.clave}" style="width:auto;max-width:260px" title="Cupón para esta tienda con esta tarjeta">
            <option value="">Sin cupón</option>
            ${disponibles.map(cu => `<option value="${cu.id}" ${cu.id === c.cupon?.id ? 'selected' : ''}>${cu.nombre} · ${reglaCupon(cu)}</option>`).join('')}
          </select>
          ${estado}
        </div>
      </td>
    </tr>`;
  };

  // Tarjeta → carritos (tiendas), ordenados por nombre.
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
      const totalTarjeta = carritos.reduce((s, c) => s + c.neto, 0);
      return `<tr style="background:rgba(127,127,127,.12)">
          <td colspan="${COLS}">
            <div class="d-flex align-items-center gap-2">
              ${tc
                ? `<span class="d-inline-block rounded-circle" style="width:10px;height:10px;background:${tc.inst?.color || '#607d8b'}"></span>
                   <span class="fw-bold">${tc.nombre}</span><small class="text-muted">${tc.inst?.nombre || ''}</small>`
                : '<i class="bi bi-credit-card text-muted"></i><span class="fw-bold text-muted">Sin tarjeta</span>'}
              <span class="ms-auto fw-bold">${currency(totalTarjeta)}</span>
            </div>
          </td>
        </tr>`
        + carritos
          .sort((a, b) => (a.tienda || '').localeCompare(b.tienda || '', 'es'))
          .map(c => filaCarrito(c) + c.items.map(filaItem).join(''))
          .join('');
    }).join('');

  const topes = calc.porBonificacion.filter(b => b.topado)
    .map(b => `<span class="badge bg-secondary-subtle text-secondary-emphasis" title="Sin tope serían ${currency(b.sinTope)}">${b.bonif.nombre}: tope ${currency(b.esperado)}</span>`)
    .join(' ');

  return `
    <div class="data-card" data-plan="${p.id}">
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 p-3">
        <div>
          <div class="fw-bold d-flex align-items-center gap-2 flex-wrap">
            <i class="bi bi-clipboard-check text-primary"></i>${p.nombre}
            ${mejor ? '<span class="badge bg-success">Más conveniente</span>' : ''}
          </div>
          ${p.notas ? `<small class="text-muted d-block">${p.notas}</small>` : ''}
          <small class="text-muted">
            Subtotal ${currency(calc.subtotal)}
            ${calc.cupones ? ` · Cupones <span class="text-success">−${currency(calc.cupones)}</span>` : ''}
            ${calc.bonificacion ? ` · Bonificación <span class="text-success">−${currency(calc.bonificacion)}</span>` : ''}
            · Total <strong>${currency(calc.neto)}</strong>
          </small>
          ${topes ? `<div class="mt-1">${topes}</div>` : ''}
        </div>
        <div class="d-flex gap-1">
          <button class="btn btn-outline-primary btn-sm btn-add-item"><i class="bi bi-plus-lg me-1"></i>Artículo</button>
          <button class="btn-icon btn-dup-plan" title="Duplicar plan (para armar una variante)"><i class="bi bi-copy"></i></button>
          <button class="btn-icon btn-edit-plan" title="Editar plan"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger btn-del-plan" title="Eliminar plan"><i class="bi bi-trash3"></i></button>
        </div>
      </div>
      ${items.length === 0
        ? `<div class="px-3 pb-3 text-muted" style="font-size:0.85rem">Sin artículos. Agrega deseos de la Lista, de otro plan o uno personalizado.</div>`
        : `<div class="table-wrapper">
            <table class="table mb-0">
              <thead><tr>
                <th>Artículo</th><th class="text-center">Cant.</th><th class="text-end">Precio</th><th class="text-end">Subtotal</th>
                <th class="text-end">Cupón</th><th class="text-end">Bonificación</th><th class="text-end">Total</th><th></th>
              </tr></thead>
              <tbody>${cuerpo}</tbody>
              <tfoot><tr class="fw-bold">
                <td colspan="3" class="text-end">Totales</td>
                <td class="text-end">${currency(calc.subtotal)}</td>
                <td class="text-end text-success">${calc.cupones ? '−' + currency(calc.cupones) : '—'}</td>
                <td class="text-end text-success">${calc.bonificacion ? '−' + currency(calc.bonificacion) : '—'}</td>
                <td class="text-end">${currency(calc.neto)}</td>
                <td></td>
              </tr></tfoot>
            </table>
          </div>`}
    </div>`;
}

function showCuponModal(cupon, tiendas, onSaved) {
  const isEdit = !!cupon;
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
        </div>
        <div class="form-text">En cada plan, el cupón solo se ofrece en los carritos de su tienda; el mínimo se valida contra el subtotal de ese carrito.</div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-cupon">${isEdit ? 'Guardar' : 'Crear'}</button>`,
  });

  const selTipo = document.getElementById('sel-cupon-tipo');
  const inputMax = document.getElementById('input-cupon-max');
  const sync = () => { inputMax.disabled = selTipo.value === 'cantidad'; };
  selTipo.addEventListener('change', sync);
  sync();

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
    };
    try {
      if (isEdit) await update(COL_CUPONES, cupon.id, data);
      else        await create(COL_CUPONES, data);
      closeModal();
      toast(isEdit ? 'Cupón actualizado' : 'Cupón creado');
      onSaved?.();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

function showPlanModal(plan, onSaved) {
  const isEdit = !!plan;
  openModal({
    title: isEdit ? 'Editar Plan' : 'Nuevo Plan de Compra',
    body: `
      <form id="plan-form">
        <div class="mb-3">
          <label class="form-label">Nombre *</label>
          <input type="text" class="form-control" name="nombre" value="${plan?.nombre || ''}" required placeholder="Ej: Buen Fin con BBVA">
        </div>
        <div class="mb-1">
          <label class="form-label">Notas</label>
          <textarea class="form-control" name="notas" rows="2" placeholder="Opcional">${plan?.notas || ''}</textarea>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-plan">${isEdit ? 'Guardar' : 'Crear'}</button>`,
  });

  document.getElementById('btn-save-plan').addEventListener('click', async () => {
    const form = document.getElementById('plan-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw = Object.fromEntries(new FormData(form));
    const data = { nombre: raw.nombre.trim(), notas: (raw.notas || '').trim() };
    try {
      if (isEdit) await update(COL_PLANES, plan.id, data);
      else        await create(COL_PLANES, { ...data, items: [] });
      closeModal();
      toast(isEdit ? 'Plan actualizado' : 'Plan creado');
      onSaved?.();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

/**
 * Alta / edición de un artículo del plan. Al agregar se elige de dónde viene:
 * un deseo de Lista (precarga la opción elegida con su precio vigente), un
 * artículo de otro plan (copia su configuración) o uno personalizado. En todos
 * los casos los campos quedan editables y se guardan como registro propio del plan.
 */
function showItemModal(plan, item, ctx) {
  const { deseos, planes, tiendas, tarjetas, instituciones, bonificaciones, recargar } = ctx;
  const isEdit = !!item;
  const hoy = toISODate(new Date());
  const instMap = Object.fromEntries(instituciones.map(i => [i.id, i]));
  const deseosConOpciones = deseos.filter(d => (d.opciones || []).length);
  const otrosPlanes = planes.filter(p => p.id !== plan.id && (p.items || []).length);

  const opcionesTarjeta = (() => {
    const porInst = {};
    tarjetas.filter(t => !t.oculta).forEach(t => { (porInst[t.institucionId || '__'] ||= []).push(t); });
    return Object.entries(porInst)
      .sort(([a], [b]) => (instMap[a]?.nombre || '').localeCompare(instMap[b]?.nombre || '', 'es'))
      .map(([instId, ts]) => `<optgroup label="${instMap[instId]?.nombre || 'Sin institución'}">
          ${ts.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(t => `<option value="${t.id}">${t.nombre}</option>`).join('')}
        </optgroup>`).join('');
  })();

  openModal({
    title: `${plan.nombre} — ${isEdit ? 'Editar artículo' : 'Agregar artículo'}`,
    size: 'lg',
    body: `
      <form id="item-form">
        ${isEdit ? '' : `
        <div class="btn-group btn-group-sm w-100 mb-3" role="group">
          <input type="radio" class="btn-check" name="origenSel" id="orig-lista" value="lista" ${deseosConOpciones.length ? 'checked' : 'disabled'}>
          <label class="btn btn-outline-primary" for="orig-lista"><i class="bi bi-stars me-1"></i>De Lista</label>
          <input type="radio" class="btn-check" name="origenSel" id="orig-plan" value="plan" ${otrosPlanes.length ? '' : 'disabled'}>
          <label class="btn btn-outline-primary" for="orig-plan"><i class="bi bi-copy me-1"></i>De otro plan</label>
          <input type="radio" class="btn-check" name="origenSel" id="orig-pers" value="personalizado" ${deseosConOpciones.length ? '' : 'checked'}>
          <label class="btn btn-outline-primary" for="orig-pers"><i class="bi bi-pencil me-1"></i>Personalizado</label>
        </div>
        <div id="src-lista" class="row g-2 mb-3">
          <div class="col-md-6">
            <label class="form-label">Deseo</label>
            <select class="form-select" id="sel-deseo">
              ${deseosConOpciones.map(d => `<option value="${d.id}">${d.nombre}</option>`).join('')}
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Opción</label>
            <select class="form-select" id="sel-opcion"></select>
          </div>
        </div>
        <div id="src-plan" class="mb-3" style="display:none">
          <label class="form-label">Artículo de otro plan</label>
          <select class="form-select" id="sel-item-otro">
            ${otrosPlanes.map(p => `
              <optgroup label="${p.nombre}">
                ${(p.items || []).map(i => `<option value="${p.id}::${i.id}">${i.nombre} · ${i.tienda || '—'} · ${currency(i.precio)}</option>`).join('')}
              </optgroup>`).join('')}
          </select>
        </div>
        <hr class="mt-0">`}
        <div class="row g-2">
          <div class="col-md-7 mb-2">
            <label class="form-label">Artículo *</label>
            <input type="text" class="form-control" name="nombre" value="${item?.nombre || ''}" required>
          </div>
          <div class="col-md-5 mb-2">
            <label class="form-label">Tienda *</label>
            <input type="text" class="form-control" name="tienda" list="plan-tiendas-datalist" value="${item?.tienda || ''}" required>
            <datalist id="plan-tiendas-datalist">${tiendas.map(t => `<option value="${t}">`).join('')}</datalist>
          </div>
          <div class="col-md-4 mb-2">
            <label class="form-label">Precio *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="precio" value="${item?.precio ?? ''}" required min="0" step="0.01">
            </div>
          </div>
          <div class="col-md-2 mb-2">
            <label class="form-label">Cant.</label>
            <input type="number" class="form-control" name="cantidad" value="${item?.cantidad || 1}" required min="1" step="1">
          </div>
          <div class="col-md-6 mb-2">
            <label class="form-label">Enlace</label>
            <input type="url" class="form-control" name="enlace" value="${item?.enlace || ''}" placeholder="https://...">
          </div>
          <div class="col-md-6 mb-2">
            <label class="form-label">Tarjeta</label>
            <select class="form-select" name="tarjetaId" id="sel-item-tarjeta">
              <option value="">— Sin definir —</option>
              ${opcionesTarjeta}
            </select>
          </div>
          <div class="col-md-6 mb-2">
            <label class="form-label">Bonificación</label>
            <select class="form-select" name="bonificacionId" id="sel-item-bonif"></select>
            <div class="form-text" id="item-bonif-detalle"></div>
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-item">${isEdit ? 'Guardar' : 'Agregar'}</button>`,
  });

  const form   = document.getElementById('item-form');
  const campo  = n => form.querySelector(`[name="${n}"]`);
  const selTc  = document.getElementById('sel-item-tarjeta');
  const selBon = document.getElementById('sel-item-bonif');
  // Origen y referencias del item que se va a guardar (se ajustan al elegir la fuente).
  let origen = item?.origen || 'personalizado';
  let refs   = { deseoId: item?.deseoId || null, opcionId: item?.opcionId || null };

  // Bonificaciones del módulo de la institución de la tarjeta elegida (no aplicadas, o la ya asignada).
  const pintarBonif = seleccion => {
    const tc = tarjetas.find(t => t.id === selTc.value);
    const disponibles = tc
      ? bonificaciones.filter(b => b.institucionId === tc.institucionId && (!b.aplicada || b.id === seleccion))
      : [];
    selBon.disabled = !disponibles.length;
    selBon.innerHTML = `<option value="">${!tc ? 'Elige una tarjeta' : disponibles.length ? 'Sin bonificación' : 'La institución no tiene bonificaciones'}</option>`
      + disponibles.map(b => `<option value="${b.id}" ${b.id === seleccion ? 'selected' : ''}>${b.nombre}${estadoBonificacion(b, hoy) === 'vencida' ? ' (vencida)' : ''}</option>`).join('');
    const b = disponibles.find(x => x.id === selBon.value);
    document.getElementById('item-bonif-detalle').textContent = b ? `${reglaBonificacion(b, currency)} · vence ${fmtDate(b.fechaMaxima)}` : '';
  };
  selTc.value = item?.tarjetaId || '';
  pintarBonif(item?.bonificacionId || '');
  selTc.addEventListener('change', () => pintarBonif(''));
  selBon.addEventListener('change', () => pintarBonif(selBon.value));

  if (!isEdit) {
    const selDeseo  = document.getElementById('sel-deseo');
    const selOpcion = document.getElementById('sel-opcion');
    const selOtro   = document.getElementById('sel-item-otro');

    const precargarOpcion = () => {
      const d = deseos.find(x => x.id === selDeseo.value);
      const o = (d?.opciones || []).find(x => x.id === selOpcion.value);
      if (!d || !o) return;
      origen = 'lista';
      refs   = { deseoId: d.id, opcionId: o.id };
      campo('nombre').value = d.nombre;
      campo('tienda').value = o.tienda || '';
      campo('precio').value = o.precio ?? '';
      campo('enlace').value = o.enlace || '';
    };
    const pintarOpciones = () => {
      const d = deseos.find(x => x.id === selDeseo.value);
      selOpcion.innerHTML = [...(d?.opciones || [])]
        .sort((a, b) => (Number(a.precio) || 0) - (Number(b.precio) || 0))
        .map(o => `<option value="${o.id}">${o.tienda || '—'} · ${currency(o.precio)}</option>`).join('');
      precargarOpcion();
    };
    const precargarOtro = () => {
      const [planId, itemId] = (selOtro.value || '').split('::');
      const src = planes.find(p => p.id === planId)?.items?.find(i => i.id === itemId);
      if (!src) return;
      origen = src.origen || 'personalizado';
      refs   = { deseoId: src.deseoId || null, opcionId: src.opcionId || null };
      ['nombre', 'tienda', 'precio', 'enlace'].forEach(k => { campo(k).value = src[k] ?? ''; });
      campo('cantidad').value = src.cantidad || 1;
      selTc.value = src.tarjetaId || '';
      pintarBonif(src.bonificacionId || '');
    };
    const elegirFuente = fuente => {
      document.getElementById('src-lista').style.display = fuente === 'lista' ? '' : 'none';
      document.getElementById('src-plan').style.display  = fuente === 'plan'  ? '' : 'none';
      if (fuente === 'lista') pintarOpciones();
      else if (fuente === 'plan') precargarOtro();
      else {
        origen = 'personalizado';
        refs   = { deseoId: null, opcionId: null };
        ['nombre', 'tienda', 'precio', 'enlace'].forEach(k => { campo(k).value = ''; });
      }
    };
    form.querySelectorAll('[name="origenSel"]').forEach(r => r.addEventListener('change', () => elegirFuente(r.value)));
    selDeseo.addEventListener('change', pintarOpciones);
    selOpcion.addEventListener('change', precargarOpcion);
    selOtro.addEventListener('change', precargarOtro);
    elegirFuente(form.querySelector('[name="origenSel"]:checked')?.value || 'personalizado');
  }

  document.getElementById('btn-save-item').addEventListener('click', async () => {
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw = Object.fromEntries(new FormData(form));
    const nuevo = {
      id:             item?.id || nuevoIdOpcion(),
      origen,
      ...refs,
      nombre:         raw.nombre.trim(),
      tienda:         raw.tienda.trim(),
      enlace:         raw.enlace || '',
      precio:         Number(raw.precio) || 0,
      cantidad:       Math.max(1, Number(raw.cantidad) || 1),
      tarjetaId:      raw.tarjetaId || null,
      bonificacionId: raw.bonificacionId || null,
    };
    const items = isEdit
      ? (plan.items || []).map(i => i.id === item.id ? nuevo : i)
      : [...(plan.items || []), nuevo];
    try {
      await update(COL_PLANES, plan.id, { items });
      closeModal();
      toast(isEdit ? 'Artículo actualizado' : 'Artículo agregado al plan');
      recargar();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
