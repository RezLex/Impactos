import { getById, update } from '../utils/db.js';
import { currency, fmtDate } from '../utils/formatters.js';
import { toISODate } from '../utils/ciclo.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import { navigate } from '../router.js';
import { precioNeto, precioPorUnidad, precioNetoPorUnidad, duracionDias, duracionPorUnidad, resumenArticulo } from '../utils/articulo-calc.js';
import { UNIDADES_VOLUMEN, UNIDADES_MASA, convertir } from '../utils/unidades.js';

const COL = 'articulosRecurrentes';

const ORDEN_ESTATUS = { enUso: 0, comprado: 1, terminado: 2 };
const ESTATUS_LABEL = { comprado: 'Comprado', enUso: 'En uso', terminado: 'Terminado' };
const ESTATUS_BADGE = { comprado: 'bg-secondary', enUso: 'bg-info text-dark', terminado: 'bg-success' };
const ESTATUS_DOT   = { comprado: 'bg-secondary', enUso: 'bg-info', terminado: 'bg-success' };

/** Grupo de orden de la tabla de inventario: En uso → Comprado → Terminado → Sin seguimiento (siempre al final, sin importar su `estatus` interno). */
const grupoOrden = r => r.sinSeguimiento ? 3 : (ORDEN_ESTATUS[r.estatus] ?? 9);

// Registro elegido en el select de la columna "Variación", por artículo: idx del registro → idx contra el que se compara.
// Solo vive en la sesión (variable de módulo); sin entrada se compara contra el anterior por fecha de compra.
const comparacionElegida = new Map();

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
      const eo = grupoOrden(a) - grupoOrden(b);
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
        <div class="d-flex gap-2 align-items-center">
          <div class="form-check form-switch mb-0 me-2" title="La variación solo se calcula entre registros de la misma marca">
            <input type="checkbox" class="form-check-input" id="chk-misma-marca" ${articulo.compararMismaMarca ? 'checked' : ''}>
            <label class="form-check-label" for="chk-misma-marca" style="font-size:0.85rem">Comparar solo misma marca</label>
          </div>
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
                  <th class="text-end">Precio/${unidad}</th><th class="text-end" style="min-width:270px">Variación</th><th class="text-end">Duración</th>
                  <th>Enlaces</th><th></th>
                </tr></thead>
                <tbody>
                  ${filas.map(r => renderRegistroRow(r, articulo, registros)).join('')}
                </tbody>
              </table>
            </div>
          </div>`
      }`;

    document.getElementById('btn-back').addEventListener('click', () => navigate('/articulos'));
    const marcas = [...new Set(registros.map(r => r.marca).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

    const onSaved = () => renderDetalle(container, articuloId);

    document.getElementById('chk-misma-marca').addEventListener('change', async e => {
      try {
        await update(COL, articulo.id, { compararMismaMarca: e.target.checked });
        onSaved();
      } catch (err) {
        e.target.checked = !e.target.checked;
        toast('Error: ' + err.message, 'danger');
      }
    });
    document.querySelectorAll('.sel-comparar').forEach(sel =>
      sel.addEventListener('change', () => {
        const idx = Number(sel.dataset.idx);
        const elegidas = comparacionElegida.get(articulo.id) || new Map();
        if (sel.value === '') elegidas.delete(idx);
        else elegidas.set(idx, Number(sel.value));
        comparacionElegida.set(articulo.id, elegidas);
        const v = calcularVariacion(articulo, registros[idx], idx, elegidas.get(idx) ?? null);
        const resultado = sel.closest('td').querySelector('.variacion-resultado');
        resultado.querySelectorAll('.btn-calc-variacion').forEach(btn => bootstrap.Popover.getInstance(btn)?.dispose());
        resultado.innerHTML = variacionHTML(v, articulo, registros[idx]);
        ligarPopoversVariacion(resultado);
      }));
    ligarPopoversVariacion(container);

    document.getElementById('btn-nuevo-registro').addEventListener('click', () =>
      showRegistroModal(articulo, null, marcas, onSaved));
    document.querySelectorAll('.btn-avanzar').forEach(btn =>
      btn.addEventListener('click', () =>
        showAvanceModal(articulo, Number(btn.dataset.idx), onSaved)));
    document.querySelectorAll('.btn-edit-registro').forEach(btn =>
      btn.addEventListener('click', () =>
        showRegistroModal(articulo, registros[Number(btn.dataset.idx)], marcas, onSaved)));
    document.querySelectorAll('.btn-del-registro').forEach(btn =>
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.idx);
        const r = registros[idx];
        if (!confirmDelete(r.marca || `${r.contenidoValor} ${r.contenidoUnidad}`)) return;
        const nuevos = (articulo.registros || []).filter((_, i) => i !== idx);
        try {
          await update(COL, articulo.id, { registros: nuevos });
          // Los idx se recorren al borrar: las comparaciones elegidas ya no apuntan a lo mismo.
          comparacionElegida.delete(articulo.id);
          toast('Registro eliminado');
          renderDetalle(container, articuloId);
        } catch (e) { toast('Error: ' + e.message, 'danger'); }
      }));
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

function renderRegistroRow(r, articulo, registros) {
  const unidad = articulo.unidadPreferida;
  const neto = precioNeto(r);
  const tieneDescuento = !!r.descuento?.tipo;
  const precioCell = tieneDescuento
    ? `<span class="fw-bold">${currency(r.precio)}</span><br><span class="text-success" style="font-size:0.78rem"><i class="bi bi-tag-fill me-1"></i>${currency(neto)}</span>`
    : `<span class="fw-bold">${currency(r.precio)}</span>`;

  const dot = estatus => `<span class="d-inline-block rounded-circle me-1 ${ESTATUS_DOT[estatus]}" style="width:8px;height:8px"></span>`;
  const fechas = [
    `<div class="text-nowrap">${dot('comprado')}<small class="text-muted">Comprado:</small> ${fmtDate(r.fechaComprado)}</div>`,
    r.fechaEnUso     ? `<div class="text-nowrap">${dot('enUso')}<small class="text-muted">En uso:</small> ${fmtDate(r.fechaEnUso)}</div>`             : '',
    r.fechaTerminado ? `<div class="text-nowrap">${dot('terminado')}<small class="text-muted">Terminado:</small> ${fmtDate(r.fechaTerminado)}</div>` : '',
  ].join('');

  const precioUnitBruto = precioPorUnidad(r, unidad);
  const precioUnitNeto  = precioNetoPorUnidad(r, unidad);
  const precioUnitCell = precioUnitBruto == null
    ? '—'
    : tieneDescuento
      ? `<span class="fw-bold">${currency(precioUnitBruto)}</span><br><span class="text-success" style="font-size:0.78rem"><i class="bi bi-tag-fill me-1"></i>${currency(precioUnitNeto)}</span>`
      : `<span class="fw-bold">${currency(precioUnitBruto)}</span>`;
  const candidatos = precioUnitBruto == null ? [] : candidatosComparacion(articulo, r, r._idx)
    .sort((a, b) => (b.fechaComprado || '').localeCompare(a.fechaComprado || ''));
  let contraIdx = comparacionElegida.get(articulo.id)?.get(r._idx) ?? null;
  if (contraIdx != null && !candidatos.some(c => c._idx === contraIdx)) contraIdx = null;
  const variacion = calcularVariacion(articulo, r, r._idx, contraIdx);
  // Preseleccionado: el elegido o, si no hay, el anterior por fecha; sin anterior, la opción "-" (sin comparar).
  const seleccionadoIdx = variacion?.anterior?._idx ?? null;
  const selComparar = candidatos.length === 0 ? '' : `
    <select class="form-select form-select-sm sel-comparar mt-1 ms-auto" data-idx="${r._idx}" style="font-size:0.72rem;width:auto" title="Registro contra el que se compara">
      ${seleccionadoIdx == null ? '<option value="" selected>-</option>' : ''}
      ${candidatos.map(c => {
        const ppu = precioPorUnidad(c, unidad);
        return `<option value="${c._idx}" ${c._idx === seleccionadoIdx ? 'selected' : ''}>${fmtDate(c.fechaComprado)} · ${c.marca || 'Sin marca'}${ppu != null ? ` · ${currency(ppu)}/${unidad}` : ''}</option>`;
      }).join('')}
    </select>`;
  const variacionCell = `<div class="variacion-resultado">${variacionHTML(variacion, articulo, r)}</div>${selComparar}`;

  const dias    = duracionDias(r, registros);
  const diasUnd = duracionPorUnidad(r, unidad, registros);
  const duracionCell = dias == null
    ? '—'
    : r.sinSeguimiento
      ? `<span title="Estimado: días hasta la siguiente compra registrada">~${dias} días</span><br><small class="text-muted">~${diasUnd.toFixed(1)} días/${unidad}</small>`
      : r.estatus === 'enUso'
        ? `<span title="Días transcurridos desde que se marcó en uso, hasta hoy">${dias} días <small class="text-muted">(hasta hoy)</small></span><br><small class="text-muted">${diasUnd.toFixed(1)} días/${unidad}</small>`
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
      <td class="text-end">${variacionCell}</td>
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
  if (tipo === 'final') return valor < precio ? { tipo: 'final', valor } : null;
  if (tipo === 'porcentaje' || tipo === 'cantidad') return { tipo, valor };
  return null;
}

const normMarca = m => (m || '').trim().toLowerCase();

/**
 * Registros (con `_idx`) contra los que se puede comparar `registroLike`: todos los que
 * tienen `fechaComprado` excepto `excluirIdx`, y si el artículo tiene activo
 * `compararMismaMarca`, solo los de su misma marca.
 */
function candidatosComparacion(articulo, registroLike, excluirIdx) {
  return (articulo.registros || [])
    .map((r, idx) => ({ ...r, _idx: idx }))
    .filter(r => r._idx !== excluirIdx && r.fechaComprado
      && (!articulo.compararMismaMarca || normMarca(r.marca) === normMarca(registroLike.marca)));
}

/** El candidato (ver `candidatosComparacion`) con la `fechaComprado` más reciente que no sea posterior a la de `registroLike`. */
function registroAnterior(articulo, registroLike, excluirIdx) {
  const candidatos = candidatosComparacion(articulo, registroLike, excluirIdx)
    .filter(r => r.fechaComprado <= registroLike.fechaComprado);
  if (!candidatos.length) return null;
  return candidatos.reduce((a, r) => (r.fechaComprado > a.fechaComprado ? r : a));
}

/**
 * Compara el precio base (sin descuento) por unidad de `registroLike` contra el del
 * registro `contraIdx` si se eligió uno válido, o si no contra el anterior por fecha de
 * compra (excluyendo `excluirIdx`, para cuando `registroLike` ya es uno de los
 * registros del artículo). Respeta `compararMismaMarca`. Misma cuenta que usa el
 * preview del modal — se comparte para que la columna "Variación" del inventario
 * muestre exactamente lo mismo.
 *
 * @returns {null|{actual:number, anterior:object|null, anteriorPrecio:number|null, cambio:number|null}}
 *   `null` si ni siquiera se pudo calcular el precio/unidad de `registroLike`.
 */
function calcularVariacion(articulo, registroLike, excluirIdx = -1, contraIdx = null) {
  const unidad = articulo.unidadPreferida;
  let actual;
  try { actual = precioPorUnidad(registroLike, unidad); } catch { actual = null; }
  if (actual == null) return null;
  let anterior = contraIdx == null ? null
    : candidatosComparacion(articulo, registroLike, excluirIdx).find(r => r._idx === contraIdx) || null;
  if (!anterior && registroLike.fechaComprado) anterior = registroAnterior(articulo, registroLike, excluirIdx);
  if (!anterior) return { actual, anterior: null, anteriorPrecio: null, cambio: null };
  let anteriorPrecio;
  try { anteriorPrecio = precioPorUnidad(anterior, unidad); } catch { anteriorPrecio = null; }
  if (anteriorPrecio == null) return { actual, anterior, anteriorPrecio: null, cambio: null };
  const cambio = ((actual - anteriorPrecio) / anteriorPrecio) * 100;
  return { actual, anterior, anteriorPrecio, cambio };
}

const escapeAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Línea "precio ÷ contenido = precio/unidad" de un registro, con el contenido ya convertido a `unidad`. */
function lineaPrecioUnidad(registro, unidad, precioUnidad) {
  let contenido;
  try { contenido = convertir(registro.contenidoValor, registro.contenidoUnidad, unidad); } catch { contenido = null; }
  const original = registro.contenidoUnidad !== unidad ? ` (${registro.contenidoValor} ${registro.contenidoUnidad})` : '';
  const contenidoTxt = contenido != null ? `${Number(contenido.toFixed(4))} ${unidad}${original}` : '—';
  return `${currency(Number(registro.precio) || 0)} ÷ ${contenidoTxt} = <strong>${currency(precioUnidad)}/${unidad}</strong>`;
}

/**
 * Contenido de la celda "Variación" (sin el select) para el resultado de `calcularVariacion`:
 * el porcentaje y un (i) cuyo popover desglosa la cuenta.
 */
function variacionHTML(v, articulo, registro) {
  if (!v || v.cambio == null) return '—';
  const unidad = articulo.unidadPreferida;
  const cls = v.cambio > 0.05 ? 'text-danger' : v.cambio < -0.05 ? 'text-success' : 'text-muted';
  const pct = `${v.cambio > 0 ? '+' : ''}${v.cambio.toFixed(1)}%`;
  const desglose = `
    <div><strong>Este registro</strong> · ${fmtDate(registro.fechaComprado)} · ${registro.marca || 'Sin marca'}</div>
    <div>${lineaPrecioUnidad(registro, unidad, v.actual)}</div>
    <div class="mt-2"><strong>Comparado contra</strong> · ${fmtDate(v.anterior.fechaComprado)} · ${v.anterior.marca || 'Sin marca'}</div>
    <div>${lineaPrecioUnidad(v.anterior, unidad, v.anteriorPrecio)}</div>
    <div class="mt-2">(${currency(v.actual)} − ${currency(v.anteriorPrecio)}) ÷ ${currency(v.anteriorPrecio)} × 100 = <strong>${pct}</strong></div>
    <div class="mt-2 text-muted small">Se usa el precio sin descuento.</div>`;
  return `<span class="${cls} fw-bold">${pct}</span>
    <button type="button" class="btn btn-link p-0 ms-1 align-baseline btn-calc-variacion" data-calc="${escapeAttr(desglose)}" title="Cómo se calculó" style="font-size:0.85rem;line-height:1">
      <i class="bi bi-info-circle"></i>
    </button>`;
}

/** Popover con el desglose de la variación en cada (i) dentro de `root`; se cierra al hacer click fuera. */
function ligarPopoversVariacion(root) {
  root.querySelectorAll('.btn-calc-variacion').forEach(btn =>
    bootstrap.Popover.getOrCreateInstance(btn, {
      html: true, trigger: 'focus', placement: 'left',
      title: 'Cómo se calculó', content: btn.dataset.calc,
    }));
}

/** Campos del registro (todo lo que no es el selector de artículo del modo "elegir artículo"). */
function camposRegistroHTML(articulo, registro, marcas, isEdit, hoy) {
  const b = registro?.descuento;
  return `
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
          <option value="final"      ${b?.tipo === 'final'      ? 'selected' : ''}>$ Precio final (ya con descuento)</option>
        </select>
      </div>
      <div class="col-3 mb-3">
        <label class="form-label" id="label-descuento-valor">${b?.tipo === 'final' ? 'Precio final' : 'Valor'}</label>
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
    ${isEdit ? `
    <div class="row g-2" id="wrap-estatus-registro"${registro?.sinSeguimiento ? ' style="display:none"' : ''}>
      <div class="col-4 mb-3">
        <label class="form-label">Estatus</label>
        <select class="form-select" name="estatus" id="sel-estatus-registro">
          ${Object.entries(ESTATUS_LABEL).map(([v, l]) => `<option value="${v}" ${(registro?.estatus || 'comprado') === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="col-4 mb-3" id="wrap-fecha-en-uso">
        <label class="form-label">Fecha en uso *</label>
        <input type="date" class="form-control" name="fechaEnUso" id="input-fecha-en-uso" value="${(registro?.fechaEnUso || '').slice(0, 10)}">
      </div>
      <div class="col-4 mb-3" id="wrap-fecha-terminado">
        <label class="form-label">Fecha terminado *</label>
        <input type="date" class="form-control" name="fechaTerminado" id="input-fecha-terminado" value="${(registro?.fechaTerminado || '').slice(0, 10)}">
      </div>
    </div>` : ''}
    <div class="form-check">
      <input type="checkbox" class="form-check-input" name="sinSeguimiento" id="chk-sin-seguimiento" ${registro?.sinSeguimiento ? 'checked' : ''}>
      <label class="form-check-label" for="chk-sin-seguimiento">Sin seguimiento</label>
      <div class="form-text">No se marca en uso/terminado — la duración se estima con la fecha de compra del siguiente registro. Al marcarlo se borran las fechas de en uso/terminado que tuviera. Se puede quitar el check en cualquier momento y volver al seguimiento normal (desde "Comprado").</div>
    </div>`;
}

/**
 * `articulo === null` activa el modo "elegir artículo" (Quick Add): el modal arranca
 * con un selector de artículo y los campos del registro aparecen recién al elegir uno
 * — mismo modal, no uno encadenado a otro. `articulosDisponibles` es obligatorio en
 * ese modo. Fuera de Quick Add, `articulo` siempre llega ya resuelto y el selector ni
 * se pinta.
 */
export function showRegistroModal(articulo, registro, marcas = [], onSaved = null, articulosDisponibles = null) {
  const isEdit = !!registro;
  const hoy = toISODate(new Date());
  const modoElegir = !articulo;

  openModal({
    title: modoElegir ? 'Nuevo Registro de Artículo' : `${articulo.nombre} — ${isEdit ? 'Editar Registro' : 'Nuevo Registro'}`,
    size: 'lg',
    body: `
      <form id="registro-form">
        ${modoElegir ? `
        <div class="mb-3">
          <label class="form-label">Artículo *</label>
          <select class="form-select" id="sel-articulo-elegir" required>
            <option value="">— Seleccionar —</option>
            ${(articulosDisponibles || []).map(a => `<option value="${a.id}">${a.nombre}${a.categoria ? ' · ' + a.categoria : ''}</option>`).join('')}
          </select>
        </div>` : ''}
        <div id="registro-campos"${modoElegir ? ' style="display:none"' : ''}>
          ${modoElegir ? '' : camposRegistroHTML(articulo, registro, marcas, isEdit, hoy)}
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-registro" ${modoElegir ? 'disabled' : ''}>${isEdit ? 'Guardar' : 'Crear'}</button>`
  });

  const LABEL_DESCUENTO = { '': 'Valor', porcentaje: 'Valor', cantidad: 'Valor', final: 'Precio final' };

  function actualizarPreview() {
    if (!articulo) return;
    const unidad = articulo.unidadPreferida;
    const preview = document.getElementById('preview-precio-unidad');
    const contenidoValor = Number(document.getElementById('input-contenido-valor')?.value);
    const contenidoUnidad = articulo.tipoMedida === 'pieza' ? unidad : document.getElementById('sel-contenido-unidad')?.value;
    const precio = Number(document.getElementById('input-precio')?.value);
    const fechaComprado = document.getElementById('input-fecha-comprado')?.value;
    const marca = document.querySelector('#registro-form [name="marca"]')?.value;

    if (!contenidoValor || !precio || !fechaComprado) { preview.innerHTML = ''; return; }

    const v = calcularVariacion(articulo, { marca, contenidoValor, contenidoUnidad, precio, fechaComprado }, isEdit ? registro._idx : -1);
    if (!v) { preview.innerHTML = ''; return; }

    if (!v.anterior) {
      preview.innerHTML = `<div class="alert alert-secondary py-2 mb-0" style="font-size:0.85rem">
        <i class="bi bi-graph-up me-1"></i>Este registro: <strong>${currency(v.actual)}/${unidad}</strong>
        <span class="text-muted">· sin registro anterior para comparar</span></div>`;
      return;
    }
    if (v.anteriorPrecio == null) {
      preview.innerHTML = `<div class="alert alert-secondary py-2 mb-0" style="font-size:0.85rem">
        <i class="bi bi-graph-up me-1"></i>Este registro: <strong>${currency(v.actual)}/${unidad}</strong></div>`;
      return;
    }

    const cls = v.cambio > 0.05 ? 'text-danger' : v.cambio < -0.05 ? 'text-success' : 'text-muted';
    const signo = v.cambio > 0 ? '+' : '';
    preview.innerHTML = `
      <div class="alert alert-secondary py-2 mb-0" style="font-size:0.85rem">
        <i class="bi bi-graph-up me-1"></i>
        Este registro: <strong>${currency(v.actual)}/${unidad}</strong>
        · Último (${fmtDate(v.anterior.fechaComprado)}): ${currency(v.anteriorPrecio)}/${unidad}
        <span class="${cls} fw-bold">(${signo}${v.cambio.toFixed(1)}%)</span>
      </div>`;
  }

  // Se re-liga cada vez que se reconstruyen los campos (al elegir/cambiar de artículo
  // en el modo "elegir"): el swap de innerHTML se lleva consigo cualquier listener
  // que hubiera quedado pegado a los nodos anteriores.
  // Solo en edición: muestra las fechas que aplican al estatus elegido (en uso → fecha en
  // uso; terminado → ambas) y las vuelve obligatorias; las ocultas quedan deshabilitadas
  // para que no viajen en el FormData. Con "Sin seguimiento" se oculta todo el bloque.
  function aplicarEstatus() {
    const wrap = document.getElementById('wrap-estatus-registro');
    if (!wrap) return;
    const sinSeguimiento = document.getElementById('chk-sin-seguimiento').checked;
    const estatus = document.getElementById('sel-estatus-registro').value;
    wrap.style.display = sinSeguimiento ? 'none' : '';
    [['wrap-fecha-en-uso', 'input-fecha-en-uso', estatus !== 'comprado'],
     ['wrap-fecha-terminado', 'input-fecha-terminado', estatus === 'terminado']].forEach(([wrapId, inputId, aplica]) => {
      const visible = aplica && !sinSeguimiento;
      const input = document.getElementById(inputId);
      document.getElementById(wrapId).style.visibility = aplica ? '' : 'hidden';
      input.disabled = !visible;
      input.required = visible;
      if (visible && !input.value) input.value = hoy;
    });
  }

  function ligarCampos() {
    document.getElementById('sel-descuento-tipo')?.addEventListener('change', e => {
      document.getElementById('label-descuento-valor').textContent = LABEL_DESCUENTO[e.target.value] || 'Valor';
    });
    document.getElementById('sel-estatus-registro')?.addEventListener('change', aplicarEstatus);
    document.getElementById('chk-sin-seguimiento')?.addEventListener('change', aplicarEstatus);
    aplicarEstatus();
    actualizarPreview();
  }

  if (modoElegir) {
    document.getElementById('sel-articulo-elegir').addEventListener('change', e => {
      const campos     = document.getElementById('registro-campos');
      const btnGuardar = document.getElementById('btn-save-registro');
      articulo = (articulosDisponibles || []).find(a => a.id === e.target.value) || null;
      if (!articulo) {
        campos.style.display = 'none';
        campos.innerHTML = '';
        btnGuardar.disabled = true;
        return;
      }
      const marcasArticulo = [...new Set((articulo.registros || []).map(r => r.marca).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
      campos.innerHTML = camposRegistroHTML(articulo, null, marcasArticulo, false, hoy);
      campos.style.display = '';
      btnGuardar.disabled = false;
      const tituloEl = document.querySelector('#app-modal .modal-title');
      if (tituloEl) tituloEl.textContent = `${articulo.nombre} — Nuevo Registro`;
      ligarCampos();
    });
  } else {
    ligarCampos();
  }

  document.getElementById('registro-form').addEventListener('input', actualizarPreview);
  document.getElementById('registro-form').addEventListener('change', actualizarPreview);

  document.getElementById('btn-save-registro').addEventListener('click', async () => {
    if (!articulo) { toast('Selecciona un artículo', 'warning'); return; }
    const form = document.getElementById('registro-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    const precio = Number(data.precio);

    const sinSeguimiento = document.getElementById('chk-sin-seguimiento').checked;
    const base = {
      marca: data.marca || '',
      contenidoValor: Number(data.contenidoValor),
      contenidoUnidad: articulo.tipoMedida === 'pieza' ? articulo.unidadPreferida : data.contenidoUnidad,
      precio,
      enlaceCompra: data.enlaceCompra || '',
      enlacePedido: data.enlacePedido || '',
      fechaComprado: data.fechaComprado,
      descuento: calcularDescuento(precio, data.descuentoTipo, data.descuentoValor),
      sinSeguimiento,
    };
    if (sinSeguimiento) {
      // Se marca sin seguimiento: el estatus/fechas de uso que traía ya no aplican —
      // de aquí en adelante la duración se estima con la fecha de compra del siguiente
      // registro, no con estas.
      base.estatus = 'comprado';
      base.fechaEnUso = null;
      base.fechaTerminado = null;
    } else if (isEdit) {
      base.estatus = data.estatus || 'comprado';
      base.fechaEnUso = base.estatus !== 'comprado' ? data.fechaEnUso : null;
      base.fechaTerminado = base.estatus === 'terminado' ? data.fechaTerminado : null;
      if (base.fechaEnUso && base.fechaEnUso < base.fechaComprado) {
        toast('La fecha en uso no puede ser anterior a la de compra', 'warning'); return;
      }
      if (base.fechaTerminado && base.fechaTerminado < base.fechaEnUso) {
        toast('La fecha terminado no puede ser anterior a la de en uso', 'warning'); return;
      }
    }

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
      onSaved?.();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

export function showAvanceModal(articulo, idx, onSaved = null) {
  const registro = (articulo.registros || [])[idx];
  const siguiente = registro.estatus === 'comprado' ? 'enUso' : 'terminado';
  const campoFecha = siguiente === 'enUso' ? 'fechaEnUso' : 'fechaTerminado';
  const label = siguiente === 'enUso' ? 'Fecha en que se empezó a usar' : 'Fecha en que se terminó';
  const hoy = toISODate(new Date());

  openModal({
    title: `${articulo.nombre} — ${siguiente === 'enUso' ? 'Marcar como en uso' : 'Marcar como terminado'}`,
    body: `
      <form id="avance-form">
        <div class="mb-3">
          <label class="form-label">${label} *</label>
          <input type="date" class="form-control" name="fecha" value="${hoy}" required>
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
      onSaved?.();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
