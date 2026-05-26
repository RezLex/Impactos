import { getAll, getById } from '../utils/db.js';
import { currency, fmtShortDate, currentYYYYMM, fmtMonth, bankClass } from '../utils/formatters.js';

export async function render(container) {
  try {
    const yyyymm  = currentYYYYMM();
    const [impacto, msiItems, fijos] = await Promise.all([
      getById('impactoMensual', yyyymm),
      getAll('msi'),
      getAll('gastosFijos'),
    ]);

    const registros    = impacto?.registros || [];
    const totalPagar   = registros.reduce((s, r) => s + (Number(r.aPagar) || 0), 0);
    const totalDisp    = registros.filter(r => r.tipo === 'credito').reduce((s, r) => s + (Number(r.disponible) || 0), 0);
    const msiActivos   = msiItems.filter(m => Number(m.restante) > 0);
    const msiTotal     = msiActivos.reduce((s, m) => s + (Number(m.mensualidad) || 0), 0);
    const fijosTotal   = fijos.reduce((s, f) => s + (Number(f.importe) || 0), 0);
    const pendientes   = registros.filter(r => !r.pagado && Number(r.aPagar) > 0)
                                  .sort((a, b) => (a.limitePago || '').localeCompare(b.limitePago || ''));

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Dashboard</h2>
          <p>${fmtMonth(yyyymm)}</p>
        </div>
      </div>

      <!-- Metrics -->
      <div class="row g-3 mb-4">
        <div class="col-6 col-lg-3">
          <div class="metric-card">
            <div class="metric-icon" style="background:#ffebee">
              <i class="bi bi-credit-card-fill" style="color:#c62828"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(totalPagar)}</div>
              <div class="metric-label">A pagar este mes</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="metric-card">
            <div class="metric-icon" style="background:#e8f5e9">
              <i class="bi bi-wallet2" style="color:#2e7d32"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(totalDisp)}</div>
              <div class="metric-label">Crédito disponible</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="metric-card">
            <div class="metric-icon" style="background:#e3f2fd">
              <i class="bi bi-calendar-range" style="color:#1565c0"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(msiTotal)}</div>
              <div class="metric-label">Mensualidad MSI (${msiActivos.length} activos)</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="metric-card">
            <div class="metric-icon" style="background:#fff8e1">
              <i class="bi bi-receipt" style="color:#e65100"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(fijosTotal)}</div>
              <div class="metric-label">Gastos fijos/mes</div>
            </div>
          </div>
        </div>
      </div>

      <div class="row g-3">
        <!-- Próximos pagos -->
        <div class="col-lg-6">
          <div class="data-card">
            <div class="data-card-header">
              <span><i class="bi bi-alarm me-2"></i>Próximos Pagos</span>
              <a href="#/impacto" class="text-white" style="font-size:0.8rem">Ver todo →</a>
            </div>
            <div class="table-wrapper">
              ${pendientes.length === 0
                ? `<div class="empty-state"><i class="bi bi-check-all"></i><p>Todo pagado este mes</p></div>`
                : `<table class="table">
                    <thead><tr>
                      <th>Entidad</th><th>Límite pago</th><th class="text-end">Monto</th>
                    </tr></thead>
                    <tbody>
                      ${pendientes.slice(0,8).map(r => {
                        const days = r.limitePago ? Math.ceil((new Date(r.limitePago) - new Date()) / 864e5) : null;
                        const badge = days == null ? '' : days < 0
                          ? `<span class="badge-tipo badge-vencido ms-1">Vencido</span>`
                          : days <= 3
                          ? `<span class="badge-tipo badge-pendiente ms-1">${days}d</span>`
                          : `<small class="text-muted ms-1">${fmtShortDate(r.limitePago)}</small>`;
                        return `<tr>
                          <td><span class="bank-chip ${bankClass(r.entidad)}">${r.entidad}</span>${badge}</td>
                          <td>${fmtShortDate(r.limitePago)}</td>
                          <td class="text-end fw-bold">${currency(r.aPagar)}</td>
                        </tr>`;
                      }).join('')}
                    </tbody>
                  </table>`
              }
            </div>
          </div>
        </div>

        <!-- MSI activos -->
        <div class="col-lg-6">
          <div class="data-card">
            <div class="data-card-header">
              <span><i class="bi bi-calendar-range me-2"></i>MSI Activos</span>
              <a href="#/msi" class="text-white" style="font-size:0.8rem">Ver todo →</a>
            </div>
            <div class="data-card-body" style="max-height:320px;overflow-y:auto">
              ${msiActivos.length === 0
                ? `<div class="empty-state" style="padding:32px 0"><i class="bi bi-calendar-x"></i><p>Sin compras MSI activas</p></div>`
                : msiActivos.slice(0,6).map(m => {
                    const pct = Math.round((Number(m.mesesPagados) / Number(m.mesesTotal)) * 100);
                    return `<div class="msi-item">
                      <div class="msi-item-info">
                        <div class="msi-item-name">${m.compra}</div>
                        <div class="progress mt-1" style="width:100%">
                          <div class="progress-bar bg-primary" style="width:${pct}%"></div>
                        </div>
                        <div class="msi-item-dates mt-1">${m.mesesPagados}/${m.mesesTotal} meses · Termina ${fmtShortDate(m.ultimoPago)}</div>
                      </div>
                      <div class="msi-item-amount">
                        <div class="msi-item-monthly">${currency(m.mensualidad)}</div>
                        <div class="msi-item-remaining">Restante ${currency(m.restante)}</div>
                      </div>
                    </div>`;
                  }).join('')
              }
            </div>
          </div>
        </div>
      </div>`;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error al cargar el dashboard: ${e.message}</div>`;
  }
}
