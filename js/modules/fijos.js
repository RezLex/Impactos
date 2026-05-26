import { getAll, create, update, remove } from '../utils/db.js';
import { currency, maskCard, bankClass } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';

export async function render(container) {
  await renderView(container);
}

async function renderView(container) {
  try {
    const [fijos, instituciones, tarjetas] = await Promise.all([
      getAll('gastosFijos'),
      getAll('instituciones'),
      getAll('tarjetas'),
    ]);

    const total    = fijos.reduce((s, f) => s + (Number(f.importe) || 0), 0);
    const cardMap  = Object.fromEntries(tarjetas.map(t => [t.id, t]));
    const instMap  = Object.fromEntries(instituciones.map(i => [i.id, i]));

    function cardLabel(f) {
      if (!f.tarjetaId) return f.tarjetaNombre || '—';
      const t = cardMap[f.tarjetaId];
      const i = t ? instMap[t.institucionId] : null;
      if (!t) return '—';
      return `${i?.nombre || ''} ${t.nombre} ${maskCard(t.numeroFisico || t.numeroDigital)}`;
    }
    function instLabel(f) {
      if (!f.tarjetaId) return '—';
      const t = cardMap[f.tarjetaId];
      return t ? instMap[t.institucionId]?.nombre || '—' : '—';
    }

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Gastos Fijos</h2>
          <p>${fijos.length} gastos · Total mensual ${currency(total)}</p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-nuevo-fijo">
          <i class="bi bi-plus-lg me-1"></i>Nuevo Gasto
        </button>
      </div>

      <div class="data-card">
        <div class="table-wrapper">
          ${fijos.length === 0
            ? `<div class="empty-state"><i class="bi bi-receipt"></i><p>Sin gastos fijos registrados</p></div>`
            : `<table class="table">
                <thead><tr>
                  <th>Gasto</th><th>Institución</th><th>Tarjeta</th>
                  <th>Día de Cobro</th><th class="text-end">Importe</th><th></th>
                </tr></thead>
                <tbody>
                  ${fijos.map(f => `
                    <tr>
                      <td class="fw-500">${f.nombre}</td>
                      <td><span class="bank-chip ${bankClass(instLabel(f))}">${instLabel(f)}</span></td>
                      <td class="card-number">${cardLabel(f)}</td>
                      <td>${f.diaCobro || '—'}</td>
                      <td class="text-end fw-bold">${currency(f.importe)}</td>
                      <td>
                        <div class="d-flex gap-1 justify-content-end">
                          <button class="btn-icon btn-edit" data-id="${f.id}" title="Editar"><i class="bi bi-pencil"></i></button>
                          <button class="btn-icon danger btn-del"  data-id="${f.id}" title="Eliminar"><i class="bi bi-trash3"></i></button>
                        </div>
                      </td>
                    </tr>`).join('')}
                </tbody>
                <tfoot><tr>
                  <td colspan="4" class="text-end">TOTAL MENSUAL</td>
                  <td class="text-end text-danger fw-bold">${currency(total)}</td>
                  <td></td>
                </tr></tfoot>
              </table>`
          }
        </div>
      </div>`;

    document.getElementById('btn-nuevo-fijo').addEventListener('click', () =>
      showModal(null, instituciones, tarjetas, container));
    document.querySelectorAll('.btn-edit').forEach(btn =>
      btn.addEventListener('click', () =>
        showModal(fijos.find(f => f.id === btn.dataset.id), instituciones, tarjetas, container)));
    document.querySelectorAll('.btn-del').forEach(btn =>
      btn.addEventListener('click', async () => {
        const f = fijos.find(x => x.id === btn.dataset.id);
        if (!confirmDelete(f.nombre)) return;
        await remove('gastosFijos', f.id);
        toast('Gasto eliminado');
        renderView(container);
      }));
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

function showModal(fijo, instituciones, tarjetas, container) {
  const isEdit = !!fijo;
  const tarjetaOptions = tarjetas.map(t => {
    const inst = instituciones.find(i => i.id === t.institucionId);
    return `<option value="${t.id}" ${fijo?.tarjetaId === t.id ? 'selected' : ''}>${inst?.nombre || ''} — ${t.nombre} ${maskCard(t.numeroFisico || t.numeroDigital)}</option>`;
  }).join('');

  openModal({
    title: isEdit ? 'Editar Gasto Fijo' : 'Nuevo Gasto Fijo',
    body: `
      <form id="fijo-form">
        <div class="mb-3">
          <label class="form-label">Nombre del gasto *</label>
          <input type="text" class="form-control" name="nombre" value="${fijo?.nombre || ''}" required placeholder="Ej: Netflix, Gym, Internet">
        </div>
        <div class="mb-3">
          <label class="form-label">Tarjeta / Cuenta</label>
          <select class="form-select" name="tarjetaId">
            <option value="">— Seleccionar —</option>
            ${tarjetaOptions}
          </select>
        </div>
        <div class="mb-3">
          <label class="form-label">Día de cobro</label>
          <input type="text" class="form-control" name="diaCobro" value="${fijo?.diaCobro || ''}" placeholder="Ej: 15, 1er Martes, 1ra Quincena">
        </div>
        <div class="mb-3">
          <label class="form-label">Importe *</label>
          <div class="input-group">
            <span class="input-group-text">$</span>
            <input type="number" class="form-control" name="importe" value="${fijo?.importe || ''}" required min="0" step="0.01" placeholder="0.00">
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save">${isEdit ? 'Guardar' : 'Crear'}</button>`
  });

  document.getElementById('btn-save').addEventListener('click', async () => {
    const form = document.getElementById('fijo-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    data.importe = Number(data.importe);
    try {
      if (isEdit) await update('gastosFijos', fijo.id, data);
      else        await create('gastosFijos', data);
      closeModal();
      toast(isEdit ? 'Gasto actualizado' : 'Gasto creado');
      renderView(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
