import { getAll, create, remove } from '../utils/db.js';
import { fmtDate } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';

export async function render(container) {
  container.innerHTML = `<div class="loading-overlay"><div class="spinner-border text-primary" role="status"></div></div>`;
  await renderView(container);
}

async function renderView(container) {
  try {
    const festivos = await getAll('festivosMX');
    festivos.sort((a, b) => a.fecha.localeCompare(b.fecha));

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Días Festivos</h2>
          <p>${festivos.length} festivos registrados</p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-nuevo-festivo">
          <i class="bi bi-plus-lg me-1"></i>Agregar Festivo
        </button>
      </div>

      <div class="data-card">
        <div class="data-card-header">
          <span><i class="bi bi-calendar-x me-2"></i>Festivos Oficiales</span>
        </div>
        ${festivos.length === 0 ? `
        <div class="empty-state" style="padding:40px 20px">
          <i class="bi bi-calendar-x"></i>
          <p>No hay festivos registrados.<br>Agrega los días festivos oficiales para que el cálculo de fechas de corte y pago sea preciso.</p>
        </div>` : `
        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Descripción</th>
                <th style="width:48px"></th>
              </tr>
            </thead>
            <tbody>
              ${festivos.map(f => `
              <tr>
                <td class="fw-mono">${fmtDate(f.fecha)}</td>
                <td>${f.descripcion || '—'}</td>
                <td>
                  <button class="btn-icon danger btn-del-festivo" data-id="${f.id}" title="Eliminar">
                    <i class="bi bi-trash3"></i>
                  </button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>

      <div class="data-card mt-3">
        <div class="data-card-header">
          <span><i class="bi bi-info-circle me-2"></i>Festivos Federales México</span>
        </div>
        <div class="p-3" style="font-size:0.85rem;color:var(--text-muted)">
          <p class="mb-2">Días festivos oficiales según la Ley Federal del Trabajo:</p>
          <ul class="mb-0" style="padding-left:1.2rem;line-height:1.8">
            <li>1 de enero — Año Nuevo</li>
            <li>Primer lunes de febrero — Aniversario de la Constitución</li>
            <li>Tercer lunes de marzo — Natalicio de Benito Juárez</li>
            <li>1 de mayo — Día del Trabajo</li>
            <li>16 de septiembre — Día de la Independencia</li>
            <li>Tercer lunes de noviembre — Aniversario de la Revolución</li>
            <li>25 de diciembre — Navidad</li>
          </ul>
          <p class="mt-2 mb-0"><i class="bi bi-exclamation-triangle me-1"></i>Los lunes móviles cambian de fecha cada año. Registra las fechas exactas para cada año.</p>
        </div>
      </div>`;

    document.getElementById('btn-nuevo-festivo').addEventListener('click', () => showFestivoModal(container));

    document.querySelectorAll('.btn-del-festivo').forEach(btn =>
      btn.addEventListener('click', async () => {
        const f = festivos.find(x => x.id === btn.dataset.id);
        if (!confirmDelete(fmtDate(f.fecha))) return;
        await remove('festivosMX', f.id);
        toast('Festivo eliminado');
        renderView(container);
      }));

  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

function showFestivoModal(container) {
  openModal({
    title: 'Agregar Día Festivo',
    body: `
      <form id="festivo-form">
        <div class="mb-3">
          <label class="form-label">Fecha *</label>
          <input type="date" class="form-control" name="fecha" required>
        </div>
        <div class="mb-3">
          <label class="form-label">Descripción</label>
          <input type="text" class="form-control" name="descripcion" placeholder="Ej: Año Nuevo">
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-festivo">Agregar</button>`
  });

  document.getElementById('btn-save-festivo').addEventListener('click', async () => {
    const form = document.getElementById('festivo-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw  = Object.fromEntries(new FormData(form));
    const data = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
    try {
      await create('festivosMX', data);
      closeModal();
      toast('Festivo agregado');
      renderView(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
