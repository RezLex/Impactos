import { getById, update, getAll } from '../utils/db.js';
import { currency, percent, bankClass } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import { navigate } from '../router.js';

export async function render(container, eventoId) {
  await renderDetalle(container, eventoId);
}

async function renderDetalle(container, eventoId) {
  try {
    const [evento, instituciones, tarjetas] = await Promise.all([
      getById('eventos', eventoId),
      getAll('instituciones'),
      getAll('tarjetas'),
    ]);
    if (!evento) {
      container.innerHTML = `<div class="alert alert-warning">Evento no encontrado.</div>`;
      return;
    }

    const plan       = evento.planCompras       || [];
    const realizadas = evento.comprasRealizadas || [];
    const promos     = evento.promociones       || [];

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>${evento.nombre}</h2>
          <p>${evento.fechaInicio || '—'} al ${evento.fechaFin || '—'}</p>
        </div>
        <button class="btn btn-sm btn-outline-secondary" id="btn-back">
          <i class="bi bi-arrow-left me-1"></i>Volver
        </button>
      </div>

      <!-- Tabs -->
      <ul class="nav nav-tabs mb-4" id="evento-tabs">
        <li class="nav-item">
          <a class="nav-link active" data-bs-toggle="tab" href="#tab-plan">
            <i class="bi bi-list-check me-1"></i>Planeación
            <span class="badge bg-secondary ms-1">${plan.length}</span>
          </a>
        </li>
        <li class="nav-item">
          <a class="nav-link" data-bs-toggle="tab" href="#tab-realizadas">
            <i class="bi bi-bag-check me-1"></i>Realizadas
            <span class="badge bg-secondary ms-1">${realizadas.length}</span>
          </a>
        </li>
        <li class="nav-item">
          <a class="nav-link" data-bs-toggle="tab" href="#tab-promos">
            <i class="bi bi-megaphone me-1"></i>Promociones
          </a>
        </li>
      </ul>

      <div class="tab-content">
        <!-- Plan -->
        <div class="tab-pane fade show active" id="tab-plan">
          <div class="d-flex justify-content-end mb-3">
            <button class="btn btn-primary btn-sm" id="btn-nueva-compra">
              <i class="bi bi-plus-lg me-1"></i>Agregar Producto
            </button>
          </div>
          ${plan.length === 0
            ? `<div class="empty-state"><i class="bi bi-cart"></i><p>Sin productos en planeación</p></div>`
            : plan.map((item, idx) => renderPlanItem(item, idx, instituciones)).join('')
          }
        </div>

        <!-- Realizadas -->
        <div class="tab-pane fade" id="tab-realizadas">
          <div class="d-flex justify-content-end mb-3">
            <button class="btn btn-primary btn-sm" id="btn-nueva-realizada">
              <i class="bi bi-plus-lg me-1"></i>Registrar Compra
            </button>
          </div>
          ${realizadas.length === 0
            ? `<div class="empty-state"><i class="bi bi-bag-x"></i><p>Sin compras realizadas</p></div>`
            : `<div class="data-card">
                <div class="table-wrapper">
                  <table class="table">
                    <thead><tr>
                      <th>Producto</th><th>Tienda</th><th>Banco</th>
                      <th class="text-end">Precio</th><th class="text-end">Desc.</th>
                      <th class="text-end">Final</th><th>MSI</th>
                      <th class="text-end">Mensualidad</th><th>Rastreo</th><th></th>
                    </tr></thead>
                    <tbody>
                      ${realizadas.map((r, idx) => `<tr>
                        <td class="fw-500">${r.producto}</td>
                        <td>${r.tienda}</td>
                        <td><span class="bank-chip ${bankClass(r.banco)}">${r.banco}</span></td>
                        <td class="text-end">${currency(r.precioCompra)}</td>
                        <td class="text-end text-success">${percent(r.descuento)}</td>
                        <td class="text-end fw-bold">${currency(r.precioFinal)}</td>
                        <td>${r.msi > 1 ? r.msi + ' meses' : 'Contado'}</td>
                        <td class="text-end">${r.msi > 1 ? currency(r.precioFinal / r.msi) : '—'}</td>
                        <td>${r.rastreo
                          ? `<a href="${r.seguimientoUrl || '#'}" target="_blank" class="text-primary" title="${r.rastreo}">
                              <i class="bi bi-truck me-1"></i><span style="font-family:monospace;font-size:0.72rem">${r.rastreo.slice(0,12)}…</span>
                            </a>` : '—'}</td>
                        <td>
                          <div class="d-flex gap-1">
                            <button class="btn-icon btn-edit-realizada" data-idx="${idx}"><i class="bi bi-pencil"></i></button>
                            <button class="btn-icon danger btn-del-realizada" data-idx="${idx}"><i class="bi bi-trash3"></i></button>
                          </div>
                        </td>
                      </tr>`).join('')}
                    </tbody>
                    <tfoot><tr>
                      <td colspan="5" class="text-end">TOTAL</td>
                      <td class="text-end fw-bold text-danger">${currency(realizadas.reduce((s,r)=>s+(Number(r.precioFinal)||0),0))}</td>
                      <td colspan="4"></td>
                    </tr></tfoot>
                  </table>
                </div>
              </div>`
          }
        </div>

        <!-- Promos -->
        <div class="tab-pane fade" id="tab-promos">
          <div class="d-flex justify-content-end mb-3">
            <button class="btn btn-primary btn-sm" id="btn-nueva-promo">
              <i class="bi bi-plus-lg me-1"></i>Agregar Promoción
            </button>
          </div>
          ${promos.length === 0
            ? `<div class="empty-state"><i class="bi bi-megaphone"></i><p>Sin promociones registradas</p></div>`
            : `<div class="data-card"><div class="table-wrapper">
                <table class="table">
                  <thead><tr><th>Institución</th><th>Publicación</th><th></th></tr></thead>
                  <tbody>
                    ${promos.map((p, idx) => `<tr>
                      <td><span class="bank-chip ${bankClass(p.institucion)}">${p.institucion}</span></td>
                      <td>${p.url ? `<a href="${p.url}" target="_blank" class="text-primary"><i class="bi bi-link-45deg me-1"></i>Ver publicación</a>` : '—'}</td>
                      <td>
                        <div class="d-flex gap-1">
                          <button class="btn-icon danger btn-del-promo" data-idx="${idx}"><i class="bi bi-trash3"></i></button>
                        </div>
                      </td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div></div>`
          }
        </div>
      </div>`;

    document.getElementById('btn-back').addEventListener('click', () => navigate('/eventos'));

    // Plan actions
    document.getElementById('btn-nueva-compra').addEventListener('click', () =>
      showPlanModal(null, -1, evento, instituciones, container));
    document.querySelectorAll('.btn-edit-plan').forEach(btn =>
      btn.addEventListener('click', () =>
        showPlanModal(plan[+btn.dataset.idx], +btn.dataset.idx, evento, instituciones, container)));
    document.querySelectorAll('.btn-del-plan').forEach(btn =>
      btn.addEventListener('click', async () => {
        const item = plan[+btn.dataset.idx];
        if (!confirmDelete(item.producto)) return;
        plan.splice(+btn.dataset.idx, 1);
        await update('eventos', eventoId, { planCompras: plan });
        toast('Producto eliminado'); renderDetalle(container, eventoId);
      }));
    document.querySelectorAll('.btn-select-opcion').forEach(btn =>
      btn.addEventListener('click', async () => {
        const [piIdx, opIdx] = [+btn.dataset.pi, +btn.dataset.oi];
        plan[piIdx].opcionSeleccionada = opIdx;
        await update('eventos', eventoId, { planCompras: plan });
        toast('Opción seleccionada'); renderDetalle(container, eventoId);
      }));

    // Realizadas actions
    document.getElementById('btn-nueva-realizada').addEventListener('click', () =>
      showRealizadaModal(null, -1, evento, instituciones, container));
    document.querySelectorAll('.btn-edit-realizada').forEach(btn =>
      btn.addEventListener('click', () =>
        showRealizadaModal(realizadas[+btn.dataset.idx], +btn.dataset.idx, evento, instituciones, container)));
    document.querySelectorAll('.btn-del-realizada').forEach(btn =>
      btn.addEventListener('click', async () => {
        realizadas.splice(+btn.dataset.idx, 1);
        await update('eventos', eventoId, { comprasRealizadas: realizadas });
        toast('Compra eliminada'); renderDetalle(container, eventoId);
      }));

    // Promos actions
    document.getElementById('btn-nueva-promo').addEventListener('click', () =>
      showPromoModal(evento, instituciones, container));
    document.querySelectorAll('.btn-del-promo').forEach(btn =>
      btn.addEventListener('click', async () => {
        promos.splice(+btn.dataset.idx, 1);
        await update('eventos', eventoId, { promociones: promos });
        toast('Promoción eliminada'); renderDetalle(container, eventoId);
      }));

  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

function renderPlanItem(item, piIdx, instituciones) {
  const opciones = item.opciones || [];
  // Find best option (lowest mensualidad if MSI>1, else lowest precioFinal)
  const prices = opciones.map(o => {
    const pf = Number(o.precio) * (1 - Number(o.descuento || 0));
    return o.msi > 1 ? pf / Number(o.msi) : pf;
  });
  const bestIdx = prices.length ? prices.indexOf(Math.min(...prices)) : -1;
  const selIdx  = item.opcionSeleccionada ?? -1;

  return `
    <div class="data-card mb-3">
      <div class="data-card-header" style="background:#37474f">
        <span><i class="bi bi-bag me-2"></i>${item.producto}</span>
        <div class="d-flex gap-2">
          <button class="btn-icon btn-edit-plan" data-idx="${piIdx}" style="background:rgba(255,255,255,.15);border-color:rgba(255,255,255,.3);color:white"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger btn-del-plan"  data-idx="${piIdx}" style="background:rgba(255,255,255,.15);border-color:rgba(255,255,255,.3);color:white"><i class="bi bi-trash3"></i></button>
        </div>
      </div>
      <div class="table-wrapper">
        <table class="table">
          <thead><tr>
            <th>Tienda</th><th>Banco / Promo</th>
            <th class="text-end">Precio lista</th><th class="text-end">Desc.</th>
            <th class="text-end">Precio oferta</th><th class="text-center">MSI</th>
            <th class="text-end">Mensualidad</th><th class="text-center">Selección</th>
          </tr></thead>
          <tbody>
            ${opciones.map((o, oi) => {
              const pf   = Number(o.precio) * (1 - Number(o.descuento || 0));
              const mens = o.msi > 1 ? pf / Number(o.msi) : pf;
              const isBest = oi === bestIdx;
              const isSel  = oi === selIdx;
              return `<tr class="${isBest ? 'comparison-row best-option' : ''} ${isSel ? 'selected-option' : ''}">
                <td>${o.tienda}${o.enlace?`<a href="${o.enlace}" target="_blank" class="ms-1 text-muted"><i class="bi bi-box-arrow-up-right"></i></a>`:''}</td>
                <td><span class="bank-chip ${bankClass(o.banco)}">${o.banco}</span></td>
                <td class="text-end">${currency(o.precio)}</td>
                <td class="text-end text-success">${percent(o.descuento)}</td>
                <td class="text-end fw-bold">${currency(pf)}</td>
                <td class="text-center">${o.msi > 1 ? o.msi : 'Contado'}</td>
                <td class="text-end">${o.msi > 1 ? currency(mens) : '—'}
                  ${isBest ? `<span class="best-badge ms-1"><i class="bi bi-star-fill"></i>Mejor</span>` : ''}</td>
                <td class="text-center">
                  ${isSel
                    ? `<span class="badge-tipo badge-pagado">✓ Elegida</span>`
                    : `<button class="btn btn-sm btn-outline-primary btn-select-opcion" data-pi="${piIdx}" data-oi="${oi}">Elegir</button>`
                  }
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function showPlanModal(item, piIdx, evento, instituciones, container) {
  const isEdit = piIdx >= 0 && item;
  const plan   = evento.planCompras || [];
  const instOpts = instituciones.map(i =>
    `<option value="${i.nombre}">${i.nombre}</option>`).join('');

  const existingOpciones = item?.opciones || [];

  openModal({
    title: isEdit ? `Editar: ${item.producto}` : 'Agregar Producto',
    size: 'xl',
    body: `
      <div class="mb-3">
        <label class="form-label">Producto *</label>
        <input type="text" class="form-control" id="prod-nombre" value="${item?.producto || ''}" required placeholder="Ej: Silla Gamer ROG Destrier">
      </div>
      <h6 class="mb-2">Opciones de compra (tienda + banco)</h6>
      <div class="table-wrapper mb-2">
        <table class="table table-sm">
          <thead><tr>
            <th>Tienda</th><th>Enlace</th><th>Precio lista</th><th>Desc. %</th><th>Banco</th><th>MSI</th><th></th>
          </tr></thead>
          <tbody id="opciones-tbody">
            ${existingOpciones.map(o => opcionRow(o, instOpts)).join('')}
            ${emptyOpcionRow(instOpts)}
          </tbody>
        </table>
      </div>
      <button class="btn btn-sm btn-outline-secondary" id="btn-add-opcion">
        <i class="bi bi-plus me-1"></i>Agregar opción
      </button>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-plan">${isEdit ? 'Guardar' : 'Agregar'}</button>`
  });

  document.getElementById('btn-add-opcion').addEventListener('click', () =>
    document.getElementById('opciones-tbody').insertAdjacentHTML('beforeend', emptyOpcionRow(instOpts)));
  document.getElementById('opciones-tbody').addEventListener('click', e => {
    if (e.target.closest('.btn-del-row')) e.target.closest('tr').remove();
  });

  document.getElementById('btn-save-plan').addEventListener('click', async () => {
    const nombre = document.getElementById('prod-nombre').value.trim();
    if (!nombre) { toast('Ingresa el nombre del producto', 'warning'); return; }
    const opciones = [...document.querySelectorAll('#opciones-tbody tr')].map(tr => ({
      tienda:   tr.querySelector('[name=tienda]').value.trim(),
      enlace:   tr.querySelector('[name=enlace]').value.trim(),
      precio:   Number(tr.querySelector('[name=precio]').value) || 0,
      descuento:Number(tr.querySelector('[name=descuento]').value) / 100 || 0,
      banco:    tr.querySelector('[name=banco]').value,
      msi:      Number(tr.querySelector('[name=msi]').value) || 1,
    })).filter(o => o.tienda && o.precio > 0);
    const newItem = { producto: nombre, opciones, opcionSeleccionada: item?.opcionSeleccionada ?? -1 };
    if (isEdit) plan[piIdx] = newItem;
    else        plan.push(newItem);
    try {
      await update('eventos', evento.id, { planCompras: plan });
      closeModal();
      toast(isEdit ? 'Producto actualizado' : 'Producto agregado');
      renderDetalle(container, evento.id);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

function opcionRow(o, instOpts) {
  return `<tr>
    <td><input type="text"   class="form-control form-control-sm" name="tienda"    value="${o.tienda||''}"  placeholder="Tienda" style="min-width:90px"></td>
    <td><input type="url"    class="form-control form-control-sm" name="enlace"    value="${o.enlace||''}"  placeholder="https://..."></td>
    <td><div class="input-group input-group-sm" style="width:110px"><span class="input-group-text">$</span>
        <input type="number" class="form-control" name="precio"    value="${o.precio||0}"   min="0" step="0.01"></div></td>
    <td><div class="input-group input-group-sm" style="width:90px">
        <input type="number" class="form-control" name="descuento" value="${((o.descuento||0)*100).toFixed(0)}" min="0" max="100" step="1">
        <span class="input-group-text">%</span></div></td>
    <td><select class="form-select form-select-sm" name="banco" style="min-width:100px">
        <option value="">—</option>${instOpts.replace(`value="${o.banco}"`,`value="${o.banco}" selected`)}</select></td>
    <td><input type="number" class="form-control form-control-sm" name="msi" value="${o.msi||1}" min="1" max="48" style="width:60px"></td>
    <td><button type="button" class="btn-icon danger btn-del-row"><i class="bi bi-x-lg"></i></button></td>
  </tr>`;
}
const emptyOpcionRow = instOpts => opcionRow({ tienda:'', enlace:'', precio:0, descuento:0, banco:'', msi:1 }, instOpts);

function showRealizadaModal(r, rIdx, evento, instituciones, container) {
  const isEdit    = rIdx >= 0 && r;
  const realizadas= evento.comprasRealizadas || [];
  const instOpts  = instituciones.map(i =>
    `<option value="${i.nombre}" ${r?.banco===i.nombre?'selected':''}>${i.nombre}</option>`).join('');

  openModal({
    title: isEdit ? 'Editar Compra' : 'Registrar Compra Realizada',
    size: 'lg',
    body: `
      <form id="real-form">
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Producto *</label>
            <input type="text" class="form-control" name="producto" value="${r?.producto||''}" required>
          </div>
          <div class="col-md-6">
            <label class="form-label">Tienda *</label>
            <input type="text" class="form-control" name="tienda" value="${r?.tienda||''}" required>
          </div>
          <div class="col-md-4">
            <label class="form-label">Precio compra *</label>
            <div class="input-group"><span class="input-group-text">$</span>
              <input type="number" class="form-control" name="precioCompra" value="${r?.precioCompra||0}" required min="0" step="0.01"></div>
          </div>
          <div class="col-md-4">
            <label class="form-label">Descuento %</label>
            <div class="input-group">
              <input type="number" class="form-control" name="descuentoPct" value="${((r?.descuento||0)*100).toFixed(0)}" min="0" max="100">
              <span class="input-group-text">%</span></div>
          </div>
          <div class="col-md-4">
            <label class="form-label">MSI</label>
            <input type="number" class="form-control" name="msi" value="${r?.msi||1}" min="1" max="48">
          </div>
          <div class="col-md-6">
            <label class="form-label">Banco / Institución</label>
            <select class="form-select" name="banco"><option value="">—</option>${instOpts}</select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Número de rastreo</label>
            <input type="text" class="form-control fw-mono" name="rastreo" value="${r?.rastreo||''}">
          </div>
          <div class="col-md-6">
            <label class="form-label">URL de seguimiento</label>
            <input type="url" class="form-control" name="seguimientoUrl" value="${r?.seguimientoUrl||''}" placeholder="https://...">
          </div>
          <div class="col-md-6">
            <label class="form-label">URL Promodescuentos</label>
            <input type="url" class="form-control" name="promodescuentosUrl" value="${r?.promodescuentosUrl||''}" placeholder="https://...">
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-real">${isEdit ? 'Guardar' : 'Registrar'}</button>`
  });

  document.getElementById('btn-save-real').addEventListener('click', async () => {
    const form = document.getElementById('real-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data     = Object.fromEntries(new FormData(form));
    data.precioCompra = Number(data.precioCompra);
    data.descuento    = Number(data.descuentoPct) / 100;
    data.precioFinal  = data.precioCompra * (1 - data.descuento);
    data.msi          = Number(data.msi);
    delete data.descuentoPct;
    if (isEdit) realizadas[rIdx] = data;
    else        realizadas.push(data);
    try {
      await update('eventos', evento.id, { comprasRealizadas: realizadas });
      closeModal();
      toast(isEdit ? 'Compra actualizada' : 'Compra registrada');
      renderDetalle(container, evento.id);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

function showPromoModal(evento, instituciones, container) {
  const promos  = evento.promociones || [];
  const instOpts= instituciones.map(i =>
    `<option value="${i.nombre}">${i.nombre}</option>`).join('');

  openModal({
    title: 'Nueva Promoción',
    body: `
      <form id="promo-form">
        <div class="mb-3">
          <label class="form-label">Institución</label>
          <select class="form-select" name="institucion" required>
            <option value="">— Seleccionar —</option>${instOpts}
          </select>
        </div>
        <div class="mb-3">
          <label class="form-label">URL de la publicación</label>
          <input type="url" class="form-control" name="url" placeholder="https://...">
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-promo">Agregar</button>`
  });

  document.getElementById('btn-save-promo').addEventListener('click', async () => {
    const form = document.getElementById('promo-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    promos.push(data);
    try {
      await update('eventos', evento.id, { promociones: promos });
      closeModal();
      toast('Promoción agregada');
      renderDetalle(container, evento.id);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
