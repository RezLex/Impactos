import { getAll, create, update, remove } from '../utils/db.js';
import { currency } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import { navigate } from '../router.js';
import { resumenArticulo } from '../utils/articulo-calc.js';
import { UNIDADES_VOLUMEN, UNIDADES_MASA } from '../utils/unidades.js';

const COL = 'articulosRecurrentes';

const TIPO_LABEL = { volumen: 'Volumen', masa: 'Masa', pieza: 'Pieza' };
const TIPO_ICON  = { volumen: 'bi-droplet-fill', masa: 'bi-box-seam-fill', pieza: 'bi-boxes' };

// Paleta fija para asignar color por categoría (texto libre, sin catálogo previo) — se elige
// siempre la misma entrada para la misma categoría con un hash simple del nombre.
const PALETA_CATEGORIA = ['#0d47a1', '#4a148c', '#e65100', '#1b5e20', '#b71c1c', '#00695c', '#880e4f', '#37474f'];
const COLOR_SIN_CATEGORIA = '#616161';

function colorCategoria(categoria) {
  if (!categoria) return COLOR_SIN_CATEGORIA;
  let hash = 0;
  for (let i = 0; i < categoria.length; i++) hash = (hash * 31 + categoria.charCodeAt(i)) >>> 0;
  return PALETA_CATEGORIA[hash % PALETA_CATEGORIA.length];
}

const unidadDefault = tipo => tipo === 'volumen' ? 'L' : tipo === 'masa' ? 'kg' : 'pza';

export async function render(container) {
  await renderList(container);
}

async function renderList(container) {
  try {
    const articulos = (await getAll(COL)).filter(a => a.activo !== false);
    articulos.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Artículos Recurrentes</h2>
          <p>${articulos.length} artículos en control</p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-nuevo-articulo">
          <i class="bi bi-plus-lg me-1"></i>Nuevo Artículo
        </button>
      </div>

      ${articulos.length === 0
        ? `<div class="empty-state"><i class="bi bi-basket"></i><p>Sin artículos registrados.<br>Agrega uno para empezar a llevar su inventario.</p></div>`
        : `<div class="row g-3">
            ${articulos.map(a => renderArticuloCard(a)).join('')}
          </div>`
      }`;

    const categorias = [...new Set(articulos.map(a => a.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

    document.getElementById('btn-nuevo-articulo').addEventListener('click', () =>
      showArticuloModal(null, container, categorias));
    document.querySelectorAll('.btn-abrir-articulo').forEach(btn =>
      btn.addEventListener('click', () => navigate('/articulos/' + btn.dataset.id)));
    document.querySelectorAll('.btn-edit-articulo').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        showArticuloModal(articulos.find(a => a.id === btn.dataset.id), container, categorias);
      }));
    document.querySelectorAll('.btn-del-articulo').forEach(btn =>
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const a = articulos.find(x => x.id === btn.dataset.id);
        if (!confirmDelete(a.nombre)) return;
        await remove(COL, a.id);
        toast('Artículo eliminado');
        renderList(container);
      }));
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

function renderArticuloCard(a) {
  const color = colorCategoria(a.categoria);
  const { promedioPrecioPorUnidad, promedioDuracionPorUnidad, stock } = resumenArticulo(a);
  const unidad = a.unidadPreferida || unidadDefault(a.tipoMedida);
  return `
    <div class="col-md-6 col-lg-4">
      <div class="evento-card" data-id="${a.id}">
        <div class="evento-card-header" style="background:${color}"></div>
        <div class="evento-card-body">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="evento-card-title"><i class="bi ${TIPO_ICON[a.tipoMedida] || TIPO_ICON.pieza} me-1"></i>${a.nombre}</div>
              <div class="evento-card-dates">
                ${TIPO_LABEL[a.tipoMedida] || a.tipoMedida}${a.categoria ? ' · ' + a.categoria : ''}
              </div>
            </div>
            <div class="d-flex gap-1">
              <button class="btn-icon btn-edit-articulo" data-id="${a.id}" title="Editar"><i class="bi bi-pencil"></i></button>
              <button class="btn-icon danger btn-del-articulo" data-id="${a.id}" title="Eliminar"><i class="bi bi-trash3"></i></button>
            </div>
          </div>
          <div class="d-flex gap-3 mt-3" style="font-size:0.8rem;color:var(--text-muted)">
            <span title="Precio promedio por ${unidad}"><i class="bi bi-tag me-1"></i>${promedioPrecioPorUnidad != null ? currency(promedioPrecioPorUnidad) + '/' + unidad : '—'}</span>
            <span title="Duración promedio por ${unidad}"><i class="bi bi-hourglass-split me-1"></i>${promedioDuracionPorUnidad != null ? promedioDuracionPorUnidad.toFixed(1) + ' días/' + unidad : '—'}</span>
          </div>
          <div class="d-flex gap-3 mt-1" style="font-size:0.75rem;color:var(--text-muted)">
            <span>${stock.comprado} en reserva</span>
            <span>${stock.enUso} en uso</span>
            <span>${stock.terminado} terminados</span>
            ${stock.sinSeguimiento ? `<span>${stock.sinSeguimiento} sin seguimiento</span>` : ''}
          </div>
          <button class="btn btn-primary btn-sm w-100 mt-3 btn-abrir-articulo" data-id="${a.id}">
            <i class="bi bi-arrow-right-circle me-1"></i>Ver Inventario
          </button>
        </div>
      </div>
    </div>`;
}

function opcionesUnidad(tipo, actual) {
  const unidades = tipo === 'volumen' ? UNIDADES_VOLUMEN : tipo === 'masa' ? UNIDADES_MASA : null;
  if (!unidades) {
    return `<input type="text" class="form-control" name="unidadPreferida" value="${actual || 'pza'}" placeholder="Ej: pza, rollo, bolsa" required>`;
  }
  return `<select class="form-select" name="unidadPreferida">
    ${unidades.map(u => `<option value="${u}" ${actual === u ? 'selected' : ''}>${u}</option>`).join('')}
  </select>`;
}

function showArticuloModal(articulo, container, categorias = []) {
  const isEdit = !!articulo;
  const tipo = articulo?.tipoMedida || 'volumen';

  openModal({
    title: isEdit ? 'Editar Artículo' : 'Nuevo Artículo',
    body: `
      <form id="articulo-form">
        <div class="mb-3">
          <label class="form-label">Nombre *</label>
          <input type="text" class="form-control" name="nombre" value="${articulo?.nombre || ''}" required placeholder="Ej: Shampoo perro">
        </div>
        <div class="row g-2">
          <div class="col-6 mb-3">
            <label class="form-label">Tipo de medida *</label>
            <select class="form-select" name="tipoMedida" id="sel-tipo-medida" required>
              <option value="volumen" ${tipo === 'volumen' ? 'selected' : ''}>Volumen (líquido)</option>
              <option value="masa"    ${tipo === 'masa'    ? 'selected' : ''}>Masa (sólido)</option>
              <option value="pieza"   ${tipo === 'pieza'   ? 'selected' : ''}>Pieza (conteo)</option>
            </select>
          </div>
          <div class="col-6 mb-3">
            <label class="form-label">Unidad de referencia *</label>
            <div id="wrap-unidad-preferida">${opcionesUnidad(tipo, articulo?.unidadPreferida)}</div>
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label">Categoría</label>
          <input type="text" class="form-control" name="categoria" list="categorias-datalist" value="${articulo?.categoria || ''}" placeholder="Ej: Higiene, Mascotas">
          <datalist id="categorias-datalist">
            ${categorias.map(c => `<option value="${c}">`).join('')}
          </datalist>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-articulo">${isEdit ? 'Guardar' : 'Crear'}</button>`
  });

  document.getElementById('sel-tipo-medida').addEventListener('change', e => {
    document.getElementById('wrap-unidad-preferida').innerHTML = opcionesUnidad(e.target.value, null);
  });

  document.getElementById('btn-save-articulo').addEventListener('click', async () => {
    const form = document.getElementById('articulo-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    if (!data.categoria) delete data.categoria;
    if (!isEdit) data.registros = [];
    try {
      if (isEdit) await update(COL, articulo.id, data);
      else        await create(COL, data);
      closeModal();
      toast(isEdit ? 'Artículo actualizado' : 'Artículo creado');
      renderList(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
