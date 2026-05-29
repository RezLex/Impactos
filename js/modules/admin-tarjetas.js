import { getAll, create, update, remove } from '../utils/db.js';
import { maskCard, currency, fmtDate } from '../utils/formatters.js';
import { calcularSaldo } from '../utils/saldo.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';

const REDES = ['Visa', 'Mastercard', 'Maestro', 'Amex', 'Carnet', 'Discover'];
const TIPO_LABEL = { credito: 'Crédito', debito: 'Débito', prestamo: 'Préstamo' };
const TIPO_CLS   = { credito: 'badge-credito', debito: 'badge-debito', prestamo: 'badge-prestamo' };

function detectarRed(numero) {
  const n = String(numero || '').replace(/\s/g, '');
  if (/^4/.test(n)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard';
  if (/^(6304|6759|676[1-3])/.test(n)) return 'Maestro';
  if (/^3[47]/.test(n)) return 'Amex';
  if (/^9/.test(n)) return 'Carnet';
  if (/^(6011|65|64[4-9])/.test(n)) return 'Discover';
  return '';
}

function fmtCiclo(c) {
  if (!c?.ciclo) return '—';
  const ci = c.ciclo;
  if (ci.diasAlCorte) return `Pago ${ci.diaPago}, corte −${ci.diasAlCorte}d`;
  if (ci.diasAlPago)  return `Corte ${ci.diaCorte}, +${ci.diasAlPago}d`;
  if (ci.diaCorte && ci.diaPago) return `Corte ${ci.diaCorte}, Pago ${ci.diaPago}`;
  return '—';
}

function wireCopyButtons(root) {
  root.querySelectorAll('.btn-copy-data').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.value).then(() => {
        const icon = btn.querySelector('i');
        icon.className = 'bi bi-check2';
        btn.classList.add('copied');
        setTimeout(() => { icon.className = 'bi bi-copy'; btn.classList.remove('copied'); }, 1500);
      });
    });
  });
}

function renderNumsCell(numeros) {
  const items = (numeros || []).filter(n => n.numero);
  if (!items.length) return '<span class="text-muted">—</span>';
  return items.map(n => `
    <div class="d-flex align-items-center gap-1 mb-1">
      <span class="admin-num-badge ${n.formato === 'fisica' ? 'fisica' : 'digital'}">${n.formato === 'fisica' ? 'F' : 'D'}</span>
      <span class="fw-mono" style="font-size:0.78rem">${maskCard(n.numero)}</span>
      ${n.fechaVencimiento ? `<span style="font-size:0.65rem;color:var(--text-muted)">${n.fechaVencimiento}</span>` : ''}
      <button class="btn-copy-data" data-value="${n.numero}" title="Copiar"><i class="bi bi-copy"></i></button>
    </div>`).join('');
}

export async function render(container) {
  container.innerHTML = `<div class="loading-overlay"><div class="spinner-border text-primary" role="status"></div></div>`;
  await renderView(container);
}

async function renderView(container) {
  try {
    const [instituciones, tarjetas, contado, msi, gastos] = await Promise.all([
      getAll('instituciones'),
      getAll('tarjetas'),
      getAll('contado'),
      getAll('msi'),
      getAll('gastos'),
    ]);

    const saldoMap = new Map(
      tarjetas.map(t => [t.id, calcularSaldo(t, contado, msi, gastos)])
    );

    instituciones.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    const tarjetasPorInst = {};
    tarjetas.forEach(t => {
      if (!tarjetasPorInst[t.institucionId]) tarjetasPorInst[t.institucionId] = [];
      tarjetasPorInst[t.institucionId].push(t);
    });

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Instituciones y Tarjetas</h2>
          <p>${instituciones.length} instituciones · ${tarjetas.length} tarjetas</p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-nueva-inst">
          <i class="bi bi-plus-lg me-1"></i>Nueva Institución
        </button>
      </div>
      <div id="inst-list">
        ${instituciones.length === 0 ? `
        <div class="empty-state">
          <i class="bi bi-building"></i>
          <p>No hay instituciones registradas. Agrega una para comenzar.</p>
        </div>` : instituciones.map(inst => {
          const cards = tarjetasPorInst[inst.id] || [];
          const color = inst.color || '#607d8b';
          return `
          <div class="data-card mb-3">
            <div class="admin-inst-header" style="background:${color};border-radius:8px 8px 0 0;">
              <span class="fw-semibold text-white">${inst.nombre}</span>
              ${inst.numeroCliente ? `
                <span class="admin-client-num">
                  <span class="fw-mono">${inst.numeroCliente}</span>
                  <button class="btn-copy-data" data-value="${inst.numeroCliente}" title="Copiar No. cliente"><i class="bi bi-copy"></i></button>
                </span>` : ''}
              <div class="d-flex gap-1 ms-auto">
                <button class="btn btn-sm btn-outline-light btn-add-card" data-inst-id="${inst.id}">
                  <i class="bi bi-plus-lg me-1"></i>Agregar
                </button>
                <button class="btn btn-sm btn-outline-light btn-edit-inst"
                  data-id="${inst.id}"
                  data-nombre="${inst.nombre}"
                  data-color="${color}"
                  data-numero-cliente="${inst.numeroCliente || ''}">
                  <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-light btn-del-inst"
                  data-id="${inst.id}" data-nombre="${inst.nombre}"
                  ${cards.length > 0 ? 'disabled title="Elimina las tarjetas primero"' : ''}>
                  <i class="bi bi-trash3"></i>
                </button>
              </div>
            </div>
            ${cards.length === 0 ? `
            <div class="p-3 text-center" style="font-size:0.85rem;color:var(--text-muted)">Sin tarjetas registradas.</div>` : `
            <div class="table-wrapper">
              <table class="table table-sm mb-0">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Tipo</th>
                    <th>Red</th>
                    <th>Números</th>
                    <th>CLABE</th>
                    <th>Límite</th>
                    <th>Saldo disponible</th>
                    <th>Saldo usado</th>
                    <th>Ciclo</th>
                    <th style="width:72px"></th>
                  </tr>
                </thead>
                <tbody>
                  ${cards.map(c => `
                  <tr>
                    <td>${c.nombre}</td>
                    <td><span class="badge-tipo ${TIPO_CLS[c.tipo] || 'badge-debito'}">${TIPO_LABEL[c.tipo] || c.tipo}</span></td>
                    <td style="white-space:nowrap">${c.red || '—'}</td>
                    <td>${renderNumsCell(c.numeros)}</td>
                    <td>${c.clabe ? `
                      <div class="d-flex align-items-center gap-1">
                        <span class="fw-mono" style="font-size:0.78rem">${maskCard(c.clabe)}</span>
                        <button class="btn-copy-data" data-value="${c.clabe}" title="Copiar CLABE"><i class="bi bi-copy"></i></button>
                      </div>` : '<span class="text-muted">—</span>'}</td>
                    <td style="white-space:nowrap">${c.limiteTotal ? currency(Number(c.limiteTotal)) : '—'}</td>
                    <td style="white-space:nowrap">${(() => {
                      const s = saldoMap.get(c.id);
                      if (!s) return '<span class="text-muted">—</span>';
                      const cls = s.ajustado ? '' : 'text-success';
                      return `<span class="fw-semibold ${cls}">${currency(s.disponible)}</span>`;
                    })()}</td>
                    <td style="white-space:nowrap">${(() => {
                      const s = saldoMap.get(c.id);
                      if (!s || s.usado == null) return '<span class="text-muted">—</span>';
                      return `<span>${currency(s.usado)}</span>`;
                    })()}</td>
                    <td style="font-size:0.78rem;color:var(--text-muted);white-space:nowrap">${fmtCiclo(c)}</td>
                    <td>
                      <div class="d-flex gap-1">
                        <button class="btn-icon btn-edit-card" data-id="${c.id}" title="Editar"><i class="bi bi-pencil"></i></button>
                        <button class="btn-icon danger btn-del-card" data-id="${c.id}" data-nombre="${c.nombre}" title="Eliminar"><i class="bi bi-trash3"></i></button>
                      </div>
                    </td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>`}
          </div>`;
        }).join('')}
      </div>`;

    wireCopyButtons(container);

    document.getElementById('btn-nueva-inst').addEventListener('click', () => showInstModal(container));

    document.querySelectorAll('.btn-edit-inst').forEach(btn =>
      btn.addEventListener('click', () => showInstModal(container, {
        id:            btn.dataset.id,
        nombre:        btn.dataset.nombre,
        color:         btn.dataset.color,
        numeroCliente: btn.dataset.numeroCliente,
      })));

    document.querySelectorAll('.btn-del-inst').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirmDelete(btn.dataset.nombre)) return;
        await remove('instituciones', btn.dataset.id);
        toast('Institución eliminada');
        renderView(container);
      }));

    document.querySelectorAll('.btn-add-card').forEach(btn =>
      btn.addEventListener('click', () => showCardModal(container, instituciones, btn.dataset.instId)));

    document.querySelectorAll('.btn-edit-card').forEach(btn =>
      btn.addEventListener('click', () => {
        const card = tarjetas.find(t => t.id === btn.dataset.id);
        showCardModal(container, instituciones, card.institucionId, card);
      }));

    document.querySelectorAll('.btn-del-card').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirmDelete(btn.dataset.nombre)) return;
        await remove('tarjetas', btn.dataset.id);
        toast('Tarjeta eliminada');
        renderView(container);
      }));

  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

// ── Institution modal ─────────────────────────────────────────────────────────

function showInstModal(container, inst = null) {
  const editing = !!inst?.id;
  openModal({
    title: editing ? 'Editar Institución' : 'Nueva Institución',
    body: `
      <form id="inst-form">
        <div class="mb-3">
          <label class="form-label">Nombre *</label>
          <input type="text" class="form-control" name="nombre" value="${inst?.nombre || ''}" required>
        </div>
        <div class="mb-3">
          <label class="form-label">Número de cliente</label>
          <input type="text" class="form-control fw-mono" name="numeroCliente" value="${inst?.numeroCliente || ''}" placeholder="Opcional">
        </div>
        <div class="mb-3">
          <label class="form-label">Color de identificación</label>
          <input type="color" class="form-control form-control-color" name="color" value="${inst?.color || '#607d8b'}">
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-inst">${editing ? 'Guardar' : 'Crear'}</button>`
  });

  document.getElementById('btn-save-inst').addEventListener('click', async () => {
    const form = document.getElementById('inst-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw  = Object.fromEntries(new FormData(form));
    const data = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
    try {
      if (editing) { await update('instituciones', inst.id, data); toast('Institución actualizada'); }
      else         { await create('instituciones', data);          toast('Institución creada');      }
      closeModal();
      renderView(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

// ── Card modal ────────────────────────────────────────────────────────────────

function addNumeroRow(list, num = {}, redEl) {
  const row = document.createElement('div');
  row.className = 'num-row d-flex gap-2 mb-2 align-items-center';
  row.innerHTML = `
    <select class="form-select form-select-sm" style="width:95px;flex-shrink:0" data-f="formato">
      <option value="fisica"  ${num.formato === 'fisica'  || !num.formato ? 'selected' : ''}>Física</option>
      <option value="digital" ${num.formato === 'digital' ? 'selected' : ''}>Digital</option>
    </select>
    <input type="text" class="form-control form-control-sm fw-mono" placeholder="Número"
      data-f="numero" value="${num.numero || ''}" maxlength="19">
    <input type="text" class="form-control form-control-sm fw-mono" style="width:82px;flex-shrink:0"
      placeholder="MM/AA" data-f="fechaVencimiento" value="${num.fechaVencimiento || ''}" maxlength="5">
    <button type="button" class="btn btn-sm btn-outline-danger flex-shrink-0" title="Eliminar">
      <i class="bi bi-trash3"></i>
    </button>`;
  row.querySelector('[data-f="numero"]').addEventListener('input', e => {
    const det = detectarRed(e.target.value);
    if (det && redEl) redEl.value = det;
  });
  row.querySelector('button').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

function showCardModal(container, instituciones, preInstId, card = null) {
  const editing        = !!card?.id;
  const tipoVal        = card?.tipo || 'debito';
  const metodoCicloVal = card?.ciclo?.diasAlCorte ? 'c' : card?.ciclo?.diasAlPago ? 'b' : 'a';

  const instOpts = instituciones
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .map(i => `<option value="${i.id}" ${(preInstId || card?.institucionId) === i.id ? 'selected' : ''}>${i.nombre}</option>`)
    .join('');

  const redOpts = REDES
    .map(r => `<option value="${r}" ${card?.red === r ? 'selected' : ''}>${r}</option>`)
    .join('');

  openModal({
    title: editing ? `Editar — ${card.nombre}` : 'Nueva Tarjeta / Préstamo',
    size: 'lg',
    body: `
      <form id="card-form">
        <div class="row g-3 mb-3">
          <div class="col-sm-6">
            <label class="form-label">Institución *</label>
            <select class="form-select" name="institucionId" required>${instOpts}</select>
          </div>
          <div class="col-sm-6">
            <label class="form-label">Tipo *</label>
            <select class="form-select" name="tipo" id="card-tipo" required>
              <option value="debito"   ${tipoVal==='debito'   ?'selected':''}>Débito</option>
              <option value="credito"  ${tipoVal==='credito'  ?'selected':''}>Crédito</option>
              <option value="prestamo" ${tipoVal==='prestamo' ?'selected':''}>Préstamo</option>
            </select>
          </div>
          <div class="col-sm-8">
            <label class="form-label">Nombre *</label>
            <input type="text" class="form-control" name="nombre" value="${card?.nombre || ''}" required placeholder="Ej: Tarjeta Azul">
          </div>
          <div class="col-sm-4">
            <label class="form-label">Red</label>
            <select class="form-select" name="red" id="card-red">
              <option value="">— Sin red —</option>
              ${redOpts}
            </select>
          </div>
        </div>

        <!-- CLABE (débito / crédito) -->
        <div class="mb-3" id="sec-clabe">
          <label class="form-label">CLABE</label>
          <input type="text" class="form-control fw-mono" name="clabe" value="${card?.clabe || ''}" maxlength="18" placeholder="18 dígitos">
        </div>

        <!-- Números de tarjeta -->
        <div class="mb-3" id="sec-numeros">
          <div class="d-flex align-items-center justify-content-between mb-2">
            <label class="form-label mb-0">Números de tarjeta</label>
            <button type="button" class="btn btn-sm btn-outline-secondary" id="btn-add-num">
              <i class="bi bi-plus-lg me-1"></i>Agregar número
            </button>
          </div>
          <div id="numeros-list"></div>
        </div>

        <!-- Número de pago (préstamo) -->
        <div class="mb-3 d-none" id="sec-prestamo">
          <label class="form-label">Número de pago</label>
          <input type="text" class="form-control fw-mono" name="numeroPago" value="${card?.numeroPago || ''}">
        </div>

        <!-- Límite (crédito y préstamo) -->
        <div class="mb-3 d-none" id="sec-limite">
          <label class="form-label">Límite total</label>
          <input type="number" class="form-control" name="limiteTotal" value="${card?.limiteTotal || ''}" min="0" step="0.01" placeholder="0.00">
        </div>

        <!-- Saldo disponible (crédito y préstamo) -->
        <div class="mb-3 d-none" id="sec-saldo">
          <hr class="my-2">
          <label class="form-label fw-semibold">Saldo disponible</label>
          <div class="row g-2">
            <div class="col-sm-6">
              <label class="form-label small text-muted">Disponible</label>
              <div class="input-group input-group-sm">
                <span class="input-group-text">$</span>
                <input type="number" class="form-control" id="saldo-disponible" name="saldoDisponible"
                       value="${card?.saldoDisponible ?? ''}" min="0" step="0.01" placeholder="0.00">
              </div>
            </div>
            <div class="col-sm-6">
              <label class="form-label small text-muted">Usado <span class="text-muted">(calcula disponible)</span></label>
              <div class="input-group input-group-sm">
                <span class="input-group-text">$</span>
                <input type="number" class="form-control" id="saldo-usado" min="0" step="0.01" placeholder="0.00"
                       value="${card?.saldoDisponible != null && card?.limiteTotal ? Math.max(0, Number(card.limiteTotal) - Number(card.saldoDisponible)).toFixed(2) : ''}">
              </div>
            </div>
            ${card?.fechaActualizacionSaldo ? `
            <div class="col-12">
              <small class="text-muted"><i class="bi bi-clock me-1"></i>Última actualización: ${fmtDate(card.fechaActualizacionSaldo)}</small>
            </div>` : ''}
          </div>
        </div>

        <!-- Ciclo (solo crédito) -->
        <div class="d-none" id="sec-credito">
          <hr>
          <div class="mb-3">
            <label class="form-label fw-semibold">Ciclo de facturación</label>
            <select class="form-select" id="metodoCiclo">
              <option value="a" ${metodoCicloVal==='a'?'selected':''}>A — Día de corte + día de pago fijo</option>
              <option value="b" ${metodoCicloVal==='b'?'selected':''}>B — Día de corte + días al pago</option>
              <option value="c" ${metodoCicloVal==='c'?'selected':''}>C — Día de pago + días al corte</option>
            </select>
          </div>

          <div id="ciclo-a" class="row g-3 mb-3">
            <div class="col-sm-6">
              <label class="form-label">Día de corte</label>
              <input type="number" class="form-control" id="diaCorte_a" placeholder="1–31" min="1" max="31"
                value="${!card?.ciclo?.diasAlCorte && !card?.ciclo?.diasAlPago ? (card?.ciclo?.diaCorte || '') : ''}">
            </div>
            <div class="col-sm-6">
              <label class="form-label">Día de pago</label>
              <input type="number" class="form-control" id="diaPago_a" placeholder="1–31" min="1" max="31"
                value="${!card?.ciclo?.diasAlCorte && !card?.ciclo?.diasAlPago ? (card?.ciclo?.diaPago || '') : ''}">
            </div>
          </div>

          <div id="ciclo-b" class="row g-3 mb-3 d-none">
            <div class="col-sm-6">
              <label class="form-label">Día de corte</label>
              <input type="number" class="form-control" id="diaCorte_b" placeholder="1–31" min="1" max="31"
                value="${card?.ciclo?.diasAlPago ? (card?.ciclo?.diaCorte || '') : ''}">
            </div>
            <div class="col-sm-6">
              <label class="form-label">Días al pago</label>
              <input type="number" class="form-control" id="diasAlPago" placeholder="ej. 20"
                value="${card?.ciclo?.diasAlPago || ''}">
            </div>
          </div>

          <div id="ciclo-c" class="row g-3 mb-3 d-none">
            <div class="col-sm-6">
              <label class="form-label">Día de pago</label>
              <input type="number" class="form-control" id="diaPago_c" placeholder="1–31" min="1" max="31"
                value="${card?.ciclo?.diasAlCorte ? (card?.ciclo?.diaPago || '') : ''}">
            </div>
            <div class="col-sm-6">
              <label class="form-label">Días al corte</label>
              <input type="number" class="form-control" id="diasAlCorte" placeholder="ej. 5"
                value="${card?.ciclo?.diasAlCorte || ''}">
            </div>
          </div>

          <div class="row g-3 mb-3">
            <div class="col-sm-4">
              <label class="form-label">Ajuste corte</label>
              <select class="form-select" name="ajusteCorte">
                <option value="siguiente" ${(card?.ciclo?.ajusteCorte||'siguiente')==='siguiente'?'selected':''}>Siguiente hábil</option>
                <option value="anterior"  ${card?.ciclo?.ajusteCorte==='anterior' ?'selected':''}>Anterior hábil</option>
                <option value="ninguno"   ${card?.ciclo?.ajusteCorte==='ninguno'  ?'selected':''}>Sin ajuste</option>
              </select>
            </div>
            <div class="col-sm-4">
              <label class="form-label">Ajuste pago</label>
              <select class="form-select" name="ajustePago">
                <option value="siguiente" ${(card?.ciclo?.ajustePago||'siguiente')==='siguiente'?'selected':''}>Siguiente hábil</option>
                <option value="anterior"  ${card?.ciclo?.ajustePago==='anterior' ?'selected':''}>Anterior hábil</option>
                <option value="ninguno"   ${card?.ciclo?.ajustePago==='ninguno'  ?'selected':''}>Sin ajuste</option>
              </select>
            </div>
            <div class="col-sm-4 d-flex align-items-end pb-2">
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="baseCalculo"
                  ${card?.ciclo?.baseCalculo === 'original' ? 'checked' : ''}>
                <label class="form-check-label" for="baseCalculo">Usar día original como base</label>
              </div>
            </div>
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-card">${editing ? 'Guardar' : 'Crear'}</button>`
  });

  const tipoEl      = document.getElementById('card-tipo');
  const metodoCiclo = document.getElementById('metodoCiclo');
  const redEl       = document.getElementById('card-red');
  const numList     = document.getElementById('numeros-list');

  // Cargar números existentes
  (card?.numeros || []).forEach(n => addNumeroRow(numList, n, redEl));

  document.getElementById('btn-add-num').addEventListener('click', () => addNumeroRow(numList, {}, redEl));

  const setTipo = (tipo) => {
    const isPrestamo = tipo === 'prestamo';
    document.getElementById('sec-clabe').classList.toggle('d-none', isPrestamo);
    document.getElementById('sec-numeros').classList.toggle('d-none', isPrestamo);
    document.getElementById('sec-prestamo').classList.toggle('d-none', !isPrestamo);
    document.getElementById('sec-limite').classList.toggle('d-none', tipo === 'debito');
    document.getElementById('sec-saldo').classList.toggle('d-none', tipo === 'debito');
    document.getElementById('sec-credito').classList.toggle('d-none', tipo !== 'credito');
  };

  const setCicloMode = (mode) => {
    ['a', 'b', 'c'].forEach(m =>
      document.getElementById(`ciclo-${m}`).classList.toggle('d-none', m !== mode));
  };

  tipoEl.addEventListener('change', () => setTipo(tipoEl.value));
  metodoCiclo.addEventListener('change', () => setCicloMode(metodoCiclo.value));
  setTipo(tipoVal);
  setCicloMode(metodoCicloVal);

  const saldoDispEl  = document.getElementById('saldo-disponible');
  const saldoUsadoEl = document.getElementById('saldo-usado');
  const limiteEl     = document.querySelector('#card-form [name="limiteTotal"]');

  const _getLimite = () => Number(limiteEl?.value) || 0;

  saldoUsadoEl.addEventListener('input', () => {
    const lim = _getLimite();
    if (lim) saldoDispEl.value = Math.max(0, lim - (Number(saldoUsadoEl.value) || 0)).toFixed(2);
  });
  saldoDispEl.addEventListener('input', () => {
    const lim = _getLimite();
    if (lim) saldoUsadoEl.value = Math.max(0, lim - (Number(saldoDispEl.value) || 0)).toFixed(2);
  });
  limiteEl?.addEventListener('input', () => {
    if (saldoUsadoEl.value !== '') {
      const lim = _getLimite();
      saldoDispEl.value = Math.max(0, lim - (Number(saldoUsadoEl.value) || 0)).toFixed(2);
    }
  });

  document.getElementById('btn-save-card').addEventListener('click', async () => {
    const form = document.getElementById('card-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw = Object.fromEntries(new FormData(form));

    const data = {
      institucionId: raw.institucionId,
      tipo:          raw.tipo,
      nombre:        raw.nombre,
      red:           raw.red || null,
    };

    if (raw.clabe)      data.clabe      = raw.clabe;
    if (raw.numeroPago) data.numeroPago = raw.numeroPago;

    // Recopilar números
    const numeros = [];
    numList.querySelectorAll('.num-row').forEach(row => {
      const formato          = row.querySelector('[data-f="formato"]').value;
      const numero           = row.querySelector('[data-f="numero"]').value.trim();
      const fechaVencimiento = row.querySelector('[data-f="fechaVencimiento"]').value.trim();
      if (numero || fechaVencimiento) numeros.push({ formato, numero, fechaVencimiento });
    });
    if (numeros.length) data.numeros = numeros;

    // Límite (crédito y préstamo)
    if (raw.limiteTotal) data.limiteTotal = Number(raw.limiteTotal);

    // Saldo disponible (crédito y préstamo)
    if (raw.tipo !== 'debito') {
      const dispVal = document.getElementById('saldo-disponible')?.value;
      if (dispVal !== '' && dispVal != null) {
        data.saldoDisponible = Number(dispVal);
        const hoy = new Date();
        data.fechaActualizacionSaldo = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
      }
    }

    // Ciclo (solo crédito)
    if (raw.tipo === 'credito') {

      const modo  = document.getElementById('metodoCiclo').value;
      const ciclo = {};
      if (modo === 'a') {
        const dc = document.getElementById('diaCorte_a').value;
        const dp = document.getElementById('diaPago_a').value;
        if (dc) ciclo.diaCorte = Number(dc);
        if (dp) ciclo.diaPago  = Number(dp);
      } else if (modo === 'b') {
        const dc = document.getElementById('diaCorte_b').value;
        const dp = document.getElementById('diasAlPago').value;
        if (dc) ciclo.diaCorte  = Number(dc);
        if (dp) ciclo.diasAlPago = Number(dp);
      } else {
        const dp = document.getElementById('diaPago_c').value;
        const dc = document.getElementById('diasAlCorte').value;
        if (dp) ciclo.diaPago    = Number(dp);
        if (dc) ciclo.diasAlCorte = Number(dc);
      }
      ciclo.ajusteCorte = raw.ajusteCorte || 'siguiente';
      ciclo.ajustePago  = raw.ajustePago  || 'siguiente';
      if (document.getElementById('baseCalculo').checked) ciclo.baseCalculo = 'original';
      if (Object.keys(ciclo).length > 2) data.ciclo = ciclo;
    }

    try {
      if (editing) { await update('tarjetas', card.id, data); toast('Tarjeta actualizada'); }
      else         { await create('tarjetas', data);          toast('Tarjeta creada');       }
      closeModal();
      renderView(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
