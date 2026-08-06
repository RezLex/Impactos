import { getAll, create, update, remove } from '../utils/db.js';
import { currency, fmtDate } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import {
  resumenCuenta, totalizarResumenes, rendimientoEntre, timelineCuenta,
  configCuenta, hoyISO, isoDay, diasEntre,
  TRAMOS_DEFAULT, BASE_ANUAL_DEFAULT,
  MODO_PROGRESIVO, MODO_UNICO, ISR_CAPITAL, ISR_INTERES,
} from '../utils/rendimiento.js';

const COL      = 'inversiones';
const MAX_HIST = 60;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pct = n => (Number(n) || 0).toFixed(2) + '%';

/**
 * Trunca en vez de redondear. Es como las instituciones muestran la tasa
 * ponderada — nunca la exhiben por encima de lo que realmente pagan.
 * Verificado con Revolut: 14.849679% se muestra como 14.84%, no 14.85%.
 * El GAT sí va redondeado (16.1798% → 16.18%), por eso usa `pct`.
 */
const pctTrunc = n => (Math.floor((Number(n) || 0) * 100) / 100).toFixed(2) + '%';

/** Alias capturado de la cuenta — opcional, puede venir vacío. */
const alias = c => (c.nombre || '').trim();

/** Nombre visible de la cuenta: su alias o, si no tiene, el de la institución. */
const nombreCuenta = (c, instNombre) => alias(c) || instNombre || 'Cuenta';

/** Etiqueta legible del rango de un tramo normalizado. */
function rangoTramo(t, esPrimero) {
  const desde = esPrimero ? '$0.00' : currency(t.desde + 0.01);
  return t.hasta == null ? `${desde} en adelante` : `${desde} – ${currency(t.hasta)}`;
}

/** Agrega una captura al historial, sin duplicar fechas y acotando el tamaño. */
function pushHistorial(historial, entry) {
  const map = new Map();
  (Array.isArray(historial) ? historial : []).forEach(h => {
    const f = isoDay(h?.fecha);
    if (f && h?.monto != null) map.set(f, { fecha: f, monto: Number(h.monto) || 0 });
  });
  map.set(entry.fecha, entry);
  return [...map.values()]
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .slice(-MAX_HIST);
}

// Estado de la calculadora — sobrevive a los re-render del módulo
const _calc = { cuentaId: '', desde: '', hasta: '' };

export async function render(container) {
  await renderView(container);
}

async function renderView(container) {
  try {
    const [cuentas, instituciones] = await Promise.all([
      getAll(COL),
      getAll('instituciones'),
    ]);

    const instMap = Object.fromEntries(instituciones.map(i => [i.id, i]));
    const hoy     = hoyISO();

    const instNombre = c => instMap[c.institucionId]?.nombre || 'Sin institución';
    cuentas.sort((a, b) =>
      instNombre(a).localeCompare(instNombre(b), 'es') ||
      (a.nombre || '').localeCompare(b.nombre || '', 'es'));

    const resumenes = new Map(cuentas.map(c => [c.id, resumenCuenta(c, hoy)]));
    const tot       = totalizarResumenes([...resumenes.values()]);

    if (!_calc.desde) _calc.desde = hoy.slice(0, 8) + '01';
    if (!_calc.hasta) _calc.hasta = hoy;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Rendimientos</h2>
          <p>${cuentas.length} ${cuentas.length === 1 ? 'cuenta' : 'cuentas'} de inversión ·
             Capital ${currency(tot.capital)} ·
             Ganado hasta hoy <strong class="text-success">${currency(tot.rendimientoHastaHoy)}</strong></p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-nueva-cuenta"
                ${instituciones.length ? '' : 'disabled title="Registra una institución en Administración primero"'}>
          <i class="bi bi-plus-lg me-1"></i>Nueva Cuenta
        </button>
      </div>

      <!-- ── Acumulado de todas las cuentas ── -->
      <div class="row g-3 mb-3">
        <div class="col-12 col-sm-6 col-xl-3">
          <div class="metric-card h-100">
            <div class="metric-icon" style="background:#e8f5e9"><i class="bi bi-piggy-bank-fill" style="color:#2e7d32"></i></div>
            <div class="metric-info">
              <div class="metric-value">${currency(tot.saldoActual)}</div>
              <div class="metric-label">Saldo actual</div>
              <div class="metric-sub">Capital ${currency(tot.capital)}</div>
            </div>
          </div>
        </div>
        <div class="col-12 col-sm-6 col-xl-3">
          <div class="metric-card h-100">
            <div class="metric-icon" style="background:#e3f2fd"><i class="bi bi-graph-up-arrow" style="color:#1565c0"></i></div>
            <div class="metric-info">
              <div class="metric-value text-success">${currency(tot.rendimientoHastaHoy)}</div>
              <div class="metric-label">Hasta hoy</div>
              <div class="metric-sub">Desde la última actualización</div>
            </div>
          </div>
        </div>
        <div class="col-12 col-sm-6 col-xl-3">
          <div class="metric-card h-100">
            <div class="metric-icon" style="background:#fff8e1"><i class="bi bi-sun-fill" style="color:#e65100"></i></div>
            <div class="metric-info">
              <div class="metric-value">${currency(tot.diario)}</div>
              <div class="metric-label">Rendimiento diario</div>
              <div class="metric-sub">Mensual ${currency(tot.mensual)}</div>
            </div>
          </div>
        </div>
        <div class="col-12 col-sm-6 col-xl-3">
          <div class="metric-card h-100">
            <div class="metric-icon" style="background:#f3e5f5"><i class="bi bi-calendar3" style="color:#6a0dad"></i></div>
            <div class="metric-info">
              <div class="metric-value">${currency(tot.anual)}</div>
              <div class="metric-label">Proyección anual</div>
              <div class="metric-sub">GAT ${pct(tot.gat)}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Calculadora entre 2 fechas ── -->
      <div class="data-card mb-3">
        <div class="data-card-header">
          <span><i class="bi bi-calendar-range me-2"></i>Calcular entre 2 fechas</span>
        </div>
        <div class="data-card-body">
          <div class="row g-2 align-items-end">
            <div class="col-12 col-md-4">
              <label class="form-label small text-muted mb-1">Cuenta</label>
              <select class="form-select form-select-sm" id="calc-cuenta">
                <option value="">Todas las cuentas</option>
                ${cuentas.map(c => `
                  <option value="${c.id}" ${_calc.cuentaId === c.id ? 'selected' : ''}>
                    ${esc(instNombre(c))}${alias(c) ? ' — ' + esc(alias(c)) : ''}
                  </option>`).join('')}
              </select>
            </div>
            <div class="col-6 col-md-3">
              <label class="form-label small text-muted mb-1">Desde</label>
              <input type="date" class="form-control form-control-sm" id="calc-desde" value="${_calc.desde}">
            </div>
            <div class="col-6 col-md-3">
              <label class="form-label small text-muted mb-1">Hasta</label>
              <input type="date" class="form-control form-control-sm" id="calc-hasta" value="${_calc.hasta}">
            </div>
            <div class="col-12 col-md-2">
              <button class="btn btn-primary btn-sm w-100" id="calc-run" ${cuentas.length ? '' : 'disabled'}>
                <i class="bi bi-calculator me-1"></i>Calcular
              </button>
            </div>
          </div>
          <div id="calc-result"></div>
        </div>
      </div>

      <!-- ── Cuentas ── -->
      ${cuentas.length === 0 ? `
        <div class="data-card">
          <div class="empty-state">
            <i class="bi bi-piggy-bank"></i>
            <p>${instituciones.length
              ? 'Sin cuentas de inversión registradas. Crea una para ver tus rendimientos.'
              : 'Primero registra una institución en <a href="#/admin">Instituciones y Tarjetas</a>.'}</p>
          </div>
        </div>`
      : `<div class="row g-3">
          ${cuentas.map(c => cuentaCard(c, resumenes.get(c.id), instMap[c.institucionId])).join('')}
        </div>`}
    `;

    // ── Listeners ────────────────────────────────────────────────────────────
    document.getElementById('btn-nueva-cuenta').addEventListener('click', () =>
      showCuentaModal(container, instituciones, null));

    container.querySelectorAll('.btn-inv-edit').forEach(b =>
      b.addEventListener('click', () =>
        showCuentaModal(container, instituciones, cuentas.find(c => c.id === b.dataset.id))));

    container.querySelectorAll('.btn-inv-upd').forEach(b =>
      b.addEventListener('click', () => {
        const c = cuentas.find(x => x.id === b.dataset.id);
        showActualizarModal(container, c, resumenes.get(c.id), nombreCuenta(c, instNombre(c)));
      }));

    container.querySelectorAll('.btn-inv-upd-rend').forEach(b =>
      b.addEventListener('click', () => {
        const c = cuentas.find(x => x.id === b.dataset.id);
        showActualizarRendimientoModal(container, c, resumenes.get(c.id), nombreCuenta(c, instNombre(c)));
      }));

    container.querySelectorAll('.btn-inv-del').forEach(b =>
      b.addEventListener('click', async () => {
        const c = cuentas.find(x => x.id === b.dataset.id);
        if (!confirmDelete(nombreCuenta(c, instNombre(c)))) return;
        await remove(COL, c.id);
        toast('Cuenta eliminada');
        renderView(container);
      }));

    const runCalc = () => {
      _calc.cuentaId = document.getElementById('calc-cuenta').value;
      _calc.desde    = document.getElementById('calc-desde').value;
      _calc.hasta    = document.getElementById('calc-hasta').value;
      document.getElementById('calc-result').innerHTML =
        calcularPeriodo(cuentas, instMap, _calc, hoy);
    };
    document.getElementById('calc-run').addEventListener('click', runCalc);
    ['calc-cuenta', 'calc-desde', 'calc-hasta'].forEach(id =>
      document.getElementById(id).addEventListener('change', () => {
        if (document.getElementById('calc-result').innerHTML) runCalc();
      }));

  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error al cargar Rendimientos: ${esc(e.message)}</div>`;
    console.error(e);
  }
}

// ── Tarjeta de cuenta ─────────────────────────────────────────────────────────

function cuentaCard(c, r, inst) {
  const color = inst?.color || '#607d8b';
  const conHistorial = r.timeline.length > 1;
  const institucion  = inst?.nombre || 'Sin institución';
  const esUnico      = r.modo === MODO_UNICO;
  // Cada institución muestra su tasa a su manera; se respeta lo configurado
  const fmtTasa      = c.redondeoTasa === 'redondear' ? pct : pctTrunc;

  return `
    <div class="col-12 col-lg-6 col-xxl-4">
      <div class="inv-card">
        <div class="inv-head" style="background:${color}">
          <div class="inv-head-txt">
            ${alias(c)
              ? `<div class="inv-inst">${esc(institucion)}</div>
                 <div class="inv-name">${esc(alias(c))}</div>`
              : `<div class="inv-name">${esc(institucion)}</div>`}
          </div>
          <div class="inv-head-actions">
            <button class="btn-inv-act btn-inv-upd"      data-id="${c.id}" title="Actualizar monto invertido"><i class="bi bi-arrow-repeat"></i></button>
            <button class="btn-inv-act btn-inv-upd-rend" data-id="${c.id}" title="Actualizar rendimiento obtenido"><i class="bi bi-graph-up-arrow"></i></button>
            <button class="btn-inv-act btn-inv-edit"     data-id="${c.id}" title="Editar cuenta"><i class="bi bi-pencil"></i></button>
            <button class="btn-inv-act btn-inv-del"      data-id="${c.id}" title="Eliminar cuenta"><i class="bi bi-trash3"></i></button>
          </div>
        </div>

        <div class="inv-body">
          <div class="inv-saldo">
            <div class="inv-saldo-val">${currency(r.saldoActual)}</div>
            <div class="inv-saldo-lbl">Saldo actual estimado</div>
          </div>

          <div class="inv-base">
            <span><i class="bi bi-cash-stack me-1"></i>Capital <strong>${currency(r.capital)}</strong></span>
            <span title="Última actualización del monto invertido">
              <i class="bi bi-clock-history me-1"></i>${fmtDate(r.fechaBase)}
              <span class="text-muted">· ${r.dias} d</span>
            </span>
          </div>

          <div class="inv-base">
            <span><i class="bi bi-graph-up-arrow me-1"></i>Rendimiento obtenido <strong>${currency(r.rendimientoObtenido)}</strong></span>
            <span title="Última actualización del rendimiento obtenido">
              <i class="bi bi-clock-history me-1"></i>${fmtDate(r.fechaRendimiento)}
              <span class="text-muted">· ${r.diasRendimiento} d</span>
            </span>
          </div>

          <div class="inv-grid">
            <div class="inv-cell">
              <div class="inv-cell-lbl">Diario</div>
              <div class="inv-cell-val">${currency(r.diario)}</div>
            </div>
            <div class="inv-cell">
              <div class="inv-cell-lbl">Mensual · 30 d</div>
              <div class="inv-cell-val">${currency(r.mensual)}</div>
            </div>
            <div class="inv-cell">
              <div class="inv-cell-lbl">Anual · 365 d</div>
              <div class="inv-cell-val">${currency(r.anual)}</div>
            </div>
            <div class="inv-cell hoy">
              <div class="inv-cell-lbl">Hasta hoy</div>
              <div class="inv-cell-val">${currency(r.rendimientoHastaHoy)}</div>
            </div>
          </div>

          ${r.isrAnual > 0 ? `
            <div class="inv-isr" title="La retención se calcula sobre el capital, no sobre el interés">
              <span>Diario bruto ${currency(r.diarioBruto)}</span>
              <span class="inv-isr-neg">− ISR ${currency(r.isrDiario)}</span>
              <span class="inv-isr-neto">= ${currency(r.diario)}</span>
              <span class="inv-isr-tasa">${pct(r.isrAnual)}${r.isrSobre === ISR_INTERES ? ' del interés' : ' anual s/ capital'}</span>
            </div>` : ''}

          <div class="inv-tramos ${esUnico ? 'unico' : ''}"
               title="${esUnico ? 'Tasa única: solo aplica el tramo resaltado' : 'Progresivo: cada porción del saldo gana la tasa de su tramo'}">
            ${r.tramos.map((t, i) => `
              <div class="inv-tramo ${i === r.idxTramo ? 'activo' : ''}">
                <span class="inv-tramo-rango">${rangoTramo(t, i === 0)}</span>
                <span class="inv-tramo-tasa">${pct(t.tasa)}</span>
              </div>`).join('')}
          </div>

          <div class="inv-foot">
            <span title="Ganancia Anual Total — tasa efectiva con capitalización diaria">GAT ${pct(r.gat)}</span>
            <span>·</span>
            <span title="${esUnico
              ? 'Tasa del tramo en el que cae el saldo actual'
              : 'Tasa anual ponderada de los tramos para el saldo actual — es la que muestra la institución'}">${fmtTasa(r.tasaNominal)} ${esUnico ? 'tasa única' : 'ponderada'}</span>
            ${conHistorial ? `<span>·</span><span title="Rendimiento acumulado desde el primer saldo registrado, sin contar aportaciones">histórico ${currency(r.rendimientoHistorico)} / ${r.diasHistoricos} d</span>` : ''}
            ${r.base !== BASE_ANUAL_DEFAULT || (r.isrAnual > 0 && r.baseIsr !== r.base)
              ? `<span>·</span><span title="Días del año usados para el interés y para la retención">base ${r.base}${r.isrAnual > 0 && r.baseIsr !== r.base ? ` · ISR ${r.baseIsr}` : ''}</span>`
              : ''}
          </div>
        </div>
      </div>
    </div>`;
}

// ── Calculadora entre 2 fechas ────────────────────────────────────────────────

function calcularPeriodo(cuentas, instMap, sel, hoy) {
  if (!sel.desde || !sel.hasta) {
    return `<div class="inv-calc-msg text-danger"><i class="bi bi-exclamation-circle me-1"></i>Selecciona ambas fechas.</div>`;
  }
  if (diasEntre(sel.desde, sel.hasta) < 0) {
    return `<div class="inv-calc-msg text-danger"><i class="bi bi-exclamation-circle me-1"></i>La fecha "Hasta" debe ser posterior a "Desde".</div>`;
  }

  const objetivo = sel.cuentaId ? cuentas.filter(c => c.id === sel.cuentaId) : cuentas;
  const filas = objetivo.map(c => {
    const res = rendimientoEntre(timelineCuenta(c), sel.desde, sel.hasta, configCuenta(c));
    return { cuenta: c, res };
  });

  const validas = filas.filter(f => f.res);
  if (!validas.length) {
    return `<div class="inv-calc-msg text-muted"><i class="bi bi-info-circle me-1"></i>
      No hay saldos registrados dentro del periodo seleccionado.</div>`;
  }

  const tot = validas.reduce((a, f) => ({
    rendimiento:  a.rendimiento  + f.res.rendimiento,
    saldoInicial: a.saldoInicial + f.res.saldoInicial,
    saldoFinal:   a.saldoFinal   + f.res.saldoFinal,
    aportaciones: a.aportaciones + f.res.aportaciones,
    isr:          a.isr          + f.res.isr,
  }), { rendimiento: 0, saldoInicial: 0, saldoFinal: 0, aportaciones: 0, isr: 0 });

  const recortado = validas.some(f => f.res.recortado);
  const proyeccion = diasEntre(hoy, sel.hasta) > 0;
  const dias = Math.max(...validas.map(f => f.res.dias));

  return `
    <div class="inv-calc">
      <div class="inv-calc-head">
        <div>
          <div class="inv-calc-val text-success">${currency(tot.rendimiento)}</div>
          <div class="inv-calc-lbl">Rendimiento del periodo</div>
        </div>
        <div class="inv-calc-meta">
          <div>${fmtDate(sel.desde)} → ${fmtDate(sel.hasta)} · <strong>${dias} días</strong></div>
          <div>Saldo ${currency(tot.saldoInicial)} → <strong>${currency(tot.saldoFinal)}</strong></div>
          ${tot.isr >= 0.01
            ? `<div>Bruto ${currency(tot.rendimiento + tot.isr)} − ISR retenido <strong>${currency(tot.isr)}</strong></div>`
            : ''}
          ${Math.abs(tot.aportaciones) >= 0.01
            ? `<div>Aportaciones netas del periodo: <strong>${currency(tot.aportaciones)}</strong> <span class="text-muted">(excluidas del rendimiento)</span></div>`
            : ''}
        </div>
      </div>

      ${validas.length > 1 ? `
        <div class="table-wrapper mt-2">
          <table class="table table-sm mb-0" style="font-size:0.8rem">
            <thead><tr>
              <th>Cuenta</th><th class="text-end">Saldo inicio</th>
              <th class="text-end">Saldo fin</th><th class="text-end">Rendimiento</th>
            </tr></thead>
            <tbody>
              ${validas.map(({ cuenta, res }) => {
                const institucion = instMap[cuenta.institucionId]?.nombre || '—';
                return `
                <tr>
                  <td>
                    <span class="fw-500">${esc(nombreCuenta(cuenta, institucion))}</span>
                    ${alias(cuenta) ? `<small class="text-muted d-block">${esc(institucion)}</small>` : ''}
                  </td>
                  <td class="text-end">${currency(res.saldoInicial)}</td>
                  <td class="text-end">${currency(res.saldoFinal)}</td>
                  <td class="text-end fw-semibold text-success">${currency(res.rendimiento)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>` : ''}

      ${recortado ? `<div class="inv-calc-msg text-warning-emphasis">
        <i class="bi bi-exclamation-triangle me-1"></i>Alguna cuenta no tiene saldo registrado desde ${fmtDate(sel.desde)};
        su cálculo arranca en su primer registro.</div>` : ''}
      ${proyeccion ? `<div class="inv-calc-msg text-muted">
        <i class="bi bi-graph-up me-1"></i>La fecha final es futura — el resultado incluye proyección.</div>` : ''}
    </div>`;
}

// ── Modal: alta / edición de cuenta ───────────────────────────────────────────

function showCuentaModal(container, instituciones, cuenta) {
  const isEdit = !!cuenta;
  const hoy    = hoyISO();
  const tramos = isEdit && Array.isArray(cuenta.tramos) && cuenta.tramos.length
    ? cuenta.tramos.map(t => ({ hasta: t.hasta ?? null, tasa: Number(t.tasa) || 0 }))
    : TRAMOS_DEFAULT.map(t => ({ ...t }));

  const instOpts = [...instituciones]
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .map(i => `<option value="${i.id}" ${cuenta?.institucionId === i.id ? 'selected' : ''}>${esc(i.nombre)}</option>`)
    .join('');

  openModal({
    size: 'lg',
    title: isEdit ? 'Editar Cuenta de Inversión' : 'Nueva Cuenta de Inversión',
    body: `
      <form id="inv-form">
        <div class="row g-2 mb-3">
          <div class="col-12 col-sm-6">
            <label class="form-label">Institución *</label>
            <select class="form-select" name="institucionId" required>
              <option value="">— Seleccionar —</option>
              ${instOpts}
            </select>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label">Nombre de la cuenta</label>
            <input type="text" class="form-control" name="nombre"
                   value="${esc(cuenta?.nombre || '')}" placeholder="Ej: Cajita, Ahorro+, Inversión">
            <div class="form-text">Opcional — si lo dejas vacío se usa el de la institución.</div>
          </div>
        </div>

        <div class="row g-2 mb-3">
          <div class="col-12 col-sm-6">
            <label class="form-label">Monto invertido *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="montoInvertido" required min="0" step="0.01"
                     value="${cuenta?.montoInvertido ?? ''}" placeholder="0.00">
            </div>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label">Fecha de actualización *</label>
            <input type="date" class="form-control" name="fechaActualizacion" required max="${hoy}"
                   value="${isoDay(cuenta?.fechaActualizacion) || hoy}">
            <div class="form-text">Fecha en que ese monto era el saldo real de la cuenta.</div>
          </div>
        </div>

        <div class="row g-2 mb-3">
          <div class="col-12 col-sm-6">
            <label class="form-label">Rendimiento obtenido</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="rendimientoObtenido" step="0.01"
                     value="${cuenta?.rendimientoObtenido ?? ''}" placeholder="0.00">
            </div>
            <div class="form-text">Opcional — total real ganado que muestra tu estado de cuenta.</div>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label">Fecha de actualización del rendimiento</label>
            <input type="date" class="form-control" name="fechaActualizacionRendimiento" max="${hoy}"
                   value="${isoDay(cuenta?.fechaActualizacionRendimiento) || ''}">
            <div class="form-text">Fecha en que ese rendimiento era el real de la cuenta.</div>
          </div>
        </div>

        <hr class="my-3">

        <div class="d-flex justify-content-between align-items-center mb-2">
          <label class="form-label mb-0">Límites de rendimiento</label>
          <button type="button" class="btn btn-outline-primary btn-sm" id="inv-add-tramo">
            <i class="bi bi-plus-lg me-1"></i>Tramo
          </button>
        </div>
        <select class="form-select form-select-sm mb-2" name="modoTramos" id="inv-modo">
          <option value="${MODO_PROGRESIVO}" ${cuenta?.modoTramos !== MODO_UNICO ? 'selected' : ''}>Progresivo por tramos</option>
          <option value="${MODO_UNICO}"      ${cuenta?.modoTramos === MODO_UNICO ? 'selected' : ''}>Tasa única según el saldo</option>
        </select>
        <p class="text-muted mb-2" style="font-size:0.78rem" id="inv-modo-hint"></p>
        <div id="inv-tramos"></div>

        <div class="mt-3">
          <a class="small text-decoration-none" data-bs-toggle="collapse" href="#inv-adv" role="button">
            <i class="bi bi-sliders me-1"></i>Avanzado
          </a>
          <div class="collapse ${cuenta?.notas || cuenta?.referencia || cuenta?.isrAnual
            || cuenta?.isrSobre === ISR_INTERES || cuenta?.redondeoTasa === 'redondear'
            || (cuenta?.baseAnual && cuenta.baseAnual !== BASE_ANUAL_DEFAULT)
            || (cuenta?.baseIsr   && cuenta.baseIsr   !== BASE_ANUAL_DEFAULT) ? 'show' : ''}" id="inv-adv">
            <div class="row g-2 mt-1">
              <div class="col-12"><div class="inv-adv-sep">Retención de ISR</div></div>
              <div class="col-12 col-sm-5">
                <label class="form-label" id="inv-isr-label">Tasa de retención</label>
                <div class="input-group">
                  <input type="number" class="form-control" name="isrAnual" min="0" step="0.01"
                         value="${cuenta?.isrAnual ?? ''}" placeholder="0.00">
                  <span class="input-group-text">%</span>
                </div>
              </div>
              <div class="col-12 col-sm-7">
                <label class="form-label">Se calcula sobre</label>
                <select class="form-select" name="isrSobre" id="inv-isr-sobre">
                  <option value="${ISR_CAPITAL}" ${cuenta?.isrSobre !== ISR_INTERES ? 'selected' : ''}>El capital — tasa anual (México)</option>
                  <option value="${ISR_INTERES}" ${cuenta?.isrSobre === ISR_INTERES ? 'selected' : ''}>El interés ganado — % directo</option>
                </select>
              </div>
              <div class="col-12">
                <div class="form-text mt-0" id="inv-isr-hint"></div>
              </div>

              <div class="col-12"><div class="inv-adv-sep">Convenciones de cálculo</div></div>
              <div class="col-12 col-sm-4">
                <label class="form-label">Base anual — interés</label>
                <select class="form-select" name="baseAnual">
                  <option value="365" ${Number(cuenta?.baseAnual) !== 360 ? 'selected' : ''}>365 días</option>
                  <option value="360" ${Number(cuenta?.baseAnual) === 360 ? 'selected' : ''}>360 días</option>
                </select>
              </div>
              <div class="col-12 col-sm-4" id="inv-baseisr-wrap">
                <label class="form-label">Base anual — ISR</label>
                <select class="form-select" name="baseIsr">
                  <option value="365" ${Number(cuenta?.baseIsr) !== 360 ? 'selected' : ''}>365 días</option>
                  <option value="360" ${Number(cuenta?.baseIsr) === 360 ? 'selected' : ''}>360 días</option>
                </select>
                <div class="form-text">No siempre coincide con la del interés.</div>
              </div>
              <div class="col-12 col-sm-4">
                <label class="form-label">Tasa ponderada</label>
                <select class="form-select" name="redondeoTasa">
                  <option value="truncar"    ${cuenta?.redondeoTasa !== 'redondear' ? 'selected' : ''}>Truncar</option>
                  <option value="redondear"  ${cuenta?.redondeoTasa === 'redondear' ? 'selected' : ''}>Redondear</option>
                </select>
                <div class="form-text">Cómo la muestra tu institución.</div>
              </div>

              <div class="col-12"><div class="inv-adv-sep">Otros</div></div>
              <div class="col-12 col-sm-6">
                <label class="form-label">CLABE / Referencia</label>
                <input type="text" class="form-control" name="referencia" value="${esc(cuenta?.referencia || '')}">
              </div>
              <div class="col-12 col-sm-6">
                <label class="form-label">Notas</label>
                <input type="text" class="form-control" name="notas" value="${esc(cuenta?.notas || '')}">
              </div>
            </div>
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-inv">${isEdit ? 'Guardar' : 'Crear'}</button>`
  });

  // ── Editor de tramos ──────────────────────────────────────────────────────
  const wrap = document.getElementById('inv-tramos');

  function leerTramos() {
    return [...wrap.querySelectorAll('.inv-row')].map(row => {
      const h = row.querySelector('.t-hasta');
      const v = h ? h.value : '';
      return {
        hasta: (!h || v === '') ? null : Number(v),
        tasa:  Number(row.querySelector('.t-tasa').value) || 0,
      };
    });
  }

  function refreshDesde() {
    let prev = 0;
    [...wrap.querySelectorAll('.inv-row')].forEach((row, i) => {
      row.querySelector('.t-desde').textContent = i === 0 ? '$0.00' : currency(prev + 0.01);
      const h = row.querySelector('.t-hasta');
      if (h && h.value !== '') prev = Number(h.value);
    });
  }

  function pintarTramos(lista) {
    const n = lista.length;
    wrap.innerHTML = lista.map((t, i) => `
      <div class="inv-row" data-i="${i}">
        <span class="t-desde">$0.00</span>
        <span class="inv-row-sep">a</span>
        ${i === n - 1
          ? `<span class="inv-row-abierto">En adelante</span>`
          : `<div class="input-group input-group-sm inv-row-hasta">
               <span class="input-group-text">$</span>
               <input type="number" class="form-control t-hasta" min="0" step="0.01"
                      value="${t.hasta ?? ''}" placeholder="0.00">
             </div>`}
        <div class="input-group input-group-sm inv-row-tasa">
          <input type="number" class="form-control t-tasa" min="0" step="0.01" value="${t.tasa}">
          <span class="input-group-text">% anual</span>
        </div>
        <button type="button" class="btn-icon danger t-del" title="Quitar tramo"
                ${n <= 1 ? 'disabled' : ''}><i class="bi bi-x-lg"></i></button>
      </div>`).join('');

    refreshDesde();
    wrap.querySelectorAll('.t-hasta').forEach(inp => inp.addEventListener('input', refreshDesde));
    wrap.querySelectorAll('.t-del').forEach((btn, i) =>
      btn.addEventListener('click', () => {
        const actual = leerTramos();
        actual.splice(i, 1);
        if (actual.length) actual[actual.length - 1].hasta = null; // el último siempre es abierto
        pintarTramos(actual);
      }));
  }

  pintarTramos(tramos);

  // ── Textos que dependen de las opciones elegidas ──────────────────────────
  const selModo  = document.getElementById('inv-modo');
  const selSobre = document.getElementById('inv-isr-sobre');

  const pintarHints = () => {
    document.getElementById('inv-modo-hint').innerHTML = selModo.value === MODO_UNICO
      ? `Todo el saldo gana la tasa del <strong>único</strong> tramo en el que cae.
         Produce escalones: al cruzar un límite el rendimiento puede <em>bajar</em>.`
      : `Cada porción del saldo gana la tasa de <strong>su propio</strong> tramo, como el ISR.
         La tasa anual es nominal y se capitaliza diario.`;

    const sobreInteres = selSobre.value === ISR_INTERES;
    document.getElementById('inv-isr-label').textContent =
      sobreInteres ? 'Porcentaje retenido' : 'Tasa de retención anual';
    document.getElementById('inv-isr-hint').innerHTML = sobreInteres
      ? `Se retiene ese porcentaje del interés ganado cada día. No se anualiza.`
      : `Tasa anual aplicada al capital, no a lo ganado — así opera México.
         <em>Revolut MX: 0.90% nacionales · 4.90% extranjeros.</em>`;
    // La base del ISR solo aplica cuando se anualiza sobre el capital
    document.getElementById('inv-baseisr-wrap').style.display = sobreInteres ? 'none' : '';
  };

  selModo.addEventListener('change', pintarHints);
  selSobre.addEventListener('change', pintarHints);
  pintarHints();

  document.getElementById('inv-add-tramo').addEventListener('click', () => {
    const actual = leerTramos();
    const ultimo = actual[actual.length - 1];
    // El último deja de ser abierto y se agrega uno nuevo abierto al final
    if (ultimo) ultimo.hasta = ultimo.hasta ?? '';
    actual.push({ hasta: null, tasa: ultimo ? ultimo.tasa : 0 });
    pintarTramos(actual);
  });

  // ── Guardar ───────────────────────────────────────────────────────────────
  document.getElementById('btn-save-inv').addEventListener('click', async () => {
    const form = document.getElementById('inv-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const nuevos = leerTramos();
    for (let i = 0; i < nuevos.length - 1; i++) {
      if (!(nuevos[i].hasta > 0)) {
        toast('Cada tramo, salvo el último, necesita un límite superior', 'warning'); return;
      }
      if (i > 0 && nuevos[i].hasta <= nuevos[i - 1].hasta) {
        toast('Los límites de los tramos deben ir en aumento', 'warning'); return;
      }
    }

    const raw  = Object.fromEntries(new FormData(form));
    const data = {
      institucionId:      raw.institucionId,
      nombre:             raw.nombre.trim(),
      montoInvertido:     Number(raw.montoInvertido),
      fechaActualizacion: raw.fechaActualizacion,
      rendimientoObtenido:            Number(raw.rendimientoObtenido) || 0,
      fechaActualizacionRendimiento:  raw.fechaActualizacionRendimiento || null,
      tramos:             nuevos,
      modoTramos:         raw.modoTramos === MODO_UNICO ? MODO_UNICO : MODO_PROGRESIVO,
      baseAnual:          Number(raw.baseAnual) || BASE_ANUAL_DEFAULT,
      isrAnual:           Number(raw.isrAnual)  || 0,
      isrSobre:           raw.isrSobre === ISR_INTERES ? ISR_INTERES : ISR_CAPITAL,
      baseIsr:            Number(raw.baseIsr)   || BASE_ANUAL_DEFAULT,
      redondeoTasa:       raw.redondeoTasa === 'redondear' ? 'redondear' : 'truncar',
      referencia:         raw.referencia.trim(),
      notas:              raw.notas.trim(),
    };

    // Si la fecha de actualización cambió, la captura anterior pasa al historial
    if (isEdit) {
      const prevF = isoDay(cuenta.fechaActualizacion);
      if (prevF && prevF !== data.fechaActualizacion) {
        data.historial = pushHistorial(cuenta.historial, {
          fecha: prevF, monto: Number(cuenta.montoInvertido) || 0,
        });
      }
      const prevFR = isoDay(cuenta.fechaActualizacionRendimiento);
      if (prevFR && prevFR !== data.fechaActualizacionRendimiento) {
        data.historialRendimiento = pushHistorial(cuenta.historialRendimiento, {
          fecha: prevFR, monto: Number(cuenta.rendimientoObtenido) || 0,
        });
      }
    }

    try {
      if (isEdit) await update(COL, cuenta.id, data);
      else        await create(COL, data);
      closeModal();
      toast(isEdit ? 'Cuenta actualizada' : 'Cuenta creada');
      renderView(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

// ── Modal: actualizar monto invertido ─────────────────────────────────────────

function showActualizarModal(container, cuenta, r, etiqueta) {
  const hoy       = hoyISO();
  const estimado  = Math.round(r.saldoActual * 100) / 100;

  openModal({
    title: `Actualizar monto — ${esc(etiqueta)}`,
    body: `
      <div class="inv-upd-est">
        <div>
          <div class="inv-upd-est-lbl">Saldo estimado a hoy</div>
          <div class="inv-upd-est-val">${currency(estimado)}</div>
        </div>
        <button type="button" class="btn btn-outline-primary btn-sm" id="inv-usar-est">
          <i class="bi bi-magic me-1"></i>Usar este valor
        </button>
      </div>
      <p class="text-muted" style="font-size:0.78rem">
        Captura el saldo <strong>real</strong> que muestra tu cuenta. El monto anterior
        (${currency(cuenta.montoInvertido)} al ${fmtDate(isoDay(cuenta.fechaActualizacion))}) se guarda en el historial.
      </p>
      <form id="inv-upd-form">
        <div class="row g-2">
          <div class="col-12 col-sm-6">
            <label class="form-label">Nuevo monto *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="montoInvertido" required min="0" step="0.01"
                     value="${estimado}">
            </div>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label">Fecha *</label>
            <input type="date" class="form-control" name="fechaActualizacion" required max="${hoy}" value="${hoy}">
          </div>
        </div>
      </form>
      <div id="inv-upd-delta" class="inv-upd-delta"></div>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-upd">Actualizar</button>`
  });

  const form  = document.getElementById('inv-upd-form');
  const input = form.montoInvertido;
  const delta = document.getElementById('inv-upd-delta');

  const pintarDelta = () => {
    const v = Number(input.value);
    if (!isFinite(v) || input.value === '') { delta.innerHTML = ''; return; }
    const d = Math.round((v - estimado) * 100) / 100;
    if (Math.abs(d) < 0.01) {
      delta.innerHTML = `<i class="bi bi-check-circle text-success me-1"></i>Coincide con el saldo estimado.`;
    } else {
      delta.innerHTML = `<i class="bi bi-arrow-left-right me-1"></i>Diferencia vs. estimado:
        <strong class="${d > 0 ? 'text-success' : 'text-danger'}">${d > 0 ? '+' : ''}${currency(d)}</strong>
        <span class="text-muted">— puede ser una aportación, un retiro o un ajuste de tasa.</span>`;
    }
  };
  input.addEventListener('input', pintarDelta);
  pintarDelta();

  document.getElementById('inv-usar-est').addEventListener('click', () => {
    input.value = estimado;
    pintarDelta();
  });

  document.getElementById('btn-save-upd').addEventListener('click', async () => {
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const nuevaFecha = form.fechaActualizacion.value;
    const prevF      = isoDay(cuenta.fechaActualizacion);

    const data = {
      montoInvertido:     Number(form.montoInvertido.value),
      fechaActualizacion: nuevaFecha,
    };
    // Misma fecha ⇒ es una corrección, no una nueva captura
    if (prevF && prevF !== nuevaFecha) {
      data.historial = pushHistorial(cuenta.historial, {
        fecha: prevF, monto: Number(cuenta.montoInvertido) || 0,
      });
    }

    try {
      await update(COL, cuenta.id, data);
      closeModal();
      toast('Monto actualizado');
      renderView(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

// ── Modal: actualizar rendimiento obtenido ────────────────────────────────────

function showActualizarRendimientoModal(container, cuenta, r, etiqueta) {
  const hoy      = hoyISO();
  const estimado = Math.round(r.rendimientoHastaHoy * 100) / 100;

  openModal({
    title: `Actualizar rendimiento — ${esc(etiqueta)}`,
    body: `
      <div class="inv-upd-est">
        <div>
          <div class="inv-upd-est-lbl">Rendimiento estimado a hoy</div>
          <div class="inv-upd-est-val">${currency(estimado)}</div>
        </div>
        <button type="button" class="btn btn-outline-primary btn-sm" id="rend-usar-est">
          <i class="bi bi-magic me-1"></i>Usar este valor
        </button>
      </div>
      <p class="text-muted" style="font-size:0.78rem">
        Captura el rendimiento <strong>real</strong> acumulado que muestra tu estado de cuenta.
        El monto anterior (${currency(r.rendimientoObtenido)} al ${fmtDate(r.fechaRendimiento)}) se guarda en el historial.
      </p>
      <form id="rend-upd-form">
        <div class="row g-2">
          <div class="col-12 col-sm-6">
            <label class="form-label">Rendimiento obtenido *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="rendimientoObtenido" required step="0.01"
                     value="${estimado}">
            </div>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label">Fecha *</label>
            <input type="date" class="form-control" name="fechaActualizacionRendimiento" required max="${hoy}" value="${hoy}">
          </div>
        </div>
      </form>
      <div id="rend-upd-delta" class="inv-upd-delta"></div>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-rend-upd">Actualizar</button>`
  });

  const form  = document.getElementById('rend-upd-form');
  const input = form.rendimientoObtenido;
  const delta = document.getElementById('rend-upd-delta');

  const pintarDelta = () => {
    const v = Number(input.value);
    if (!isFinite(v) || input.value === '') { delta.innerHTML = ''; return; }
    const d = Math.round((v - estimado) * 100) / 100;
    if (Math.abs(d) < 0.01) {
      delta.innerHTML = `<i class="bi bi-check-circle text-success me-1"></i>Coincide con el rendimiento estimado.`;
    } else {
      delta.innerHTML = `<i class="bi bi-arrow-left-right me-1"></i>Diferencia vs. estimado:
        <strong class="${d > 0 ? 'text-success' : 'text-danger'}">${d > 0 ? '+' : ''}${currency(d)}</strong>
        <span class="text-muted">— puede deberse a ajustes de tasa o retenciones no contempladas.</span>`;
    }
  };
  input.addEventListener('input', pintarDelta);
  pintarDelta();

  document.getElementById('rend-usar-est').addEventListener('click', () => {
    input.value = estimado;
    pintarDelta();
  });

  document.getElementById('btn-save-rend-upd').addEventListener('click', async () => {
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const nuevaFecha = form.fechaActualizacionRendimiento.value;
    const prevF      = r.fechaRendimiento;

    const data = {
      rendimientoObtenido:           Number(form.rendimientoObtenido.value),
      fechaActualizacionRendimiento: nuevaFecha,
    };
    // Misma fecha ⇒ es una corrección, no una nueva captura
    if (prevF && prevF !== nuevaFecha) {
      data.historialRendimiento = pushHistorial(cuenta.historialRendimiento, {
        fecha: prevF, monto: r.rendimientoObtenido,
      });
    }

    try {
      await update(COL, cuenta.id, data);
      closeModal();
      toast('Rendimiento actualizado');
      renderView(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
