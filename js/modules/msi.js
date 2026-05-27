import { getAll, create, update, remove } from '../utils/db.js';
import { currency, fmtDate } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import { calcularMes, toISODate, anteriorNomina } from '../utils/ciclo.js';

export async function render(container) {
  await renderView(container);
}

async function renderView(container) {
  try {
    const [msiItems, instituciones, tarjetas, festivosMX] = await Promise.all([
      getAll('msi'),
      getAll('instituciones'),
      getAll('tarjetas'),
      getAll('festivosMX'),
    ]);

    const instMap     = Object.fromEntries(instituciones.map(i => [i.id, i]));
    const cardMap     = Object.fromEntries(tarjetas.map(t => [t.id, { ...t, inst: instMap[t.institucionId] }]));
    const creditCards = tarjetas.filter(t => t.tipo === 'credito');

    const byInst = {};
    msiItems.forEach(m => {
      const card   = cardMap[m.tarjetaId];
      const instId = card?.institucionId || '__sin_inst__';
      if (!byInst[instId]) byInst[instId] = { inst: instMap[instId] || null, items: [] };
      byInst[instId].items.push(m);
    });

    const deudaTotal       = msiItems.reduce((s, m) => s + (Number(m.restante) || 0), 0);
    const mensualidadTotal = msiItems.reduce((s, m) => s + (Number(m.mensualidad) || 0), 0);
    const groups           = Object.values(byInst).filter(g => g.items.length > 0);

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Meses Sin Intereses</h2>
          <p>${msiItems.length} compras activas</p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-nuevo-msi">
          <i class="bi bi-plus-lg me-1"></i>Nueva Compra MSI
        </button>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-6">
          <div class="metric-card">
            <div class="metric-icon" style="background:#ffebee">
              <i class="bi bi-credit-card-fill" style="color:#c62828"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(deudaTotal)}</div>
              <div class="metric-label">Deuda total restante</div>
            </div>
          </div>
        </div>
        <div class="col-6">
          <div class="metric-card">
            <div class="metric-icon" style="background:#e3f2fd">
              <i class="bi bi-calendar-check" style="color:#1565c0"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(mensualidadTotal)}</div>
              <div class="metric-label">Mensualidad combinada</div>
            </div>
          </div>
        </div>
      </div>

      ${groups.length === 0
        ? `<div class="empty-state"><i class="bi bi-calendar-x"></i><p>Sin compras MSI registradas</p></div>`
        : `<div class="accordion" id="msi-accordion">
            ${groups.map((g, idx) => renderGroup(g, idx, cardMap, festivosMX)).join('')}
          </div>`
      }`;

    document.getElementById('btn-nuevo-msi').addEventListener('click', () =>
      showModal(null, instituciones, tarjetas, container));
    document.querySelectorAll('.btn-edit-msi').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        showModal(msiItems.find(m => m.id === btn.dataset.id), instituciones, tarjetas, container);
      }));
    document.querySelectorAll('.btn-del-msi').forEach(btn =>
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const m = msiItems.find(x => x.id === btn.dataset.id);
        if (!confirmDelete(m.compra)) return;
        await remove('msi', m.id);
        toast('Compra eliminada');
        renderView(container);
      }));
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

// Derives primerPago and ultimoPago from the card's ciclo and the purchase date
function calcularPagos(ciclo, fechaCompra, mesesTotal, festivosMX) {
  if (!ciclo || !fechaCompra || !mesesTotal) return { primerPago: null, ultimoPago: null };

  const compra = new Date(fechaCompra + 'T12:00:00');
  let year  = compra.getFullYear();
  let month = compra.getMonth();
  let periodo = calcularMes(ciclo, year, month, festivosMX);

  // If the cut-off already passed before the purchase date, advance to the next cycle
  if (periodo.fechaCorte < compra) {
    const next = new Date(year, month + 1, 1);
    year   = next.getFullYear();
    month  = next.getMonth();
    periodo = calcularMes(ciclo, year, month, festivosMX);
  }

  if (!periodo.fechaPago) return { primerPago: null, ultimoPago: null };

  const primerPago = periodo.fechaPago;

  // Last payment = payment of the cycle (mesesTotal - 1) months after the first cycle
  const lastDate    = new Date(year, month + (mesesTotal - 1), 1);
  const lastPeriodo = calcularMes(ciclo, lastDate.getFullYear(), lastDate.getMonth(), festivosMX);

  return { primerPago, ultimoPago: lastPeriodo.fechaPago };
}

function renderGroup({ inst, items }, idx, cardMap, festivosMX) {
  const label = inst?.nombre || 'Sin institución';
  const color = inst?.color  || '#607d8b';
  const deuda = items.reduce((s, m) => s + (Number(m.restante) || 0), 0);
  const mens  = items.reduce((s, m) => s + (Number(m.mensualidad) || 0), 0);

  return `
    <div class="accordion-item mb-2">
      <h2 class="accordion-header">
        <button class="accordion-button ${idx > 0 ? 'collapsed' : ''}" type="button"
                data-bs-toggle="collapse" data-bs-target="#acc-${idx}">
          <span style="width:10px;height:10px;border-radius:50%;background:${color};margin-right:10px;flex-shrink:0"></span>
          <span class="flex-grow-1">${label}</span>
          <span class="ms-auto me-3 d-flex gap-3" style="font-size:0.8rem;color:#888">
            <span>Deuda: <strong>${currency(deuda)}</strong></span>
            <span class="d-none d-sm-inline">Mensualidad: <strong>${currency(mens)}</strong></span>
          </span>
        </button>
      </h2>
      <div id="acc-${idx}" class="accordion-collapse collapse ${idx === 0 ? 'show' : ''}">
        <div class="accordion-body p-0">
          <div class="table-wrapper">
            <table class="table">
              <thead><tr>
                <th>Compra</th><th>Tarjeta</th><th class="text-center">Meses</th>
                <th class="text-end">Mensualidad</th><th class="text-end">Restante</th>
                <th>Primer Pago</th><th>Último Pago</th><th></th>
              </tr></thead>
              <tbody>
                ${items.map(m => {
                  const tc = cardMap[m.tarjetaId];
                  const { primerPago, ultimoPago } = calcularPagos(
                    tc?.ciclo, m.fechaCompra, Number(m.mesesTotal) || 0, festivosMX
                  );
                  const nomPrimero = primerPago ? anteriorNomina(primerPago, festivosMX) : null;
                  const nomUltimo  = ultimoPago  ? anteriorNomina(ultimoPago,  festivosMX) : null;

                  const numeros   = Array.isArray(tc?.numeros) ? tc.numeros : [];
                  const primerNum = (numeros.find(n => n.formato === 'fisica' && n.numero) || numeros.find(n => n.numero))?.numero || '';
                  const lastFour  = primerNum ? String(primerNum).replace(/\s/g, '').slice(-4) : '';

                  const pct  = Math.round((Number(m.mesesPagados) || 0) / (Number(m.mesesTotal) || 1) * 100);
                  const done = Number(m.restante) <= 0;
                  return `<tr class="${done ? 'table-success' : ''}">
                    <td>
                      <div class="fw-500">${m.compra}</div>
                      <div class="progress mt-1" style="width:120px">
                        <div class="progress-bar ${done ? 'bg-success' : 'bg-primary'}" style="width:${pct}%"></div>
                      </div>
                    </td>
                    <td style="white-space:nowrap">${tc?.nombre || '—'}${lastFour ? ' ···' + lastFour : ''}</td>
                    <td class="text-center">${m.mesesPagados || 0}/${m.mesesTotal || 0}</td>
                    <td class="text-end">${currency(m.mensualidad)}</td>
                    <td class="text-end ${done ? 'text-success' : 'fw-bold'}">${done ? '✓ Pagado' : currency(m.restante)}</td>
                    <td style="white-space:nowrap">${nomPrimero ? fmtDate(toISODate(nomPrimero)) : '—'}</td>
                    <td style="white-space:nowrap">${nomUltimo  ? fmtDate(toISODate(nomUltimo))  : '—'}</td>
                    <td>
                      <div class="d-flex gap-1">
                        <button class="btn-icon btn-edit-msi" data-id="${m.id}"><i class="bi bi-pencil"></i></button>
                        <button class="btn-icon danger btn-del-msi" data-id="${m.id}"><i class="bi bi-trash3"></i></button>
                      </div>
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function showModal(msi, instituciones, tarjetas, container) {
  const isEdit      = !!msi;
  const creditCards = tarjetas.filter(t => t.tipo === 'credito');
  const instMap     = Object.fromEntries(instituciones.map(i => [i.id, i]));
  const cardOptions = creditCards.map(t =>
    `<option value="${t.id}" ${msi?.tarjetaId === t.id ? 'selected' : ''}>${instMap[t.institucionId]?.nombre || ''} — ${t.nombre}</option>`
  ).join('');

  openModal({
    title: isEdit ? 'Editar Compra MSI' : 'Nueva Compra MSI',
    size: 'lg',
    body: `
      <form id="msi-form">
        <div class="row g-3">
          <div class="col-12">
            <label class="form-label">Descripción *</label>
            <input type="text" class="form-control" name="compra" value="${msi?.compra || ''}" required placeholder="Ej: Amazon — Teclado">
          </div>
          <div class="col-md-6">
            <label class="form-label">Tarjeta *</label>
            <select class="form-select" name="tarjetaId" required>
              <option value="">— Seleccionar —</option>
              ${cardOptions}
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Fecha de compra *</label>
            <input type="date" class="form-control" name="fechaCompra" value="${msi?.fechaCompra || ''}" required>
          </div>
          <div class="col-md-6">
            <label class="form-label">Total de la compra *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="total" value="${msi?.total || ''}" required min="0" step="0.01">
            </div>
          </div>
          <div class="col-md-3">
            <label class="form-label">Meses totales *</label>
            <input type="number" class="form-control" name="mesesTotal" value="${msi?.mesesTotal || ''}" required min="1" max="48">
          </div>
          <div class="col-md-3">
            <label class="form-label">Meses pagados</label>
            <input type="number" class="form-control" name="mesesPagados" value="${msi?.mesesPagados || 0}" min="0">
          </div>
          <div class="col-md-6">
            <label class="form-label">Mensualidad *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="mensualidad" value="${msi?.mensualidad || ''}" required min="0" step="0.01">
            </div>
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-msi">${isEdit ? 'Guardar' : 'Crear'}</button>`
  });

  // Auto-calculate mensualidad when total or mesesTotal change
  ['total', 'mesesTotal'].forEach(name => {
    document.querySelector(`[name="${name}"]`).addEventListener('input', () => {
      const total = Number(document.querySelector('[name=total]').value);
      const meses = Number(document.querySelector('[name=mesesTotal]').value);
      if (total > 0 && meses > 0)
        document.querySelector('[name=mensualidad]').value = (total / meses).toFixed(2);
    });
  });

  document.getElementById('btn-save-msi').addEventListener('click', async () => {
    const form = document.getElementById('msi-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data        = Object.fromEntries(new FormData(form));
    data.total        = Number(data.total);
    data.mensualidad  = Number(data.mensualidad);
    data.mesesTotal   = Number(data.mesesTotal);
    data.mesesPagados = Number(data.mesesPagados);
    data.restante     = Math.max(0, data.total - data.mensualidad * data.mesesPagados);
    try {
      if (isEdit) await update('msi', msi.id, data);
      else        await create('msi', data);
      closeModal();
      toast(isEdit ? 'MSI actualizado' : 'Compra MSI creada');
      renderView(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
