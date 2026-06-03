import { getAll, create, update, remove } from '../utils/db.js';
import { currency, bankClass, fmtDate } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';

const SEMANAS    = { 1: '1er', 2: '2do', 3: '3er', 4: '4to', [-1]: 'Último' };
const DIAS_SEM   = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' };
const FORMA_PAGO = { automatico: 'Automático', retiro: 'Retiro', transferencia: 'Transferencia' };

function labelSemanaMes(semana, dia) {
  return `${SEMANAS[semana] || semana} ${DIAS_SEM[dia] || dia} de cada mes`;
}

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

    const total   = fijos.reduce((s, f) => s + (Number(f.importe) || 0), 0);
    const cardMap = Object.fromEntries(tarjetas.map(t => [t.id, t]));
    const instMap = Object.fromEntries(instituciones.map(i => [i.id, i]));

    function cardLabel(f) {
      if (!f.tarjetaId) return '—';
      const t = cardMap[f.tarjetaId];
      if (!t) return '—';
      const lastFour = f.numeroTarjeta
        ? String(f.numeroTarjeta).replace(/\s/g, '').slice(-4)
        : (() => {
            const nums = Array.isArray(t.numeros) ? t.numeros : [];
            const n = nums.find(x => x.formato === 'fisica' && x.numero) || nums.find(x => x.numero);
            return n ? String(n.numero).replace(/\s/g, '').slice(-4) : '';
          })();
      return `${t.nombre}${lastFour ? ' ···' + lastFour : ''}`;
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
                  ${[...fijos]
                    .sort((a, b) => {
                      const ia = instLabel(a), ib = instLabel(b);
                      const ic = ia.localeCompare(ib, 'es');
                      return ic !== 0 ? ic : a.nombre.localeCompare(b.nombre, 'es');
                    })
                    .map(f => `
                    <tr>
                      <td>
                        <div class="fw-500">${f.nombre}</div>
                        ${f.formaPago ? `<small class="text-muted">${FORMA_PAGO[f.formaPago] || f.formaPago}</small>` : ''}
                      </td>
                      <td><span class="bank-chip ${bankClass(instLabel(f))}">${instLabel(f)}</span></td>
                      <td class="card-number">${cardLabel(f)}</td>
                      <td>
                        ${f.semanaDelMes && f.diaSemana
                          ? labelSemanaMes(f.semanaDelMes, f.diaSemana)
                          : f.diasIntervalo
                            ? `<span>Cada ${f.diasIntervalo} días</span>${f.fechaInicio ? `<br><small class="text-muted">desde ${fmtDate(f.fechaInicio)}</small>` : ''}`
                            : (f.diaCobro || '—')}
                      </td>
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
  const isEdit  = !!fijo;
  const instMap = Object.fromEntries(instituciones.map(i => [i.id, i]));

  const _opts = (cards, showInst = false) => cards
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .flatMap(t => {
      const numeros    = Array.isArray(t.numeros) ? t.numeros : [];
      const all        = [...numeros.filter(n => n.formato === 'fisica'  && n.numero),
                          ...numeros.filter(n => n.formato === 'digital' && n.numero)];
      const instPrefix = showInst && instMap[t.institucionId]?.nombre
        ? `${instMap[t.institucionId].nombre} — ` : '';
      if (!all.length) {
        const sel = fijo?.tarjetaId === t.id && !fijo?.numeroTarjeta ? 'selected' : '';
        return [`<option value="${t.id}::" ${sel}>${instPrefix}${t.nombre}</option>`];
      }
      return all.map(n => {
        const last4 = String(n.numero).replace(/\s/g, '').slice(-4);
        const tipo  = n.formato === 'fisica' ? 'Física' : 'Digital';
        const sel   = fijo?.tarjetaId === t.id && fijo?.numeroTarjeta === n.numero ? 'selected' : '';
        return `<option value="${t.id}::${n.numero}" ${sel}>${instPrefix}${t.nombre} ···${last4} (${tipo})</option>`;
      });
    }).join('');

  const favoritas = tarjetas.filter(t => t.favorita);
  const normales  = tarjetas.filter(t => !t.favorita);
  const byInst = {};
  normales.forEach(t => {
    const id = t.institucionId || '__';
    if (!byInst[id]) byInst[id] = { inst: instMap[id] || null, cards: [] };
    byInst[id].cards.push(t);
  });

  const cardOptions =
    (favoritas.length ? `<optgroup label="⭐ Favoritas">${_opts(favoritas, true)}</optgroup>` : '') +
    Object.values(byInst)
      .sort((a, b) => (a.inst?.nombre || '').localeCompare(b.inst?.nombre || '', 'es'))
      .map(({ inst, cards }) =>
        `<optgroup label="${inst?.nombre || 'Sin institución'}">${_opts(cards)}</optgroup>`)
      .join('');

  openModal({
    title: isEdit ? 'Editar Gasto Fijo' : 'Nuevo Gasto Fijo',
    body: `
      <form id="fijo-form">
        <div class="mb-3">
          <label class="form-label">Nombre del gasto *</label>
          <input type="text" class="form-control" name="nombre" value="${fijo?.nombre || ''}" required placeholder="Ej: Netflix, Gym, Internet">
        </div>
        <div class="mb-3">
          <label class="form-label">Forma de pago</label>
          <select class="form-select" name="formaPago">
            <option value="">— No especificada —</option>
            <option value="automatico"    ${fijo?.formaPago === 'automatico'    ? 'selected' : ''}>Pago Automático / Domiciliado</option>
            <option value="retiro"        ${fijo?.formaPago === 'retiro'        ? 'selected' : ''}>Retiro</option>
            <option value="transferencia" ${fijo?.formaPago === 'transferencia' ? 'selected' : ''}>Transferencia</option>
          </select>
        </div>
        <div class="mb-3">
          <label class="form-label">Tarjeta / Cuenta</label>
          <select class="form-select" name="tarjetaId">
            <option value="">— Seleccionar —</option>
            ${cardOptions}
          </select>
        </div>
        <div class="mb-3">
          <label class="form-label">Día de cobro</label>
          <input type="text" class="form-control" name="diaCobro" value="${fijo?.diaCobro || ''}" placeholder="Ej: 15, 1er Martes, 1ra Quincena">
        </div>
        <div class="mb-3">
          <label class="form-label">Pago recurrente por intervalo</label>
          <div class="row g-2">
            <div class="col-6">
              <label class="form-label small text-muted mb-1">Fecha de inicio</label>
              <input type="date" class="form-control form-control-sm" name="fechaInicio" value="${(fijo?.fechaInicio || '').slice(0, 10)}">
            </div>
            <div class="col-6">
              <label class="form-label small text-muted mb-1">Intervalo (días)</label>
              <input type="number" class="form-control form-control-sm" name="diasIntervalo" value="${fijo?.diasIntervalo || ''}" min="1" placeholder="Ej: 30">
            </div>
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label">Día de semana del mes</label>
          <div class="row g-2">
            <div class="col-6">
              <label class="form-label small text-muted mb-1">Semana</label>
              <select class="form-select form-select-sm" name="semanaDelMes">
                <option value="">—</option>
                <option value="1"  ${fijo?.semanaDelMes === 1  ? 'selected' : ''}>1era</option>
                <option value="2"  ${fijo?.semanaDelMes === 2  ? 'selected' : ''}>2da</option>
                <option value="3"  ${fijo?.semanaDelMes === 3  ? 'selected' : ''}>3era</option>
                <option value="4"  ${fijo?.semanaDelMes === 4  ? 'selected' : ''}>4ta</option>
                <option value="-1" ${fijo?.semanaDelMes === -1 ? 'selected' : ''}>Última</option>
              </select>
            </div>
            <div class="col-6">
              <label class="form-label small text-muted mb-1">Día</label>
              <select class="form-select form-select-sm" name="diaSemana">
                <option value="">—</option>
                <option value="1" ${fijo?.diaSemana === 1 ? 'selected' : ''}>Lunes</option>
                <option value="2" ${fijo?.diaSemana === 2 ? 'selected' : ''}>Martes</option>
                <option value="3" ${fijo?.diaSemana === 3 ? 'selected' : ''}>Miércoles</option>
                <option value="4" ${fijo?.diaSemana === 4 ? 'selected' : ''}>Jueves</option>
                <option value="5" ${fijo?.diaSemana === 5 ? 'selected' : ''}>Viernes</option>
                <option value="6" ${fijo?.diaSemana === 6 ? 'selected' : ''}>Sábado</option>
                <option value="7" ${fijo?.diaSemana === 7 ? 'selected' : ''}>Domingo</option>
              </select>
            </div>
          </div>
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
    const [tarjetaId, numeroTarjeta] = (data.tarjetaId || '').split('::');
    data.tarjetaId     = tarjetaId     || '';
    data.numeroTarjeta = numeroTarjeta || '';
    if (!data.tarjetaId) { delete data.tarjetaId; delete data.numeroTarjeta; }
    data.importe = Number(data.importe);
    if (!data.formaPago) delete data.formaPago;
    if (data.diasIntervalo) data.diasIntervalo = Number(data.diasIntervalo);
    else { delete data.diasIntervalo; delete data.fechaInicio; }
    if (!data.fechaInicio) delete data.fechaInicio;
    if (data.semanaDelMes && data.diaSemana) {
      data.semanaDelMes = Number(data.semanaDelMes);
      data.diaSemana    = Number(data.diaSemana);
    } else { delete data.semanaDelMes; delete data.diaSemana; }
    try {
      if (isEdit) await update('gastosFijos', fijo.id, data);
      else        await create('gastosFijos', data);
      closeModal();
      toast(isEdit ? 'Gasto actualizado' : 'Gasto creado');
      renderView(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
