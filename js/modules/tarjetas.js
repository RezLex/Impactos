import { getAll, create, update, remove } from '../utils/db.js';
import { maskCard, currency } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';

const INSTITUCIONES_DEFAULT_COLORS = {
  'Banamex':'#e31837','Banorte':'#da1c2b','BBVA':'#004481',
  'Mercado Pago':'#009ee3','NU':'#820ad1','Rappi':'#ff441f',
  'Revolut':'#0075eb','Santander':'#ec0000'
};

export async function render(container) {
  container.innerHTML = `<div class="loading-overlay"><div class="spinner-border text-primary" role="status"></div></div>`;
  await renderView(container);
}

async function renderView(container) {
  try {
    const [instituciones, tarjetas] = await Promise.all([
      getAll('instituciones'),
      getAll('tarjetas'),
    ]);

    const byInst = {};
    instituciones.forEach(i => { byInst[i.id] = { inst: i, cards: [] }; });
    tarjetas.forEach(t => { if (byInst[t.institucionId]) byInst[t.institucionId].cards.push(t); });

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Tarjetas</h2>
          <p>${instituciones.length} instituciones · ${tarjetas.length} tarjetas</p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-nueva-inst">
          <i class="bi bi-plus-lg me-1"></i>Nueva Institución
        </button>
      </div>

      ${instituciones.length === 0 ? `
        <div class="empty-state">
          <i class="bi bi-bank"></i>
          <p>No hay instituciones registradas.<br>Agrega una para comenzar.</p>
        </div>` : `
        <div class="row g-3" id="inst-list">
          ${Object.values(byInst).sort((a, b) => a.inst.nombre.localeCompare(b.inst.nombre, 'es')).map(({ inst, cards }) => renderInstCard(inst, cards)).join('')}
        </div>`
      }`;

    document.getElementById('btn-nueva-inst').addEventListener('click', () => showInstModal(null, container));

    document.querySelectorAll('.btn-edit-inst').forEach(btn =>
      btn.addEventListener('click', () => showInstModal(instituciones.find(i => i.id === btn.dataset.id), container)));

    document.querySelectorAll('.btn-del-inst').forEach(btn =>
      btn.addEventListener('click', async () => {
        const inst = instituciones.find(i => i.id === btn.dataset.id);
        if (!confirmDelete(inst.nombre)) return;
        await remove('instituciones', inst.id);
        await Promise.all(tarjetas.filter(t => t.institucionId === inst.id).map(t => remove('tarjetas', t.id)));
        toast('Institución eliminada');
        renderView(container);
      }));

    document.querySelectorAll('.btn-nueva-tarjeta').forEach(btn =>
      btn.addEventListener('click', () => showCardModal(null, btn.dataset.instId, instituciones, container)));

    document.querySelectorAll('.btn-edit-card').forEach(btn =>
      btn.addEventListener('click', () => showCardModal(tarjetas.find(t => t.id === btn.dataset.id), btn.dataset.instId, instituciones, container)));

    document.querySelectorAll('.btn-del-card').forEach(btn =>
      btn.addEventListener('click', async () => {
        const card = tarjetas.find(t => t.id === btn.dataset.id);
        if (!confirmDelete(card.nombre)) return;
        await remove('tarjetas', card.id);
        toast('Tarjeta eliminada');
        renderView(container);
      }));

    document.querySelectorAll('.btn-copy-data').forEach(btn =>
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.value).then(() => {
          const icon = btn.querySelector('i');
          icon.className = 'bi bi-check2';
          btn.classList.add('copied');
          setTimeout(() => { icon.className = 'bi bi-copy'; btn.classList.remove('copied'); }, 1500);
        });
      }));

  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

const TIPO_ORDER = { debito: 0, credito: 1, prestamo: 2 };
const TIPO_BADGE  = {
  credito:  { cls: 'badge-credito',  label: 'Crédito'  },
  debito:   { cls: 'badge-debito',   label: 'Débito'   },
  prestamo: { cls: 'badge-prestamo', label: 'Préstamo' },
};

function darkenHex(hex, amount = 45) {
  const h = (hex || '#607d8b').replace('#', '');
  const r = Math.max(0, parseInt(h.slice(0, 2), 16) - amount);
  const g = Math.max(0, parseInt(h.slice(2, 4), 16) - amount);
  const b = Math.max(0, parseInt(h.slice(4, 6), 16) - amount);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function renderInstCard(inst, cards) {
  const color  = inst.color || INSTITUCIONES_DEFAULT_COLORS[inst.nombre] || '#607d8b';
  const sorted = [...cards].sort((a, b) => TIPO_ORDER[a.tipo] - TIPO_ORDER[b.tipo]);
  return `
    <div class="col-12 col-xl-6">
      <div class="data-card">
        <div class="data-card-header" style="background:${color}">
          <span><i class="bi bi-bank2 me-2"></i>${inst.nombre}</span>
          <div class="d-flex gap-2">
            <button class="btn-icon btn-edit-inst" data-id="${inst.id}" title="Editar" style="background:rgba(255,255,255,.15);border-color:rgba(255,255,255,.3);color:white">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn-icon danger btn-del-inst" data-id="${inst.id}" title="Eliminar" style="background:rgba(255,255,255,.15);border-color:rgba(255,255,255,.3);color:white">
              <i class="bi bi-trash3"></i>
            </button>
          </div>
        </div>

        ${inst.numeroCliente ? `
        <div class="inst-meta-row">
          <span class="inst-meta-label"><i class="bi bi-person-badge me-1"></i>No. Cliente</span>
          <span class="inst-meta-value fw-mono">${inst.numeroCliente}</span>
          <button class="btn-copy-data" data-value="${inst.numeroCliente}" title="Copiar"><i class="bi bi-copy"></i></button>
        </div>` : ''}

        <div class="inst-cards-body">
          ${sorted.length === 0
            ? `<p class="text-muted small mb-2 px-1">Sin tarjetas registradas</p>`
            : sorted.map(c => renderCardRow(c, color)).join('')
          }
          <button class="btn btn-sm btn-outline-secondary w-100 mt-3 btn-nueva-tarjeta" data-inst-id="${inst.id}">
            <i class="bi bi-plus me-1"></i>Agregar Tarjeta
          </button>
        </div>
      </div>
    </div>`;
}

function renderCardRow(c, color) {
  const isCred    = c.tipo === 'credito';
  const isPrest   = c.tipo === 'prestamo';
  const tipoBadge = TIPO_BADGE[c.tipo] ?? TIPO_BADGE.debito;
  const numeros   = (Array.isArray(c.numeros) ? c.numeros : []).filter(n => n.numero || n.fechaVencimiento);
  return `
    <div class="card-section">
      <div class="card-section-header">
        <div class="d-flex align-items-center gap-2">
          <span class="fw-600">${c.nombre}</span>
          <span class="badge-tipo ${tipoBadge.cls}">${tipoBadge.label}</span>
        </div>
        <div class="d-flex gap-1 flex-shrink-0">
          <button class="btn-icon btn-edit-card" data-id="${c.id}" data-inst-id="${c.institucionId}" title="Editar"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger btn-del-card" data-id="${c.id}" title="Eliminar"><i class="bi bi-trash3"></i></button>
        </div>
      </div>

      ${!isPrest && numeros.length > 0 ? `
      <div class="bank-cards-row">
        ${numeros.map(n => renderNumeroTile(n, color)).join('')}
      </div>` : ''}

      <div class="card-section-info">
        ${c.clabe ? `
        <div class="card-number-item">
          <span class="card-number-label">CLABE</span>
          <span class="fw-mono">${maskCard(c.clabe)}</span>
          <button class="btn-copy-data" data-value="${c.clabe}" title="Copiar CLABE"><i class="bi bi-copy"></i></button>
        </div>` : ''}
        ${isPrest && c.numeroPago ? `
        <div class="card-number-item">
          <span class="card-number-label">No. Pago</span>
          <span class="fw-mono">${c.numeroPago}</span>
          <button class="btn-copy-data" data-value="${c.numeroPago}" title="Copiar"><i class="bi bi-copy"></i></button>
        </div>` : ''}
        ${isCred && (c.limiteTotal || c.diaCorte || c.diaPago) ? `
        <div class="card-row-credit">
          ${c.limiteTotal ? `<span class="credit-chip"><i class="bi bi-wallet2 me-1"></i>${currency(Number(c.limiteTotal))}</span>` : ''}
          ${c.diaCorte   ? `<span class="credit-chip"><i class="bi bi-scissors me-1"></i>Corte ${c.diaCorte}</span>` : ''}
          ${c.diaPago    ? `<span class="credit-chip"><i class="bi bi-calendar-check me-1"></i>Pago ${c.diaPago}</span>` : ''}
        </div>` : ''}
        ${isPrest && (c.limite || c.diaCorte || c.diaPago) ? `
        <div class="card-row-credit">
          ${c.limite   ? `<span class="credit-chip prestamo-chip"><i class="bi bi-wallet2 me-1"></i>${currency(Number(c.limite))}</span>` : ''}
          ${c.diaCorte ? `<span class="credit-chip prestamo-chip"><i class="bi bi-scissors me-1"></i>Corte ${c.diaCorte}</span>` : ''}
          ${c.diaPago  ? `<span class="credit-chip prestamo-chip"><i class="bi bi-calendar-check me-1"></i>Pago ${c.diaPago}</span>` : ''}
        </div>` : ''}
      </div>
    </div>`;
}

function renderNumeroTile(n, color) {
  const dark     = darkenHex(color, 45);
  const isFisica = n.formato === 'fisica';
  return `
    <div class="bank-card-tile" style="background:linear-gradient(135deg,${color} 0%,${dark} 100%)">
      <div class="bct-top">
        ${isFisica ? '<div class="bct-chip"></div>' : '<i class="bi bi-wifi bct-wifi"></i>'}
      </div>
      <div class="bct-bottom">
        <div class="bct-number">
          ${n.numero
            ? `<span class="bct-num-text">${maskCard(n.numero)}</span>
               <button class="btn-copy-data bct-copy" data-value="${n.numero}" title="Copiar número"><i class="bi bi-copy"></i></button>`
            : `<span class="bct-num-text bct-no-num">— — — —</span>`}
        </div>
        <div class="bct-meta">
          <span>${isFisica ? 'Física' : 'Digital'}</span>
          ${n.fechaVencimiento ? `<span>${n.fechaVencimiento}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function showInstModal(inst, container) {
  const isEdit = !!inst;
  openModal({
    title: isEdit ? 'Editar Institución' : 'Nueva Institución',
    body: `
      <form id="inst-form">
        <div class="mb-3">
          <label class="form-label">Nombre *</label>
          <input type="text" class="form-control" name="nombre" value="${inst?.nombre || ''}" required placeholder="Ej: Banamex">
        </div>
        <div class="mb-3">
          <label class="form-label">Número de Cliente</label>
          <input type="text" class="form-control fw-mono" name="numeroCliente" value="${inst?.numeroCliente || ''}" placeholder="Opcional">
        </div>
        <div class="mb-3">
          <label class="form-label">Color</label>
          <input type="color" class="form-control form-control-color" name="color" value="${inst?.color || '#1565c0'}">
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-inst">${isEdit ? 'Guardar' : 'Crear'}</button>`
  });

  document.getElementById('btn-save-inst').addEventListener('click', async () => {
    const form = document.getElementById('inst-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw = Object.fromEntries(new FormData(form));
    const data = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
    try {
      if (isEdit) await update('instituciones', inst.id, data);
      else        await create('instituciones', data);
      closeModal();
      toast(isEdit ? 'Institución actualizada' : 'Institución creada');
      renderView(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

function showCardModal(card, instId, instituciones, container) {
  const isEdit = !!card;
  const inst = instituciones.find(i => i.id === instId);

  openModal({
    title: isEdit ? 'Editar Tarjeta' : `Nueva Tarjeta — ${inst?.nombre || ''}`,
    body: `
      <form id="card-form">
        <div class="row g-2 mb-3">
          <div class="col">
            <label class="form-label">Nombre *</label>
            <input type="text" class="form-control" name="nombre" value="${card?.nombre || ''}" required placeholder="Ej: Clásica, Oro">
          </div>
          <div class="col-auto">
            <label class="form-label">Tipo *</label>
            <select class="form-select" name="tipo" id="card-tipo" required>
              <option value="credito"  ${(card?.tipo ?? 'credito') === 'credito'  ? 'selected' : ''}>Crédito</option>
              <option value="debito"   ${card?.tipo === 'debito'                  ? 'selected' : ''}>Débito</option>
              <option value="prestamo" ${card?.tipo === 'prestamo'                ? 'selected' : ''}>Préstamo</option>
            </select>
          </div>
        </div>

        <div class="mb-3">
          <label class="form-label">CLABE</label>
          <input type="text" class="form-control fw-mono" name="clabe" value="${card?.clabe || ''}" placeholder="18 dígitos" maxlength="18">
        </div>

        <div id="credit-fields" ${card?.tipo !== 'credito' && card ? 'style="display:none"' : ''}>
          <hr class="my-2">
          <p class="form-text fw-600 mb-2" style="color:var(--text)">Crédito</p>
          <div class="mb-3">
            <label class="form-label">Límite total</label>
            <input type="number" class="form-control" name="limiteTotal" value="${card?.limiteTotal || ''}" placeholder="Ej: 50000" min="0" step="0.01">
          </div>
          <div class="row g-2 mb-3">
            <div class="col">
              <label class="form-label">Día de corte</label>
              <input type="number" class="form-control" name="diaCorte" value="${card?.diaCorte || ''}" placeholder="1-31" min="1" max="31">
            </div>
            <div class="col">
              <label class="form-label">Día de pago</label>
              <input type="number" class="form-control" name="diaPago" value="${card?.diaPago || ''}" placeholder="1-31" min="1" max="31">
            </div>
          </div>
        </div>

        <div id="loan-fields" ${card?.tipo !== 'prestamo' ? 'style="display:none"' : ''}>
          <hr class="my-2">
          <p class="form-text fw-600 mb-2" style="color:var(--text)">Préstamo</p>
          <div class="mb-3">
            <label class="form-label">Límite</label>
            <input type="number" class="form-control" name="limite" value="${card?.limite || ''}" placeholder="Monto del préstamo" min="0" step="0.01">
          </div>
          <div class="mb-3">
            <label class="form-label">Número de pago</label>
            <input type="text" class="form-control fw-mono" name="numeroPago" value="${card?.numeroPago || ''}" placeholder="Referencia de pago (opcional)">
          </div>
          <div class="row g-2 mb-3">
            <div class="col">
              <label class="form-label">Día de corte</label>
              <input type="number" class="form-control" name="diaCorte" value="${card?.diaCorte || ''}" placeholder="1-31" min="1" max="31">
            </div>
            <div class="col">
              <label class="form-label">Día de pago</label>
              <input type="number" class="form-control" name="diaPago" value="${card?.diaPago || ''}" placeholder="1-31" min="1" max="31">
            </div>
          </div>
        </div>

        <div id="numeros-section" ${card?.tipo === 'prestamo' ? 'style="display:none"' : ''}>
          <hr class="my-2">
          <div class="d-flex align-items-center justify-content-between mb-2">
            <p class="form-text fw-600 mb-0" style="color:var(--text)">Números</p>
            <button type="button" class="btn btn-sm btn-outline-primary" id="btn-add-numero">
              <i class="bi bi-plus me-1"></i>Agregar
            </button>
          </div>
          <div id="numeros-list"></div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-card">${isEdit ? 'Guardar' : 'Crear'}</button>`
  });

  // Populate existing numeros
  const numerosList = document.getElementById('numeros-list');
  const existingNumeros = Array.isArray(card?.numeros) ? card.numeros : [];
  if (existingNumeros.length === 0) addNumeroRow(numerosList);
  else existingNumeros.forEach(n => addNumeroRow(numerosList, n));

  document.getElementById('btn-add-numero').addEventListener('click', () => addNumeroRow(numerosList));

  const tipoSelect     = document.getElementById('card-tipo');
  const creditFields   = document.getElementById('credit-fields');
  const loanFields     = document.getElementById('loan-fields');
  const numerosSection = document.getElementById('numeros-section');
  const setFieldsDisabled = (section, disabled) => {
    section.querySelectorAll('input, select').forEach(el => el.disabled = disabled);
  };
  const toggleTipo = () => {
    const t = tipoSelect.value;
    creditFields.style.display   = t === 'credito'  ? '' : 'none';
    loanFields.style.display     = t === 'prestamo' ? '' : 'none';
    numerosSection.style.display = t === 'prestamo' ? 'none' : '';
    setFieldsDisabled(creditFields, t !== 'credito');
    setFieldsDisabled(loanFields,   t !== 'prestamo');
  };
  toggleTipo();
  tipoSelect.addEventListener('change', toggleTipo);

  document.getElementById('btn-save-card').addEventListener('click', async () => {
    const form = document.getElementById('card-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw = Object.fromEntries(new FormData(form));
    const data = { institucionId: instId };
    for (const [k, v] of Object.entries(raw)) {
      if (v !== '') data[k] = v;
    }
    if (data.tipo === 'debito') {
      delete data.limiteTotal;
      delete data.diaCorte;
      delete data.diaPago;
    }
    if (data.tipo === 'credito') {
      delete data.limite;
      delete data.numeroPago;
    }
    if (data.tipo !== 'prestamo') {
      delete data.limite;
      delete data.numeroPago;
    }
    if (data.tipo === 'prestamo') {
      data.numeros = [];
    }
    // Collect numeros array
    data.numeros = [];
    document.querySelectorAll('.numero-row').forEach(row => {
      const formato = row.querySelector('.n-formato').value;
      const numero  = row.querySelector('.n-numero').value.trim();
      const fv      = row.querySelector('.n-vencimiento').value.trim();
      const entry   = { formato };
      if (numero) entry.numero = numero;
      if (fv)     entry.fechaVencimiento = fv;
      if (entry.numero || entry.fechaVencimiento) data.numeros.push(entry);
    });
    try {
      if (isEdit) await update('tarjetas', card.id, data);
      else        await create('tarjetas', data);
      closeModal();
      toast(isEdit ? 'Tarjeta actualizada' : 'Tarjeta creada');
      renderView(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

function addNumeroRow(container, n = null) {
  const row = document.createElement('div');
  row.className = 'numero-row d-flex gap-2 mb-2 align-items-center';
  row.innerHTML = `
    <select class="form-select form-select-sm n-formato" style="width:100px;flex-shrink:0">
      <option value="fisica"  ${!n || n.formato === 'fisica'  ? 'selected' : ''}>Física</option>
      <option value="digital" ${n?.formato === 'digital'       ? 'selected' : ''}>Digital</option>
    </select>
    <input type="text" class="form-control form-control-sm fw-mono n-numero" value="${n?.numero || ''}" placeholder="4 o 16 dígitos" maxlength="16">
    <input type="text" class="form-control form-control-sm fw-mono n-vencimiento" value="${n?.fechaVencimiento || ''}" placeholder="MM/AA" maxlength="5" style="width:80px;flex-shrink:0">
    <button type="button" class="btn-icon danger flex-shrink-0" title="Eliminar"><i class="bi bi-x-lg"></i></button>
  `;
  row.querySelector('.btn-icon').addEventListener('click', () => row.remove());

  const numeroInput = row.querySelector('.n-numero');
  numeroInput.addEventListener('paste', e => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\s/g, '');
    const { selectionStart: s, selectionEnd: e2, value } = numeroInput;
    numeroInput.value = (value.slice(0, s) + pasted + value.slice(e2)).slice(0, 16);
    numeroInput.setSelectionRange(s + pasted.length, s + pasted.length);
  });

  container.appendChild(row);
}
