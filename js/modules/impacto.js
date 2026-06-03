import { getAll, getById, upsert, update } from '../utils/db.js';
import { currency, fmtDate, fmtMonth, currentYYYYMM, prevMonth, nextMonth } from '../utils/formatters.js';
import { toast, openModal, closeModal } from '../utils/ui.js';
import { toISODate, anteriorNomina } from '../utils/ciclo.js';
import { navigate } from '../router.js';
import {
  calcularEstimadoTarjeta, getGastosDebitoMes, getGastosDebitoCompleto,
  calcularTotalesCredito, getPlazosMes, proyectarMes, recalcTotalesImpacto,
  calcularCicloParaMes,
} from '../utils/impacto-calc.js';

export async function render(container, mesParam) {
  const mes = mesParam || currentYYYYMM();
  await renderView(container, mes);
}

// ── Main view ────────────────────────────────────────────────────────────────

async function renderView(container, mes) {
  container.innerHTML = `<div class="loading-overlay"><div class="spinner-border text-primary" role="status"></div></div>`;
  try {
    const mesCurrent = currentYYYYMM();
    const isFuture   = mes > mesCurrent;
    const isPast     = mes < mesCurrent;

    const [impactoExistente, tarjetas, instituciones, contado, msi, gastos, gastosFijos, festivosMX, configGen] =
      await Promise.all([
        getById('impacto', mes),
        getAll('tarjetas'),
        getAll('instituciones'),
        getAll('contado'),
        getAll('msi'),
        getAll('gastos'),
        getAll('gastosFijos'),
        getAll('festivosMX'),
        getById('config', 'general'),
      ]);

    const instMap         = Object.fromEntries(instituciones.map(i => [i.id, i]));
    const cardMap         = Object.fromEntries(tarjetas.map(t => [t.id, t]));
    const tarjetasCredito = tarjetas.filter(t => t.tipo === 'credito' || t.tipo === 'prestamo');
    const debitoIds       = new Set(tarjetas.filter(t => t.tipo === 'debito').map(t => t.id));
    const nominaAprox     = Number(configGen?.nominaAprox) || 0;

    let impacto;
    if (isFuture) {
      impacto = proyectarMes(mes, mesCurrent, msi, contado, gastos, tarjetasCredito, nominaAprox, festivosMX, gastosFijos, tarjetas);
      // Enrich projection tarjetas with institution data
      impacto.tarjetas = impacto.tarjetas.map(t => {
        const tc   = cardMap[t.tarjetaId];
        const inst = instMap[tc?.institucionId];
        return { ...t, institucion: inst?.nombre || '', color: inst?.color || '#607d8b' };
      });
    } else if (impactoExistente) {
      impacto = impactoExistente;
      // Recalculate estimates + sync dates/new tarjetas for active impactos
      if (impacto.estado === 'activo') {
        let changed = false;

        // Add tarjetas registered after impacto was created
        const existingIds = new Set(impacto.tarjetas.map(t => t.tarjetaId));
        const nuevasTarjetas = tarjetasCredito
          .filter(t => !existingIds.has(t.id))
          .map(t => {
            const inst = instMap[t.institucionId];
            const est  = calcularEstimadoTarjeta(t, contado, msi, gastos, festivosMX, mes);
            const p    = t.ciclo ? calcularCicloParaMes(t.ciclo, mes, festivosMX) : null;
            changed = true;
            return {
              tarjetaId: t.id, nombre: t.nombre,
              institucion: inst?.nombre || '', color: inst?.color || '#607d8b',
              limiteTotal: Number(t.limiteTotal) || 0,
              saldoDisponible: t.saldoDisponible ?? null,
              fechaCorte: p?.fechaCorte ? toISODate(p.fechaCorte) : null,
              fechaPago:  p?.fechaPago  ? toISODate(p.fechaPago)  : null,
              ...est,
              confirmado: false, montoAPagar: null, pagado: false, fechaPagado: null,
              fechaCorteConf: null, fechaPagoConf: null, limiteTotalConf: null, saldoDispConf: null,
            };
          });

        const updatedTarjetas = [
          ...impacto.tarjetas.map(t => {
            const tarjeta = cardMap[t.tarjetaId];
            if (!tarjeta) return t;
            const est  = calcularEstimadoTarjeta(tarjeta, contado, msi, gastos, festivosMX, mes);
            const estSame = est.estimadoContado === t.estimadoContado &&
                            est.estimadoPlazos  === t.estimadoPlazos  &&
                            est.estimadoGastos  === t.estimadoGastos;
            // Always recalculate dates to catch stale/wrong values from previous versions
            let dateUpdate = {};
            if (tarjeta.ciclo) {
              const p = calcularCicloParaMes(tarjeta.ciclo, mes, festivosMX);
              if (p) {
                const newCorte  = p.fechaCorte ? toISODate(p.fechaCorte) : null;
                const newPago   = p.fechaPago  ? toISODate(p.fechaPago)  : null;
                const nom       = p.fechaPago ? anteriorNomina(p.fechaPago, festivosMX) : null;
                const newNomina = nom ? toISODate(nom) : null;
                if (newCorte !== t.fechaCorte || newPago !== t.fechaPago || newNomina !== (t.fechaNomina ?? null)) {
                  dateUpdate = { fechaCorte: newCorte, fechaPago: newPago, fechaNomina: newNomina };
                }
              }
            }
            if (!estSame || Object.keys(dateUpdate).length) { changed = true; return { ...t, ...est, ...dateUpdate }; }
            return t;
          }),
          ...nuevasTarjetas,
        ];

        if (changed) {
          impacto = { ...impacto, tarjetas: updatedTarjetas };
          upsert('impacto', mes, { tarjetas: updatedTarjetas }); // fire-and-forget
        }
      }
    } else if (!isPast) {
      impacto = await _crearImpacto(mes, tarjetasCredito, contado, msi, gastos, festivosMX, nominaAprox, instMap);
    } else {
      impacto = null;
    }

    const gastosDebitoLive = (impacto?.estado === 'cerrado' || isFuture)
      ? (impacto?.gastosDebito || [])
      : getGastosDebitoCompleto(gastos, gastosFijos, mes, debitoIds, tarjetas, festivosMX);

    const ctx = {
      mes, mesCurrent, isFuture, isPast, tarjetas, cardMap, instMap,
      tarjetasCredito, festivosMX, configGen, nominaAprox, contado, msi, gastos,
      gastosDebitoLive, debitoIds, container,
    };

    _renderPage(container, impacto, ctx);
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
    console.error(e);
  }
}

// ── Create new impacto ───────────────────────────────────────────────────────

async function _crearImpacto(mes, tarjetasCredito, contadoItems, msiItems, gastosItems, festivosMX, nominaAprox, instMap) {
  const [y, mo] = mes.split('-').map(Number);

  const tarjetas = tarjetasCredito.map(t => {
    const est  = calcularEstimadoTarjeta(t, contadoItems, msiItems, gastosItems, festivosMX, mes);
    const inst = instMap[t.institucionId];
    let fechaCorte = null, fechaPago = null, fechaNomina = null;
    if (t.ciclo) {
      const p = calcularCicloParaMes(t.ciclo, mes, festivosMX);
      fechaCorte = p?.fechaCorte ? toISODate(p.fechaCorte) : null;
      fechaPago  = p?.fechaPago  ? toISODate(p.fechaPago)  : null;
      if (p?.fechaPago) {
        const nom = anteriorNomina(p.fechaPago, festivosMX);
        fechaNomina = nom ? toISODate(nom) : null;
      }
    }
    return {
      tarjetaId: t.id, nombre: t.nombre,
      institucion: inst?.nombre || '', color: inst?.color || '#607d8b',
      limiteTotal:     Number(t.limiteTotal) || 0,
      saldoDisponible: t.saldoDisponible ?? null,
      fechaCorte, fechaPago, fechaNomina, ...est,
      confirmado: false, montoAPagar: null, pagado: false, fechaPagado: null,
      fechaCorteConf: null, fechaPagoConf: null, limiteTotalConf: null, saldoDispConf: null,
    };
  });

  const estimadoCredito = tarjetas.reduce((s, t) => s + t.estimadoTotal, 0);
  const data = {
    mes, estado: 'activo', presupuesto: 0, nominaRef: nominaAprox,
    fechaCierre: null, tarjetas, gastosDebito: [],
    totales: {
      estimadoCredito, pagoCredito: 0, gastoDebito: 0,
      restanteEsperado: nominaAprox - estimadoCredito,
      restante: -estimadoCredito,
      ...calcularTotalesCredito(tarjetas),
    },
  };
  await upsert('impacto', mes, data);
  return { id: mes, ...data };
}

// ── Page render ──────────────────────────────────────────────────────────────

function _renderPage(container, impacto, ctx) {
  const { mes, mesCurrent, isFuture, isPast, gastosDebitoLive, nominaAprox } = ctx;
  const hoy = toISODate(new Date());

  const isActivo    = impacto?.estado === 'activo';
  const isCerrado   = impacto?.estado === 'cerrado';
  const isProyeccion = impacto?.estado === 'proyeccion';

  const totales = impacto
    ? (isActivo ? recalcTotalesImpacto(impacto, gastosDebitoLive, nominaAprox) : impacto.totales)
    : null;

  const estadoBadge = isActivo
    ? `<span class="badge bg-success">Activo</span>`
    : isCerrado
      ? `<span class="badge bg-secondary">Cerrado</span>`
      : isProyeccion
        ? `<span class="badge bg-info text-dark">Proyección</span>`
        : '';

  const allPagados = impacto?.tarjetas?.every(t => t.pagado) ?? false;

  container.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-2 flex-wrap">
      <button class="btn-icon" id="imp-prev"><i class="bi bi-chevron-left"></i></button>
      <span class="fw-semibold" style="text-transform:capitalize;font-size:1rem">${fmtMonth(mes)}</span>
      <button class="btn-icon" id="imp-next"><i class="bi bi-chevron-right"></i></button>
      ${estadoBadge}
      <div class="ms-auto d-flex align-items-center gap-2">
        ${isActivo ? `<button class="btn btn-link btn-sm p-0 text-muted" id="btn-edit-nomina" style="font-size:0.8rem">
          <i class="bi bi-pencil me-1"></i>Nómina ref.
        </button>` : ''}
        ${isActivo ? `<button class="btn btn-outline-danger btn-sm" id="btn-cerrar-mes" ${allPagados ? '' : 'disabled title="Registra el pago de todas las tarjetas primero"'}>
          <i class="bi bi-lock me-1"></i>Cerrar mes
        </button>` : ''}
      </div>
    </div>

    <!-- Budget metrics -->
    ${impacto ? _renderBudgetSection(impacto, totales, isActivo, isProyeccion, nominaAprox) : ''}

    <!-- Credit cards -->
    ${impacto ? `
    <p class="text-muted fw-semibold mb-1 mt-4" style="font-size:0.72rem;text-transform:uppercase;letter-spacing:.05em">
      <i class="bi bi-credit-card me-1"></i>Tarjetas de Crédito y Préstamos
    </p>
    ${_renderTarjetasTable(impacto.tarjetas || [], isActivo, isCerrado, hoy, ctx.festivosMX, isProyeccion)}` : ''}

    <!-- Debit gastos -->
    ${impacto ? _renderGastosDebito(gastosDebitoLive, ctx.cardMap) : ''}

    ${!impacto ? `<div class="empty-state"><i class="bi bi-bar-chart-line"></i><p>No hay datos de impacto para este mes.</p></div>` : ''}`;

  // ── Event listeners ───────────────────────────────────────────────────────

  container.querySelector('#imp-prev')?.addEventListener('click', () => navigate('/impacto/' + prevMonth(mes)));
  container.querySelector('#imp-next')?.addEventListener('click', () => navigate('/impacto/' + nextMonth(mes)));

  if (isActivo) {
    container.querySelector('#btn-edit-nomina')?.addEventListener('click', () =>
      _showModalNomina(ctx.configGen, ctx));

    container.querySelector('#btn-presupuesto-edit')?.addEventListener('click', () =>
      _showModalPresupuesto(impacto, ctx));

    container.querySelector('#btn-cerrar-mes')?.addEventListener('click', () => {
      if (!allConfirmadosPagados) return;
      if (!confirm(`¿Cerrar el Impacto de ${fmtMonth(mes)}?\n\nEsta acción guarda los totales y el mes quedará en solo lectura.`)) return;
      _cerrarMes(impacto, gastosDebitoLive, totales, ctx);
    });

    container.querySelectorAll('.btn-edit-campo').forEach(btn =>
      btn.addEventListener('click', () => {
        const idx   = Number(btn.dataset.idx);
        const campo = btn.dataset.campo;
        _showModalEditCampo(impacto.tarjetas[idx], idx, campo, impacto, ctx);
      }));

    container.querySelectorAll('.btn-pagar-tarjeta').forEach(btn =>
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        _showModalPagar(impacto.tarjetas[idx], idx, impacto, ctx);
      }));
  }
}

// ── Section renderers ────────────────────────────────────────────────────────

function _renderBudgetSection(impacto, totales, isActivo, isProyeccion, nominaAprox = 0) {
  const pres = Number(impacto.presupuesto) || 0;
  const nom  = isActivo ? nominaAprox : (Number(impacto.nominaRef) || 0);
  const totalAPagar = totales.estimadoCredito + totales.gastoDebito;

  return `
    <div class="row g-2 mb-1">
      <div class="col-6 col-lg-3">
        <div class="metric-card">
          <div class="metric-icon" style="background:#e8f5e9"><i class="bi bi-wallet2" style="color:#2e7d32"></i></div>
          <div class="metric-info">
            <div class="metric-value d-flex align-items-center gap-1">
              ${isProyeccion ? currency(nom) : currency(pres)}
              ${isActivo ? `<button class="btn btn-link p-0" id="btn-presupuesto-edit" style="font-size:0.7rem;line-height:1"><i class="bi bi-pencil"></i></button>` : ''}
            </div>
            <div class="metric-label">${isProyeccion ? 'Nómina estimada' : 'Presupuesto'}</div>
          </div>
        </div>
      </div>
      <div class="col-6 col-lg-3">
        <div class="metric-card">
          <div class="metric-icon" style="background:#fce4ec"><i class="bi bi-credit-card-fill" style="color:#c62828"></i></div>
          <div class="metric-info">
            <div class="metric-value">${currency(totalAPagar)}</div>
            <div class="metric-label">Total a pagar</div>
          </div>
        </div>
      </div>
      <div class="col-12 col-lg-3">
        <div class="metric-card">
          <div class="metric-icon" style="background:#e3f2fd"><i class="bi bi-calculator" style="color:#1565c0"></i></div>
          <div class="metric-info d-flex gap-0" style="min-width:0">
            <div style="flex:1;min-width:0">
              <div class="metric-value ${totales.restante < 0 ? 'text-danger' : 'text-success'}">${currency(totales.restante)}</div>
              <div class="metric-label">Restante</div>
            </div>
            ${!isProyeccion ? `<div style="width:1px;background:#e9ecef;margin:2px 8px"></div>
            <div style="flex:1;min-width:0">
              <div class="metric-value text-muted">${currency(totales.restanteEsperado)}</div>
              <div class="metric-label">Esperado</div>
            </div>` : ''}
          </div>
        </div>
      </div>
    </div>
    ${!isProyeccion ? `
    <div class="d-flex flex-wrap gap-3 mb-1" style="font-size:0.75rem;color:#888">
      <span><i class="bi bi-layers me-1"></i>Crédito total: <strong class="text-body">${currency(totales.creditoTotal)}</strong></span>
      <span><i class="bi bi-check-circle me-1 text-success"></i>Disponible: <strong class="text-success">${currency(totales.creditoDisponible)}</strong></span>
      <span><i class="bi bi-exclamation-circle me-1 text-danger"></i>Deuda: <strong class="text-danger">${currency(totales.deudaTotal)}</strong></span>
    </div>` : ''}`;
}

function _renderTarjetasTable(tarjetas, isActivo, isCerrado, hoy, festivosMX = [], isProyeccion = false) {
  const CONF_ICON  = `<i class="bi bi-check-circle-fill" style="color:var(--bs-success);font-size:0.65rem;flex-shrink:0"></i>`;
  const CONF_EMPTY = `<i style="font-size:0.65rem;flex-shrink:0;visibility:hidden">·</i>`;

  const eb = (idx, campo) => isActivo
    ? `<button class="btn-icon btn-edit-campo" data-idx="${idx}" data-campo="${campo}"
               style="font-size:0.7rem;opacity:0.45;flex-shrink:0" title="Editar"><i class="bi bi-pencil-fill"></i></button>`
    : '';

  const dateCell = (ref, conf, idx, campo) => {
    const val = conf ?? ref;
    const confirmed = conf != null;
    return `<div class="d-flex align-items-center justify-content-end gap-1">
      ${confirmed ? CONF_ICON : CONF_EMPTY}
      <span class="${confirmed ? 'fw-semibold' : 'text-muted fst-italic'}">${val ? fmtDate(val) : '—'}</span>
      ${eb(idx, campo)}
    </div>`;
  };

  const numCell = (ref, conf, idx, campo) => {
    const val = conf ?? ref;
    const confirmed = conf != null;
    return `<div class="d-flex align-items-center justify-content-end gap-1">
      ${confirmed ? CONF_ICON : CONF_EMPTY}
      ${val != null ? `<span class="${confirmed ? 'fw-semibold' : 'text-muted fst-italic'}">${currency(val)}</span>` : '<span class="text-muted">—</span>'}
      ${eb(idx, campo)}
    </div>`;
  };

  const _nomFecha = (t) => {
    if (t.fechaNomina) return t.fechaNomina;
    const fp = t.fechaPagoConf ?? t.fechaPago;
    if (!fp) return '';
    const nom = anteriorNomina(new Date(String(fp).includes('T') ? fp : fp + 'T12:00:00'), festivosMX);
    return nom ? toISODate(nom) : fp;
  };

  const rows = [...tarjetas]
    .sort((a, b) => {
      if (a.pagado !== b.pagado) return a.pagado ? 1 : -1;
      return _nomFecha(a).localeCompare(_nomFecha(b));
    })
    .map((t, idx) => {
      // Recover original index for edit/pay actions (data-idx must match impacto.tarjetas[])
      idx = tarjetas.indexOf(t);
    const color = t.color || '#607d8b';
    const monto = t.montoAPagar ?? t.estimadoTotal ?? 0;
    const corteEfectivo = t.fechaCorteConf ?? t.fechaCorte;
    const canPay = !t.pagado && (corteEfectivo <= hoy || monto === 0);

    const P = 'padding:2px 6px';
    return `<tr class="${t.pagado ? 'table-success' : ''}">
      <td style="white-space:nowrap;${P}">
        <div class="d-flex align-items-center gap-2">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
          <span style="font-size:0.85rem">
            ${t.institucion ? `<span class="text-muted">${t.institucion}</span> ` : ''}<span class="fw-500">${t.nombre}</span>
          </span>
        </div>
        ${t.pagado ? `<span class="badge bg-success" style="font-size:0.6rem;margin-left:18px">Pagada</span>` : ''}
      </td>
      ${!isProyeccion ? `
      <td class="text-end" style="white-space:nowrap;${P}">${numCell(t.limiteTotal, t.limiteTotalConf, idx, 'limiteTotal')}</td>
      <td class="text-end" style="white-space:nowrap;${P}">${numCell(t.saldoDisponible, t.saldoDispConf, idx, 'saldoDisp')}</td>
      ` : ''}
      <td class="text-end" style="white-space:nowrap;padding:2px 6px 2px 18px">${dateCell(t.fechaCorte, t.fechaCorteConf, idx, 'fechaCorte')}</td>
      <td class="text-end" style="white-space:nowrap;${P}">${(() => {
          const fp = t.fechaPagoConf ?? t.fechaPago;
          const confirmed = t.fechaPagoConf != null;
          if (!fp) return `<div class="d-flex align-items-center justify-content-end gap-1">${CONF_EMPTY}<span class="text-muted">—</span>${eb(idx, 'fechaPago')}</div>`;
          const nom = anteriorNomina(new Date(String(fp).includes('T') ? fp : fp + 'T12:00:00'), festivosMX);
          const nomDay = nom ? Number(toISODate(nom).slice(8, 10)) : Number(fp.slice(8, 10));
          const q = nomDay <= 15 ? '1Q' : '2Q';
          const qCls = nomDay <= 15 ? 'bg-primary-subtle text-primary' : 'bg-success-subtle text-success';
          return `<div class="d-flex align-items-center justify-content-end gap-1">
            ${confirmed ? CONF_ICON : CONF_EMPTY}
            <span class="${confirmed ? 'fw-semibold' : 'text-muted fst-italic'}">${fmtDate(fp)}</span>
            <span class="badge ${qCls}" style="font-size:0.58rem;padding:2px 4px">${q}</span>
            ${eb(idx, 'fechaPago')}
          </div>`;
        })()}</td>
      <td class="text-end" style="white-space:nowrap;${P}" title="${[
          `Estimado: ${currency(t.estimadoTotal)}`,
          t.estimadoContado > 0 ? `  Contado: ${currency(t.estimadoContado)}` : '',
          t.estimadoPlazos  > 0 ? `  Plazos:  ${currency(t.estimadoPlazos)}`  : '',
          t.estimadoGastos  > 0 ? `  Gastos:  ${currency(t.estimadoGastos)}`  : '',
        ].filter(Boolean).join('\n')}">
        ${numCell(t.estimadoTotal, t.montoAPagar, idx, 'montoAPagar')}
        ${t.pagado ? `<div class="text-muted" style="font-size:0.7rem">${fmtDate(t.fechaPagado)}</div>` : ''}
      </td>
      ${isActivo ? `<td class="text-center" style="${P}">
        ${!t.pagado
          ? `<button class="btn-icon btn-pagar-tarjeta" data-idx="${idx}"
                     ${canPay ? '' : `disabled title="Espera al corte (${corteEfectivo ? fmtDate(corteEfectivo) : '—'})"`}>
               <i class="bi bi-check-circle${canPay ? ' text-success' : ''}" style="font-size:1.1rem"></i>
             </button>`
          : `<i class="bi bi-check-circle-fill text-success" style="font-size:1.1rem"></i>`}
      </td>` : ''}
    </tr>`;
  }).join('');

  return `
    <div class="table-wrapper">
      <table class="table table-sm align-middle">
        <thead><tr>
          <th style="padding:3px 6px">Tarjeta</th>
          ${!isProyeccion ? `
          <th class="text-center" style="padding:3px 6px;white-space:nowrap">Límite</th>
          <th class="text-center" style="padding:3px 6px;white-space:nowrap">Disponible</th>` : ''}
          <th class="text-center" style="padding:3px 6px 3px 18px;white-space:nowrap">Corte</th>
          <th class="text-center" style="padding:3px 6px;white-space:nowrap">Pago</th>
          <th class="text-center" style="padding:3px 6px;white-space:nowrap">A Pagar</th>
          ${isActivo ? '<th style="padding:3px 6px;width:36px"></th>' : ''}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function _renderGastosDebito(gastosDebitoLive, cardMap) {
  if (!gastosDebitoLive.length) return '';

  const estadoCell = (estado) => {
    if (estado === 'registrado') return `<span class="badge bg-success-subtle text-success" style="font-size:0.65rem">Registrado</span>`;
    if (estado === 'pendiente')  return `<span class="badge bg-warning-subtle text-warning-emphasis" style="font-size:0.65rem">Pendiente</span>`;
    return `<span class="badge bg-secondary-subtle text-secondary" style="font-size:0.65rem">Sin registrar</span>`;
  };

  const totalDebito = gastosDebitoLive.reduce((s, g) => s + (Number(g.importe) || 0), 0);

  return `
    <p class="text-muted fw-semibold mb-1 mt-4" style="font-size:0.72rem;text-transform:uppercase;letter-spacing:.05em">
      <i class="bi bi-bank me-1"></i>Gastos Débito
    </p>
    <div class="table-wrapper mb-2">
      <table class="table table-sm">
        <thead><tr>
          <th>Nombre</th><th>Tarjeta</th><th>Fecha</th><th>Estado</th><th class="text-end">Importe</th>
        </tr></thead>
        <tbody>
          ${gastosDebitoLive.map(g => {
            const tc = cardMap[g.tarjetaId];
            const muted = g.estado === 'sin_registro';
            return `<tr class="${muted ? 'text-muted' : ''}">
              <td>${g.nombre}</td>
              <td style="white-space:nowrap">${tc?.nombre || '—'}</td>
              <td style="white-space:nowrap">${g.fechaPago ? fmtDate(g.fechaPago) : '—'}</td>
              <td>${estadoCell(g.estado)}</td>
              <td class="text-end ${muted ? 'fst-italic' : ''}">${currency(g.importe)}</td>
            </tr>`;
          }).join('')}
          <tr class="fw-semibold table-secondary">
            <td colspan="4">Total débito</td>
            <td class="text-end">${currency(totalDebito)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function _renderTotalesSection(totales) {
  return `
    <p class="text-muted fw-semibold mb-2 mt-4" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:.05em">
      <i class="bi bi-bar-chart-line me-1"></i>Resumen de Crédito
    </p>
    <div class="row g-3 mb-4">
      <div class="col-4">
        <div class="metric-card">
          <div class="metric-icon" style="background:#e8eaf6"><i class="bi bi-layers" style="color:#3949ab"></i></div>
          <div class="metric-info">
            <div class="metric-value">${currency(totales.creditoTotal)}</div>
            <div class="metric-label">Crédito total</div>
          </div>
        </div>
      </div>
      <div class="col-4">
        <div class="metric-card">
          <div class="metric-icon" style="background:#e8f5e9"><i class="bi bi-check-circle" style="color:#2e7d32"></i></div>
          <div class="metric-info">
            <div class="metric-value">${currency(totales.creditoDisponible)}</div>
            <div class="metric-label">Disponible</div>
          </div>
        </div>
      </div>
      <div class="col-4">
        <div class="metric-card">
          <div class="metric-icon" style="background:#ffebee"><i class="bi bi-exclamation-circle" style="color:#c62828"></i></div>
          <div class="metric-info">
            <div class="metric-value">${currency(totales.deudaTotal)}</div>
            <div class="metric-label">Deuda total</div>
          </div>
        </div>
      </div>
    </div>`;
}

// ── Modals ───────────────────────────────────────────────────────────────────

function _showModalNomina(configGen, ctx) {
  const val = Number(configGen?.nominaAprox) || 0;
  openModal({
    title: 'Nómina de referencia',
    body: `
      <p class="text-muted" style="font-size:0.85rem">Este valor se usa como referencia para calcular el <strong>Restante Esperado</strong> en cada Impacto. No afecta el Presupuesto real.</p>
      <label class="form-label">Nómina aproximada *</label>
      <div class="input-group">
        <span class="input-group-text">$</span>
        <input type="number" class="form-control" id="input-nomina" value="${val}" min="0" step="0.01">
      </div>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-nomina">Guardar</button>`,
  });
  document.getElementById('btn-save-nomina').addEventListener('click', async () => {
    const v = Number(document.getElementById('input-nomina').value) || 0;
    await upsert('config', 'general', { nominaAprox: v });
    // Sync nominaRef in active impacto so historical data stays consistent
    const imp = await getById('impacto', ctx.mes);
    if (imp?.estado === 'activo') await upsert('impacto', ctx.mes, { nominaRef: v });
    closeModal();
    toast('Nómina actualizada');
    await renderView(ctx.container, ctx.mes);
  });
}

function _showModalPresupuesto(impacto, ctx) {
  const val = Number(impacto.presupuesto) || 0;
  openModal({
    title: 'Presupuesto del mes',
    body: `
      <p class="text-muted" style="font-size:0.85rem">Ingresos reales recibidos este mes. Puede editarse en cualquier momento mientras el Impacto esté activo.</p>
      <label class="form-label">Presupuesto *</label>
      <div class="input-group">
        <span class="input-group-text">$</span>
        <input type="number" class="form-control" id="input-pres" value="${val}" min="0" step="0.01">
      </div>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-pres">Guardar</button>`,
  });
  document.getElementById('btn-save-pres').addEventListener('click', async () => {
    const v = Number(document.getElementById('input-pres').value) || 0;
    await upsert('impacto', impacto.mes, { presupuesto: v });
    closeModal();
    toast('Presupuesto actualizado');
    await renderView(ctx.container, ctx.mes);
  });
}

function _showModalEditCampo(t, idx, campo, impacto, ctx) {
  const defs = {
    fechaCorte:  { label: 'Fecha de corte',       ref: t.fechaCorte,      conf: t.fechaCorteConf,   confKey: 'fechaCorteConf',  type: 'date'   },
    fechaPago:   { label: 'Fecha límite de pago',  ref: t.fechaPago,       conf: t.fechaPagoConf,    confKey: 'fechaPagoConf',   type: 'date'   },
    limiteTotal: { label: 'Límite total',           ref: t.limiteTotal,     conf: t.limiteTotalConf,  confKey: 'limiteTotalConf', type: 'number' },
    saldoDisp:   { label: 'Saldo disponible',       ref: t.saldoDisponible, conf: t.saldoDispConf,    confKey: 'saldoDispConf',   type: 'number' },
    montoAPagar: { label: 'Monto a pagar',          ref: t.estimadoTotal,   conf: t.montoAPagar,      confKey: 'montoAPagar',     type: 'number' },
  };
  const d = defs[campo];
  const val = d.conf ?? d.ref ?? '';
  const refLabel = d.type === 'number' ? currency(d.ref ?? 0) : (d.ref ? fmtDate(d.ref) : '—');

  openModal({
    title: d.label,
    body: `
      <p class="text-muted mb-2" style="font-size:0.82rem">Referencia calculada: <strong>${refLabel}</strong></p>
      <div class="${d.type === 'number' ? 'input-group' : ''}">
        ${d.type === 'number' ? '<span class="input-group-text">$</span>' : ''}
        <input type="${d.type}" class="form-control" id="campo-input"
               value="${val}" ${d.type === 'number' ? 'min="0" step="0.01"' : ''}>
      </div>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      ${d.conf != null ? `<button type="button" class="btn btn-outline-secondary btn-sm" id="btn-usar-ref">Usar referencia</button>` : ''}
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-campo">Confirmar</button>`,
  });

  const _save = async (newVal) => {
    const updated = [...impacto.tarjetas];
    updated[idx] = { ...t, [d.confKey]: newVal };
    await upsert('impacto', impacto.mes, { tarjetas: updated });
    closeModal();
    await renderView(ctx.container, ctx.mes);
  };

  document.getElementById('btn-save-campo').addEventListener('click', () => {
    const v = document.getElementById('campo-input').value;
    _save(d.type === 'number' ? Number(v) : (v || null));
  });
  document.getElementById('btn-usar-ref')?.addEventListener('click', () => _save(null));
}

function _showModalPagar(t, idx, impacto, ctx) {
  const monto = t.montoAPagar ?? t.estimadoTotal ?? 0;
  const hayNoConf = [
    t.fechaCorteConf == null && t.fechaCorte,
    t.fechaPagoConf  == null && t.fechaPago,
    t.limiteTotalConf == null,
    t.montoAPagar == null,
  ].some(Boolean);

  openModal({
    title: `Registrar pago — ${t.nombre}`,
    body: `
      <p class="mb-2">Monto a registrar: <strong>${currency(monto)}</strong></p>
      ${hayNoConf ? `<div class="alert alert-warning py-2 mb-2" style="font-size:0.8rem">
        <i class="bi bi-exclamation-triangle me-1"></i>
        Uno o más datos sin confirmar — se usarán los valores de referencia.
      </div>` : ''}
      <div class="alert alert-info py-2" style="font-size:0.8rem">
        <i class="bi bi-info-circle me-1"></i>
        Actualizará el saldo disponible y registrará el pago de las mensualidades de este mes.
      </div>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-success btn-sm" id="btn-confirmar-pago">Confirmar pago</button>`,
  });
  document.getElementById('btn-confirmar-pago').addEventListener('click', async () => {
    closeModal();
    await _registrarPago(t, idx, monto, impacto, ctx);
    toast('Pago registrado');
    await renderView(ctx.container, ctx.mes);
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function _registrarPago(t, idx, monto, impacto, ctx) {
  const hoy = toISODate(new Date());

  // 1. Update tarjeta record in impacto
  const updatedTarjetas = [...impacto.tarjetas];
  const dispActual = Number(t.saldoDispConf ?? t.saldoDisponible ?? 0);
  updatedTarjetas[idx] = {
    ...t,
    pagado:      true,
    fechaPagado: hoy,
    saldoDispConf: dispActual + monto,
  };
  await upsert('impacto', impacto.mes, { tarjetas: updatedTarjetas });

  // 2. Update saldoDisponible on the tarjeta document (no fecha update)
  if (t.tarjetaId && monto > 0) {
    await update('tarjetas', t.tarjetaId, { saldoDisponible: dispActual + monto });
  }

  // 3. Increment mesesPagados for A Plazos whose próximo pago is this month
  if (t.tarjetaId) {
    const tarjeta = ctx.tarjetas.find(tc => tc.id === t.tarjetaId);
    const ciclo   = tarjeta?.ciclo;
    if (ciclo) {
      const plazosMes = getPlazosMes(ctx.msi, t.tarjetaId, ciclo, impacto.mes, ctx.festivosMX);
      await Promise.all(plazosMes.map(m => {
        const nuevosMeses   = (Number(m.mesesPagados) || 0) + 1;
        const restanteBase  = m.restante != null
          ? Number(m.restante)
          : Math.max(0, (Number(m.total) || 0) - (Number(m.mensualidad) || 0) * (Number(m.mesesPagados) || 0));
        const nuevoRestante = Math.max(0, restanteBase - (Number(m.mensualidad) || 0));
        return update('msi', m.id, { mesesPagados: nuevosMeses, restante: nuevoRestante });
      }));
    }
  }
}

async function _cerrarMes(impacto, gastosDebitoLive, totales, ctx) {
  // Auto-mark 0-amount cards as paid if not already
  const updatedTarjetas = impacto.tarjetas.map(t =>
    (!t.pagado && (t.montoAPagar ?? t.estimadoTotal ?? 0) === 0)
      ? { ...t, pagado: true, fechaPagado: toISODate(new Date()) }
      : t
  );

  await upsert('impacto', impacto.mes, {
    estado: 'cerrado',
    fechaCierre: toISODate(new Date()),
    tarjetas: updatedTarjetas,
    gastosDebito: gastosDebitoLive,
    totales,
  });
  toast('Impacto cerrado');
  await renderView(ctx.container, ctx.mes);
}

// ── Utility ──────────────────────────────────────────────────────────────────

function _darken(hex, amount = 40) {
  const h = (hex || '#607d8b').replace('#', '');
  return '#' + [0, 2, 4].map(i => {
    const v = Math.max(0, parseInt(h.slice(i, i + 2), 16) - amount);
    return v.toString(16).padStart(2, '0');
  }).join('');
}
