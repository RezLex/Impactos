import { getAll, getById, recentWhere } from '../utils/db.js';
import { currency, fmtDate, fmtShortDate, currentYYYYMM, fmtMonth } from '../utils/formatters.js';
import { toISODate, anteriorNomina } from '../utils/ciclo.js';
import { calcularSaldo } from '../utils/saldo.js';
import {
  calcularCicloParaMes, calcularEstimadoTarjeta,
  getPlazosMes, getGastosDebitoCompleto, calcularTotalesCredito,
  recalcTotalesImpacto,
} from '../utils/impacto-calc.js';
import { resumenCuenta, totalizarResumenes, registrarInhabiles } from '../utils/rendimiento.js';

export async function render(container) {
  container.innerHTML = `<div class="loading-overlay"><div class="spinner-border text-primary" role="status"></div></div>`;

  let styleEl = document.getElementById('dashboard-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'dashboard-style';
    document.head.appendChild(styleEl);
  }
  // :has() handles overflow automatically — activates on desktop only when dashboard is visible,
  // reverts instantly when navigating away (no JS state needed)
  // `extra` compensa la fila adicional cuando las 3 metric cards no caben en
  // una sola línea (por debajo de xxl la tercera baja a su propio renglón)
  const setPanel = (extra = 0) => styleEl.textContent = `
    @media (min-width:992px){
      body:has(#app-content .dash-panel-content){overflow:hidden}
      .dash-panel-content{max-height:calc((100dvh - ${458 + extra}px)/2)!important;overflow-y:auto}
    }
    ${extra ? `@media (min-width:1400px){
      .dash-panel-content{max-height:calc((100dvh - 458px)/2)!important}
    }` : ''}`;
  setPanel();

  new MutationObserver((_, obs) => {
    if (!container.querySelector('.dash-panel-content')) { styleEl.remove(); obs.disconnect(); }
  }).observe(container, { childList: true });
  try {
    const mes = currentYYYYMM();

    const [impacto, tarjetas, instituciones, msi, contado, gastos, gastosFijos, festivosMX, configGen, pagosDiferidos, inversiones] =
      await Promise.all([
        getById('impacto', mes),
        getAll('tarjetas'),
        getAll('instituciones'),
        getAll('msi'),
        getAll('contado'),
        getAll('gastos', recentWhere('mes')),
        getAll('gastosFijos'),
        getAll('festivosMX'),
        getById('config', 'general'),
        getAll('pagosDiferidos'),
        getAll('inversiones'),
      ]);

    const instMap         = Object.fromEntries(instituciones.map(i => [i.id, i]));
    const cardMap         = Object.fromEntries(tarjetas.map(t => [t.id, t]));
    const tarjetasCredito = tarjetas.filter(t => t.tipo === 'credito' || t.tipo === 'prestamo');
    const debitoIds       = new Set(tarjetas.filter(t => t.tipo === 'debito').map(t => t.id));
    const nominaAprox     = Number(configGen?.nominaAprox) || 0;
    const hoy             = toISODate(new Date());

    // ── Saldo calculado por tarjeta ──────────────────────────────────────────
    const saldoMap = new Map(tarjetas.map(t => [t.id, calcularSaldo(t, contado, msi, gastos, pagosDiferidos)]));

    // ── Crédito health ───────────────────────────────────────────────────────
    let creditoTotal = 0, creditoDisponible = 0;
    tarjetasCredito.forEach(t => {
      const s = saldoMap.get(t.id);
      creditoTotal      += Number(t.limiteTotal) || 0;
      creditoDisponible += s ? s.disponible : (t.saldoDisponible ?? Number(t.limiteTotal) ?? 0);
    });
    const deudaTotal     = Math.max(0, creditoTotal - creditoDisponible);
    const usadoPct       = creditoTotal > 0 ? Math.round((deudaTotal / creditoTotal) * 100) : 0;

    // ── Rendimientos de las cuentas de inversión ─────────────────────────────
    // Los festivos van antes del cálculo: las cuentas que solo abonan en días
    // hábiles los necesitan para saber cuándo se acredita el interés.
    registrarInhabiles(festivosMX);
    const rend = totalizarResumenes(inversiones.map(c => resumenCuenta(c, hoy)));
    // Con 3 tarjetas hacen falta ~313px cada una para que el importe no se
    // corte; con el sidebar eso solo se cumple desde xxl. Debajo, la tercera
    // baja a su propio renglón en vez de estrujar a las tres.
    const colMetric = rend.cuentas ? 'col-12 col-lg-6 col-xxl-4' : 'col-12 col-lg-6';
    if (rend.cuentas) setPanel(92);

    // ── Impacto del mes ──────────────────────────────────────────────────────
    let impactoTarjetas = [];
    let totalAPagar     = 0;
    let presupuesto     = 0;
    let gastoDebito     = 0;
    let restante        = 0;
    let tieneImpacto    = !!impacto;

    const gastosDebMes = getGastosDebitoCompleto(gastos, gastosFijos, mes, debitoIds, tarjetas, festivosMX);
    gastoDebito = gastosDebMes.reduce((s, g) => s + (Number(g.importe) || 0), 0);

    if (impacto) {
      impactoTarjetas = impacto.tarjetas || [];
      const totales    = recalcTotalesImpacto(impacto, gastosDebMes, nominaAprox);
      totalAPagar      = totales.estimadoCredito + totales.gastoDebito;
      presupuesto      = Number(impacto.presupuesto) || 0;
      restante         = totales.restante;
    } else {
      impactoTarjetas = tarjetasCredito.map(t => {
        const inst      = instMap[t.institucionId];
        const est       = calcularEstimadoTarjeta(t, contado, msi, gastos, festivosMX, mes, pagosDiferidos);
        const cicloData = calcularCicloParaMes(t.ciclo, mes, festivosMX);
        const fp        = cicloData?.fechaPago ? toISODate(cicloData.fechaPago) : null;
        const nom       = fp ? anteriorNomina(new Date(String(fp).includes('T') ? fp : fp + 'T12:00:00'), festivosMX) : null;
        const nomDay    = nom ? Number(toISODate(nom).slice(8, 10)) : null;
        return {
          tarjetaId:    t.id,
          nombre:       t.nombre,
          institucion:  inst?.nombre || '',
          color:        inst?.color  || '#607d8b',
          fechaPago:    fp,
          nomDay,
          ...est,
          montoAPagar:  est.estimadoTotal,
          pagado:       false,
        };
      });
      // sort will be applied below alongside stored impacto
      totalAPagar = impactoTarjetas.reduce((s, t) => s + t.estimadoTotal, 0);
      presupuesto = nominaAprox;
      restante    = presupuesto - totalAPagar - gastoDebito;
    }

    // ── Ordenar por fecha nómina (misma regla que Impacto) ──────────────────
    const _nomFechaDash = (t) => {
      if (t.fechaNomina) return t.fechaNomina;
      const fp = t.fechaPagoConf ?? t.fechaPago;
      if (!fp) return '';
      const nom = anteriorNomina(new Date(String(fp).includes('T') ? fp : fp + 'T12:00:00'), festivosMX);
      return nom ? toISODate(nom) : fp;
    };
    impactoTarjetas = [...impactoTarjetas].sort((a, b) => {
      const nomA = _nomFechaDash(a), nomB = _nomFechaDash(b);
      const qA = nomA ? (Number(nomA.slice(8, 10)) <= 15 ? 0 : 1) : 2;
      const qB = nomB ? (Number(nomB.slice(8, 10)) <= 15 ? 0 : 1) : 2;
      if (qA !== qB) return qA - qB;
      const corteA = a.fechaCorteConf ?? a.fechaCorte ?? '';
      const corteB = b.fechaCorteConf ?? b.fechaCorte ?? '';
      return corteA.localeCompare(corteB);
    });

    // ── Desglose Total a pagar ───────────────────────────────────────────────
    const estimadoContado = impactoTarjetas.reduce((s, t) => s + (Number(t.estimadoContado) || 0), 0);
    const estimadoPlazos  = impactoTarjetas.reduce((s, t) => s + (Number(t.estimadoPlazos)  || 0), 0);
    const estimadoGastos  = impactoTarjetas.reduce((s, t) => s + (Number(t.estimadoGastos)  || 0), 0);
    const restanteEsperado = nominaAprox - totalAPagar - gastoDebito;

    // ── Últimas compras (contado + plazos unificados) ────────────────────────
    const ultimasCompras = [
      ...[...contado].map(c => ({ ...c, _tipo: 'contado' })),
      ...[...msi].filter(m => !m.liquidado).map(m => ({ ...m, _tipo: 'plazos' })),
    ].sort((a, b) => (b.fechaCompra || '').localeCompare(a.fechaCompra || ''))
     .slice(0, 20);

    // ── Gastos fijos pendientes del mes ──────────────────────────────────────
    const gastosFijosPendientes = gastosDebMes
      .filter(g => g.estado !== 'registrado' && g.estado !== 'descartado')
      .slice(0, 5);

    // ── Render ───────────────────────────────────────────────────────────────
    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Dashboard</h2>
          <p style="text-transform:capitalize">${fmtMonth(mes)}</p>
        </div>
        <a href="#/impacto" class="btn btn-sm btn-outline-primary">
          <i class="bi bi-bar-chart-line me-1"></i>Ver Impacto
        </a>
      </div>

      <!-- ── Métricas ── -->
      <div class="row g-3 mb-3">
        <div class="${colMetric}">
          <div class="metric-card h-100">
            <div class="metric-icon tint-danger"><i class="bi bi-credit-card-fill"></i></div>
            <div class="metric-info d-flex gap-0" style="min-width:0">
              <div style="flex:1;min-width:0">
                <div class="metric-value">${currency(totalAPagar)}</div>
                <div class="metric-label">Total a pagar</div>
              </div>
              <div class="metric-divider"></div>
              <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1px">
                ${estimadoContado > 0 ? `<div style="font-size:0.72rem;color:var(--text-faint)">Contado <strong style="color:var(--text-soft)">${currency(estimadoContado)}</strong></div>` : ''}
                ${estimadoPlazos  > 0 ? `<div style="font-size:0.72rem;color:var(--text-faint)">Plazos <strong style="color:var(--text-soft)">${currency(estimadoPlazos)}</strong></div>` : ''}
                ${estimadoGastos  > 0 ? `<div style="font-size:0.72rem;color:var(--text-faint)">Gastos <strong style="color:var(--text-soft)">${currency(estimadoGastos)}</strong></div>` : ''}
              </div>
            </div>
          </div>
        </div>
        <div class="${colMetric}">
          <div class="metric-card h-100">
            <div class="metric-icon tint-info"><i class="bi bi-calculator"></i></div>
            <div class="metric-info d-flex gap-0" style="min-width:0">
              <div style="flex:1;min-width:0">
                <div class="metric-value ${restante < 0 ? 'text-danger' : 'text-success'}">${currency(restante)}</div>
                <div class="metric-label">Restante${tieneImpacto ? '' : ' est.'}</div>
              </div>
              <div class="metric-divider"></div>
              <div style="flex:1;min-width:0">
                <div class="metric-value text-muted">${currency(restanteEsperado)}</div>
                <div class="metric-label">Esperado</div>
              </div>
            </div>
          </div>
        </div>
        ${rend.cuentas ? `
        <div class="${colMetric}">
          <a href="#/rendimientos" class="metric-card h-100 text-reset">
            <div class="metric-icon tint-success"><i class="bi bi-piggy-bank-fill"></i></div>
            <div class="metric-info d-flex gap-0" style="min-width:0">
              <div style="flex:1;min-width:0">
                <div class="metric-value text-success">${currency(rend.diario)}</div>
                <div class="metric-label">Diario</div>
                <div class="metric-sub">Saldo ${currency(rend.saldoActual)}</div>
              </div>
              <div class="metric-divider"></div>
              <div style="flex:1;min-width:0">
                <div class="metric-value text-success">${currency(rend.rendimientoHastaHoy)}</div>
                <div class="metric-label">Hasta hoy</div>
              </div>
            </div>
          </a>
        </div>` : ''}
      </div>

      <!-- ── Crédito health bar ── -->
      <div class="data-card mb-3" style="padding:12px 16px">
        <div class="d-flex justify-content-between align-items-center mb-1" style="font-size:0.78rem">
          <span class="text-muted"><i class="bi bi-layers me-1"></i>Crédito total: <strong class="text-body">${currency(creditoTotal)}</strong></span>
          <span>
            <span class="text-danger me-3"><i class="bi bi-exclamation-circle me-1"></i>Deuda: <strong>${currency(deudaTotal)}</strong></span>
            <span class="text-success"><i class="bi bi-check-circle me-1"></i>Disponible: <strong>${currency(creditoDisponible)}</strong></span>
          </span>
        </div>
        <div class="progress" style="height:8px">
          <div class="progress-bar ${usadoPct > 80 ? 'bg-danger' : usadoPct > 60 ? 'bg-warning' : 'bg-success'}"
               style="width:${usadoPct}%" title="${usadoPct}% utilizado"></div>
        </div>
        <div class="text-muted mt-1" style="font-size:0.72rem;text-align:right">${usadoPct}% utilizado</div>
      </div>

      <!-- ── Row 1: Últimas Compras + Gastos Fijos ── -->
      <div class="row g-3 mb-3">
        <div class="col-lg-6">
          <div class="data-card h-100">
            <div class="data-card-header">
              <span><i class="bi bi-bag me-2"></i>Últimas compras</span>
              <a href="#/compras" class="text-white" style="font-size:0.78rem">Ver todo →</a>
            </div>
            <div class="dash-panel-content" style="max-height:260px;overflow-y:auto">
              ${ultimasCompras.length === 0
                ? `<div class="empty-state" style="padding:24px 0"><i class="bi bi-bag-x"></i><p>Sin compras registradas</p></div>`
                : ultimasCompras.map(item => {
                    const tc     = cardMap[item.tarjetaId];
                    const enlace = item.enlaceCompra;
                    const titulo = enlace
                      ? `<a href="${enlace}" target="_blank" rel="noopener" class="text-reset text-decoration-none">${item.compra}<i class="bi bi-box-arrow-up-right ms-1" style="font-size:var(--fs-nano);opacity:.5"></i></a>`
                      : item.compra;
                    const fecha  = item.fechaCompra ? ' · ' + fmtShortDate(item.fechaCompra) : '';
                    const tarjeta = tc?.nombre || '—';

                    if (item._tipo === 'contado') {
                      return `<div class="d-flex align-items-center gap-3 px-3 py-2 border-bottom" style="font-size:0.82rem">
                        <div class="flex-grow-1 min-width-0">
                          <div class="fw-500 text-truncate">${titulo}</div>
                          <div class="text-muted" style="font-size:0.72rem">
                            <span class="badge bg-secondary-subtle text-secondary me-1" style="font-size:var(--fs-nano);vertical-align:middle">Contado</span>${tarjeta}${fecha}
                          </div>
                        </div>
                        <div class="fw-semibold text-end flex-shrink-0">${currency(item.total)}</div>
                      </div>`;
                    } else {
                      return `<div class="d-flex align-items-center gap-3 px-3 py-2 border-bottom" style="font-size:0.82rem">
                        <div class="flex-grow-1 min-width-0">
                          <div class="fw-500 text-truncate">${titulo}</div>
                          <div class="text-muted" style="font-size:0.72rem">
                            <span class="badge bg-primary-subtle text-primary me-1" style="font-size:var(--fs-nano);vertical-align:middle">${item.mesesPagados}/${item.mesesTotal} msi</span>${tarjeta}${fecha}
                          </div>
                        </div>
                        <div class="text-end flex-shrink-0">
                          <div class="fw-semibold">${currency(item.mensualidad)}<span class="text-muted fw-normal" style="font-size:var(--fs-small)">/mes</span></div>
                          <div style="font-size:var(--fs-mini);color:var(--text-faint)">${currency(item.total)} total</div>
                        </div>
                      </div>`;
                    }
                  }).join('')
              }
            </div>
          </div>
        </div>
        <div class="col-lg-6">
          <div class="data-card h-100">
            <div class="data-card-header">
              <span><i class="bi bi-receipt-cutoff me-2"></i>Gastos Fijos del mes</span>
              <a href="#/compras/gastos" class="text-white" style="font-size:0.78rem">Gestionar →</a>
            </div>
            <div class="dash-panel-content" style="max-height:260px;overflow-y:auto">
              ${gastosDebMes.length === 0 && gastosFijosPendientes.length === 0
                ? `<div class="empty-state" style="padding:24px 0"><i class="bi bi-receipt"></i><p>Sin gastos fijos este mes</p></div>`
                : gastosDebMes.concat(
                    gastos.filter(g => g.mes === mes && g.gastaFijoId && g.estado !== 'descartado' && !debitoIds.has(g.tarjetaId))
                          .map(g => ({ ...g, nombre: g.nombre || '—' }))
                  ).slice(0, 8).map(g => {
                    const tc = cardMap[g.tarjetaId];
                    const estadoCls = g.estado === 'registrado' ? 'bg-success-subtle text-success'
                      : g.estado === 'pendiente' ? 'bg-warning-subtle text-warning-emphasis'
                      : 'bg-secondary-subtle text-secondary';
                    const estadoLabel = g.estado === 'registrado' ? 'Registrado'
                      : g.estado === 'pendiente' ? 'Pendiente' : 'Sin registrar';
                    return `<div class="d-flex align-items-center gap-3 px-3 py-2 border-bottom" style="font-size:0.82rem">
                      <div class="flex-grow-1">
                        <div class="fw-500">${g.nombre}</div>
                        <div class="text-muted" style="font-size:0.72rem">${tc?.nombre || '—'}${g.fechaPago ? ' · ' + fmtShortDate(g.fechaPago) : ''}</div>
                      </div>
                      <span class="badge ${estadoCls}" style="font-size:var(--fs-tiny)">${estadoLabel}</span>
                      <div class="fw-semibold text-end flex-shrink-0" style="min-width:60px">${currency(g.importe)}</div>
                    </div>`;
                  }).join('')
              }
            </div>
          </div>
        </div>
      </div>

      <!-- ── Row 2: Tarjetas ── -->
      <div class="row g-3 mb-3">
        <div class="col-lg-12">
          <div class="data-card h-100">
            <div class="data-card-header">
              <span><i class="bi bi-credit-card me-2"></i>Tarjetas — ${fmtMonth(mes)}</span>
              <a href="#/impacto" class="text-white" style="font-size:0.78rem">${tieneImpacto ? 'Gestionar →' : 'Crear Impacto →'}</a>
            </div>
            <div class="table-wrapper dash-panel-content" style="max-height:260px;overflow-y:auto">
              <table class="table table-sm mb-0" style="font-size:0.82rem">
                <tbody>
                  ${impactoTarjetas.map(t => {
                    const cortePasado = t.fechaCorte && t.fechaCorte <= hoy;
                    const fp = t.fechaPago;
                    const nom = fp ? anteriorNomina(new Date(String(fp).includes('T') ? fp : fp + 'T12:00:00'), festivosMX) : null;
                    const nomDay = nom ? Number(toISODate(nom).slice(8, 10)) : null;
                    const q = nomDay ? (nomDay <= 15 ? '1Q' : '2Q') : null;
                    const qCls = q === '1Q' ? 'bg-primary-subtle text-primary' : 'bg-success-subtle text-success';
                    const monto = t.montoAPagar ?? t.estimadoTotal ?? 0;
                    return `<tr class="${t.pagado ? 'table-success' : ''}">
                      <td style="padding:4px 8px">
                        <div class="d-flex align-items-center gap-2">
                          <span style="width:7px;height:7px;border-radius:50%;background:${t.color || '#607d8b'};flex-shrink:0"></span>
                          <span style="font-size:0.82rem">${t.institucion ? `<span class="text-muted">${t.institucion}</span> ` : ''}<span class="fw-500">${t.nombre}</span></span>
                        </div>
                      </td>
                      <td style="padding:4px 8px;white-space:nowrap;font-size:0.78rem">
                        <div class="d-flex flex-column gap-0" style="line-height:1.4">
                          ${t.fechaCorte ? `<span class="text-muted"><i class="bi bi-scissors me-1" style="font-size:0.7rem"></i>${fmtShortDate(t.fechaCorteConf ?? t.fechaCorte)}</span>` : ''}
                          <span style="color:var(--text-muted)"><i class="bi bi-wallet2 me-1" style="font-size:0.7rem"></i>${fp ? fmtShortDate(fp) : '—'}${q ? `<span class="badge ${qCls} ms-1" style="font-size:var(--fs-micro);padding:1px 3px">${q}</span>` : ''}</span>
                        </div>
                      </td>
                      <td class="text-end fw-semibold" style="padding:4px 8px;white-space:nowrap">${currency(monto)}</td>
                      <td style="padding:4px 8px;text-align:center">
                        ${t.pagado
                          ? `<i class="bi bi-check-circle-fill text-success"></i>`
                          : monto === 0
                            ? `<i class="bi bi-dash-circle text-muted"></i>`
                            : cortePasado
                              ? `<i class="bi bi-circle text-warning" title="Pendiente de pago"></i>`
                              : `<i class="bi bi-clock text-muted" title="Espera al corte"></i>`}
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>`;

  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error al cargar el dashboard: ${e.message}</div>`;
    console.error(e);
  }
}
