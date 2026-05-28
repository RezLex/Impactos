import { getAll, create, update, remove } from '../utils/db.js';
import { currency, fmtDate } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import { calcularMes, toISODate, anteriorNomina } from '../utils/ciclo.js';

const FORMA_PAGO = { automatico: 'Automático', retiro: 'Retiro', transferencia: 'Transferencia' };

export async function render(container) {
  await renderView(container);
}

async function renderView(container) {
  try {
    const [contadoItems, msiItems, instituciones, tarjetas, festivosMX, gastosItems, gastosFijosItems] = await Promise.all([
      getAll('contado'),
      getAll('msi'),
      getAll('instituciones'),
      getAll('tarjetas'),
      getAll('festivosMX'),
      getAll('gastos'),
      getAll('gastosFijos'),
    ]);

    const instMap = Object.fromEntries(instituciones.map(i => [i.id, i]));
    const cardMap = Object.fromEntries(tarjetas.map(t => [t.id, { ...t, inst: instMap[t.institucionId] }]));

    let tabActivo = 'contado';
    let filtroMsi = 'curso';

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Compras y Gastos</h2>
          <p id="compras-subtitle"></p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-nueva-compra">
          <i class="bi bi-plus-lg me-1"></i><span id="btn-nueva-label">Nueva Compra</span>
        </button>
      </div>
      <ul class="nav nav-tabs mb-3" id="compras-tabs">
        <li class="nav-item">
          <button class="nav-link active" data-tab="contado">De Contado</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" data-tab="plazos">A Plazos</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" data-tab="gastos">Gastos</button>
        </li>
      </ul>
      <div id="compras-tab-content"></div>`;

    // ── De Contado ──────────────────────────────────────────────────────────────

    const renderContado = () => {
      const byInst = {};
      contadoItems.forEach(c => {
        const card   = cardMap[c.tarjetaId];
        const instId = card?.institucionId || '__sin_inst__';
        if (!byInst[instId]) byInst[instId] = { inst: instMap[instId] || null, items: [] };
        byInst[instId].items.push(c);
      });

      const totalCompras = contadoItems.reduce((s, c) => s + (Number(c.total) || 0), 0);
      const groups       = Object.values(byInst)
        .filter(g => g.items.length > 0)
        .sort((a, b) => (a.inst?.nombre || '').localeCompare(b.inst?.nombre || '', 'es'));

      const subtitle = document.getElementById('compras-subtitle');
      if (subtitle) subtitle.textContent =
        `${contadoItems.length} compra${contadoItems.length !== 1 ? 's' : ''} de contado`;

      document.getElementById('compras-tab-content').innerHTML = `
        <div class="row g-3 mb-4">
          <div class="col-6">
            <div class="metric-card">
              <div class="metric-icon" style="background:#e8f5e9">
                <i class="bi bi-cash-stack" style="color:#2e7d32"></i>
              </div>
              <div class="metric-info">
                <div class="metric-value">${currency(totalCompras)}</div>
                <div class="metric-label">Total de compras</div>
              </div>
            </div>
          </div>
          <div class="col-6">
            <div class="metric-card">
              <div class="metric-icon" style="background:#f3e5f5">
                <i class="bi bi-receipt" style="color:#6a1b9a"></i>
              </div>
              <div class="metric-info">
                <div class="metric-value">${contadoItems.length}</div>
                <div class="metric-label">Compras registradas</div>
              </div>
            </div>
          </div>
        </div>
        ${groups.length === 0
          ? `<div class="empty-state"><i class="bi bi-bag"></i><p>Sin compras de contado registradas</p></div>`
          : `<div class="accordion" id="contado-accordion">
              ${groups.map((g, idx) => renderGroupContado(g, idx, cardMap, festivosMX)).join('')}
            </div>`
        }`;

      const content = document.getElementById('compras-tab-content');

      content.querySelectorAll('.btn-edit-contado').forEach(btn =>
        btn.addEventListener('click', e => {
          e.stopPropagation();
          showModalContado(
            contadoItems.find(c => c.id === btn.dataset.id),
            instituciones, tarjetas,
            () => renderView(container)
          );
        }));

      content.querySelectorAll('.btn-del-contado').forEach(btn =>
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const c = contadoItems.find(x => x.id === btn.dataset.id);
          if (!confirmDelete(c.compra)) return;
          await remove('contado', c.id);
          contadoItems.splice(contadoItems.findIndex(x => x.id === c.id), 1);
          toast('Compra eliminada');
          renderContado();
        }));
    };

    // ── A Plazos ────────────────────────────────────────────────────────────────

    const renderPlazos = (filtro) => {
      const filtered = msiItems.filter(m => {
        if (filtro === 'curso')      return !m.liquidado;
        if (filtro === 'liquidados') return !!m.liquidado;
        return true;
      });

      const byInst = {};
      filtered.forEach(m => {
        const card   = cardMap[m.tarjetaId];
        const instId = card?.institucionId || '__sin_inst__';
        if (!byInst[instId]) byInst[instId] = { inst: instMap[instId] || null, items: [] };
        byInst[instId].items.push(m);
      });

      const mostrarTotal     = filtro !== 'curso';
      const deudaTotal       = filtered.reduce((s, m) => s + (Number(m.restante) || 0), 0);
      const mensualidadTotal = filtered.reduce((s, m) => s + (Number(m.mensualidad) || 0), 0);
      const totalCompras     = filtered.reduce((s, m) => s + (Number(m.total) || 0), 0);
      const groups           = Object.values(byInst)
        .filter(g => g.items.length > 0)
        .sort((a, b) => (a.inst?.nombre || '').localeCompare(b.inst?.nombre || '', 'es'));

      const subtitle = document.getElementById('compras-subtitle');
      if (subtitle) {
        const label = filtro === 'curso' ? 'en curso' : filtro === 'liquidados' ? 'liquidadas' : 'en total';
        subtitle.textContent = `${filtered.length} compra${filtered.length !== 1 ? 's' : ''} a plazos ${label}`;
      }

      const emptyMsg = filtro === 'liquidados' ? 'Sin compras a plazos liquidadas'
        : filtro === 'curso' ? 'Sin compras a plazos en curso'
        : 'Sin compras a plazos registradas';

      const metricsHtml = mostrarTotal ? `
        <div class="col-6">
          <div class="metric-card">
            <div class="metric-icon" style="background:#e8f5e9">
              <i class="bi bi-cash-stack" style="color:#2e7d32"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(totalCompras)}</div>
              <div class="metric-label">Total de compras</div>
            </div>
          </div>
        </div>
        <div class="col-6">
          <div class="metric-card">
            <div class="metric-icon" style="background:#f3e5f5">
              <i class="bi bi-receipt" style="color:#6a1b9a"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${filtered.length}</div>
              <div class="metric-label">${filtro === 'liquidados' ? 'Compras liquidadas' : 'Compras registradas'}</div>
            </div>
          </div>
        </div>` : `
        <div class="col-6">
          <div class="metric-card">
            <div class="metric-icon" style="background:#ffebee">
              <i class="bi bi-credit-card-fill" style="color:#c62828"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(deudaTotal)}</div>
              <div class="metric-label">Deuda total restante</div>
            </div>
          </div>
        </div>
        <div class="col-6">
          <div class="metric-card">
            <div class="metric-icon" style="background:#e3f2fd">
              <i class="bi bi-calendar-check" style="color:#1565c0"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(mensualidadTotal)}</div>
              <div class="metric-label">Mensualidad combinada</div>
            </div>
          </div>
        </div>`;

      document.getElementById('compras-tab-content').innerHTML = `
        <div class="filter-bar">
          <div class="filter-chips" id="filtro-msi">
            <button class="filter-chip ${filtro === 'curso'      ? 'active' : ''}" data-filtro="curso">En curso</button>
            <button class="filter-chip ${filtro === 'liquidados' ? 'active' : ''}" data-filtro="liquidados">Liquidados</button>
            <button class="filter-chip ${filtro === 'todos'      ? 'active' : ''}" data-filtro="todos">Todos</button>
          </div>
        </div>
        <div class="row g-3 mb-4">${metricsHtml}</div>
        ${groups.length === 0
          ? `<div class="empty-state"><i class="bi bi-calendar-x"></i><p>${emptyMsg}</p></div>`
          : `<div class="accordion" id="msi-accordion">
              ${groups.map((g, idx) => renderGroupMsi(g, idx, cardMap, festivosMX, filtro)).join('')}
            </div>`
        }`;

      const content = document.getElementById('compras-tab-content');

      content.querySelectorAll('#filtro-msi [data-filtro]').forEach(btn =>
        btn.addEventListener('click', () => {
          filtroMsi = btn.dataset.filtro;
          renderPlazos(filtroMsi);
        }));

      content.querySelectorAll('.btn-edit-msi').forEach(btn =>
        btn.addEventListener('click', e => {
          e.stopPropagation();
          showModalMsi(
            msiItems.find(m => m.id === btn.dataset.id),
            instituciones, tarjetas,
            () => renderView(container)
          );
        }));

      content.querySelectorAll('.btn-del-msi').forEach(btn =>
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const m = msiItems.find(x => x.id === btn.dataset.id);
          if (!confirmDelete(m.compra)) return;
          await remove('msi', m.id);
          msiItems.splice(msiItems.findIndex(x => x.id === m.id), 1);
          toast('Compra eliminada');
          renderPlazos(filtroMsi);
        }));

      content.querySelectorAll('.btn-liquidar-msi').forEach(btn =>
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const m = msiItems.find(x => x.id === btn.dataset.id);
          if (!m) return;
          if (!confirm(`¿Liquidar "${m.compra}"?\n\nSe marcará como pagada en su totalidad.`)) return;
          const fechaLiquidacion = toISODate(new Date());
          await update('msi', m.id, { liquidado: true, mesesPagados: m.mesesTotal, restante: 0, fechaLiquidacion });
          Object.assign(m, { liquidado: true, mesesPagados: m.mesesTotal, restante: 0, fechaLiquidacion });
          toast('Compra liquidada');
          renderPlazos(filtroMsi);
        }));
    };

    // ── Tab switching ───────────────────────────────────────────────────────────

    const renderTab = (tab) => {
      document.querySelectorAll('#compras-tabs .nav-link').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === tab));
      const labels = { contado: 'Nueva Compra', plazos: 'Nueva Compra MSI', gastos: 'Nuevo Gasto' };
      document.getElementById('btn-nueva-label').textContent = labels[tab] || 'Nueva Compra';
      if (tab === 'contado')     renderContado();
      else if (tab === 'plazos') renderPlazos(filtroMsi);
      else                       renderGastos();
    };

    document.getElementById('compras-tabs').addEventListener('click', e => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      tabActivo = btn.dataset.tab;
      renderTab(tabActivo);
    });

    document.getElementById('btn-nueva-compra').addEventListener('click', () => {
      if (tabActivo === 'contado')
        showModalContado(null, instituciones, tarjetas, () => renderView(container));
      else if (tabActivo === 'plazos')
        showModalMsi(null, instituciones, tarjetas, () => renderView(container));
      else
        showModalNuevoGasto(null, instituciones, tarjetas, () => renderView(container));
    });

    // ── Gastos ──────────────────────────────────────────────────────────────────

    const renderGastos = () => {
      const now   = new Date();
      const year  = now.getFullYear();
      const month = now.getMonth();
      const mesActual = toISODate(now).slice(0, 7);
      const hoy       = toISODate(now);

      const confirmedSet = new Set(
        gastosItems.filter(g => g.mes === mesActual && g.gastaFijoId).map(g => g.gastaFijoId)
      );

      const fijosPendientes = [];
      gastosFijosItems.forEach(gasto => {
        if (confirmedSet.has(gasto.id)) return;
        const card = cardMap[gasto.tarjetaId];
        if (!card || card.tipo !== 'credito') return;
        const fecha = calcularFechaGastoMes(gasto, year, month, festivosMX);
        if (!fecha) return;
        const fechaISO = toISODate(fecha);
        if (!fechaISO.startsWith(mesActual)) return;
        fijosPendientes.push({ gasto, card, fecha: fechaISO });
      });
      fijosPendientes.sort((a, b) => a.fecha.localeCompare(b.fecha));

      const registrados = [...gastosItems]
        .filter(g => g.mes === mesActual)
        .sort((a, b) => (a.fechaPago || '').localeCompare(b.fechaPago || ''));

      const totalRegistrado = registrados.reduce((s, g) => s + (Number(g.importe) || 0), 0);

      const mesLabel = now.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
      const subtitle = document.getElementById('compras-subtitle');
      if (subtitle) subtitle.textContent = `Gastos de ${mesLabel}`;

      const lastFourOf = (g, tc) => g.numeroTarjeta
        ? String(g.numeroTarjeta).replace(/\s/g, '').slice(-4)
        : (() => {
            const nums = Array.isArray(tc?.numeros) ? tc.numeros : [];
            const n = nums.find(x => x.formato === 'fisica' && x.numero) || nums.find(x => x.numero);
            return n ? String(n.numero).replace(/\s/g, '').slice(-4) : '';
          })();

      document.getElementById('compras-tab-content').innerHTML = `
        <div class="row g-3 mb-4">
          <div class="col-6">
            <div class="metric-card">
              <div class="metric-icon" style="background:#fff3e0">
                <i class="bi bi-cash" style="color:#e65100"></i>
              </div>
              <div class="metric-info">
                <div class="metric-value">${currency(totalRegistrado)}</div>
                <div class="metric-label">Total del mes</div>
              </div>
            </div>
          </div>
          <div class="col-6">
            <div class="metric-card">
              <div class="metric-icon" style="background:#e8eaf6">
                <i class="bi bi-list-check" style="color:#3949ab"></i>
              </div>
              <div class="metric-info">
                <div class="metric-value">${registrados.length}</div>
                <div class="metric-label">Gastos registrados</div>
              </div>
            </div>
          </div>
        </div>

        ${fijosPendientes.length > 0 ? `
        <p class="text-muted fw-semibold mb-2" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:.05em">
          <i class="bi bi-hourglass-split me-1 text-warning"></i>Gastos Fijos — Pendientes de confirmar
        </p>
        <div class="list-group mb-4" id="gastos-pendientes">
          ${fijosPendientes.map(({ gasto, card, fecha }) => {
            const lf = lastFourOf(gasto, card);
            const vencido = fecha <= hoy;
            return `
              <div class="list-group-item d-flex align-items-center gap-3 py-2">
                <div class="flex-grow-1">
                  <div class="fw-500">${gasto.nombre}</div>
                  <small class="text-muted">${card.nombre}${lf ? ' ···' + lf : ''} · ${FORMA_PAGO[gasto.formaPago] || '—'}</small>
                </div>
                <div class="text-center" style="min-width:76px">
                  <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:.04em;color:#aaa">Cobro</div>
                  <div class="${vencido ? 'text-danger fw-bold' : 'text-muted'}" style="font-size:0.82rem">${fmtDate(fecha)}</div>
                </div>
                <div class="fw-bold text-end" style="min-width:80px">${currency(gasto.importe)}</div>
                <button class="btn btn-sm btn-outline-primary btn-confirmar-gasto" data-id="${gasto.id}" style="white-space:nowrap">
                  <i class="bi bi-check-lg me-1"></i>Confirmar
                </button>
              </div>`;
          }).join('')}
        </div>` : ''}

        <p class="text-muted fw-semibold mb-2" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:.05em">
          <i class="bi bi-receipt me-1"></i>Gastos registrados
        </p>
        ${registrados.length === 0
          ? `<div class="empty-state"><i class="bi bi-cash-stack"></i><p>Sin gastos registrados este mes</p></div>`
          : `<div class="table-wrapper">
              <table class="table">
                <thead><tr>
                  <th>Nombre</th><th>Tarjeta</th><th>Forma de Pago</th>
                  <th>Fecha Pago</th><th class="text-end">Importe</th><th></th>
                </tr></thead>
                <tbody>
                  ${registrados.map(g => {
                    const tc = cardMap[g.tarjetaId];
                    const lf = lastFourOf(g, tc);
                    return `<tr>
                      <td>
                        <div class="fw-500">${g.nombre}</div>
                        ${g.gastaFijoId ? `<small class="text-muted"><i class="bi bi-arrow-repeat me-1"></i>Gasto fijo</small>` : ''}
                      </td>
                      <td style="white-space:nowrap">${tc?.nombre || '—'}${lf ? ' ···' + lf : ''}</td>
                      <td>${FORMA_PAGO[g.formaPago] || '—'}</td>
                      <td style="white-space:nowrap">${g.fechaPago ? fmtDate(g.fechaPago) : '—'}</td>
                      <td class="text-end fw-bold">${currency(g.importe)}</td>
                      <td>
                        <div class="d-flex gap-1">
                          <button class="btn-icon btn-edit-gasto" data-id="${g.id}"><i class="bi bi-pencil"></i></button>
                          <button class="btn-icon danger btn-del-gasto" data-id="${g.id}"><i class="bi bi-trash3"></i></button>
                        </div>
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>`
        }`;

      const content = document.getElementById('compras-tab-content');

      content.querySelectorAll('.btn-confirmar-gasto').forEach(btn =>
        btn.addEventListener('click', () => {
          const gasto = gastosFijosItems.find(g => g.id === btn.dataset.id);
          if (!gasto) return;
          const fecha = calcularFechaGastoMes(gasto, year, month, festivosMX);
          showModalConfirmarGasto(gasto, fecha, mesActual, instituciones, tarjetas, () => renderView(container));
        }));

      content.querySelectorAll('.btn-edit-gasto').forEach(btn =>
        btn.addEventListener('click', () => {
          const g = gastosItems.find(x => x.id === btn.dataset.id);
          showModalNuevoGasto(g, instituciones, tarjetas, () => renderView(container));
        }));

      content.querySelectorAll('.btn-del-gasto').forEach(btn =>
        btn.addEventListener('click', async () => {
          const g = gastosItems.find(x => x.id === btn.dataset.id);
          if (!g || !confirmDelete(g.nombre)) return;
          await remove('gastos', g.id);
          gastosItems.splice(gastosItems.findIndex(x => x.id === g.id), 1);
          toast('Gasto eliminado');
          renderGastos();
        }));
    };

    renderTab(tabActivo);
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

// ── Render helpers ──────────────────────────────────────────────────────────────

function renderGroupContado({ inst, items }, idx, cardMap, festivosMX) {
  const label      = inst?.nombre || 'Sin institución';
  const color      = inst?.color  || '#607d8b';
  const totalGrupo = items.reduce((s, c) => s + (Number(c.total) || 0), 0);

  return `
    <div class="accordion-item mb-2">
      <h2 class="accordion-header">
        <button class="accordion-button" type="button"
                data-bs-toggle="collapse" data-bs-target="#acc-c-${idx}">
          <span style="width:10px;height:10px;border-radius:50%;background:${color};margin-right:10px;flex-shrink:0"></span>
          <span class="flex-grow-1">${label}</span>
          <span class="ms-auto me-3" style="font-size:0.8rem;color:#888">
            Total: <strong>${currency(totalGrupo)}</strong>
          </span>
        </button>
      </h2>
      <div id="acc-c-${idx}" class="accordion-collapse collapse show">
        <div class="accordion-body p-0">
          <div class="table-wrapper">
            <table class="table">
              <thead><tr>
                <th>Compra</th><th>Tarjeta</th><th>Fecha Compra</th><th>Fecha Pago</th>
                <th class="text-end">Total</th><th></th>
              </tr></thead>
              <tbody>
                ${[...items]
                  .sort((a, b) => (b.fechaCompra || '').localeCompare(a.fechaCompra || ''))
                  .map(c => {
                    const tc = cardMap[c.tarjetaId];
                    const lastFour = c.numeroTarjeta
                      ? String(c.numeroTarjeta).replace(/\s/g, '').slice(-4)
                      : (() => {
                          const nums = Array.isArray(tc?.numeros) ? tc.numeros : [];
                          const n = nums.find(x => x.formato === 'fisica' && x.numero) || nums.find(x => x.numero);
                          return n ? String(n.numero).replace(/\s/g, '').slice(-4) : '';
                        })();

                    let limitePagoDisplay = '—';
                    let nominaPagoDisplay = null;
                    if (tc?.tipo === 'credito' && tc?.ciclo && c.fechaCompra) {
                      const compra = new Date(c.fechaCompra + 'T12:00:00');
                      let year = compra.getFullYear(), month = compra.getMonth();
                      let p = calcularMes(tc.ciclo, year, month, festivosMX);
                      if (p.fechaCorte < compra) {
                        const next = new Date(year, month + 1, 1);
                        p = calcularMes(tc.ciclo, next.getFullYear(), next.getMonth(), festivosMX);
                      }
                      if (p.fechaPago) {
                        limitePagoDisplay = fmtDate(toISODate(p.fechaPago));
                        const nom = anteriorNomina(p.fechaPago, festivosMX);
                        if (nom) nominaPagoDisplay = fmtDate(toISODate(nom));
                      }
                    }

                    return `<tr>
                      <td>
                        <div class="fw-500">
                          ${c.compra}
                          ${c.enlaceCompra ? `<a href="${c.enlaceCompra}" target="_blank" rel="noopener" class="ms-1 text-muted" title="Abrir enlace"><i class="bi bi-box-arrow-up-right" style="font-size:0.72rem"></i></a>` : ''}
                        </div>
                      </td>
                      <td style="white-space:nowrap">${tc?.nombre || '—'}${lastFour ? ' ···' + lastFour : ''}</td>
                      <td style="white-space:nowrap">${c.fechaCompra ? fmtDate(c.fechaCompra) : '—'}</td>
                      <td style="white-space:nowrap">
                        ${nominaPagoDisplay ? `<span><i class="bi bi-wallet2 me-1 text-muted" style="font-size:0.75rem"></i>${nominaPagoDisplay}</span><br>` : ''}
                        ${limitePagoDisplay !== '—' ? `<small class="text-muted"><i class="bi bi-credit-card me-1" style="font-size:0.7rem"></i>${limitePagoDisplay}</small>` : '—'}
                      </td>
                      <td class="text-end fw-bold">${currency(c.total)}</td>
                      <td>
                        <div class="d-flex gap-1">
                          <button class="btn-icon btn-edit-contado" data-id="${c.id}"><i class="bi bi-pencil"></i></button>
                          <button class="btn-icon danger btn-del-contado" data-id="${c.id}"><i class="bi bi-trash3"></i></button>
                        </div>
                      </td>
                    </tr>`;
                  }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function calcularPagos(ciclo, fechaCompra, mesesTotal, festivosMX) {
  if (!ciclo || !fechaCompra || !mesesTotal) return { primerPago: null, ultimoPago: null };

  const compra = new Date(fechaCompra + 'T12:00:00');
  let year  = compra.getFullYear();
  let month = compra.getMonth();
  let periodo = calcularMes(ciclo, year, month, festivosMX);

  if (periodo.fechaCorte < compra) {
    const next = new Date(year, month + 1, 1);
    year   = next.getFullYear();
    month  = next.getMonth();
    periodo = calcularMes(ciclo, year, month, festivosMX);
  }

  if (!periodo.fechaPago) return { primerPago: null, ultimoPago: null };

  const primerPago  = periodo.fechaPago;
  const lastDate    = new Date(year, month + (mesesTotal - 1), 1);
  const lastPeriodo = calcularMes(ciclo, lastDate.getFullYear(), lastDate.getMonth(), festivosMX);

  return { primerPago, ultimoPago: lastPeriodo.fechaPago };
}

function renderGroupMsi({ inst, items }, idx, cardMap, festivosMX, filtro) {
  const label        = inst?.nombre || 'Sin institución';
  const color        = inst?.color  || '#607d8b';
  const mostrarTotal = filtro !== 'curso';
  const deuda        = items.reduce((s, m) => s + (Number(m.restante) || 0), 0);
  const mens         = items.reduce((s, m) => s + (Number(m.mensualidad) || 0), 0);
  const totalGrupo   = items.reduce((s, m) => s + (Number(m.total) || 0), 0);

  const headerStats = mostrarTotal
    ? `<span>Total: <strong>${currency(totalGrupo)}</strong></span>`
    : `<span>Deuda: <strong>${currency(deuda)}</strong></span>
       <span class="d-none d-sm-inline">Mensualidad: <strong>${currency(mens)}</strong></span>`;

  const thUltimo   = filtro === 'liquidados' ? 'Liquidado' : 'Último Pago';
  const thRestante = mostrarTotal ? 'Total' : 'Restante';

  return `
    <div class="accordion-item mb-2">
      <h2 class="accordion-header">
        <button class="accordion-button" type="button"
                data-bs-toggle="collapse" data-bs-target="#acc-m-${idx}">
          <span style="width:10px;height:10px;border-radius:50%;background:${color};margin-right:10px;flex-shrink:0"></span>
          <span class="flex-grow-1">${label}</span>
          <span class="ms-auto me-3 d-flex gap-3" style="font-size:0.8rem;color:#888">
            ${headerStats}
          </span>
        </button>
      </h2>
      <div id="acc-m-${idx}" class="accordion-collapse collapse show">
        <div class="accordion-body p-0">
          <div class="table-wrapper">
            <table class="table">
              <thead><tr>
                <th>Compra</th><th>Tarjeta</th><th class="text-center">Meses</th>
                <th class="text-end">Mensualidad</th>
                <th class="text-end">${thRestante}</th>
                <th>Primer Pago</th>
                <th>${thUltimo}</th>
                <th></th>
              </tr></thead>
              <tbody>
                ${[...items]
                  .sort((a, b) => {
                    const pa = (Number(a.mesesPagados) || 0) / (Number(a.mesesTotal) || 1);
                    const pb = (Number(b.mesesPagados) || 0) / (Number(b.mesesTotal) || 1);
                    return pa !== pb ? pb - pa : a.compra.localeCompare(b.compra, 'es');
                  })
                  .map(m => {
                    const tc = cardMap[m.tarjetaId];
                    const { primerPago, ultimoPago } = calcularPagos(
                      tc?.ciclo, m.fechaCompra, Number(m.mesesTotal) || 0, festivosMX
                    );
                    const nomPrimero = primerPago ? anteriorNomina(primerPago, festivosMX) : null;
                    const nomUltimo  = ultimoPago  ? anteriorNomina(ultimoPago,  festivosMX) : null;

                    const lastFour = m.numeroTarjeta
                      ? String(m.numeroTarjeta).replace(/\s/g, '').slice(-4)
                      : (() => {
                          const nums = Array.isArray(tc?.numeros) ? tc.numeros : [];
                          const n = nums.find(x => x.formato === 'fisica' && x.numero) || nums.find(x => x.numero);
                          return n ? String(n.numero).replace(/\s/g, '').slice(-4) : '';
                        })();

                    const done = m.liquidado || Number(m.restante) <= 0;
                    const pct  = m.liquidado ? 100
                      : Math.round((Number(m.mesesPagados) || 0) / (Number(m.mesesTotal) || 1) * 100);

                    const restanteVal = mostrarTotal
                      ? currency(m.total)
                      : (m.liquidado ? '✓ Liquidado' : done ? '✓ Pagado' : currency(m.restante));
                    const restanteCls = mostrarTotal ? '' : done ? 'text-success' : 'fw-bold';

                    const isLiquidado = (filtro === 'liquidados' || m.liquidado) && m.fechaLiquidacion;

                    const primerPagoCell = nomPrimero
                      ? `<span><i class="bi bi-wallet2 me-1 text-muted" style="font-size:0.75rem"></i>${fmtDate(toISODate(nomPrimero))}</span><br>
                         <small class="text-muted"><i class="bi bi-credit-card me-1" style="font-size:0.7rem"></i>${fmtDate(toISODate(primerPago))}</small>`
                      : '—';

                    const ultimoPagoCell = isLiquidado
                      ? fmtDate(m.fechaLiquidacion)
                      : nomUltimo
                        ? `<span><i class="bi bi-wallet2 me-1 text-muted" style="font-size:0.75rem"></i>${fmtDate(toISODate(nomUltimo))}</span><br>
                           <small class="text-muted"><i class="bi bi-credit-card me-1" style="font-size:0.7rem"></i>${fmtDate(toISODate(ultimoPago))}</small>`
                        : '—';

                    return `<tr class="${done ? 'table-success' : ''}">
                      <td>
                        <div class="fw-500">
                          ${m.compra}
                          ${m.enlaceCompra ? `<a href="${m.enlaceCompra}" target="_blank" rel="noopener" class="ms-1 text-muted" title="Abrir enlace"><i class="bi bi-box-arrow-up-right" style="font-size:0.72rem"></i></a>` : ''}
                        </div>
                        <div class="progress mt-1" style="width:120px">
                          <div class="progress-bar ${done ? 'bg-success' : 'bg-primary'}" style="width:${pct}%"></div>
                        </div>
                      </td>
                      <td style="white-space:nowrap">${tc?.nombre || '—'}${lastFour ? ' ···' + lastFour : ''}</td>
                      <td class="text-center">${m.mesesPagados || 0}/${m.mesesTotal || 0}</td>
                      <td class="text-end">${currency(m.mensualidad)}</td>
                      <td class="text-end ${restanteCls}">${restanteVal}</td>
                      <td style="white-space:nowrap">${primerPagoCell}</td>
                      <td style="white-space:nowrap">${ultimoPagoCell}</td>
                      <td>
                        <div class="d-flex gap-1">
                          ${!m.liquidado ? `<button class="btn-icon btn-liquidar-msi" data-id="${m.id}" title="Liquidar"><i class="bi bi-check-circle"></i></button>` : ''}
                          <button class="btn-icon btn-edit-msi" data-id="${m.id}"><i class="bi bi-pencil"></i></button>
                          <button class="btn-icon danger btn-del-msi" data-id="${m.id}"><i class="bi bi-trash3"></i></button>
                        </div>
                      </td>
                    </tr>`;
                  }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

// ── Card select options (shared) ────────────────────────────────────────────────

function buildCardOptions(item, instituciones, tarjetas, soloCredito = false) {
  const instMap = Object.fromEntries(instituciones.map(i => [i.id, i]));
  const lista   = soloCredito ? tarjetas.filter(t => t.tipo === 'credito') : tarjetas;
  const byInst  = {};
  lista.forEach(t => {
    const id = t.institucionId || '__';
    if (!byInst[id]) byInst[id] = { inst: instMap[id] || null, cards: [] };
    byInst[id].cards.push(t);
  });
  return Object.values(byInst)
    .sort((a, b) => (a.inst?.nombre || '').localeCompare(b.inst?.nombre || '', 'es'))
    .map(({ inst, cards }) => {
      const opts = cards
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
        .flatMap(t => {
          const numeros   = Array.isArray(t.numeros) ? t.numeros : [];
          const fisicas   = numeros.filter(n => n.formato === 'fisica'  && n.numero);
          const digitales = numeros.filter(n => n.formato === 'digital' && n.numero);
          const all = [...fisicas, ...digitales];
          if (!all.length) {
            const sel = item?.tarjetaId === t.id && !item?.numeroTarjeta ? 'selected' : '';
            return [`<option value="${t.id}::" ${sel}>${t.nombre}</option>`];
          }
          return all.map(n => {
            const last4 = String(n.numero).replace(/\s/g, '').slice(-4);
            const tipo  = n.formato === 'fisica' ? 'Física' : 'Digital';
            const sel   = item?.tarjetaId === t.id && item?.numeroTarjeta === n.numero ? 'selected' : '';
            return `<option value="${t.id}::${n.numero}" ${sel}>${t.nombre} ···${last4} (${tipo})</option>`;
          });
        })
        .join('');
      return `<optgroup label="${inst?.nombre || 'Sin institución'}">${opts}</optgroup>`;
    })
    .join('');
}

// ── Modal De Contado ────────────────────────────────────────────────────────────

function showModalContado(compra, instituciones, tarjetas, onSaved) {
  const isEdit = !!compra;

  openModal({
    title: isEdit ? 'Editar Compra' : 'Nueva Compra de Contado',
    size: 'lg',
    body: `
      <form id="contado-form">
        <div class="row g-3">
          <div class="col-12">
            <label class="form-label">Descripción *</label>
            <input type="text" class="form-control" name="compra" value="${compra?.compra || ''}" required placeholder="Ej: Amazon — Auriculares">
          </div>
          <div class="col-md-6">
            <label class="form-label">Tarjeta *</label>
            <select class="form-select" name="tarjetaId" required>
              <option value="">— Seleccionar —</option>
              ${buildCardOptions(compra, instituciones, tarjetas, false)}
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Fecha de compra *</label>
            <input type="date" class="form-control" name="fechaCompra" value="${compra?.fechaCompra || ''}" required>
          </div>
          <div class="col-12">
            <label class="form-label">Total *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="total" value="${compra?.total || ''}" required min="0" step="0.01">
            </div>
          </div>
          <div class="col-12">
            <label class="form-label">Enlace de la compra</label>
            <input type="url" class="form-control" name="enlaceCompra" value="${compra?.enlaceCompra || ''}" placeholder="https://...">
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-contado">${isEdit ? 'Guardar' : 'Crear'}</button>`
  });

  document.getElementById('btn-save-contado').addEventListener('click', async () => {
    const form = document.getElementById('contado-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    const [tarjetaId, numeroTarjeta] = (data.tarjetaId || '').split('::');
    data.tarjetaId     = tarjetaId;
    data.numeroTarjeta = numeroTarjeta || '';
    data.total         = Number(data.total);
    if (!data.enlaceCompra) delete data.enlaceCompra;
    try {
      if (isEdit) await update('contado', compra.id, data);
      else        await create('contado', data);
      closeModal();
      toast(isEdit ? 'Compra actualizada' : 'Compra creada');
      onSaved();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

// ── Modal A Plazos ─────────────────────────────────────────────────────────────

function showModalMsi(msi, instituciones, tarjetas, onSaved) {
  const isEdit = !!msi;

  openModal({
    title: isEdit ? 'Editar Compra MSI' : 'Nueva Compra MSI',
    size: 'lg',
    body: `
      <form id="msi-form">
        <div class="row g-3">
          <div class="col-12">
            <label class="form-label">Descripción *</label>
            <input type="text" class="form-control" name="compra" value="${msi?.compra || ''}" required placeholder="Ej: Amazon — Teclado">
          </div>
          <div class="col-md-6">
            <label class="form-label">Tarjeta *</label>
            <select class="form-select" name="tarjetaId" required>
              <option value="">— Seleccionar —</option>
              ${buildCardOptions(msi, instituciones, tarjetas, true)}
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Fecha de compra *</label>
            <input type="date" class="form-control" name="fechaCompra" value="${msi?.fechaCompra || ''}" required>
          </div>
          <div class="col-md-6">
            <label class="form-label">Total de la compra *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="total" value="${msi?.total || ''}" required min="0" step="0.01">
            </div>
          </div>
          <div class="col-md-3">
            <label class="form-label">Meses totales *</label>
            <input type="number" class="form-control" name="mesesTotal" value="${msi?.mesesTotal || ''}" required min="1" max="48">
          </div>
          <div class="col-md-3">
            <label class="form-label">Meses pagados</label>
            <input type="number" class="form-control" name="mesesPagados" value="${msi?.mesesPagados || 0}" min="0">
          </div>
          <div class="col-md-6">
            <label class="form-label">Mensualidad *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="mensualidad" value="${msi?.mensualidad || ''}" required min="0" step="0.01">
            </div>
          </div>
          <div class="col-12">
            <label class="form-label">Enlace de la compra</label>
            <input type="url" class="form-control" name="enlaceCompra" value="${msi?.enlaceCompra || ''}" placeholder="https://...">
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-msi">${isEdit ? 'Guardar' : 'Crear'}</button>`
  });

  ['total', 'mesesTotal'].forEach(name => {
    document.querySelector(`[name="${name}"]`).addEventListener('input', () => {
      const total = Number(document.querySelector('[name=total]').value);
      const meses = Number(document.querySelector('[name=mesesTotal]').value);
      if (total > 0 && meses > 0)
        document.querySelector('[name=mensualidad]').value = (total / meses).toFixed(2);
    });
  });

  document.getElementById('btn-save-msi').addEventListener('click', async () => {
    const form = document.getElementById('msi-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    const [tarjetaId, numeroTarjeta] = (data.tarjetaId || '').split('::');
    data.tarjetaId     = tarjetaId;
    data.numeroTarjeta = numeroTarjeta || '';
    data.total         = Number(data.total);
    data.mensualidad   = Number(data.mensualidad);
    data.mesesTotal    = Number(data.mesesTotal);
    data.mesesPagados  = Number(data.mesesPagados);
    data.restante      = Math.max(0, data.total - data.mensualidad * data.mesesPagados);
    if (!data.enlaceCompra) delete data.enlaceCompra;
    try {
      let savedId;
      if (isEdit) {
        await update('msi', msi.id, data);
        savedId = msi.id;
      } else {
        savedId = await create('msi', data);
      }
      closeModal();
      toast(isEdit ? 'MSI actualizado' : 'Compra MSI creada');

      const sugerirLiquidar = data.mesesPagados === data.mesesTotal && !msi?.liquidado;
      if (sugerirLiquidar) {
        setTimeout(() => {
          if (confirm(`"${data.compra}" tiene todos sus meses pagados.\n¿Marcarla como liquidada?`)) {
            const fechaLiquidacion = toISODate(new Date());
            update('msi', savedId, { liquidado: true, mesesPagados: data.mesesTotal, restante: 0, fechaLiquidacion })
              .then(() => { toast('Compra liquidada'); onSaved(); })
              .catch(err => { toast('Error: ' + err.message, 'danger'); onSaved(); });
          } else {
            onSaved();
          }
        }, 300);
      } else {
        onSaved();
      }
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

// ── Helpers de fecha para Gastos Fijos ─────────────────────────────────────────

function _sigHabil(date, festivosMX) {
  const festSet = new Set(festivosMX.map(f => f.fecha));
  const d = new Date(date);
  while (d.getDay() === 0 || d.getDay() === 6 || festSet.has(toISODate(d))) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function calcularFechaGastoMes(gasto, year, month, festivosMX) {
  if (gasto.semanaDelMes && gasto.diaSemana) {
    const jsDay = gasto.diaSemana === 7 ? 0 : gasto.diaSemana;
    if (gasto.semanaDelMes === -1) {
      const d = new Date(year, month + 1, 0);
      while (d.getDay() !== jsDay) d.setDate(d.getDate() - 1);
      return _sigHabil(d, festivosMX);
    }
    let count = 0;
    const d = new Date(year, month, 1);
    while (d.getMonth() === month) {
      if (d.getDay() === jsDay) {
        count++;
        if (count === gasto.semanaDelMes) return _sigHabil(new Date(d), festivosMX);
      }
      d.setDate(d.getDate() + 1);
    }
    return null;
  }

  if (gasto.diasIntervalo && gasto.fechaInicio) {
    const inicio     = new Date(gasto.fechaInicio + 'T12:00:00');
    const monthStart = new Date(year, month, 1);
    const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59);
    const diffDays   = Math.ceil((monthStart - inicio) / 86400000);
    const n          = Math.ceil(diffDays / gasto.diasIntervalo);
    for (let i = Math.max(0, n - 1); i <= n + 2; i++) {
      const d = new Date(inicio);
      d.setDate(d.getDate() + i * gasto.diasIntervalo);
      if (d >= monthStart && d <= monthEnd) return _sigHabil(d, festivosMX);
    }
    return null;
  }

  if (gasto.diaCobro) {
    const day = parseInt(gasto.diaCobro, 10);
    if (!isNaN(day) && day >= 1 && day <= 31) {
      const maxDay = new Date(year, month + 1, 0).getDate();
      return new Date(year, month, Math.min(day, maxDay));
    }
  }

  return null;
}

// ── Modal Confirmar Gasto Fijo ──────────────────────────────────────────────────

function showModalConfirmarGasto(gastaFijo, fechaCalculada, mes, instituciones, tarjetas, onSaved) {
  const tc = tarjetas.find(t => t.id === gastaFijo.tarjetaId);
  const lastFour = gastaFijo.numeroTarjeta
    ? String(gastaFijo.numeroTarjeta).replace(/\s/g, '').slice(-4)
    : (() => {
        const nums = Array.isArray(tc?.numeros) ? tc.numeros : [];
        const n = nums.find(x => x.formato === 'fisica' && x.numero) || nums.find(x => x.numero);
        return n ? String(n.numero).replace(/\s/g, '').slice(-4) : '';
      })();
  const fechaISO = fechaCalculada ? toISODate(fechaCalculada) : '';

  openModal({
    title: 'Confirmar Gasto Fijo',
    body: `
      <form id="confirmar-gasto-form">
        <div class="row g-3">
          <div class="col-12">
            <label class="form-label">Nombre</label>
            <input type="text" class="form-control" name="nombre" value="${gastaFijo.nombre}" required>
          </div>
          <div class="col-12">
            <label class="form-label">Tarjeta</label>
            <input type="text" class="form-control" value="${tc ? tc.nombre + (lastFour ? ' ···' + lastFour : '') : '—'}" disabled>
            <input type="hidden" name="tarjetaId"     value="${gastaFijo.tarjetaId    || ''}">
            <input type="hidden" name="numeroTarjeta" value="${gastaFijo.numeroTarjeta || ''}">
          </div>
          <div class="col-md-6">
            <label class="form-label">Forma de Pago</label>
            <select class="form-select" name="formaPago">
              <option value="automatico"    ${gastaFijo.formaPago === 'automatico'    ? 'selected' : ''}>Automático</option>
              <option value="retiro"        ${gastaFijo.formaPago === 'retiro'        ? 'selected' : ''}>Retiro</option>
              <option value="transferencia" ${gastaFijo.formaPago === 'transferencia' ? 'selected' : ''}>Transferencia</option>
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Fecha de Pago *</label>
            <input type="date" class="form-control" name="fechaPago" value="${fechaISO}" required>
          </div>
          <div class="col-12">
            <label class="form-label">Importe *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="importe" value="${gastaFijo.importe || ''}" required min="0" step="0.01">
            </div>
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-confirmar">Confirmar y Registrar</button>`
  });

  document.getElementById('btn-save-confirmar').addEventListener('click', async () => {
    const form = document.getElementById('confirmar-gasto-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    data.importe     = Number(data.importe);
    data.mes         = mes;
    data.gastaFijoId = gastaFijo.id;
    data.tipo        = 'gastaFijo';
    if (!data.numeroTarjeta) delete data.numeroTarjeta;
    try {
      await create('gastos', data);
      closeModal();
      toast('Gasto registrado');
      onSaved();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

// ── Modal Nuevo Gasto Manual ────────────────────────────────────────────────────

function showModalNuevoGasto(gasto, instituciones, tarjetas, onSaved) {
  const isEdit = !!gasto;
  const cardOpts = buildCardOptions(
    gasto ? { tarjetaId: gasto.tarjetaId, numeroTarjeta: gasto.numeroTarjeta } : null,
    instituciones,
    tarjetas.filter(t => t.tipo === 'debito'),
    false
  );

  openModal({
    title: isEdit ? 'Editar Gasto' : 'Nuevo Gasto Manual',
    body: `
      <form id="nuevo-gasto-form">
        <div class="row g-3">
          <div class="col-12">
            <label class="form-label">Nombre *</label>
            <input type="text" class="form-control" name="nombre" value="${gasto?.nombre || ''}" required placeholder="Ej: Retiro Banorte">
          </div>
          <div class="col-md-6">
            <label class="form-label">Tarjeta (débito) *</label>
            <select class="form-select" name="tarjetaId" required>
              <option value="">— Seleccionar —</option>
              ${cardOpts}
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Forma de Pago *</label>
            <select class="form-select" name="formaPago" required>
              <option value="">— Seleccionar —</option>
              <option value="retiro"        ${gasto?.formaPago === 'retiro'        ? 'selected' : ''}>Retiro</option>
              <option value="transferencia" ${gasto?.formaPago === 'transferencia' ? 'selected' : ''}>Transferencia</option>
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Fecha de Pago *</label>
            <input type="date" class="form-control" name="fechaPago" value="${gasto?.fechaPago || ''}" required>
          </div>
          <div class="col-md-6">
            <label class="form-label">Importe *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="importe" value="${gasto?.importe || ''}" required min="0" step="0.01">
            </div>
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-nuevo-gasto">${isEdit ? 'Guardar' : 'Registrar'}</button>`
  });

  document.getElementById('btn-save-nuevo-gasto').addEventListener('click', async () => {
    const form = document.getElementById('nuevo-gasto-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    const [tarjetaId, numeroTarjeta] = (data.tarjetaId || '').split('::');
    data.tarjetaId     = tarjetaId;
    data.numeroTarjeta = numeroTarjeta || '';
    data.importe       = Number(data.importe);
    data.tipo          = 'manual';
    data.mes           = gasto?.mes || toISODate(new Date()).slice(0, 7);
    if (!data.numeroTarjeta) delete data.numeroTarjeta;
    try {
      if (isEdit) await update('gastos', gasto.id, data);
      else        await create('gastos', data);
      closeModal();
      toast(isEdit ? 'Gasto actualizado' : 'Gasto registrado');
      onSaved();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
