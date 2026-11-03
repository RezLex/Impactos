import { getAll, create, update, remove } from '../utils/db.js';
import { currency, fmtDate } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import { toISODate } from '../utils/ciclo.js';
import { calcularDistribucion, reglaBonificacion, estadoBonificacion, baseCompra, MESES_COMUNES } from '../utils/bonificaciones.js';

const COL = 'bonificaciones';

const ESTADO_BADGE = {
  vigente:  '<span class="badge bg-warning-subtle text-warning-emphasis">Vigente</span>',
  vencida:  '<span class="badge bg-danger-subtle text-danger">Vencida</span>',
  aplicada: '<span class="badge bg-success-subtle text-success">Aplicada</span>',
};
const TIPO_BADGE = {
  contado: '<span class="badge bg-success-subtle text-success">De Contado</span>',
  msi:     '<span class="badge bg-primary-subtle text-primary">A Plazos</span>',
};

// Se recuerda entre navegaciones dentro de la sesión.
let filtroEstado = 'activas'; // 'activas' | 'aplicadas' | 'todas'

export async function render(container) {
  await renderView(container);
}

async function renderView(container) {
  try {
    const [bonificaciones, instituciones, tarjetas, contado, msi] = await Promise.all([
      getAll(COL), getAll('instituciones'), getAll('tarjetas'), getAll('contado'), getAll('msi'),
    ]);
    const instMap = Object.fromEntries(instituciones.map(i => [i.id, i]));
    const cardMap = Object.fromEntries(tarjetas.map(t => [t.id, t]));
    const ligadas = [
      ...contado.filter(c => c.bonificacionId).map(c => ({ ...c, _col: 'contado' })),
      ...msi.filter(m => m.bonificacionId).map(m => ({ ...m, _col: 'msi' })),
    ];
    const hoy = toISODate(new Date());

    const visibles = bonificaciones
      .filter(b => filtroEstado === 'todas' || (filtroEstado === 'aplicadas' ? b.aplicada : !b.aplicada))
      .sort((a, b) => (a.fechaMaxima || '').localeCompare(b.fechaMaxima || ''));

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Bonificaciones</h2>
          <p>${bonificaciones.length} bonificaci${bonificaciones.length !== 1 ? 'ones' : 'ón'} · ${ligadas.length} compra${ligadas.length !== 1 ? 's' : ''} ligada${ligadas.length !== 1 ? 's' : ''}</p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-nueva-bonif">
          <i class="bi bi-plus-lg me-1"></i>Nueva Bonificación
        </button>
      </div>
      <div class="filter-bar">
        <div class="filter-chips">
          <button class="filter-chip ${filtroEstado === 'activas'   ? 'active' : ''}" data-estado="activas">Activas</button>
          <button class="filter-chip ${filtroEstado === 'aplicadas' ? 'active' : ''}" data-estado="aplicadas">Aplicadas</button>
          <button class="filter-chip ${filtroEstado === 'todas'     ? 'active' : ''}" data-estado="todas">Todas</button>
        </div>
      </div>
      ${visibles.length === 0
        ? `<div class="empty-state"><i class="bi bi-gift"></i><p>Sin bonificaciones ${filtroEstado === 'aplicadas' ? 'aplicadas' : filtroEstado === 'activas' ? 'activas' : ''}.<br>Crea una para ligarla a tus compras.</p></div>`
        : visibles.map(b => renderBonificacion(b, instMap, cardMap, ligadas.filter(c => c.bonificacionId === b.id), hoy)).join('')}`;

    const recargar = () => {
      const y = window.scrollY;
      return renderView(container).then(() => window.scrollTo(0, y));
    };

    container.querySelectorAll('[data-estado]').forEach(btn =>
      btn.addEventListener('click', () => { filtroEstado = btn.dataset.estado; renderView(container); }));
    document.getElementById('btn-nueva-bonif').addEventListener('click', () =>
      showBonifModal(null, instituciones, recargar));
    container.querySelectorAll('.btn-edit-bonif').forEach(btn =>
      btn.addEventListener('click', () =>
        showBonifModal(bonificaciones.find(b => b.id === btn.dataset.id), instituciones, recargar)));
    container.querySelectorAll('.btn-aplicada-bonif').forEach(btn =>
      btn.addEventListener('click', async () => {
        const b = bonificaciones.find(x => x.id === btn.dataset.id);
        try {
          await update(COL, b.id, { aplicada: !b.aplicada });
          toast(b.aplicada ? 'Bonificación marcada como pendiente' : 'Bonificación marcada como aplicada');
          recargar();
        } catch (e) { toast('Error: ' + e.message, 'danger'); }
      }));
    container.querySelectorAll('.btn-del-bonif').forEach(btn =>
      btn.addEventListener('click', async () => {
        const b = bonificaciones.find(x => x.id === btn.dataset.id);
        const suyas = ligadas.filter(c => c.bonificacionId === b.id);
        if (!confirmDelete(b.nombre)) return;
        if (suyas.length && !confirm(`Tiene ${suyas.length} compra(s) ligada(s). Se desligarán y quedarán sin bonificación.\n¿Continuar?`)) return;
        try {
          await Promise.all(suyas.map(c => update(c._col, c.id, { bonificacionId: null, folioOrden: null })));
          await remove(COL, b.id);
          toast('Bonificación eliminada');
          recargar();
        } catch (e) { toast('Error: ' + e.message, 'danger'); }
      }));
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

function renderBonificacion(b, instMap, cardMap, compras, hoy) {
  const inst   = instMap[b.institucionId];
  const estado = estadoBonificacion(b, hoy);
  const porOrden = b.minimoPor !== 'acumulado';
  const dist   = calcularDistribucion(b, compras, !!inst?.bonificacionConIva);
  const acumulado = !porOrden ? dist.grupos[0] : null;

  const enlaces = [
    b.enlace    ? `<a href="${b.enlace}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right me-1"></i>Promoción</a>` : '',
    b.enlaceTyc ? `<a href="${b.enlaceTyc}" target="_blank" rel="noopener"><i class="bi bi-file-earmark-text me-1"></i>TyCs</a>` : '',
  ].filter(Boolean).join(' · ');

  const resumen = [
    `<span><strong>${compras.length}</strong> compra${compras.length !== 1 ? 's' : ''}</span>`,
    `<span>Suma <strong>${currency(dist.sumaBase)}</strong></span>`,
    `<span>Bonificación esperada <strong class="${estado === 'aplicada' ? 'text-success' : ''}">${currency(dist.esperado)}</strong>${dist.topado ? ` <span class="badge bg-secondary-subtle text-secondary-emphasis" title="Sin tope serían ${currency(dist.sinTope)}">tope</span>` : ''}</span>`,
    acumulado && !acumulado.califica && compras.length
      ? `<span class="text-danger">Faltan ${currency(acumulado.faltante)} para el mínimo acumulado</span>` : '',
  ].filter(Boolean).join('<span class="text-muted">·</span>');

  // Por compra: filas agrupadas por folio, con la celda del folio abarcando su orden.
  const grupos = [...dist.grupos].sort((a, b2) => (a.folio || '~').localeCompare(b2.folio || '~'));
  const filas = grupos.flatMap(g => {
    const ordenadas = [...g.compras].sort((a, c) => (a.fechaCompra || '').localeCompare(c.fechaCompra || ''));
    return ordenadas.map((c, idx) => {
      const d  = dist.porCompra.get(c.id);
      const tc = cardMap[c.tarjetaId];
      const folioCell = porOrden && idx === 0
        ? `<td rowspan="${ordenadas.length}" style="white-space:nowrap;vertical-align:top">
             <div class="fw-500">${g.folio || '<span class="text-muted">Sin folio</span>'}</div>
             <small class="text-muted">${currency(g.base)}</small><br>
             ${g.califica
               ? '<small class="text-success"><i class="bi bi-check-circle me-1"></i>Califica</small>'
               : `<small class="text-danger" title="Mínimo ${currency(b.montoMinimo)}">Faltan ${currency(g.faltante)}</small>`}
           </td>`
        : '';
      return `<tr>
        ${folioCell}
        <td>${TIPO_BADGE[c._col]}</td>
        <td><div class="fw-500">${c.compra || '—'}</div></td>
        <td style="white-space:nowrap">${tc?.nombre || '—'}</td>
        <td style="white-space:nowrap">${fmtDate(c.fechaCompra)}</td>
        <td class="text-end">${currency(baseCompra(c))}</td>
        <td class="text-end fw-bold ${d.califica ? '' : 'text-muted'}">${currency(d.monto)}</td>
        <td class="text-end ${d.califica ? '' : 'text-muted'}">${d.pct.toFixed(1)}%</td>
      </tr>`;
    });
  }).join('');

  return `
    <div class="data-card">
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 p-3">
        <div>
          <div class="fw-bold d-flex align-items-center gap-2 flex-wrap">
            <span class="d-inline-block rounded-circle" style="width:10px;height:10px;background:${inst?.color || '#607d8b'}"></span>
            ${b.nombre} ${ESTADO_BADGE[estado]}
          </div>
          <small class="text-muted">
            ${inst?.nombre || 'Sin institución'} · ${reglaBonificacion(b, currency)} · vence ${fmtDate(b.fechaMaxima)}
            ${inst?.bonificacionConIva ? ' · +IVA' : ''}${enlaces ? ` · ${enlaces}` : ''}
          </small>
        </div>
        <div class="d-flex gap-1">
          <button class="btn-icon btn-aplicada-bonif" data-id="${b.id}" title="${b.aplicada ? 'Marcar como pendiente' : 'Marcar como aplicada'}">
            <i class="bi ${b.aplicada ? 'bi-arrow-counterclockwise' : 'bi-check2-circle'}"></i>
          </button>
          <button class="btn-icon btn-edit-bonif" data-id="${b.id}" title="Editar"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger btn-del-bonif" data-id="${b.id}" title="Eliminar"><i class="bi bi-trash3"></i></button>
        </div>
      </div>
      <div class="d-flex flex-wrap gap-2 px-3 pb-3" style="font-size:0.85rem">${resumen}</div>
      ${compras.length === 0
        ? `<div class="px-3 pb-3 text-muted" style="font-size:0.85rem">Sin compras ligadas. Lígalas desde el modal de compra en "Esperar bonificación / cashback".</div>`
        : `<div class="table-wrapper">
            <table class="table mb-0">
              <thead><tr>
                ${porOrden ? '<th>Folio</th>' : ''}
                <th>Tipo</th><th>Compra</th><th>Tarjeta</th><th>Fecha</th>
                <th class="text-end">Total</th><th class="text-end">Bonificación</th><th class="text-end">% de la compra</th>
              </tr></thead>
              <tbody>${filas}</tbody>
            </table>
          </div>`}
    </div>`;
}

function showBonifModal(bonif, instituciones, onSaved) {
  const isEdit = !!bonif;
  const insts = [...instituciones].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));

  openModal({
    title: isEdit ? 'Editar Bonificación' : 'Nueva Bonificación',
    size: 'lg',
    body: `
      <form id="bonif-form">
        <div class="row g-3">
          <div class="col-md-7">
            <label class="form-label">Nombre *</label>
            <input type="text" class="form-control" name="nombre" value="${bonif?.nombre || ''}" required placeholder="Ej: Buen Fin 10%">
          </div>
          <div class="col-md-5">
            <label class="form-label">Institución *</label>
            <select class="form-select" name="institucionId" required>
              <option value="">— Seleccionar —</option>
              ${insts.map(i => `<option value="${i.id}" ${bonif?.institucionId === i.id ? 'selected' : ''}>${i.nombre}</option>`).join('')}
            </select>
          </div>
          <div class="col-4">
            <label class="form-label">Tipo *</label>
            <select class="form-select" name="tipo">
              <option value="porcentaje" ${(!bonif || bonif.tipo === 'porcentaje') ? 'selected' : ''}>% Porcentaje</option>
              <option value="cantidad"   ${bonif?.tipo === 'cantidad' ? 'selected' : ''}>$ Cantidad</option>
            </select>
          </div>
          <div class="col-4">
            <label class="form-label">Valor *</label>
            <input type="number" class="form-control" name="valor" value="${bonif?.valor ?? ''}" required min="0" step="0.01">
          </div>
          <div class="col-4">
            <label class="form-label">Fecha máxima *</label>
            <input type="date" class="form-control" name="fechaMaxima" value="${bonif?.fechaMaxima || ''}" required>
          </div>
          <div class="col-md-4">
            <label class="form-label">Monto mínimo</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="montoMinimo" value="${bonif?.montoMinimo || ''}" min="0" step="0.01" placeholder="Sin mínimo">
            </div>
          </div>
          <div class="col-md-4">
            <label class="form-label">Mínimo se valida</label>
            <select class="form-select" name="minimoPor">
              <option value="compra"    ${bonif?.minimoPor !== 'acumulado' ? 'selected' : ''}>Por compra (folio de orden)</option>
              <option value="acumulado" ${bonif?.minimoPor === 'acumulado' ? 'selected' : ''}>Acumulado de las compras</option>
            </select>
          </div>
          <div class="col-md-4">
            <label class="form-label">Bonificación máxima</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="montoMaximo" value="${bonif?.montoMaximo || ''}" min="0" step="0.01" placeholder="Sin tope">
            </div>
          </div>
          <div class="col-md-5">
            <label class="form-label">Aplica a</label>
            <select class="form-select" name="aplicaA" id="bonif-aplica-a">
              <option value="ambos"   ${(!bonif || !bonif.aplicaA || bonif.aplicaA === 'ambos') ? 'selected' : ''}>De Contado y A Plazos (MSI)</option>
              <option value="contado" ${bonif?.aplicaA === 'contado' ? 'selected' : ''}>Solo De Contado</option>
              <option value="msi"     ${bonif?.aplicaA === 'msi' ? 'selected' : ''}>Solo A Plazos (MSI)</option>
            </select>
          </div>
          <div class="col-md-7" id="bonif-meses-wrap" style="${bonif?.aplicaA === 'contado' ? 'display:none' : ''}">
            <label class="form-label">Mensualidades que aplican <small class="text-muted">(ninguna = todas)</small></label>
            <div class="d-flex flex-wrap gap-3 pt-1">
              ${MESES_COMUNES.map(m => `
                <div class="form-check form-check-inline">
                  <input class="form-check-input" type="checkbox" name="mesesAplican" value="${m}" id="bonif-mes-${m}" ${(bonif?.mesesAplican || []).includes(m) ? 'checked' : ''}>
                  <label class="form-check-label" for="bonif-mes-${m}">${m}</label>
                </div>`).join('')}
            </div>
          </div>
          <div class="col-12 form-text mt-1">
            <strong>Por compra:</strong> cada orden (compras con el mismo folio) debe alcanzar el mínimo; con tipo cantidad, el monto se otorga por cada orden que califica.
            <strong>Acumulado:</strong> la suma de todas las compras ligadas debe alcanzarlo.
            La bonificación máxima topa el total y se reparte proporcionalmente. Si la institución bonifica con IVA, se suma el 16%.
          </div>
          <div class="col-md-6">
            <label class="form-label">Enlace de la promoción</label>
            <input type="url" class="form-control" name="enlace" value="${bonif?.enlace || ''}" placeholder="https://...">
          </div>
          <div class="col-md-6">
            <label class="form-label">Enlace de TyCs</label>
            <input type="url" class="form-control" name="enlaceTyc" value="${bonif?.enlaceTyc || ''}" placeholder="https://...">
          </div>
          <div class="col-12">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" name="aplicada" id="bonif-mod-aplicada" ${bonif?.aplicada ? 'checked' : ''}>
              <label class="form-check-label text-success" for="bonif-mod-aplicada">Ya recibida / aplicada</label>
            </div>
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-bonif">${isEdit ? 'Guardar' : 'Crear'}</button>`,
  });

  document.getElementById('bonif-aplica-a').addEventListener('change', e =>
    document.getElementById('bonif-meses-wrap').style.display = e.target.value === 'contado' ? 'none' : '');

  document.getElementById('btn-save-bonif').addEventListener('click', async () => {
    const form = document.getElementById('bonif-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw = Object.fromEntries(new FormData(form));
    const aplicaA = ['contado', 'msi'].includes(raw.aplicaA) ? raw.aplicaA : 'ambos';
    const data = {
      nombre:        raw.nombre.trim(),
      institucionId: raw.institucionId,
      tipo:          raw.tipo,
      valor:         Number(raw.valor) || 0,
      fechaMaxima:   raw.fechaMaxima,
      montoMinimo:   Number(raw.montoMinimo) || 0,
      minimoPor:     raw.minimoPor === 'acumulado' ? 'acumulado' : 'compra',
      montoMaximo:   Number(raw.montoMaximo) || 0,
      aplicaA,
      mesesAplican:  aplicaA === 'contado' ? [] : [...form.querySelectorAll('[name="mesesAplican"]:checked')].map(el => Number(el.value)),
      enlace:        raw.enlace || '',
      enlaceTyc:     raw.enlaceTyc || '',
      aplicada:      !!raw.aplicada,
    };
    try {
      if (isEdit) await update(COL, bonif.id, data);
      else        await create(COL, data);
      closeModal();
      toast(isEdit ? 'Bonificación actualizada' : 'Bonificación creada');
      onSaved?.();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
