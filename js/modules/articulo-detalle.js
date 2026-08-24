import { getById, update } from '../utils/db.js';
import { currency, fmtDate } from '../utils/formatters.js';
import { toISODate } from '../utils/ciclo.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import { navigate } from '../router.js';
import { precioNeto, precioPorUnidad, precioNetoPorUnidad, duracionDias, duracionPorUnidad, resumenArticulo } from '../utils/articulo-calc.js';
import { UNIDADES_VOLUMEN, UNIDADES_MASA } from '../utils/unidades.js';

const COL = 'articulosRecurrentes';

const ORDEN_ESTATUS = { comprado: 0, enUso: 1, terminado: 2 };
const ESTATUS_LABEL = { comprado: 'Comprado', enUso: 'En uso', terminado: 'Terminado' };
const ESTATUS_BADGE = { comprado: 'bg-secondary', enUso: 'bg-info text-dark', terminado: 'bg-success' };

export async function render(container, articuloId) {
  await renderDetalle(container, articuloId);
}

async function renderDetalle(container, articuloId) {
  try {
    const articulo = await getById(COL, articuloId);
    if (!articulo) {
      container.innerHTML = `<div class="alert alert-warning">Artículo no encontrado.</div>`;
      return;
    }

    const unidad = articulo.unidadPreferida;
    const registros = (articulo.registros || []).map((r, idx) => ({ ...r, _idx: idx }));
    const filas = [...registros].sort((a, b) => {
      const eo = (ORDEN_ESTATUS[a.estatus] ?? 9) - (ORDEN_ESTATUS[b.estatus] ?? 9);
      return eo !== 0 ? eo : (b.fechaComprado || '').localeCompare(a.fechaComprado || '');
    });
    const { promedioPrecioPorUnidad, promedioDuracionPorUnidad, stock } = resumenArticulo(articulo);

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>${articulo.nombre}</h2>
          <p>
            ${promedioPrecioPorUnidad != null ? `${currency(promedioPrecioPorUnidad)}/${unidad}` : '—'} ·
            ${promedioDuracionPorUnidad != null ? `${promedioDuracionPorUnidad.toFixed(1)} días/${unidad}` : 'sin duración aún'} ·
            ${stock.comprado} en reserva · ${stock.enUso} en uso${stock.sinSeguimiento ? ` · ${stock.sinSeguimiento} sin seguimiento` : ''}
          </p>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-secondary" id="btn-back">
            <i class="bi bi-arrow-left me-1"></i>Volver
          </button>
          <button class="btn btn-primary btn-sm" id="btn-nuevo-registro">
            <i class="bi bi-plus-lg me-1"></i>Nuevo Registro
          </button>
        </div>
      </div>

      ${filas.length === 0
        ? `<div class="empty-state"><i class="bi bi-box"></i><p>Sin registros en el inventario</p></div>`
        : `<div class="data-card">
            <div class="table-wrapper">
              <table class="table">
                <thead><tr>
                  <th>Marca</th><th>Contenido</th><th class="text-end">Precio</th>
                  <th>Estatus</th><th>Fechas</th>
                  <th class="text-end">Precio/${unidad}</th><th class="text-end">Duración</th>
                  <th>Enlaces</th><th></th>
                </tr></thead>
                <tbody>
                  ${filas.map(r => renderRegistroRow(r, unidad, registros)).join('')}
                </tbody>
              </table>
            </div>
          </div>`
      }`;

    document.getElementById('btn-back').addEventListener('click', () => navigate('/articulos'));
    const marcas = [...new Set(registros.map(r => r.marca).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

    document.getElementById('btn-nuevo-registro').addEventListener('click', () =>
      showRegistroModal(articulo, null, container, marcas));
    document.querySelectorAll('.btn-avanzar').forEach(btn =>
      btn.addEventListener('click', () =>
        showAvanceModal(articulo, Number(btn.dataset.idx), container)));
    document.querySelectorAll('.btn-edit-registro').forEach(btn =>
      btn.addEventListener('click', () =>
        showRegistroModal(articulo, registros[Number(btn.dataset.idx)], container, marcas)));
    document.querySelectorAll('.btn-del-registro').forEach(btn =>
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.idx);
        const r = registros[idx];
        if (!confirmDelete(r.marca || `${r.contenidoValor} ${r.contenidoUnidad}`)) return;
        const nuevos = (articulo.registros || []).filter((_, i) => i !== idx);
        try {
          await update(COL, articulo.id, { registros: nuevos });
          toast('Registro eliminado');
          renderDetalle(container, articuloId);
        } catch (e) { toast('Error: ' + e.message, 'danger'); }
      }));
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

function renderRegistroRow(r, unidad, registros) {
  const neto = precioNeto(r);
  const tieneDescuento = !!r.descuento?.tipo;
  const precioCell = tieneDescuento
    ? `<span class="fw-bold">${currency(neto)}</span><br><span class="text-muted text-decoration-line-through" style="font-size:0.78rem">${currency(r.precio)}</span>`
    : `<span class="fw-bold">${currency(r.precio)}</span>`;

  const fechas = [
    `<div><small class="text-muted">Comprado:</small> ${fmtDate(r.fechaComprado)}</div>`,
    r.fechaEnUso     ? `<div><small class="text-muted">En uso:</small> ${fmtDate(r.fechaEnUso)}</div>`         : '',
    r.fechaTerminado ? `<div><small class="text-muted">Terminado:</small> ${fmtDate(r.fechaTerminado)}</div>` : '',
  ].join('');

  const precioUnitBruto = precioPorUnidad(r, unidad);
  const precioUnitNeto  = precioNetoPorUnidad(r, unidad);
  const precioUnitCell = precioUnitBruto == null
    ? '—'
    : tieneDescuento
      ? `<span class="fw-bold">${currency(precioUnitNeto)}</span><br><span class="text-muted text-decoration-line-through" style="font-size:0.78rem">${currency(precioUnitBruto)}</span>`
      : `<span class="fw-bold">${currency(precioUnitBruto)}</span>`;
  const dias    = duracionDias(r, registros);
  const diasUnd = duracionPorUnidad(r, unidad, registros);
  const duracionCell = dias == null
    ? '—'
    : r.sinSeguimiento
      ? `<span title="Estimado: días hasta la siguiente compra registrada">~${dias} días</span><br><small class="text-muted">~${diasUnd.toFixed(1)} días/${unidad}</small>`
      : `${dias} días<br><small class="text-muted">${diasUnd.toFixed(1)} días/${unidad}</small>`;

  const enlaces = [
    r.enlaceCompra ? `<a href="${r.enlaceCompra}" target="_blank" rel="noopener" title="Enlace de compra"><i class="bi bi-bag-check"></i></a>` : '',
    r.enlacePedido ? `<a href="${r.enlacePedido}" target="_blank" rel="noopener" title="Enlace de pedido"><i class="bi bi-truck"></i></a>` : '',
  ].filter(Boolean).join(' ');

  const btnAvanzar = r.sinSeguimiento ? '' : r.estatus === 'comprado'
    ? `<button class="btn-icon btn-avanzar" data-idx="${r._idx}" title="Marcar en uso"><i class="bi bi-play-circle"></i></button>`
    : r.estatus === 'enUso'
      ? `<button class="btn-icon btn-avanzar" data-idx="${r._idx}" title="Marcar terminado"><i class="bi bi-check-circle"></i></button>`
      : '';

  const estatusCell = r.sinSeguimiento
    ? `<span class="badge bg-light text-dark border" title="No se registran fechas de uso — la duración se estima con la siguiente compra">Sin seguimiento</span>`
    : `<span class="badge ${ESTATUS_BADGE[r.estatus] || 'bg-secondary'}">${ESTATUS_LABEL[r.estatus] || r.estatus}</span>`;

  return `
    <tr>
      <td>${r.marca || '—'}</td>
      <td>${r.contenidoValor} ${r.contenidoUnidad}</td>
      <td class="text-end">${precioCell}</td>
      <td>${estatusCell}</td>
      <td>${fechas}</td>
      <td class="text-end">${precioUnitCell}</td>
      <td class="text-end">${duracionCell}</td>
      <td>${enlaces || '—'}</td>
      <td>
        <div class="d-flex gap-1 justify-content-end">
          ${btnAvanzar}
          <button class="btn-icon btn-edit-registro" data-idx="${r._idx}" title="Editar"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger btn-del-registro" data-idx="${r._idx}" title="Eliminar"><i class="bi bi-trash3"></i></button>
        </div>
      </td>
    </tr>`;
}

function opcionesContenidoUnidad(tipoMedida, unidadPreferida, actual) {
  if (tipoMedida === 'volumen') {
    return UNIDADES_VOLUMEN.map(u => `<option value="${u}" ${(actual || unidadPreferida) === u ? 'selected' : ''}>${u}</option>`).join('');
  }
  if (tipoMedida === 'masa') {
    return UNIDADES_MASA.map(u => `<option value="${u}" ${(actual || unidadPreferida) === u ? 'selected' : ''}>${u}</option>`).join('');
  }
  return `<option value="${unidadPreferida}" selected>${unidadPreferida}</option>`;
}

/** Traduce lo capturado en el select de descuento al `{ tipo, valor }` que se persiste. */
function calcularDescuento(precio, tipo, valorStr) {
  if (valorStr === '' || valorStr == null) return null;
  const valor = Number(valorStr);
  if (Number.isNaN(valor)) return null;
  if (tipo === 'final') {
    const monto = precio - valor;
    return monto > 0 ? { tipo: 'cantidad', valor: monto } : null;
  }
  if (tipo === 'porcentaje' || tipo === 'cantidad') return { tipo, valor };
  return null;
}

/** El registro con la `fechaComprado` más reciente que no sea posterior a `fecha`, excluyendo `excluirIdx`. */
function registroAnterior(articulo, fecha, excluirIdx) {
  const candidatos = (articulo.registros || [])
    .map((r, idx) => ({ ...r, _idx: idx }))
    .filter(r => r._idx !== excluirIdx && r.fechaComprado && r.fechaComprado <= fecha);
  if (!candidatos.length) return null;
  return candidatos.reduce((a, r) => (r.fechaComprado > a.fechaComprado ? r : a));
}

function showRegistroModal(articulo, registro, container, marcas = []) {
  const isEdit = !!registro;
  const b = registro?.descuento;
  const hoy = toISODate(new Date());

  openModal({
    title: isEdit ? 'Editar Registro' : 'Nuevo Registro',
    size: 'lg',
    body: `
      <form id="registro-form">
        <div class="row g-2">
          <div class="col-6 mb-3">
            <label class="form-label">Marca</label>
            <input type="text" class="form-control" name="marca" list="marcas-datalist" value="${registro?.marca || ''}" placeholder="Opcional">
            <datalist id="marcas-datalist">
              ${marcas.map(m => `<option value="${m}">`).join('')}
            </datalist>
          </div>
          <div class="col-3 mb-3">
            <label class="form-label">Contenido *</label>
            <input type="number" class="form-control" name="contenidoValor" id="input-contenido-valor" value="${registro?.contenidoValor || ''}" required min="0" step="0.01">
          </div>
          <div class="col-3 mb-3">
            <label class="form-label">Unidad *</label>
            <select class="form-select" name="contenidoUnidad" id="sel-contenido-unidad" ${articulo.tipoMedida === 'pieza' ? 'disabled' : ''}>
              ${opcionesContenidoUnidad(articulo.tipoMedida, articulo.unidadPreferida, registro?.contenidoUnidad)}
            </select>
          </div>
        </div>
        <div class="row g-2">
          <div class="col-6 mb-3">
            <label class="form-label">Precio *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="precio" id="input-precio" value="${registro?.precio || ''}" required min="0" step="0.01">
            </div>
          </div>
          <div class="col-3 mb-3">
            <label class="form-label">Descuento</label>
            <select class="form-select" name="descuentoTipo" id="sel-descuento-tipo">
              <option value="">Sin descuento</option>
              <option value="porcentaje" ${b?.tipo === 'porcentaje' ? 'selected' : ''}>% Porcentaje</option>
              <option value="cantidad"   ${b?.tipo === 'cantidad'   ? 'selected' : ''}>$ Cantidad de descuento</option>
              <option value="final">$ Precio final (ya con descuento)</option>
            </select>
          </div>
          <div class="col-3 mb-3">
            <label class="form-label" id="label-descuento-valor">Valor</label>
            <input type="number" class="form-control" name="descuentoValor" id="input-descuento-valor" value="${b?.valor ?? ''}" min="0" step="0.01">
          </div>
        </div>
        <div class="mb-3" id="preview-precio-unidad"></div>
        <div class="row g-2">
          <div class="col-6 mb-3">
            <label class="form-label">Enlace de compra</label>
            <input type="url" class="form-control" name="enlaceCompra" value="${registro?.enlaceCompra || ''}" placeholder="Opcional">
          </div>
          <div class="col-6 mb-3">
            <label class="form-label">Enlace de pedido</label>
            <input type="url" class="form-control" name="enlacePedido" value="${registro?.enlacePedido || ''}" placeholder="Opcional">
          </div>
        </div>
        <div class="row g-2">
          <div class="col-6 mb-3">
            <label class="form-label">Fecha de compra *</label>
            <input type="date" class="form-control" name="fechaComprado" id="input-fecha-comprado" value="${(registro?.fechaComprado || hoy).slice(0, 10)}" required>
          </div>
          ${!isEdit ? `
          <div class="col-6 mb-3">
            <label class="form-label">Cantidad de registros iguales *</label>
            <input type="number" class="form-control" name="cantidad" value="1" required min="1" step="1">
          </div>` : ''}
        </div>
        <div class="form-check">
          <input type="checkbox" class="form-check-input" name="sinSeguimiento" id="chk-sin-seguimiento" ${registro?.sinSeguimiento ? 'checked' : ''}>
          <label class="form-check-label" for="chk-sin-seguimiento">Sin seguimiento</label>
          <div class="form-text">No se marca en uso/terminado — la duración se estima con la fecha de compra del siguiente registro. Se puede quitar el check en cualquier momento y volver al seguimiento normal.</div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-registro">${isEdit ? 'Guardar' : 'Crear'}</button>`
  });

  const LABEL_DESCUENTO = { '': 'Valor', porcentaje: 'Valor', cantidad: 'Valor', final: 'Precio final' };
  document.getElementById('sel-descuento-tipo').addEventListener('change', e => {
    document.getElementById('label-descuento-valor').textContent = LABEL_DESCUENTO[e.target.value] || 'Valor';
  });

  function actualizarPreview() {
    const unidad = articulo.unidadPreferida;
    const preview = document.getElementById('preview-precio-unidad');
    const contenidoValor = Number(document.getElementById('input-contenido-valor').value);
    const contenidoUnidad = articulo.tipoMedida === 'pieza' ? unidad : document.getElementById('sel-contenido-unidad').value;
    const precio = Number(document.getElementById('input-precio').value);
    const fechaComprado = document.getElementById('input-fecha-comprado').value;

    if (!contenidoValor || !precio || !fechaComprado) { preview.innerHTML = ''; return; }

    let actual;
    try { actual = precioPorUnidad({ contenidoValor, contenidoUnidad, precio }, unidad); } catch { actual = null; }
    if (actual == null) { preview.innerHTML = ''; return; }

    const anterior = registroAnterior(articulo, fechaComprado, isEdit ? registro._idx : -1);
    if (!anterior) {
      preview.innerHTML = `<div class="alert alert-secondary py-2 mb-0" style="font-size:0.85rem">
        <i class="bi bi-graph-up me-1"></i>Este registro: <strong>${currency(actual)}/${unidad}</strong>
        <span class="text-muted">· sin registro anterior para comparar</span></div>`;
      return;
    }
    let anteriorPrecio;
    try { anteriorPrecio = precioPorUnidad(anterior, unidad); } catch { anteriorPrecio = null; }
    if (anteriorPrecio == null) {
      preview.innerHTML = `<div class="alert alert-secondary py-2 mb-0" style="font-size:0.85rem">
        <i class="bi bi-graph-up me-1"></i>Este registro: <strong>${currency(actual)}/${unidad}</strong></div>`;
      return;
    }

    const cambio = ((actual - anteriorPrecio) / anteriorPrecio) * 100;
    const cls = cambio > 0.05 ? 'text-danger' : cambio < -0.05 ? 'text-success' : 'text-muted';
    const signo = cambio > 0 ? '+' : '';
    preview.innerHTML = `
      <div class="alert alert-secondary py-2 mb-0" style="font-size:0.85rem">
        <i class="bi bi-graph-up me-1"></i>
        Este registro: <strong>${currency(actual)}/${unidad}</strong>
        · Último (${fmtDate(anterior.fechaComprado)}): ${currency(anteriorPrecio)}/${unidad}
        <span class="${cls} fw-bold">(${signo}${cambio.toFixed(1)}%)</span>
      </div>`;
  }
  document.getElementById('registro-form').addEventListener('input', actualizarPreview);
  document.getElementById('registro-form').addEventListener('change', actualizarPreview);
  actualizarPreview();

  document.getElementById('btn-save-registro').addEventListener('click', async () => {
    const form = document.getElementById('registro-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    const precio = Number(data.precio);

    const base = {
      marca: data.marca || '',
      contenidoValor: Number(data.contenidoValor),
      contenidoUnidad: articulo.tipoMedida === 'pieza' ? articulo.unidadPreferida : data.contenidoUnidad,
      precio,
      enlaceCompra: data.enlaceCompra || '',
      enlacePedido: data.enlacePedido || '',
      fechaComprado: data.fechaComprado,
      descuento: calcularDescuento(precio, data.descuentoTipo, data.descuentoValor),
      sinSeguimiento: document.getElementById('chk-sin-seguimiento').checked,
    };

    const registros = [...(articulo.registros || [])];
    try {
      if (isEdit) {
        registros[registro._idx] = { ...registros[registro._idx], ...base };
      } else {
        const cantidad = Math.max(1, Number(data.cantidad) || 1);
        for (let i = 0; i < cantidad; i++) {
          registros.push({ ...base, estatus: 'comprado' });
        }
      }
      await update(COL, articulo.id, { registros });
      closeModal();
      toast(isEdit ? 'Registro actualizado' : 'Registro(s) creado(s)');
      renderDetalle(container, articulo.id);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

function showAvanceModal(articulo, idx, container) {
  const registro = (articulo.registros || [])[idx];
  const siguiente = registro.estatus === 'comprado' ? 'enUso' : 'terminado';
  const campoFecha = siguiente === 'enUso' ? 'fechaEnUso' : 'fechaTerminado';
  const label = siguiente === 'enUso' ? 'Fecha en que se empezó a usar' : 'Fecha en que se terminó';
  const hoy = toISODate(new Date());
  // Precarga con la fecha del estatus actual (de dónde viene el registro), no "hoy" —
  // suele estar más cerca del momento real del cambio que la fecha en que se captura.
  const fechaActual = (registro.estatus === 'comprado' ? registro.fechaComprado : registro.fechaEnUso) || hoy;

  openModal({
    title: siguiente === 'enUso' ? 'Marcar como en uso' : 'Marcar como terminado',
    body: `
      <form id="avance-form">
        <div class="mb-3">
          <label class="form-label">${label} *</label>
          <input type="date" class="form-control" name="fecha" value="${fechaActual.slice(0, 10)}" required>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-avance">Confirmar</button>`
  });

  document.getElementById('btn-save-avance').addEventListener('click', async () => {
    const form = document.getElementById('avance-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const fecha = new FormData(form).get('fecha');

    const registros = [...(articulo.registros || [])];
    registros[idx] = { ...registros[idx], estatus: siguiente, [campoFecha]: fecha };
    try {
      await update(COL, articulo.id, { registros });
      closeModal();
      toast('Estatus actualizado');
      renderDetalle(container, articulo.id);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
