import { getAll, create, update, remove } from '../utils/db.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import { navigate } from '../router.js';

const TIPOS = ['Hot Sale','Buen Fin','Cyber Monday','Prime Day','Otro'];
const TIPO_COLORS = {
  'Hot Sale':'#e65100','Buen Fin':'#1b5e20','Cyber Monday':'#0d47a1','Prime Day':'#f57f17','Otro':'#4a148c'
};

export async function render(container) {
  await renderList(container);
}

async function renderList(container) {
  try {
    const eventos = await getAll('eventos');
    eventos.sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''));

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Eventos de Ofertas</h2>
          <p>${eventos.length} eventos registrados</p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-nuevo-evento">
          <i class="bi bi-plus-lg me-1"></i>Nuevo Evento
        </button>
      </div>

      ${eventos.length === 0
        ? `<div class="empty-state"><i class="bi bi-tag"></i><p>Sin eventos registrados.<br>Agrega uno para comenzar la planeación.</p></div>`
        : `<div class="row g-3">
            ${eventos.map(ev => renderEventoCard(ev)).join('')}
          </div>`
      }`;

    document.getElementById('btn-nuevo-evento').addEventListener('click', () =>
      showEventoModal(null, container));
    document.querySelectorAll('.btn-abrir-evento').forEach(btn =>
      btn.addEventListener('click', () => navigate('/eventos/' + btn.dataset.id)));
    document.querySelectorAll('.btn-edit-evento').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        showEventoModal(eventos.find(ev => ev.id === btn.dataset.id), container);
      }));
    document.querySelectorAll('.btn-del-evento').forEach(btn =>
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const ev = eventos.find(x => x.id === btn.dataset.id);
        if (!confirmDelete(ev.nombre)) return;
        await remove('eventos', ev.id);
        toast('Evento eliminado');
        renderList(container);
      }));
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

function renderEventoCard(ev) {
  const color = TIPO_COLORS[ev.tipo] || TIPO_COLORS['Otro'];
  const planCount  = (ev.planCompras || []).length;
  const compCount  = (ev.comprasRealizadas || []).length;
  return `
    <div class="col-md-6 col-lg-4">
      <div class="evento-card" data-id="${ev.id}">
        <div class="evento-card-header" style="background:${color}"></div>
        <div class="evento-card-body">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="evento-card-title">${ev.nombre}</div>
              <div class="evento-card-dates">
                <i class="bi bi-calendar3 me-1"></i>
                ${ev.fechaInicio || '—'} al ${ev.fechaFin || '—'}
              </div>
            </div>
            <div class="d-flex gap-1">
              <button class="btn-icon btn-edit-evento" data-id="${ev.id}" title="Editar"><i class="bi bi-pencil"></i></button>
              <button class="btn-icon danger btn-del-evento" data-id="${ev.id}" title="Eliminar"><i class="bi bi-trash3"></i></button>
            </div>
          </div>
          <div class="d-flex gap-3 mt-3" style="font-size:0.8rem;color:#888">
            <span><i class="bi bi-list-check me-1"></i>${planCount} planeadas</span>
            <span><i class="bi bi-bag-check me-1"></i>${compCount} realizadas</span>
          </div>
          <button class="btn btn-primary btn-sm w-100 mt-3 btn-abrir-evento" data-id="${ev.id}">
            <i class="bi bi-arrow-right-circle me-1"></i>Abrir Evento
          </button>
        </div>
      </div>
    </div>`;
}

function showEventoModal(ev, container) {
  const isEdit = !!ev;
  openModal({
    title: isEdit ? 'Editar Evento' : 'Nuevo Evento',
    body: `
      <form id="evento-form">
        <div class="mb-3">
          <label class="form-label">Nombre *</label>
          <input type="text" class="form-control" name="nombre" value="${ev?.nombre || ''}" required placeholder="Ej: Hot Sale 2026">
        </div>
        <div class="mb-3">
          <label class="form-label">Tipo</label>
          <select class="form-select" name="tipo">
            ${TIPOS.map(t => `<option value="${t}" ${ev?.tipo===t?'selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="row g-2">
          <div class="col-6">
            <label class="form-label">Fecha inicio</label>
            <input type="date" class="form-control" name="fechaInicio" value="${ev?.fechaInicio || ''}">
          </div>
          <div class="col-6">
            <label class="form-label">Fecha fin</label>
            <input type="date" class="form-control" name="fechaFin" value="${ev?.fechaFin || ''}">
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-evento">${isEdit ? 'Guardar' : 'Crear'}</button>`
  });

  document.getElementById('btn-save-evento').addEventListener('click', async () => {
    const form = document.getElementById('evento-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    if (!data.planCompras)       data.planCompras       = ev?.planCompras       || [];
    if (!data.comprasRealizadas) data.comprasRealizadas = ev?.comprasRealizadas || [];
    if (!data.promociones)       data.promociones       = ev?.promociones       || [];
    try {
      if (isEdit) await update('eventos', ev.id, data);
      else        await create('eventos', data);
      closeModal();
      toast(isEdit ? 'Evento actualizado' : 'Evento creado');
      renderList(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
