import { getAll, getById, upsert } from '../utils/db.js';
import {
  currency, fmtShortDate, fmtDate, currentYYYYMM,
  fmtMonth, fmtMonthShort, prevMonth, nextMonth, bankClass
} from '../utils/formatters.js';
import { toast } from '../utils/ui.js';
import { navigate } from '../router.js';

export async function render(container, mesParam) {
  const mes = mesParam || currentYYYYMM();
  await renderView(container, mes);
}

async function renderView(container, mes) {
  try {
    const [impacto, instituciones, tarjetas] = await Promise.all([
      getById('impactoMensual', mes),
      getAll('instituciones'),
      getAll('tarjetas'),
    ]);

    const instMap   = Object.fromEntries(instituciones.map(i => [i.id, i]));
    const cardMap   = Object.fromEntries(tarjetas.map(t => [t.id, t]));
    const registros = impacto?.registros      || [];
    const pagos     = impacto?.pagosDebito    || [];
    const nomina    = impacto?.nomina         || 0;

    const totalPagar   = registros.reduce((s, r) => s + (Number(r.aPagar) || 0), 0);
    const totalPagado  = registros.filter(r => r.pagado).reduce((s, r) => s + (Number(r.aPagar) || 0), 0);
    const totalPagosD  = pagos.reduce((s, p) => s + (Number(p.importe) || 0), 0);
    const restante     = nomina - totalPagar;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Impacto Mensual</h2>
          <p>Estado de tarjetas y pagos</p>
        </div>
        <!-- Month selector -->
        <div class="d-flex align-items-center gap-2">
          <div class="month-selector">
            <button id="btn-prev-month" title="Mes anterior"><i class="bi bi-chevron-left"></i></button>
            <span id="month-label">${fmtMonthShort(mes)}</span>
            <button id="btn-next-month" title="Mes siguiente"><i class="bi bi-chevron-right"></i></button>
          </div>
          <button class="btn btn-primary btn-sm" id="btn-edit-impacto">
            <i class="bi bi-pencil me-1"></i><span class="d-none d-sm-inline">Editar</span>
          </button>
        </div>
      </div>

      <!-- Summary row -->
      <div class="row g-3 mb-4">
        <div class="col-6 col-lg-3">
          <div class="metric-card">
            <div class="metric-icon" style="background:#ffebee">
              <i class="bi bi-cash-coin" style="color:#c62828"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(totalPagar)}</div>
              <div class="metric-label">Total a pagar</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="metric-card">
            <div class="metric-icon" style="background:#e8f5e9">
              <i class="bi bi-check2-circle" style="color:#2e7d32"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(totalPagado)}</div>
              <div class="metric-label">Ya pagado</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="metric-card">
            <div class="metric-icon" style="background:#e3f2fd">
              <i class="bi bi-bank" style="color:#1565c0"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(nomina)}</div>
              <div class="metric-label">Nómina aplicada</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="alert-restante ${restante >= 0 ? 'positivo' : 'negativo'}" style="border-radius:12px;height:100%">
            <i class="bi bi-${restante >= 0 ? 'arrow-up-circle' : 'arrow-down-circle'}"></i>
            <div>
              <div style="font-size:1.3rem">${currency(Math.abs(restante))}</div>
              <div style="font-size:0.72rem;font-weight:400;text-transform:uppercase;letter-spacing:.5px">
                ${restante >= 0 ? 'Restante' : 'Déficit'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Table -->
      <div class="data-card mb-3">
        <div class="data-card-header">
          <span><i class="bi bi-table me-2"></i>Tarjetas — ${fmtMonth(mes)}</span>
        </div>
        <div class="table-wrapper">
          ${registros.length === 0
            ? `<div class="empty-state"><i class="bi bi-calendar-x"></i><p>Sin registros para este mes.<br>Haz clic en "Editar" para agregarlos.</p></div>`
            : `<table class="table">
                <thead><tr>
                  <th>Entidad</th><th class="text-end">Límite</th><th class="text-end">Usado</th>
                  <th class="text-end">Disponible</th><th>Corte</th><th>Límite Pago</th>
                  <th class="text-end">A Pagar</th><th class="text-center">Estado</th>
                </tr></thead>
                <tbody>
                  ${registros.map(r => {
                    const days = r.limitePago ? Math.ceil((new Date(r.limitePago) - new Date()) / 864e5) : null;
                    const statusBadge = r.pagado
                      ? `<span class="badge-tipo badge-pagado">Pagado</span>`
                      : days == null ? ''
                      : days < 0 ? `<span class="badge-tipo badge-vencido">Vencido</span>`
                      : days <= 3 ? `<span class="badge-tipo badge-pendiente">${days}d</span>`
                      : `<span class="badge-tipo badge-pendiente">Pendiente</span>`;
                    return `<tr class="${r.pagado ? 'table-success' : ''}">
                      <td><span class="bank-chip ${bankClass(r.entidad)}">${r.entidad}</span></td>
                      <td class="text-end">${currency(r.limite)}</td>
                      <td class="text-end">${currency(r.usado)}</td>
                      <td class="text-end">${currency(r.disponible)}</td>
                      <td>${fmtShortDate(r.corte)}</td>
                      <td>${fmtShortDate(r.limitePago)}</td>
                      <td class="text-end fw-bold">${currency(r.aPagar)}</td>
                      <td class="text-center">${statusBadge}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
                <tfoot><tr>
                  <td>TOTALES</td><td></td>
                  <td class="text-end">${currency(registros.reduce((s,r)=>s+Number(r.usado||0),0))}</td>
                  <td class="text-end">${currency(registros.reduce((s,r)=>s+Number(r.disponible||0),0))}</td>
                  <td colspan="2"></td>
                  <td class="text-end text-danger">${currency(totalPagar)}</td>
                  <td></td>
                </tr></tfoot>
              </table>`
          }
        </div>
      </div>

      <!-- Pagos desde débito -->
      <div class="row g-3">
        <div class="col-md-6">
          <div class="data-card">
            <div class="data-card-header">
              <span><i class="bi bi-arrow-down-circle me-2"></i>Pagos desde Débito / Nómina</span>
            </div>
            <div class="data-card-body">
              ${pagos.length === 0
                ? `<p class="text-muted small">Sin pagos desde débito registrados.</p>`
                : `<table class="table table-sm mb-0">
                    <tbody>
                      ${pagos.map(p => `<tr>
                        <td><span class="bank-chip ${bankClass(p.banco)}">${p.banco}</span></td>
                        <td class="text-end fw-bold">${currency(p.importe)}</td>
                      </tr>`).join('')}
                    </tbody>
                    <tfoot><tr>
                      <td class="fw-bold">TOTAL</td>
                      <td class="text-end fw-bold">${currency(totalPagosD)}</td>
                    </tr></tfoot>
                  </table>`
              }
            </div>
          </div>
        </div>
        <div class="col-md-6 d-flex flex-column gap-3">
          <div class="data-card flex-grow-1">
            <div class="data-card-body">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="fw-600">Nómina</span>
                <span id="nomina-display" class="fw-bold fs-5">${currency(nomina)}</span>
              </div>
              <div class="d-flex justify-content-between align-items-center mb-2">
                <span>Total a pagar</span>
                <span class="text-danger fw-bold">${currency(totalPagar)}</span>
              </div>
              <hr class="my-2">
              <div class="d-flex justify-content-between align-items-center">
                <span class="fw-bold">Restante</span>
                <span class="fw-bold ${restante >= 0 ? 'text-success' : 'text-danger'}">${currency(restante)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    // Navigation
    document.getElementById('btn-prev-month').addEventListener('click', () =>
      navigate('/impacto/' + prevMonth(mes)));
    document.getElementById('btn-next-month').addEventListener('click', () =>
      navigate('/impacto/' + nextMonth(mes)));
    document.getElementById('btn-edit-impacto').addEventListener('click', () =>
      showEditModal(mes, impacto, instituciones, tarjetas, container));

  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

function showEditModal(mes, impacto, instituciones, tarjetas, container) {
  const registros = impacto?.registros || [];
  const pagos     = impacto?.pagosDebito || [];
  const nomina    = impacto?.nomina || 0;
  const instMap   = Object.fromEntries(instituciones.map(i => [i.id, i]));

  // Build a row for each existing registro + one empty row
  const regRows = [...registros.map(r => regRow(r)), emptyRegRow()].join('');
  const pagoRows = [...pagos.map(p => pagoRow(p, instituciones)), emptyPagoRow(instituciones)].join('');

  const { openModal, closeModal } = { openModal: (cfg) => {
    document.getElementById('modal-container').innerHTML = `
      <div class="modal fade" id="app-modal" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered modal-xl">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Editar Impacto — ${fmtMonth(mes)}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" style="max-height:70vh;overflow-y:auto">
              ${cfg.body}
            </div>
            <div class="modal-footer">${cfg.footer}</div>
          </div>
        </div>
      </div>`;
    const m = new bootstrap.Modal(document.getElementById('app-modal'));
    m.show();
    document.getElementById('app-modal').addEventListener('hidden.bs.modal', () =>
      document.getElementById('modal-container').innerHTML = '', { once: true });
    return m;
  }, closeModal: () => {
    const el = document.getElementById('app-modal');
    if (el) bootstrap.Modal.getInstance(el)?.hide();
  }};

  openModal({
    body: `
      <div class="mb-3">
        <label class="form-label">Ingreso Nómina</label>
        <div class="input-group" style="max-width:200px">
          <span class="input-group-text">$</span>
          <input type="number" class="form-control" id="nomina-input" value="${nomina}" min="0" step="0.01">
        </div>
      </div>

      <h6 class="mb-2">Tarjetas / Líneas de crédito</h6>
      <div class="table-wrapper mb-3">
        <table class="table table-sm" id="reg-table">
          <thead><tr>
            <th>Entidad</th><th>Tipo</th><th>Límite</th><th>Usado</th><th>Corte</th>
            <th>Límite pago</th><th>A Pagar</th><th>Pagado</th><th></th>
          </tr></thead>
          <tbody id="reg-tbody">${regRows}</tbody>
        </table>
        <button class="btn btn-sm btn-outline-secondary" id="btn-add-reg">
          <i class="bi bi-plus me-1"></i>Agregar fila
        </button>
      </div>

      <h6 class="mb-2">Pagos desde débito</h6>
      <div class="table-wrapper">
        <table class="table table-sm" id="pago-table">
          <thead><tr><th>Banco</th><th>Importe</th><th></th></tr></thead>
          <tbody id="pago-tbody">${pagoRows}</tbody>
        </table>
        <button class="btn btn-sm btn-outline-secondary" id="btn-add-pago">
          <i class="bi bi-plus me-1"></i>Agregar fila
        </button>
      </div>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-impacto">Guardar</button>`
  });

  document.getElementById('btn-add-reg').addEventListener('click', () =>
    document.getElementById('reg-tbody').insertAdjacentHTML('beforeend', emptyRegRow()));
  document.getElementById('btn-add-pago').addEventListener('click', () =>
    document.getElementById('pago-tbody').insertAdjacentHTML('beforeend', emptyPagoRow(instituciones)));
  document.getElementById('reg-tbody').addEventListener('click', e => {
    if (e.target.closest('.btn-del-row')) e.target.closest('tr').remove();
  });
  document.getElementById('pago-tbody').addEventListener('click', e => {
    if (e.target.closest('.btn-del-row')) e.target.closest('tr').remove();
  });

  document.getElementById('btn-save-impacto').addEventListener('click', async () => {
    const nomVal = Number(document.getElementById('nomina-input').value) || 0;

    const newRegistros = [...document.querySelectorAll('#reg-tbody tr')].map(tr => ({
      entidad:    tr.querySelector('[name=entidad]').value.trim(),
      tipo:       tr.querySelector('[name=tipo]')?.value || 'credito',
      limite:     Number(tr.querySelector('[name=limite]').value) || 0,
      usado:      Number(tr.querySelector('[name=usado]').value) || 0,
      disponible: Number(tr.querySelector('[name=disponible]').value) || 0,
      corte:      tr.querySelector('[name=corte]').value || null,
      limitePago: tr.querySelector('[name=limitePago]').value || null,
      aPagar:     Number(tr.querySelector('[name=aPagar]').value) || 0,
      pagado:     tr.querySelector('[name=pagado]').checked,
    })).filter(r => r.entidad);

    const newPagos = [...document.querySelectorAll('#pago-tbody tr')].map(tr => ({
      banco:   tr.querySelector('[name=banco]').value.trim(),
      importe: Number(tr.querySelector('[name=importe]').value) || 0,
    })).filter(p => p.banco && p.importe > 0);

    const totalPagarVal = newRegistros.reduce((s, r) => s + r.aPagar, 0);

    try {
      await upsert('impactoMensual', mes, {
        nomina:      nomVal,
        registros:   newRegistros,
        pagosDebito: newPagos,
        total:       totalPagarVal,
        restante:    nomVal - totalPagarVal,
      });
      closeModal();
      toast('Impacto mensual guardado');
      renderView(container, mes);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

function regRow(r) {
  return `<tr>
    <td><input type="text" class="form-control form-control-sm" name="entidad" value="${r.entidad || ''}" placeholder="Entidad" style="min-width:110px"></td>
    <td><select class="form-select form-select-sm" name="tipo" style="min-width:90px">
      <option value="credito" ${r.tipo==='credito'?'selected':''}>Crédito</option>
      <option value="debito"  ${r.tipo==='debito' ?'selected':''}>Débito</option>
    </select></td>
    <td><input type="number" class="form-control form-control-sm" name="limite"     value="${r.limite||0}"     min="0" style="width:90px"></td>
    <td><input type="number" class="form-control form-control-sm" name="usado"      value="${r.usado||0}"      min="0" style="width:90px"></td>
    <td><input type="number" class="form-control form-control-sm" name="disponible" value="${r.disponible||0}" min="0" style="width:90px"></td>
    <td><input type="date"   class="form-control form-control-sm" name="corte"      value="${r.corte||''}"></td>
    <td><input type="date"   class="form-control form-control-sm" name="limitePago" value="${r.limitePago||''}"></td>
    <td><input type="number" class="form-control form-control-sm" name="aPagar"     value="${r.aPagar||0}"     min="0" style="width:90px"></td>
    <td class="text-center"><input type="checkbox" name="pagado" ${r.pagado?'checked':''}></td>
    <td><button type="button" class="btn-icon danger btn-del-row"><i class="bi bi-x-lg"></i></button></td>
  </tr>`;
}
const emptyRegRow = () => regRow({ entidad:'', tipo:'credito', limite:0, usado:0, disponible:0, corte:'', limitePago:'', aPagar:0, pagado:false });

function pagoRow(p, instituciones) {
  const opts = instituciones.map(i =>
    `<option value="${i.nombre}" ${p.banco===i.nombre?'selected':''}>${i.nombre}</option>`).join('');
  return `<tr>
    <td><select class="form-select form-select-sm" name="banco" style="min-width:130px">
      <option value="">— Banco —</option>${opts}
    </select></td>
    <td><div class="input-group input-group-sm" style="width:140px">
      <span class="input-group-text">$</span>
      <input type="number" class="form-control" name="importe" value="${p.importe||0}" min="0" step="0.01">
    </div></td>
    <td><button type="button" class="btn-icon danger btn-del-row"><i class="bi bi-x-lg"></i></button></td>
  </tr>`;
}
const emptyPagoRow = inst => pagoRow({ banco:'', importe:0 }, inst);
