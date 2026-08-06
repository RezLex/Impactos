import { getAll, create, update, remove, recentWhere } from '../utils/db.js';

const _hasRealTime = dt => dt?.length > 10 && !dt.includes('T12:00:00');

const _wireTimeToggle = () => {
  const todayStr = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
  };
  const nowTime = () => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
  };
  document.querySelectorAll('[data-toggle-time]').forEach(btn => {
    const input      = document.querySelector(`[name="${btn.dataset.toggleTime}"]`);
    if (!input) return;
    const wrapper    = input.closest('.time-toggle-wrapper') || input;
    const dateInput  = document.querySelector(`[name="${btn.dataset.toggleTime.replace(/Time$/, '')}"]`);
    btn.addEventListener('click', () => {
      const visible = wrapper.style.display !== 'none';
      wrapper.style.display = visible ? 'none' : '';
      btn.querySelector('i').style.color = visible ? '' : 'var(--bs-primary)';
      if (visible) {
        input.value = '';
      } else if (!input.value && dateInput?.value === todayStr()) {
        input.value = nowTime();
      }
    });
  });
};

const _wireTimePicker = () => {
  document.querySelectorAll('input[type=time]').forEach(el => {
    el.addEventListener('click', () => { try { el.showPicker(); } catch(e) {} });
    el.addEventListener('keydown', e => e.preventDefault());
  });
};

const _applyTime = (dateStr, timeStr) => {
  if (!dateStr || dateStr.length !== 10) return dateStr;
  if (timeStr) return `${dateStr}T${timeStr}:00`;
  return _addTime(dateStr);
};


const _addTime = s => {
  if (!s || s.length !== 10) return s;
  const n = new Date();
  const today = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
  return s === today
    ? `${s}T${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`
    : `${s}T12:00:00`;
};
import { currency, fmtDate, r2 } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import { calcularMes, toISODate, anteriorNomina } from '../utils/ciclo.js';

const FORMA_PAGO = { automatico: 'Automático', retiro: 'Retiro', transferencia: 'Transferencia' };

export async function render(container, tab = null) {
  await renderView(container, tab || 'contado');
}

async function renderView(container, initialTab = 'contado') {
  try {
    const [contadoItems, msiItems, instituciones, tarjetas, festivosMX, gastosItems, gastosFijosItems, pagosDiferidos] = await Promise.all([
      getAll('contado'),
      getAll('msi'),
      getAll('instituciones'),
      getAll('tarjetas'),
      getAll('festivosMX'),
      getAll('gastos', recentWhere('mes')),
      getAll('gastosFijos'),
      getAll('pagosDiferidos'),
    ]);

    // Index pagosDiferidos by compraId for fast lookup
    const pagosMap = {};
    pagosDiferidos.forEach(p => {
      if (!pagosMap[p.compraId]) pagosMap[p.compraId] = [];
      pagosMap[p.compraId].push(p);
    });

    // State: which diferido compras are expanded
    const expandedDiferidos = new Set();

    const _rerenderAcordeon = (acordeonId, renderFn) => {
      const abiertos = [...document.querySelectorAll(`#${acordeonId} .accordion-collapse.show`)].map(el => el.id);
      const scrollY = window.scrollY;
      // Rebuild pagosMap from current pagosDiferidos before re-render
      Object.keys(pagosMap).forEach(k => delete pagosMap[k]);
      pagosDiferidos.forEach(p => {
        if (!pagosMap[p.compraId]) pagosMap[p.compraId] = [];
        pagosMap[p.compraId].push(p);
      });
      renderFn();
      // Restore open panels without animation, then restore scroll
      abiertos.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('show')) {
          el.style.transition = 'none';
          el.classList.add('show');
          const btn = document.querySelector(`[data-bs-target="#${id}"]`);
          if (btn) btn.classList.remove('collapsed');
          requestAnimationFrame(() => { el.style.transition = ''; });
        }
      });
      window.scrollTo(0, scrollY);
    };

    const _buildPagoCellHtml = (tc, fechaISO) => {
      if (!tc?.ciclo || !fechaISO) return '—';
      const dt = new Date(String(fechaISO).includes('T') ? fechaISO : fechaISO + 'T12:00:00');
      let year = dt.getFullYear(), month = dt.getMonth();
      let p = calcularMes(tc.ciclo, year, month, festivosMX);
      if (p.fechaCorte < dt) {
        const next = new Date(year, month + 1, 1);
        p = calcularMes(tc.ciclo, next.getFullYear(), next.getMonth(), festivosMX);
      }
      if (!p.fechaPago) return '—';
      const lim = fmtDate(toISODate(p.fechaPago));
      const nom = anteriorNomina(p.fechaPago, festivosMX);
      return `${nom ? `<span style="color:var(--bs-primary);font-weight:600"><i class="bi bi-wallet2 me-1"></i>${fmtDate(toISODate(nom))}</span><br>` : ''}<small class="text-muted"><i class="bi bi-credit-card me-1" style="font-size:0.7rem"></i>${lim}</small>`;
    };

    const instMap = Object.fromEntries(instituciones.map(i => [i.id, i]));
    const cardMap = Object.fromEntries(tarjetas.map(t => [t.id, { ...t, inst: instMap[t.institucionId] }]));

    // ── Auto-crear / migrar pendientes para gastos fijos cuya fecha ya pasó ──
    {
      const _now   = new Date();
      const _year  = _now.getFullYear();
      const _month = _now.getMonth();
      const _mes   = toISODate(_now).slice(0, 7);
      const _hoy   = toISODate(_now);

      // Mapa de registros existentes para este mes por gastaFijoId
      const existeMap = new Map(
        gastosItems
          .filter(g => g.mes === _mes && g.gastaFijoId)
          .map(g => [g.gastaFijoId, g])
      );

      const nuevos   = [];
      const migrar   = []; // registros sin estado → actualizar a 'pendiente'

      gastosFijosItems.forEach(gasto => {
        const existente = existeMap.get(gasto.id);

        if (existente) {
          if (!existente.estado) {
            migrar.push(existente.id);
            existente.estado = 'pendiente';
          }
          return;
        }

        const fecha = calcularFechaGastoMes(gasto, _year, _month, festivosMX);
        if (!fecha) return;
        const fechaISO = toISODate(fecha);
        if (!fechaISO.startsWith(_mes) || fechaISO > _hoy) return;

        nuevos.push({
          tipo: 'gastaFijo', estado: 'pendiente', mes: _mes,
          gastaFijoId: gasto.id, nombre: gasto.nombre,
          tarjetaId: gasto.tarjetaId || '',
          ...(gasto.numeroTarjeta ? { numeroTarjeta: gasto.numeroTarjeta } : {}),
          formaPago: gasto.formaPago || '',
          fechaPago: fechaISO,
          importe: Number(gasto.importe) || 0,
        });
      });

      await Promise.all([
        ...migrar.map(id => update('gastos', id, { estado: 'pendiente' })),
        ...nuevos.map(d => create('gastos', d).then(id => gastosItems.push({ ...d, id }))),
      ]);
    }

    let tabActivo = initialTab;
    let filtroMsi = 'curso';

    const _mesActualStr   = toISODate(new Date()).slice(0, 7);
    let filtroContadoMes  = _mesActualStr;
    let filtroContadoTipo = 'pago';
    let filtroGastosMes   = _mesActualStr;
    let filtroGastosTipo  = 'pago';

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
      const contadoCollapsed = true;

      const filtered = contadoItems.filter(c => {
        if (filtroContadoTipo === 'compra') return (c.fechaCompra || '').slice(0, 7) === filtroContadoMes;
        const tc = cardMap[c.tarjetaId];
        // Diferido with pagos: each pago belongs to its own cycle — show when this cycle has pagos
        if (c.diferido && (pagosMap[c.id] || []).length > 0 && tc?.tipo === 'credito' && tc?.ciclo) {
          return _getPagosEnCiclo(pagosMap[c.id], tc, filtroContadoMes, festivosMX).length > 0;
        }
        if (tc?.tipo === 'credito' && tc?.ciclo && c.fechaCompra) {
          const compra = new Date(String(c.fechaCompra).includes('T') ? c.fechaCompra : c.fechaCompra + 'T12:00:00');
          let y = compra.getFullYear(), m = compra.getMonth();
          let p = calcularMes(tc.ciclo, y, m, festivosMX);
          if (p.fechaCorte < compra) { const nx = new Date(y, m + 1, 1); p = calcularMes(tc.ciclo, nx.getFullYear(), nx.getMonth(), festivosMX); }
          if (p.fechaPago) return toISODate(anteriorNomina(p.fechaPago, festivosMX) || p.fechaPago).slice(0, 7) === filtroContadoMes;
        }
        return (c.fechaCompra || '').slice(0, 7) === filtroContadoMes;
      });

      const byInst = {};
      filtered.forEach(c => {
        const card   = cardMap[c.tarjetaId];
        const instId = card?.institucionId || '__sin_inst__';
        if (!byInst[instId]) byInst[instId] = { inst: instMap[instId] || null, items: [] };
        byInst[instId].items.push(c);
      });

      const _contadoVal = c => {
        if (!c.diferido) return Number(c.total) || 0;
        const tc2 = cardMap[c.tarjetaId];
        const pp = (filtroContadoTipo === 'pago' && tc2?.ciclo)
          ? _getPagosEnCiclo(pagosMap[c.id], tc2, filtroContadoMes, festivosMX)
          : (pagosMap[c.id] || []);
        return pp.reduce((ps, p) => ps + (Number(p.monto) || 0), 0);
      };
      const totalCompras = filtered.reduce((s, c) => s + _contadoVal(c), 0);
      const groups       = Object.values(byInst)
        .filter(g => g.items.length > 0)
        .sort((a, b) => (a.inst?.nombre || '').localeCompare(b.inst?.nombre || '', 'es'));

      const subtitle = document.getElementById('compras-subtitle');
      if (subtitle) subtitle.textContent =
        `${filtered.length} compra${filtered.length !== 1 ? 's' : ''} · ${_labelMes(filtroContadoMes)}`;

      document.getElementById('compras-tab-content').innerHTML = `
        <div class="filter-bar d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
          <div class="d-flex align-items-center gap-1">
            <button class="btn-icon" id="contado-mes-prev"><i class="bi bi-chevron-left"></i></button>
            <span class="fw-500" style="min-width:130px;text-align:center;text-transform:capitalize">${_labelMes(filtroContadoMes)}</span>
            <button class="btn-icon" id="contado-mes-next"><i class="bi bi-chevron-right"></i></button>
          </div>
          <div class="filter-chips">
            <button class="filter-chip ${filtroContadoTipo === 'compra' ? 'active' : ''}" data-tipo="compra">Fecha Compra</button>
            <button class="filter-chip ${filtroContadoTipo === 'pago'   ? 'active' : ''}" data-tipo="pago">Fecha Pago</button>
          </div>
        </div>
        <div class="row g-3 mb-4">
          <div class="col-6">
            <div class="metric-card">
              <div class="metric-icon tint-success">
                <i class="bi bi-cash-stack"></i>
              </div>
              <div class="metric-info">
                <div class="metric-value">${currency(totalCompras)}</div>
                <div class="metric-label">Total de compras</div>
              </div>
            </div>
          </div>
          <div class="col-6">
            <div class="metric-card">
              <div class="metric-icon tint-purple">
                <i class="bi bi-receipt"></i>
              </div>
              <div class="metric-info">
                <div class="metric-value">${filtered.length}</div>
                <div class="metric-label">Compras registradas</div>
              </div>
            </div>
          </div>
        </div>
        ${groups.length === 0
          ? `<div class="empty-state"><i class="bi bi-bag"></i><p>Sin compras de contado para este período</p></div>`
          : `<div class="d-flex justify-content-end mb-2">
              <button class="btn btn-link btn-sm p-0 text-muted" id="btn-toggle-contado">
                <i class="bi bi-arrows-${contadoCollapsed ? 'expand' : 'collapse'} me-1"></i>${contadoCollapsed ? 'Expandir todo' : 'Colapsar todo'}
              </button>
            </div>
            <div class="accordion" id="contado-accordion">
              ${groups.map((g, idx) => renderGroupContado(g, idx, cardMap, festivosMX, contadoCollapsed, pagosMap, expandedDiferidos, filtroContadoTipo === 'pago' ? filtroContadoMes : null)).join('')}
            </div>`
        }`;

      const content = document.getElementById('compras-tab-content');

      content.querySelector('#contado-mes-prev')?.addEventListener('click', () => { filtroContadoMes = _mesAnterior(filtroContadoMes); renderContado(); });
      content.querySelector('#contado-mes-next')?.addEventListener('click', () => { filtroContadoMes = _mesSiguiente(filtroContadoMes); renderContado(); });
      content.querySelectorAll('.filter-chips .filter-chip[data-tipo]').forEach(btn =>
        btn.addEventListener('click', () => { filtroContadoTipo = btn.dataset.tipo; renderContado(); }));

      const btnToggleContado = content.querySelector('#btn-toggle-contado');
      if (btnToggleContado) {
        btnToggleContado.addEventListener('click', () => {
          const panels = content.querySelectorAll('#contado-accordion .accordion-collapse');
          const allOpen = [...panels].every(el => el.classList.contains('show'));
          panels.forEach(el => {
            bootstrap.Collapse.getOrCreateInstance(el, { toggle: false })[allOpen ? 'hide' : 'show']();
          });
          btnToggleContado.innerHTML = allOpen
            ? `<i class="bi bi-arrows-expand me-1"></i>Expandir todo`
            : `<i class="bi bi-arrows-collapse me-1"></i>Colapsar todo`;
        });
      }

      content.querySelectorAll('.btn-edit-contado').forEach(btn =>
        btn.addEventListener('click', e => {
          e.stopPropagation();
          showModalContado(
            contadoItems.find(c => c.id === btn.dataset.id),
            instituciones, tarjetas,
            () => renderView(container, 'contado')
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

      content.querySelectorAll('[data-toggle-diferido]').forEach(row =>
        row.addEventListener('click', e => {
          if (e.target.closest('a,button')) return;
          e.stopPropagation();
          const id = row.dataset.toggleDiferido;
          const isExpanding = !expandedDiferidos.has(id);
          if (isExpanding) expandedDiferidos.add(id); else expandedDiferidos.delete(id);

          const iconEl = row.querySelector('[data-dif-icon]');
          if (iconEl) iconEl.textContent = isExpanding ? '▼' : '▶';

          const tbody = row.closest('tbody');
          tbody.querySelectorAll(`[data-pago-de="${id}"]`).forEach(r => r.remove());

          if (isExpanding) {
            const compra = contadoItems.find(x => x.id === id);
            if (!compra) return;
            const tc = cardMap[compra.tarjetaId];
            const _allPagos = pagosDiferidos.filter(p => p.compraId === id);
            const pagos = (filtroContadoTipo === 'pago' && tc?.ciclo)
              ? _getPagosEnCiclo(_allPagos, tc, filtroContadoMes, festivosMX)
              : _allPagos;
            pagos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
            const childHtml = pagos.map(p => `
              <tr data-pago-de="${id}" class="row-highlight">
                <td style="padding-left:28px;color:var(--text-muted);font-size:0.85rem">└ Pago ${fmtDate(p.fecha)}</td>
                <td></td>
                <td style="white-space:nowrap">${p.fecha ? fmtDate(p.fecha) : '—'}</td>
                <td>—</td>
                <td class="text-end">${currency(p.monto)}</td>
                <td>
                  <div class="d-flex gap-1">
                    <button class="btn-icon btn-edit-pago-diferido" data-id="${p.id}"><i class="bi bi-pencil"></i></button>
                    <button class="btn-icon danger btn-del-pago-diferido" data-id="${p.id}" data-compra-id="${id}" data-monto="${p.monto}"><i class="bi bi-trash3"></i></button>
                  </div>
                </td>
              </tr>`).join('');
            if (childHtml) {
              row.insertAdjacentHTML('afterend', childHtml);
              tbody.querySelectorAll(`[data-pago-de="${id}"] .btn-edit-pago-diferido`).forEach(btn =>
                btn.addEventListener('click', e => {
                  e.stopPropagation();
                  const pago = pagosDiferidos.find(x => x.id === btn.dataset.id);
                  if (!pago) return;
                  _showModalPagoDiferido(pago, compra, 'contado', pagosDiferidos,
                    () => _rerenderAcordeon('contado-accordion', renderContado));
                }));
              tbody.querySelectorAll(`[data-pago-de="${id}"] .btn-del-pago-diferido`).forEach(btn =>
                btn.addEventListener('click', async e => {
                  e.stopPropagation();
                  const pagoId = btn.dataset.id;
                  const monto = Number(btn.dataset.monto) || 0;
                  if (!confirm('¿Eliminar este pago?')) return;
                  await remove('pagosDiferidos', pagoId);
                  pagosDiferidos.splice(pagosDiferidos.findIndex(x => x.id === pagoId), 1);
                  compra.total = (Number(compra.total) || 0) + monto;
                  await update('contado', compra.id, { total: compra.total });
                  toast('Pago eliminado');
                  _rerenderAcordeon('contado-accordion', renderContado);
                }));
            }
          }
        }));

      content.querySelectorAll('.btn-add-pago-diferido').forEach(btn =>
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const compraId = btn.dataset.id;
          const coleccion = btn.dataset.coleccion || 'contado';
          const compra = contadoItems.find(x => x.id === compraId);
          if (!compra) return;
          _showModalPagoDiferido(null, compra, coleccion, pagosDiferidos, () => {
            expandedDiferidos.add(compraId);
            _rerenderAcordeon('contado-accordion', renderContado);
          });
        }));

      content.querySelectorAll('.btn-edit-pago-diferido').forEach(btn =>
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const pago = pagosDiferidos.find(x => x.id === btn.dataset.id);
          if (!pago) return;
          const coleccion = pago.compraColeccion || 'contado';
          const compra = contadoItems.find(x => x.id === pago.compraId);
          _showModalPagoDiferido(pago, compra, coleccion, pagosDiferidos,
            () => _rerenderAcordeon('contado-accordion', renderContado));
        }));

      content.querySelectorAll('.btn-del-pago-diferido').forEach(btn =>
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const pagoId = btn.dataset.id;
          const compraId = btn.dataset.compraId;
          const monto = Number(btn.dataset.monto) || 0;
          if (!confirm('¿Eliminar este pago?')) return;
          await remove('pagosDiferidos', pagoId);
          const idx = pagosDiferidos.findIndex(x => x.id === pagoId);
          if (idx >= 0) pagosDiferidos.splice(idx, 1);
          const compra = contadoItems.find(x => x.id === compraId);
          if (compra) {
            compra.total = (Number(compra.total) || 0) + monto;
            await update('contado', compraId, { total: compra.total });
          }
          toast('Pago eliminado');
          _rerenderAcordeon('contado-accordion', renderContado);
        }));

      content.querySelectorAll('.btn-csv-contado').forEach(btn =>
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const grupo = groups[Number(btn.dataset.groupIdx)];
          if (!grupo) return;
          const _cardLabel = c => {
            const tc   = cardMap[c.tarjetaId];
            const nums = Array.isArray(tc?.numeros) ? tc.numeros : [];
            const n    = nums.find(x => x.formato === 'fisica' && x.numero) || nums.find(x => x.numero);
            const l4   = n ? String(n.numero).replace(/\s/g, '').slice(-4) : '';
            return { tc, label: tc ? `${tc.nombre}${l4 ? ' ···' + l4 : ''}` : '' };
          };
          const sorted = [...grupo.items].sort((a, b) => (b.fechaCompra || '').localeCompare(a.fechaCompra || ''));
          const mainRows = sorted.map(c => {
            const { tc, label } = _cardLabel(c);
            let fechaPago = '';
            if (tc?.ciclo && c.fechaCompra) {
              const d = new Date(String(c.fechaCompra).includes('T') ? c.fechaCompra : c.fechaCompra + 'T12:00:00');
              let y = d.getFullYear(), mo = d.getMonth();
              let p = calcularMes(tc.ciclo, y, mo, festivosMX);
              if (p.fechaCorte < d) { const nx = new Date(y, mo + 1, 1); p = calcularMes(tc.ciclo, nx.getFullYear(), nx.getMonth(), festivosMX); }
              if (p.fechaPago) fechaPago = toISODate(p.fechaPago);
            }
            const totalCompra   = c.diferido ? (Number(c.totalDiferido || c.total) || 0) : (Number(c.total) || 0);
            const pagosSumC     = c.diferido ? (pagosMap[c.id] || []).reduce((s, p) => s + (Number(p.monto) || 0), 0) : 0;
            const pendiente     = c.diferido ? Math.max(0, totalCompra - pagosSumC) : 0;
            const impactoC      = c.diferido ? pagosSumC : (Number(c.total) || 0);
            return {
              'Compra':        c.compra || '',
              'Tarjeta':       label,
              'Fecha Compra':  (c.fechaCompra || '').slice(0, 10),
              'Fecha Pago':    fechaPago,
              'Total Compra':  totalCompra.toFixed(2),
              'Pendiente':     c.diferido ? pendiente.toFixed(2) : '',
              'Impacto':       impactoC.toFixed(2),
              'Diferido':      c.diferido ? 'Sí' : 'No',
            };
          });
          const pagoRows = [];
          sorted.filter(c => c.diferido).forEach(c => {
            const { label } = _cardLabel(c);
            (pagosMap[c.id] || [])
              .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
              .forEach(p => pagoRows.push({
                'Compra Padre':  c.compra || '',
                'Tarjeta':       label,
                'Fecha':         (p.fecha || '').slice(0, 10),
                'Monto':         (Number(p.monto) || 0).toFixed(2),
              }));
          });
          _downloadCSV(
            `contado_${(grupo.inst?.nombre || 'tarjeta').replace(/\s+/g, '_')}_${filtroContadoMes}.csv`,
            [
              { title: 'Compras', rows: mainRows },
              ...(pagoRows.length ? [{ title: 'Pagos Diferidos', rows: pagoRows }] : []),
            ]
          );
        }));
    };

    // ── A Plazos ────────────────────────────────────────────────────────────────

    const renderPlazos = (filtro) => {
      const plazosCollapsed = true;
      const filtered = msiItems.filter(m => {
        if (filtro === 'curso')      return !m.liquidado;
        if (filtro === 'liquidados') return !!m.liquidado;
        return true;
      }).sort((a, b) => (b.fechaCompra || '').localeCompare(a.fechaCompra || ''));

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
            <div class="metric-icon tint-success">
              <i class="bi bi-cash-stack"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(totalCompras)}</div>
              <div class="metric-label">Total de compras</div>
            </div>
          </div>
        </div>
        <div class="col-6">
          <div class="metric-card">
            <div class="metric-icon tint-purple">
              <i class="bi bi-receipt"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${filtered.length}</div>
              <div class="metric-label">${filtro === 'liquidados' ? 'Compras liquidadas' : 'Compras registradas'}</div>
            </div>
          </div>
        </div>` : `
        <div class="col-6">
          <div class="metric-card">
            <div class="metric-icon tint-danger">
              <i class="bi bi-credit-card-fill"></i>
            </div>
            <div class="metric-info">
              <div class="metric-value">${currency(deudaTotal)}</div>
              <div class="metric-label">Deuda total restante</div>
            </div>
          </div>
        </div>
        <div class="col-6">
          <div class="metric-card">
            <div class="metric-icon tint-info">
              <i class="bi bi-calendar-check"></i>
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
          : `<div class="d-flex justify-content-end mb-2">
              <button class="btn btn-link btn-sm p-0 text-muted" id="btn-toggle-plazos">
                <i class="bi bi-arrows-${plazosCollapsed ? 'expand' : 'collapse'} me-1"></i>${plazosCollapsed ? 'Expandir todo' : 'Colapsar todo'}
              </button>
            </div>
            <div class="accordion" id="msi-accordion">
              ${groups.map((g, idx) => renderGroupMsi(g, idx, cardMap, festivosMX, filtro, plazosCollapsed, pagosMap, expandedDiferidos)).join('')}
            </div>`
        }`;

      const content = document.getElementById('compras-tab-content');

      const btnTogglePlazos = content.querySelector('#btn-toggle-plazos');
      if (btnTogglePlazos) {
        btnTogglePlazos.addEventListener('click', () => {
          const panels = content.querySelectorAll('#msi-accordion .accordion-collapse');
          const allOpen = [...panels].every(el => el.classList.contains('show'));
          panels.forEach(el => {
            bootstrap.Collapse.getOrCreateInstance(el, { toggle: false })[allOpen ? 'hide' : 'show']();
          });
          btnTogglePlazos.innerHTML = allOpen
            ? `<i class="bi bi-arrows-expand me-1"></i>Expandir todo`
            : `<i class="bi bi-arrows-collapse me-1"></i>Colapsar todo`;
        });
      }

      content.querySelectorAll('#filtro-msi [data-filtro]').forEach(btn =>
        btn.addEventListener('click', () => {
          filtroMsi = btn.dataset.filtro;
          renderPlazos(filtroMsi);
        }));

      content.querySelectorAll('.btn-pagar-msi').forEach(btn =>
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const m = msiItems.find(x => x.id === btn.dataset.id);
          if (!m) return;
          const nuevosMeses   = (Number(m.mesesPagados) || 0) + 1;
          const restanteBase  = m.restante != null
            ? Number(m.restante)
            : Math.max(0, (Number(m.total) || 0) - (Number(m.mensualidad) || 0) * (Number(m.mesesPagados) || 0));
          const nuevoRestante = r2(Math.max(0, restanteBase - (Number(m.mensualidad) || 0)));
          const mensualidad   = Number(m.mensualidad) || 0;

          const ops = [update('msi', m.id, { mesesPagados: nuevosMeses, restante: nuevoRestante })];

          // Sumar mensualidad al saldo disponible de la tarjeta (sin tocar fechaActualizacionSaldo)
          const tc = cardMap[m.tarjetaId];
          if (tc && tc.saldoDisponible != null && mensualidad > 0) {
            const nuevoSaldo = r2(Number(tc.saldoDisponible) + mensualidad);
            ops.push(update('tarjetas', tc.id, { saldoDisponible: nuevoSaldo }));
            tc.saldoDisponible = nuevoSaldo; // actualizar en memoria
          }

          await Promise.all(ops);
          Object.assign(m, { mesesPagados: nuevosMeses, restante: nuevoRestante });
          toast('Mensualidad registrada');
          if (nuevosMeses >= Number(m.mesesTotal) && !m.liquidado) {
            setTimeout(() => {
              if (confirm(`"${m.compra}" tiene todos sus meses pagados.\n¿Marcarla como liquidada?`)) {
                const fechaLiquidacion = toISODate(new Date());
                update('msi', m.id, { liquidado: true, restante: 0, fechaLiquidacion })
                  .then(() => { Object.assign(m, { liquidado: true, restante: 0, fechaLiquidacion }); toast('Compra liquidada'); renderPlazos(filtroMsi); })
                  .catch(err => toast('Error: ' + err.message, 'danger'));
              } else { renderPlazos(filtroMsi); }
            }, 300);
          } else {
            renderPlazos(filtroMsi);
          }
        }));

      content.querySelectorAll('.btn-edit-msi').forEach(btn =>
        btn.addEventListener('click', e => {
          e.stopPropagation();
          showModalMsi(
            msiItems.find(m => m.id === btn.dataset.id),
            instituciones, tarjetas,
            () => renderView(container, 'plazos')
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

      content.querySelectorAll('[data-toggle-diferido-msi]').forEach(row =>
        row.addEventListener('click', e => {
          if (e.target.closest('a,button')) return;
          e.stopPropagation();
          const id = row.dataset.toggleDiferidoMsi;
          if (expandedDiferidos.has(id)) expandedDiferidos.delete(id);
          else expandedDiferidos.add(id);
          _rerenderAcordeon('msi-accordion', () => renderPlazos(filtroMsi));
        }));

      content.querySelectorAll('.btn-add-pago-diferido-msi').forEach(btn =>
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const compraId = btn.dataset.id;
          const compra = msiItems.find(x => x.id === compraId);
          if (!compra) return;
          _showModalPagoDiferido(null, compra, 'msi', pagosDiferidos, () => {
            expandedDiferidos.add(compraId);
            _rerenderAcordeon('msi-accordion', () => renderPlazos(filtroMsi));
          });
        }));

      content.querySelectorAll('.btn-edit-pago-diferido-msi').forEach(btn =>
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const pago = pagosDiferidos.find(x => x.id === btn.dataset.id);
          if (!pago) return;
          const compra = msiItems.find(x => x.id === pago.compraId);
          _showModalPagoDiferido(pago, compra, 'msi', pagosDiferidos,
            () => _rerenderAcordeon('msi-accordion', () => renderPlazos(filtroMsi)));
        }));

      content.querySelectorAll('.btn-del-pago-diferido-msi').forEach(btn =>
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const pagoId  = btn.dataset.id;
          const compraId = btn.dataset.compraId;
          const monto   = Number(btn.dataset.monto) || 0;
          if (!confirm('¿Eliminar este pago?')) return;
          await remove('pagosDiferidos', pagoId);
          const idx = pagosDiferidos.findIndex(x => x.id === pagoId);
          if (idx >= 0) pagosDiferidos.splice(idx, 1);
          const compra = msiItems.find(x => x.id === compraId);
          if (compra) {
            compra.total = (Number(compra.total) || 0) + monto;
            await update('msi', compraId, { total: compra.total });
          }
          toast('Pago eliminado');
          _rerenderAcordeon('msi-accordion', () => renderPlazos(filtroMsi));
        }));

      content.querySelectorAll('.btn-csv-msi').forEach(btn =>
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const grupo = groups[Number(btn.dataset.groupIdx)];
          if (!grupo) return;
          const _cardLabel = m => {
            const tc   = cardMap[m.tarjetaId];
            const nums = Array.isArray(tc?.numeros) ? tc.numeros : [];
            const n    = nums.find(x => x.formato === 'fisica' && x.numero) || nums.find(x => x.numero);
            const l4   = n ? String(n.numero).replace(/\s/g, '').slice(-4) : '';
            return { tc, label: tc ? `${tc.nombre}${l4 ? ' ···' + l4 : ''}` : '' };
          };
          const sorted = [...grupo.items].sort((a, b) => (b.fechaCompra || '').localeCompare(a.fechaCompra || ''));
          const mainRows = sorted.map(m => {
            const { label } = _cardLabel(m);
            const pagosSumM = m.diferido
              ? (pagosMap[m.id] || []).reduce((s, p) => s + (Number(p.mensualidad ?? m.mensualidad ?? p.monto) || 0), 0)
              : 0;
            const impactoM  = m.diferido ? pagosSumM : (Number(m.mensualidad) || 0);
            return {
              'Compra':        m.compra || '',
              'Tarjeta':       label,
              'Fecha Compra':  (m.fechaCompra || '').slice(0, 10),
              'Mensualidad':   (Number(m.mensualidad) || 0).toFixed(2),
              'Meses Pagados': Number(m.mesesPagados) || 0,
              'Meses Total':   Number(m.mesesTotal) || 0,
              'Restante':      (Number(m.restante) || 0).toFixed(2),
              'Total':         (Number(m.total) || 0).toFixed(2),
              'Diferido':      m.diferido ? 'Sí' : 'No',
              'Liquidado':     m.liquidado ? 'Sí' : 'No',
              'Impacto':       impactoM.toFixed(2),
            };
          });
          const pagoRows = [];
          sorted.filter(m => m.diferido).forEach(m => {
            const { label } = _cardLabel(m);
            (pagosMap[m.id] || [])
              .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
              .forEach(p => pagoRows.push({
                'Compra Padre':  m.compra || '',
                'Tarjeta':       label,
                'Fecha':         (p.fecha || '').slice(0, 10),
                'Mensualidad':   (Number(p.mensualidad ?? m.mensualidad) || 0).toFixed(2),
                'Meses Pagados': Number(p.mesesPagados) || 0,
                'Restante':      (Number(p.restante) || 0).toFixed(2),
                'Monto':         (Number(p.monto) || 0).toFixed(2),
              }));
          });
          _downloadCSV(
            `plazos_${(grupo.inst?.nombre || 'tarjeta').replace(/\s+/g, '_')}_${filtro}.csv`,
            [
              { title: 'Compras a Plazos', rows: mainRows },
              ...(pagoRows.length ? [{ title: 'Pagos Diferidos', rows: pagoRows }] : []),
            ]
          );
        }));

      content.querySelectorAll('.btn-edit-pago-msi-plan').forEach(btn =>
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const pago  = pagosDiferidos.find(x => x.id === btn.dataset.id);
          if (!pago) return;
          const compra = msiItems.find(x => x.id === pago.compraId);
          _showModalEditPagoPlan(pago, compra, pagosDiferidos,
            () => _rerenderAcordeon('msi-accordion', () => renderPlazos(filtroMsi)));
        }));

      content.querySelectorAll('.btn-pagar-cuota-diferido').forEach(btn =>
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const pago   = pagosDiferidos.find(x => x.id === btn.dataset.id);
          const compra = msiItems.find(x => x.id === btn.dataset.compraId);
          if (!pago || !compra) return;
          const mens    = Number(pago.mensualidad != null ? pago.mensualidad : compra.mensualidad) || 0;
          const rest    = pago.restante != null ? Number(pago.restante) : Math.max(0, Number(pago.monto) - mens * (Number(pago.mesesPagados) || 0));
          const newMeses = (Number(pago.mesesPagados) || 0) + 1;
          const newRest  = r2(Math.max(0, rest - mens));
          pago.mesesPagados = newMeses;
          pago.restante     = newRest;
          await update('pagosDiferidos', pago.id, { mesesPagados: newMeses, restante: newRest });
          // Recalcular restante del padre
          const pagosDeLaCompra = pagosDiferidos.filter(p => p.compraId === compra.id);
          const sumRest = pagosDeLaCompra.reduce((s, p) => {
            const m2 = Number(p.mensualidad != null ? p.mensualidad : compra.mensualidad) || 0;
            return s + (p.restante != null ? Number(p.restante) : Math.max(0, Number(p.monto) - m2 * (Number(p.mesesPagados) || 0)));
          }, 0);
          const nuevoRestante = r2(sumRest + (Number(compra.total) || 0));
          compra.restante = nuevoRestante;
          await update('msi', compra.id, { restante: nuevoRestante });
          _rerenderAcordeon('msi-accordion', () => renderPlazos(filtroMsi));
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
        showModalContado(null, instituciones, tarjetas, () => renderView(container, 'contado'));
      else if (tabActivo === 'plazos')
        showModalMsi(null, instituciones, tarjetas, () => renderView(container, 'plazos'));
      else
        showModalNuevoGasto(null, instituciones, tarjetas, () => renderView(container, 'gastos'));
    });

    // ── Gastos ──────────────────────────────────────────────────────────────────

    const renderGastos = () => {
      const now       = new Date();
      const mesActual = toISODate(now).slice(0, 7);
      const hoy       = toISODate(now);

      const pendientes = [...gastosItems]
        .filter(g => g.mes === mesActual && g.estado === 'pendiente')
        .sort((a, b) => (a.fechaPago || '').localeCompare(b.fechaPago || ''));

      const registrados = [...gastosItems]
        .filter(g => {
          if (g.estado !== 'registrado') return false;
          if (filtroGastosTipo === 'gasto') return (g.fechaPago || '').slice(0, 7) === filtroGastosMes;
          const tc = cardMap[g.tarjetaId];
          if (tc?.tipo === 'credito' && tc?.ciclo && g.fechaPago) {
            const base = new Date(String(g.fechaPago).includes('T') ? g.fechaPago : g.fechaPago + 'T12:00:00');
            let yr = base.getFullYear(), mo = base.getMonth();
            let p = calcularMes(tc.ciclo, yr, mo, festivosMX);
            if (p.fechaCorte < base) { const nx = new Date(yr, mo + 1, 1); p = calcularMes(tc.ciclo, nx.getFullYear(), nx.getMonth(), festivosMX); }
            if (p.fechaPago) return toISODate(anteriorNomina(p.fechaPago, festivosMX) || p.fechaPago).slice(0, 7) === filtroGastosMes;
          }
          return (g.fechaPago || '').slice(0, 7) === filtroGastosMes;
        })
        .sort((a, b) => (a.fechaPago || '').localeCompare(b.fechaPago || ''));

      const totalRegistrado = registrados.reduce((s, g) => s + (Number(g.importe) || 0), 0);

      const subtitle = document.getElementById('compras-subtitle');
      if (subtitle) subtitle.textContent = `Gastos · ${_labelMes(filtroGastosMes)}`;

      const lastFourOf = (g, tc) => g.numeroTarjeta
        ? String(g.numeroTarjeta).replace(/\s/g, '').slice(-4)
        : (() => {
            const nums = Array.isArray(tc?.numeros) ? tc.numeros : [];
            const n = nums.find(x => x.formato === 'fisica' && x.numero) || nums.find(x => x.numero);
            return n ? String(n.numero).replace(/\s/g, '').slice(-4) : '';
          })();

      document.getElementById('compras-tab-content').innerHTML = `
        <div class="filter-bar d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
          <div class="d-flex align-items-center gap-1">
            <button class="btn-icon" id="gastos-mes-prev"><i class="bi bi-chevron-left"></i></button>
            <span class="fw-500" style="min-width:130px;text-align:center;text-transform:capitalize">${_labelMes(filtroGastosMes)}</span>
            <button class="btn-icon" id="gastos-mes-next"><i class="bi bi-chevron-right"></i></button>
          </div>
          <div class="filter-chips">
            <button class="filter-chip ${filtroGastosTipo === 'gasto' ? 'active' : ''}" data-gtipo="gasto">Fecha Gasto</button>
            <button class="filter-chip ${filtroGastosTipo === 'pago'  ? 'active' : ''}" data-gtipo="pago">Fecha Pago</button>
          </div>
        </div>
        <div class="row g-3 mb-4">
          <div class="col-6">
            <div class="metric-card">
              <div class="metric-icon tint-warn">
                <i class="bi bi-cash"></i>
              </div>
              <div class="metric-info">
                <div class="metric-value">${currency(totalRegistrado)}</div>
                <div class="metric-label">Total del período</div>
              </div>
            </div>
          </div>
          <div class="col-6">
            <div class="metric-card">
              <div class="metric-icon tint-indigo">
                <i class="bi bi-list-check"></i>
              </div>
              <div class="metric-info">
                <div class="metric-value">${registrados.length}</div>
                <div class="metric-label">Gastos registrados</div>
              </div>
            </div>
          </div>
        </div>

        ${pendientes.length > 0 ? `
        <p class="text-muted fw-semibold mb-2" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:.05em">
          <i class="bi bi-hourglass-split me-1 text-warning"></i>Gastos Fijos — Pendientes de confirmar
        </p>
        <div class="list-group mb-4" id="gastos-pendientes">
          ${pendientes.map(g => {
            const tc = cardMap[g.tarjetaId];
            const lf = lastFourOf(g, tc);
            const vencido = g.fechaPago <= hoy;
            return `
              <div class="list-group-item gasto-pend d-flex align-items-center gap-3 py-2">
                <div class="gasto-pend-info flex-grow-1">
                  <div class="fw-500">${g.nombre}</div>
                  <small class="text-muted">${tc?.nombre || '—'}${lf ? ' ···' + lf : ''} · ${FORMA_PAGO[g.formaPago] || '—'}</small>
                </div>
                <div class="gasto-pend-cobro text-center" style="min-width:76px">
                  <div class="gasto-pend-cobro-lbl" style="font-size:0.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-faint)">Cobro</div>
                  <div class="${vencido ? 'text-danger fw-bold' : 'text-muted'}" style="font-size:0.82rem">${fmtDate(g.fechaPago)}</div>
                </div>
                <div class="gasto-pend-importe fw-bold text-end" style="min-width:80px">${currency(g.importe)}</div>
                <div class="gasto-pend-acciones d-flex gap-1">
                  <button class="btn btn-sm btn-outline-primary btn-confirmar-gasto" data-id="${g.id}" style="white-space:nowrap">
                    <i class="bi bi-check-lg me-1"></i>Confirmar
                  </button>
                  <button class="btn-icon btn-descartar-gasto" data-id="${g.id}" title="Descartar este mes">
                    <i class="bi bi-x-lg"></i>
                  </button>
                </div>
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
                  <th>Fecha Gasto</th><th>Fecha Pago</th><th class="text-end">Importe</th><th></th>
                </tr></thead>
                <tbody>
                  ${registrados.map(g => {
                    const tc = cardMap[g.tarjetaId];
                    const lf = lastFourOf(g, tc);

                    let fechaPagoCell = g.fechaPago ? fmtDate(g.fechaPago) : '—';
                    if (tc?.tipo === 'credito' && tc?.ciclo && g.fechaPago) {
                      const base = new Date(String(g.fechaPago).includes('T') ? g.fechaPago : g.fechaPago + 'T12:00:00');
                      let yr = base.getFullYear(), mo = base.getMonth();
                      let p = calcularMes(tc.ciclo, yr, mo, festivosMX);
                      if (p.fechaCorte < base) {
                        const next = new Date(yr, mo + 1, 1);
                        p = calcularMes(tc.ciclo, next.getFullYear(), next.getMonth(), festivosMX);
                      }
                      if (p.fechaPago) {
                        const nom = anteriorNomina(p.fechaPago, festivosMX);
                        fechaPagoCell = `
                          ${nom ? `<span style="color:var(--bs-primary);font-weight:600"><i class="bi bi-wallet2 me-1"></i>${fmtDate(toISODate(nom))}</span><br>` : ''}
                          <small class="text-muted"><i class="bi bi-credit-card me-1" style="font-size:0.7rem"></i>${fmtDate(toISODate(p.fechaPago))}</small>`;
                      }
                    }

                    return `<tr>
                      <td>
                        <div class="fw-500">${g.nombre}</div>
                        ${g.gastaFijoId ? `<small class="text-muted"><i class="bi bi-arrow-repeat me-1"></i>Gasto fijo</small>` : ''}
                      </td>
                      <td style="white-space:nowrap">${tc?.nombre || '—'}${lf ? ' ···' + lf : ''}</td>
                      <td>${FORMA_PAGO[g.formaPago] || '—'}</td>
                      <td style="white-space:nowrap">${g.fechaPago ? fmtDate(g.fechaPago) : '—'}</td>
                      <td style="white-space:nowrap">${fechaPagoCell}</td>
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

      content.querySelector('#gastos-mes-prev')?.addEventListener('click', () => { filtroGastosMes = _mesAnterior(filtroGastosMes); renderGastos(); });
      content.querySelector('#gastos-mes-next')?.addEventListener('click', () => { filtroGastosMes = _mesSiguiente(filtroGastosMes); renderGastos(); });
      content.querySelectorAll('[data-gtipo]').forEach(btn =>
        btn.addEventListener('click', () => { filtroGastosTipo = btn.dataset.gtipo; renderGastos(); }));

      content.querySelectorAll('.btn-confirmar-gasto').forEach(btn =>
        btn.addEventListener('click', () => {
          const g = gastosItems.find(x => x.id === btn.dataset.id);
          if (!g) return;
          showModalConfirmarGasto(g, instituciones, tarjetas, () => renderView(container, 'gastos'));
        }));

      content.querySelectorAll('.btn-descartar-gasto').forEach(btn =>
        btn.addEventListener('click', async () => {
          const g = gastosItems.find(x => x.id === btn.dataset.id);
          if (!g) return;
          await update('gastos', g.id, { estado: 'descartado' });
          Object.assign(g, { estado: 'descartado' });
          renderGastos();
        }));

      content.querySelectorAll('.btn-edit-gasto').forEach(btn =>
        btn.addEventListener('click', () => {
          const g = gastosItems.find(x => x.id === btn.dataset.id);
          showModalNuevoGasto(g, instituciones, tarjetas, () => renderView(container, 'gastos'));
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

// ── CSV download ────────────────────────────────────────────────────────────────

// sections: Array<{ title?: string, rows: object[] }>
// UTF-16 LE with BOM so Excel opens it correctly without import wizard.
function _downloadCSV(filename, sections) {
  const esc   = v => { const s = String(v ?? ''); return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [];
  sections.forEach(({ title, rows }) => {
    if (!rows?.length) return;
    if (title) lines.push(esc(title));
    const cols = Object.keys(rows[0]);
    lines.push(cols.map(esc).join(','));
    rows.forEach(r => lines.push(cols.map(c => esc(r[c])).join(',')));
    lines.push('');
  });
  if (!lines.length) return;
  const str  = 'sep=,\r\n' + lines.join('\r\n');
  const buf  = new ArrayBuffer(2 + str.length * 2);
  const view = new Uint16Array(buf);
  view[0] = 0xFEFF; // UTF-16 LE BOM
  for (let i = 0; i < str.length; i++) view[i + 1] = str.charCodeAt(i);
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([buf], { type: 'text/csv;charset=utf-16le' })),
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Render helpers ──────────────────────────────────────────────────────────────

function _getPagosEnCiclo(pagos, tc, mes, festivosMX) {
  if (!tc?.ciclo || !mes) return pagos || [];
  return (pagos || []).filter(p => {
    if (!p.fecha) return false;
    const dt = new Date(String(p.fecha).includes('T') ? p.fecha : p.fecha + 'T12:00:00');
    let y = dt.getFullYear(), m = dt.getMonth();
    let ci = calcularMes(tc.ciclo, y, m, festivosMX);
    if (ci.fechaCorte < dt) {
      const nx = new Date(y, m + 1, 1);
      ci = calcularMes(tc.ciclo, nx.getFullYear(), nx.getMonth(), festivosMX);
    }
    if (!ci.fechaPago) return false;
    const nom = anteriorNomina(ci.fechaPago, festivosMX);
    return (nom ? toISODate(nom) : toISODate(ci.fechaPago)).slice(0, 7) === mes;
  });
}

function renderGroupContado({ inst, items }, idx, cardMap, festivosMX, collapsed = false, pagosMap = {}, expandedDiferidos = new Set(), filtroMes = null) {
  const label      = inst?.nombre || 'Sin institución';
  const color      = inst?.color  || '#607d8b';
  const totalGrupo = items.reduce((s, c) => {
    if (!c.diferido) return s + (Number(c.total) || 0);
    const tc = cardMap[c.tarjetaId];
    const pp = (filtroMes && tc?.ciclo)
      ? _getPagosEnCiclo(pagosMap[c.id], tc, filtroMes, festivosMX)
      : (pagosMap[c.id] || []);
    return s + pp.reduce((ps, p) => ps + (Number(p.monto) || 0), 0);
  }, 0);

  return `
    <div class="accordion-item mb-2">
      <h2 class="accordion-header">
        <button class="accordion-button${collapsed ? ' collapsed' : ''}" type="button"
                data-bs-toggle="collapse" data-bs-target="#acc-c-${idx}">
          <span style="width:10px;height:10px;border-radius:50%;background:${color};margin-right:10px;flex-shrink:0"></span>
          <span class="flex-grow-1">${label}</span>
          <span class="ms-auto me-3 d-flex align-items-center gap-2" style="font-size:0.8rem;color:var(--text-muted)">
            <span>Total: <strong>${currency(totalGrupo)}</strong></span>
            <span class="btn-csv-contado" data-group-idx="${idx}" title="Descargar CSV"
                  style="cursor:pointer;padding:1px 6px;border-radius:4px;border:1px solid var(--border);color:var(--text-muted);background:var(--card-bg);line-height:1.8">
              <i class="bi bi-download" style="pointer-events:none"></i>
            </span>
          </span>
        </button>
      </h2>
      <div id="acc-c-${idx}" class="accordion-collapse collapse${collapsed ? '' : ' show'}">
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
                  .flatMap(c => {
                    const tc = cardMap[c.tarjetaId];
                    const lastFour = c.numeroTarjeta
                      ? String(c.numeroTarjeta).replace(/\s/g, '').slice(-4)
                      : (() => {
                          const nums = Array.isArray(tc?.numeros) ? tc.numeros : [];
                          const n = nums.find(x => x.formato === 'fisica' && x.numero) || nums.find(x => x.numero);
                          return n ? String(n.numero).replace(/\s/g, '').slice(-4) : '';
                        })();

                    const _pagoCell = (fechaISO) => {
                      if (!tc?.ciclo || !fechaISO) return '—';
                      const compra = new Date(String(fechaISO).includes('T') ? fechaISO : fechaISO + 'T12:00:00');
                      let year = compra.getFullYear(), month = compra.getMonth();
                      let p = calcularMes(tc.ciclo, year, month, festivosMX);
                      if (p.fechaCorte < compra) {
                        const next = new Date(year, month + 1, 1);
                        p = calcularMes(tc.ciclo, next.getFullYear(), next.getMonth(), festivosMX);
                      }
                      if (!p.fechaPago) return '—';
                      const lim = fmtDate(toISODate(p.fechaPago));
                      const nom = anteriorNomina(p.fechaPago, festivosMX);
                      return `${nom ? `<span style="color:var(--bs-primary);font-weight:600"><i class="bi bi-wallet2 me-1"></i>${fmtDate(toISODate(nom))}</span><br>` : ''}<small class="text-muted"><i class="bi bi-credit-card me-1" style="font-size:0.7rem"></i>${lim}</small>`;
                    };

                    if (c.diferido) {
                      const allPagos     = (pagosMap[c.id] || []).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
                      const pagos        = (filtroMes && tc?.ciclo)
                        ? _getPagosEnCiclo(pagosMap[c.id], tc, filtroMes, festivosMX).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
                        : allPagos;
                      const regTotal     = allPagos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
                      const totalVal     = Number(c.totalDiferido || c.total) || 0;
                      const pend         = totalVal - regTotal;
                      const allRegistered = pend < 0.005;
                      const expanded     = expandedDiferidos.has(c.id);
                      const bonif        = !!tc?.inst?.bonificacionConIva;

                      const parentRow = `<tr class="table-warning" style="cursor:pointer" data-toggle-diferido="${c.id}">
                        <td>
                          <span data-dif-icon class="me-1" style="font-size:0.8rem">${expanded ? '▼' : '▶'}</span>
                          <span class="fw-500">${c.compra}</span>
                          <span class="badge bg-warning text-dark ms-1" style="font-size:var(--fs-nano)">Diferido</span>
                          ${c.enlaceCompra ? `<a href="${c.enlaceCompra}" target="_blank" rel="noopener" class="ms-1 text-muted"><i class="bi bi-box-arrow-up-right" style="font-size:0.72rem"></i></a>` : ''}
                          <span style="font-size:0.7rem" class="${allRegistered ? 'text-success' : 'text-danger'}">
                            ${allRegistered ? '✓' : `○ ${currency(Math.max(0, pend))}`}
                          </span>
                        </td>
                        <td style="white-space:nowrap">${tc?.nombre || '—'}${lastFour ? ' ···' + lastFour : ''}</td>
                        <td style="white-space:nowrap">${c.fechaCompra ? fmtDate(c.fechaCompra) : '—'}</td>
                        <td style="white-space:nowrap">${_pagoCell(filtroMes && pagos.length ? pagos[0].fecha : c.fechaCompra)}</td>
                        <td class="text-end">
                          ${_bonifTotal(c, totalVal, bonif)}
                        </td>
                        <td>
                          <div class="d-flex gap-1">
                            ${!allRegistered ? `<button class="btn-icon btn-add-pago-diferido" data-id="${c.id}" data-coleccion="contado" title="Registrar pago"><i class="bi bi-plus-circle"></i></button>` : ''}
                            <button class="btn-icon btn-edit-contado" data-id="${c.id}"><i class="bi bi-pencil"></i></button>
                            <button class="btn-icon danger btn-del-contado" data-id="${c.id}"><i class="bi bi-trash3"></i></button>
                          </div>
                        </td>
                      </tr>`;

                      const pagoRows = expanded ? pagos.map(p => `
                        <tr data-pago-de="${c.id}" class="row-highlight">
                          <td style="padding-left:28px;color:var(--text-muted);font-size:0.85rem">└ Pago ${fmtDate(p.fecha)}</td>
                          <td></td>
                          <td style="white-space:nowrap">${p.fecha ? fmtDate(p.fecha) : '—'}</td>
                          <td>—</td>
                          <td class="text-end">${currency(p.monto)}</td>
                          <td>
                            <div class="d-flex gap-1">
                              <button class="btn-icon btn-edit-pago-diferido" data-id="${p.id}" title="Editar pago"><i class="bi bi-pencil"></i></button>
                              <button class="btn-icon danger btn-del-pago-diferido" data-id="${p.id}" data-compra-id="${c.id}" data-monto="${p.monto}" title="Eliminar pago"><i class="bi bi-trash3"></i></button>
                            </div>
                          </td>
                        </tr>`).join('') : '';

                      return [parentRow, pagoRows];
                    }

                    return [`<tr>
                      <td>
                        <div class="fw-500">
                          ${c.compra}
                          ${c.enlaceCompra ? `<a href="${c.enlaceCompra}" target="_blank" rel="noopener" class="ms-1 text-muted" title="Abrir enlace"><i class="bi bi-box-arrow-up-right" style="font-size:0.72rem"></i></a>` : ''}
                        </div>
                      </td>
                      <td style="white-space:nowrap">${tc?.nombre || '—'}${lastFour ? ' ···' + lastFour : ''}</td>
                      <td style="white-space:nowrap">${c.fechaCompra ? fmtDate(c.fechaCompra) : '—'}</td>
                      <td style="white-space:nowrap">${_pagoCell(c.fechaCompra)}</td>
                      <td class="text-end">${_bonifTotal(c, Number(c.total) || 0, !!tc?.inst?.bonificacionConIva)}</td>
                      <td>
                        <div class="d-flex gap-1">
                          <button class="btn-icon btn-edit-contado" data-id="${c.id}"><i class="bi bi-pencil"></i></button>
                          <button class="btn-icon danger btn-del-contado" data-id="${c.id}"><i class="bi bi-trash3"></i></button>
                        </div>
                      </td>
                    </tr>`];
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

  const compra = new Date(String(fechaCompra).includes('T') ? fechaCompra : fechaCompra + 'T12:00:00');
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

  return { primerPago, ultimoPago: lastPeriodo.fechaPago, cicloYear: year, cicloMonth: month };
}

function renderGroupMsi({ inst, items }, idx, cardMap, festivosMX, filtro, collapsed = false, pagosMap = {}, expandedDiferidos = new Set()) {
  const label        = inst?.nombre || 'Sin institución';
  const color        = inst?.color  || '#607d8b';
  const mostrarTotal = filtro !== 'curso';
  const deuda        = items.reduce((s, m) => s + (Number(m.restante) || 0), 0);
  const mens         = items.reduce((s, m) => {
    if (!m.diferido) return s + (Number(m.mensualidad) || 0);
    return s + (pagosMap[m.id] || []).reduce((ps, p) => ps + (Number(p.mensualidad ?? m.mensualidad ?? p.monto) || 0), 0);
  }, 0);
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
        <button class="accordion-button${collapsed ? ' collapsed' : ''}" type="button"
                data-bs-toggle="collapse" data-bs-target="#acc-m-${idx}">
          <span style="width:10px;height:10px;border-radius:50%;background:${color};margin-right:10px;flex-shrink:0"></span>
          <span class="flex-grow-1">${label}</span>
          <span class="ms-auto me-3 d-flex align-items-center gap-2" style="font-size:0.8rem;color:var(--text-muted)">
            <span class="d-flex gap-3">${headerStats}</span>
            <span class="btn-csv-msi" data-group-idx="${idx}" title="Descargar CSV"
                  style="cursor:pointer;padding:1px 6px;border-radius:4px;border:1px solid var(--border);color:var(--text-muted);background:var(--card-bg);line-height:1.8">
              <i class="bi bi-download" style="pointer-events:none"></i>
            </span>
          </span>
        </button>
      </h2>
      <div id="acc-m-${idx}" class="accordion-collapse collapse${collapsed ? '' : ' show'}">
        <div class="accordion-body p-0">
          <div class="table-wrapper">
            <table class="table">
              <thead><tr>
                <th>Compra</th><th>Tarjeta</th><th class="text-center">Meses</th><th style="white-space:nowrap">Fecha compra</th>
                <th>Primer Pago</th>
                ${filtro === 'curso' ? `<th>Próximo Pago</th>` : ''}
                <th>${thUltimo}</th>
                <th class="text-end">Mensualidad</th>
                <th class="text-end">${thRestante}</th>
                ${filtro === 'curso' ? `<th class="text-end">Total</th>` : ''}
                <th></th>
              </tr></thead>
              <tbody>
                ${[...items]
                  .sort((a, b) => (b.fechaCompra || '').localeCompare(a.fechaCompra || ''))
                  .flatMap(m => {
                    const tc = cardMap[m.tarjetaId];
                    const { primerPago, ultimoPago, cicloYear, cicloMonth } = calcularPagos(
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

                    const _pagoMuted = (nom, limite) =>
                      `<span><i class="bi bi-wallet2 me-1 text-muted" style="font-size:0.75rem"></i>${fmtDate(toISODate(nom))}</span><br>
                       <small class="text-muted"><i class="bi bi-credit-card me-1" style="font-size:0.7rem"></i>${fmtDate(toISODate(limite))}</small>`;

                    const _pagoHighlight = (nom, limite) =>
                      `<span style="color:var(--bs-primary);font-weight:600"><i class="bi bi-wallet2 me-1"></i>${fmtDate(toISODate(nom))}</span><br>
                       <small class="text-muted"><i class="bi bi-credit-card me-1" style="font-size:0.7rem"></i>${fmtDate(toISODate(limite))}</small>`;

                    const primerPagoCell = nomPrimero ? _pagoMuted(nomPrimero, primerPago) : '—';

                    // Diferido parent row
                    if (m.diferido) {
                      const pagos        = (pagosMap[m.id] || []).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
                      const pendingAmount = Number(m.total) || 0;
                      const allRegistered = pendingAmount < 0.005;
                      const bonif         = !!tc?.inst?.bonificacionConIva;
                      const expanded      = expandedDiferidos.has(m.id);

                      // Aggregate across registered pagos
                      const sumMesesPagados  = pagos.reduce((s, p) => s + (Number(p.mesesPagados) || 0), 0);
                      const sumMensualidad  = pagos.reduce((s, p) => s + (Number(p.mensualidad != null ? p.mensualidad : m.mensualidad) || 0), 0);
                      const sumRestante     = pagos.reduce((s, p) => {
                        const mens = Number(p.mensualidad != null ? p.mensualidad : m.mensualidad) || 0;
                        return s + (p.restante != null ? Number(p.restante) : Math.max(0, Number(p.monto) - mens * (Number(p.mesesPagados) || 0)));
                      }, 0);
                      const totalRestante    = sumRestante + pendingAmount;
                      const totalMensualidad = sumMensualidad + (pendingAmount > 0 && m.mesesTotal ? pendingAmount / m.mesesTotal : 0);
                      const totalDif  = Number(m.totalDiferido) || (Number(m.total) + pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0));

                      // Detectar si los pagos pertenecen a distintos ciclos
                      const _pagosCicloKeys = pagos.map(p => {
                        if (!tc?.ciclo) return null;
                        const { cicloYear: cy, cicloMonth: cm } = calcularPagos(tc.ciclo, p.fecha, Number(m.mesesTotal) || 0, festivosMX);
                        return cy != null ? `${cy}-${cm}` : null;
                      });
                      const multiCiclo = new Set(_pagosCicloKeys.filter(Boolean)).size > 1;

                      // Progreso padre
                      const totalMesesPosibles = (Number(m.mesesTotal) || 1) * Math.max(1, pagos.length);
                      const sumMonto = pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
                      const pctParent = multiCiclo
                        ? Math.min(100, Math.round(sumMonto > 0
                            ? pagos.reduce((s, p) => s + (Number(p.mesesPagados) || 0) / (Number(m.mesesTotal) || 1) * ((Number(p.monto) || 0) / sumMonto), 0) * 100
                            : 0))
                        : Math.min(100, Math.round(sumMesesPagados / totalMesesPosibles * 100));
                      const doneParent = allRegistered && pagos.length > 0 && pagos.every(p => {
                        const mens = Number(p.mensualidad != null ? p.mensualidad : m.mensualidad) || 0;
                        return (p.restante != null ? Number(p.restante) : Math.max(0, Number(p.monto) - mens * (Number(p.mesesPagados) || 0))) <= 0;
                      });

                      // Primer/último/próximo pago from registered pagos
                      let difPrimerCell = '—', difUltimoCell = '—', difProximoCell = '—';
                      if (pagos.length > 0) {
                        let earliestPrimer = null, latestUltimo = null;
                        for (const p of pagos) {
                          const { primerPago, ultimoPago } = calcularPagos(tc?.ciclo, p.fecha, Number(m.mesesTotal) || 0, festivosMX);
                          if (primerPago && (!earliestPrimer || primerPago < earliestPrimer)) earliestPrimer = primerPago;
                          if (ultimoPago  && (!latestUltimo  || ultimoPago  > latestUltimo))  latestUltimo  = ultimoPago;
                        }
                        if (earliestPrimer) { const n = anteriorNomina(earliestPrimer, festivosMX); difPrimerCell = n ? _pagoMuted(n, earliestPrimer) : fmtDate(toISODate(earliestPrimer)); }
                        if (latestUltimo)   { const n = anteriorNomina(latestUltimo,   festivosMX); difUltimoCell = n ? _pagoMuted(n, latestUltimo)   : fmtDate(toISODate(latestUltimo)); }
                        if (filtro === 'curso') {
                          let earliest = null;
                          for (const p of pagos) {
                            const mp = Number(p.mesesPagados) || 0;
                            if (mp >= Number(m.mesesTotal)) continue;
                            const { cicloYear: cy, cicloMonth: cm } = calcularPagos(tc?.ciclo, p.fecha, Number(m.mesesTotal) || 0, festivosMX);
                            if (cy == null) continue;
                            const nx = new Date(cy, cm + mp, 1);
                            const pp = calcularMes(tc.ciclo, nx.getFullYear(), nx.getMonth(), festivosMX);
                            if (pp?.fechaPago && (!earliest || pp.fechaPago < earliest.fp)) earliest = { fp: pp.fechaPago, nom: anteriorNomina(pp.fechaPago, festivosMX) };
                          }
                          if (earliest) difProximoCell = earliest.nom ? _pagoHighlight(earliest.nom, earliest.fp) : fmtDate(toISODate(earliest.fp));
                        }
                      }

                      const parentRow = `<tr class="table-warning" style="cursor:pointer" data-toggle-diferido-msi="${m.id}">
                        <td>
                          <span data-dif-icon class="me-1" style="font-size:0.8rem">${expanded ? '▼' : '▶'}</span>
                          <span class="fw-500">${m.compra}</span>
                          <span class="badge bg-warning text-dark ms-1" style="font-size:var(--fs-nano)">Diferido</span>
                          ${m.enlaceCompra ? `<a href="${m.enlaceCompra}" target="_blank" rel="noopener" class="ms-1 text-muted"><i class="bi bi-box-arrow-up-right" style="font-size:0.72rem"></i></a>` : ''}
                          <div class="d-flex align-items-center gap-2 mt-1">
                            <div class="progress" style="width:120px;flex-shrink:0">
                              <div class="progress-bar ${doneParent ? 'bg-success' : 'bg-primary'}" style="width:${pctParent}%"></div>
                            </div>
                            <span style="font-size:0.7rem;white-space:nowrap" class="${allRegistered ? 'text-success' : 'text-danger'}">
                              ${allRegistered ? '✓' : `○ ${currency(pendingAmount)}`}
                            </span>
                          </div>
                        </td>
                        <td style="white-space:nowrap">${tc?.nombre || '—'}${lastFour ? ' ···' + lastFour : ''}</td>
                        <td class="text-center">${(() => {
                          if (!multiCiclo) return `${sumMesesPagados}/${m.mesesTotal || 0}`;
                          const mn = Math.min(...pagos.map(p => Number(p.mesesPagados) || 0));
                          const mx = Math.max(...pagos.map(p => Number(p.mesesPagados) || 0));
                          return mn === mx ? `${mn}/${m.mesesTotal || 0}` : `${mn}–${mx}/${m.mesesTotal || 0}`;
                        })()}</td>
                        <td style="white-space:nowrap">${m.fechaCompra ? fmtDate(m.fechaCompra) : '—'}</td>
                        <td style="white-space:nowrap">${difPrimerCell}</td>
                        ${filtro === 'curso' ? `<td style="white-space:nowrap">${difProximoCell}</td>` : ''}
                        <td style="white-space:nowrap">${difUltimoCell}</td>
                        <td class="text-end">${currency(totalMensualidad)}${doneParent ? ' <span class="text-success">✓</span>' : ''}</td>
                        <td class="text-end ${doneParent ? 'text-success' : 'fw-bold'}">
                          ${currency(totalRestante)}${doneParent ? ' <span class="text-success">✓</span>' : ''}
                        </td>
                        ${filtro === 'curso' ? `<td class="text-end">${_bonifTotal(m, Number(m.totalDiferido || 0), bonif)}</td>` : ''}
                        <td>
                          <div class="d-flex gap-1">
                            ${!allRegistered ? `<button class="btn-icon btn-add-pago-diferido-msi" data-id="${m.id}" data-coleccion="msi" title="Registrar pago"><i class="bi bi-plus-circle"></i></button>` : ''}
                            <button class="btn-icon btn-edit-msi" data-id="${m.id}"><i class="bi bi-pencil"></i></button>
                            <button class="btn-icon danger btn-del-msi" data-id="${m.id}"><i class="bi bi-trash3"></i></button>
                          </div>
                        </td>
                      </tr>`;

                      const pagoRows = expanded ? pagos.map(p => {
                        const pMens   = Number(p.mensualidad != null ? p.mensualidad : m.mensualidad) || 0;
                        const pMesPag = Number(p.mesesPagados) || 0;
                        const pRest   = p.restante != null ? Number(p.restante) : Math.max(0, Number(p.monto) - pMens * pMesPag);
                        const pDone   = pRest <= 0 || pMesPag >= Number(m.mesesTotal);
                        const pPct    = Math.round(pMesPag / (Number(m.mesesTotal) || 1) * 100);
                        const { primerPago: pp1, ultimoPago: up1, cicloYear: cy1, cicloMonth: cm1 } = calcularPagos(tc?.ciclo, p.fecha, Number(m.mesesTotal) || 0, festivosMX);
                        const nomPp1  = pp1 ? anteriorNomina(pp1, festivosMX) : null;
                        const nomUp1  = up1 ? anteriorNomina(up1, festivosMX) : null;
                        const pPrimerCell = nomPp1 ? _pagoMuted(nomPp1, pp1) : '—';
                        const pUltimoCell = nomUp1 ? _pagoMuted(nomUp1, up1) : '—';
                        let pProximoCell = '—';
                        if (filtro === 'curso' && !pDone && cy1 != null && pMesPag < Number(m.mesesTotal)) {
                          const nx = new Date(cy1, cm1 + pMesPag, 1);
                          const ppn = calcularMes(tc.ciclo, nx.getFullYear(), nx.getMonth(), festivosMX);
                          if (ppn?.fechaPago) { const n = anteriorNomina(ppn.fechaPago, festivosMX); pProximoCell = n ? _pagoHighlight(n, ppn.fechaPago) : fmtDate(toISODate(ppn.fechaPago)); }
                        }
                        return `<tr data-pago-de="${m.id}" class="row-highlight">
                          <td style="padding-left:28px;color:var(--text-muted);font-size:0.85rem">
                            └ Pago ${fmtDate(p.fecha)}
                            ${multiCiclo ? `<div class="progress mt-1" style="width:100px"><div class="progress-bar ${pDone ? 'bg-success' : 'bg-primary'}" style="width:${pPct}%"></div></div>` : ''}
                          </td>
                          <td></td>
                          <td class="text-center">${multiCiclo ? `${pMesPag}/${m.mesesTotal || 0}` : '—'}</td>
                          <td style="white-space:nowrap">${p.fecha ? fmtDate(p.fecha) : '—'}</td>
                          <td style="white-space:nowrap">${multiCiclo ? pPrimerCell : '—'}</td>
                          ${filtro === 'curso' ? `<td style="white-space:nowrap">${multiCiclo ? pProximoCell : '—'}</td>` : ''}
                          <td style="white-space:nowrap">${multiCiclo ? pUltimoCell : '—'}</td>
                          <td class="text-end">${currency(pMens)}</td>
                          <td class="text-end ${pDone ? 'text-success' : 'fw-bold'}">${pDone ? '✓ Pagado' : currency(pRest)}</td>
                          ${filtro === 'curso' ? `<td class="text-end">${currency(p.monto)}</td>` : ''}
                          <td>
                            <div class="d-flex gap-1">
                              <button class="btn-icon btn-edit-pago-msi-plan" data-id="${p.id}" title="Editar plan"><i class="bi bi-pencil"></i></button>
                              ${!pDone ? `<button class="btn-icon btn-pagar-cuota-diferido" data-id="${p.id}" data-compra-id="${m.id}" title="Pagar cuota"><i class="bi bi-coin"></i></button>` : ''}
                              <button class="btn-icon danger btn-del-pago-diferido-msi" data-id="${p.id}" data-compra-id="${m.id}" data-monto="${p.monto}" title="Eliminar"><i class="bi bi-trash3"></i></button>
                            </div>
                          </td>
                        </tr>`;
                      }).join('') : '';

                      return [parentRow, pagoRows];
                    }

                    const restanteEfectivo = m.restante != null
                      ? Number(m.restante)
                      : Math.max(0, (Number(m.total) || 0) - (Number(m.mensualidad) || 0) * (Number(m.mesesPagados) || 0));

                    const done = m.liquidado || restanteEfectivo <= 0;
                    const pct  = m.liquidado ? 100
                      : Math.round((Number(m.mesesPagados) || 0) / (Number(m.mesesTotal) || 1) * 100);

                    const restanteVal = mostrarTotal
                      ? currency(m.total)
                      : (m.liquidado ? '✓ Liquidado' : done ? '✓ Pagado' : currency(restanteEfectivo));
                    const restanteCls = mostrarTotal ? '' : done ? 'text-success' : 'fw-bold';

                    const isLiquidado = (filtro === 'liquidados' || m.liquidado) && m.fechaLiquidacion;

                    const ultimoPagoCell = isLiquidado
                      ? fmtDate(m.fechaLiquidacion)
                      : nomUltimo ? _pagoMuted(nomUltimo, ultimoPago) : '—';

                    let proximoPagoCell = '—';
                    if (!m.liquidado && primerPago && tc?.ciclo && cicloYear != null && Number(m.mesesPagados) < Number(m.mesesTotal)) {
                      const nx = new Date(cicloYear, cicloMonth + (Number(m.mesesPagados) || 0), 1);
                      const pp = calcularMes(tc.ciclo, nx.getFullYear(), nx.getMonth(), festivosMX);
                      if (pp?.fechaPago) {
                        const nomPx = anteriorNomina(pp.fechaPago, festivosMX);
                        proximoPagoCell = nomPx ? _pagoHighlight(nomPx, pp.fechaPago) : fmtDate(toISODate(pp.fechaPago));
                      }
                    }

                    return [`<tr class="${done ? 'table-success' : ''}">
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
                      <td style="white-space:nowrap">${m.fechaCompra ? fmtDate(m.fechaCompra) : '—'}</td>
                      <td style="white-space:nowrap">${primerPagoCell}</td>
                      ${filtro === 'curso' ? `<td style="white-space:nowrap">${proximoPagoCell}</td>` : ''}
                      <td style="white-space:nowrap">${ultimoPagoCell}</td>
                      <td class="text-end">${currency(m.mensualidad)}</td>
                      <td class="text-end ${restanteCls}">
                        ${mostrarTotal ? _bonifTotal(m, Number(m.total) || 0, !!tc?.inst?.bonificacionConIva) : restanteVal}
                      </td>
                      ${filtro === 'curso' ? `<td class="text-end">${_bonifTotal(m, Number(m.total) || 0, !!tc?.inst?.bonificacionConIva)}</td>` : ''}
                      <td>
                        <div class="d-flex gap-1">
                          ${!m.liquidado && Number(m.mesesPagados) < Number(m.mesesTotal) ? `<button class="btn-icon btn-pagar-msi" data-id="${m.id}" title="Registrar pago de mensualidad"><i class="bi bi-coin"></i></button>` : ''}
                          ${!m.liquidado ? `<button class="btn-icon btn-liquidar-msi" data-id="${m.id}" title="Liquidar"><i class="bi bi-check-circle"></i></button>` : ''}
                          <button class="btn-icon btn-edit-msi" data-id="${m.id}"><i class="bi bi-pencil"></i></button>
                          <button class="btn-icon danger btn-del-msi" data-id="${m.id}"><i class="bi bi-trash3"></i></button>
                        </div>
                      </td>
                    </tr>`];
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
  const lista   = (soloCredito ? tarjetas.filter(t => t.tipo === 'credito') : tarjetas).filter(t => !t.oculta);

  const _cardOpts = (cards, showInst = false) => cards
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .flatMap(t => {
      const numeros  = Array.isArray(t.numeros) ? t.numeros : [];
      const all      = [...numeros.filter(n => n.formato === 'fisica'  && n.numero),
                        ...numeros.filter(n => n.formato === 'digital' && n.numero)];
      const instPrefix = showInst && instMap[t.institucionId]?.nombre
        ? `${instMap[t.institucionId].nombre} — ` : '';
      if (!all.length) {
        const sel = item?.tarjetaId === t.id && !item?.numeroTarjeta ? 'selected' : '';
        return [`<option value="${t.id}::" ${sel}>${instPrefix}${t.nombre}</option>`];
      }
      return all.map(n => {
        const last4 = String(n.numero).replace(/\s/g, '').slice(-4);
        const tipo  = n.formato === 'fisica' ? 'Física' : 'Digital';
        const sel   = item?.tarjetaId === t.id && item?.numeroTarjeta === n.numero ? 'selected' : '';
        return `<option value="${t.id}::${n.numero}" ${sel}>${instPrefix}${t.nombre} ···${last4} (${tipo})</option>`;
      });
    }).join('');

  // Favoritas primero
  const favoritas = lista.filter(t => t.favorita);
  const normales  = lista.filter(t => !t.favorita);

  const favGroup = favoritas.length
    ? `<optgroup label="⭐ Favoritas">${_cardOpts(favoritas, true)}</optgroup>`
    : '';

  const byInst = {};
  normales.forEach(t => {
    const id = t.institucionId || '__';
    if (!byInst[id]) byInst[id] = { inst: instMap[id] || null, cards: [] };
    byInst[id].cards.push(t);
  });
  const instGroups = Object.values(byInst)
    .sort((a, b) => (a.inst?.nombre || '').localeCompare(b.inst?.nombre || '', 'es'))
    .map(({ inst, cards }) =>
      `<optgroup label="${inst?.nombre || 'Sin institución'}">${_cardOpts(cards)}</optgroup>`)
    .join('');

  return favGroup + instGroups;
}

// ── Modal De Contado ────────────────────────────────────────────────────────────

// ── Bonificación helpers ────────────────────────────────────────────────────────

function _bonifFields(item) {
  const b = item?.bonificacion;
  return `
    <div class="col-12">
      <div class="form-check mb-1">
        <input class="form-check-input" type="checkbox" id="has-bonif" ${b ? 'checked' : ''}>
        <label class="form-check-label" for="has-bonif" style="font-size:0.85rem">Esperar bonificación / cashback</label>
      </div>
      <div id="bonif-fields" ${b ? '' : 'style="display:none"'}>
        <div class="row g-2">
          <div class="col-4">
            <select class="form-select form-select-sm" name="bonificacionTipo">
              <option value="porcentaje" ${(!b || b.tipo === 'porcentaje') ? 'selected' : ''}>% Porcentaje</option>
              <option value="cantidad"   ${b?.tipo === 'cantidad' ? 'selected' : ''}>$ Cantidad</option>
            </select>
          </div>
          <div class="col-4">
            <input type="number" class="form-control form-control-sm" name="bonificacionValor"
                   value="${b?.valor ?? ''}" min="0" step="0.01" placeholder="Valor">
          </div>
          <div class="col-4">
            <input type="date" class="form-control form-control-sm" name="bonificacionFecha"
                   value="${b?.fechaMaxima ?? ''}">
          </div>
          <div class="col-12">
            <input type="url" class="form-control form-control-sm" name="bonificacionEnlace"
                   value="${b?.enlace ?? ''}" placeholder="Enlace de la promoción (opcional)">
          </div>
          <div class="col-12">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" name="bonificacionAplicada" id="bonif-aplicada" ${b?.aplicada ? 'checked' : ''}>
              <label class="form-check-label text-success" for="bonif-aplicada" style="font-size:0.82rem">Ya recibida / aplicada</label>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function _wireBonif() {
  const chk = document.getElementById('has-bonif');
  const flds = document.getElementById('bonif-fields');
  if (chk && flds) chk.addEventListener('change', () => { flds.style.display = chk.checked ? '' : 'none'; });
}

function _saveBonif(data) {
  const tipo     = data.bonificacionTipo;
  const valor    = Number(data.bonificacionValor);
  const fecha    = data.bonificacionFecha;
  const enlace   = data.bonificacionEnlace || '';
  const aplicada = !!data.bonificacionAplicada;
  delete data.bonificacionTipo; delete data.bonificacionValor; delete data.bonificacionFecha;
  delete data.bonificacionEnlace; delete data.bonificacionAplicada;
  const hasBonif = document.getElementById('has-bonif')?.checked;
  if (hasBonif && valor > 0 && fecha) {
    data.bonificacion = {
      tipo, valor, fechaMaxima: fecha,
      ...(enlace   ? { enlace }   : {}),
      ...(aplicada ? { aplicada } : {}),
    };
  } else {
    data.bonificacion = null;
  }
}

function _bonifBadge(item) {
  // Solo muestra indicador pequeño en el nombre; el detalle va junto al total
  const b = item?.bonificacion;
  if (!b) return '';
  const vencido = b.fechaMaxima < toISODate(new Date());
  return `<span class="${vencido ? 'text-danger' : 'text-success'}" style="font-size:0.7rem"><i class="bi bi-gift"></i></span>`;
}

function _bonifTotal(item, totalVal, conIva = false) {
  const b = item?.bonificacion;
  if (!b) return `<span class="fw-bold">${currency(totalVal)}</span>`;
  const montoBase = b.tipo === 'porcentaje' ? totalVal * (b.valor / 100) : Number(b.valor);
  const monto     = conIva ? montoBase * 1.16 : montoBase;
  const final     = totalVal - monto;
  const label     = b.tipo === 'porcentaje' ? `${b.valor}%` : currency(b.valor);
  const vencido = b.fechaMaxima < toISODate(new Date());
  const cls     = b.aplicada ? 'text-success' : vencido ? 'text-danger' : 'text-warning';
  return `
    <span class="fw-bold ${cls}">${currency(final)}</span>
    <span class="text-muted text-decoration-line-through ms-1" style="font-size:0.78rem">${currency(totalVal)}</span>
    <br><span class="${cls}" style="font-size:0.7rem"><i class="bi bi-gift me-1"></i>${label}${b.tipo === 'porcentaje' ? ` = ${currency(montoBase)}` : ''}${b.conIva ? ` +IVA = ${currency(monto)}` : ''} · ${fmtDate(b.fechaMaxima)}${b.enlace ? ` <a href="${b.enlace}" target="_blank" rel="noopener" class="${cls}" title="Ver promoción"><i class="bi bi-box-arrow-up-right" style="font-size:var(--fs-mini)"></i></a>` : ''}</span>`;
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
              ${buildCardOptions(compra, instituciones, tarjetas, true)}
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Fecha de compra *</label>
            <div class="d-flex align-items-center gap-1">
              <input type="date" class="form-control" style="min-width:0" name="fechaCompra" value="${(compra?.fechaCompra || toISODate(new Date())).slice(0, 10)}" required>
              <button type="button" class="btn-icon" data-toggle-time="fechaCompraTime" title="Registrar hora"><i class="bi bi-clock"></i></button>
              <div class="time-toggle-wrapper" style="display:none">
                <input type="time" class="form-control form-control-sm" name="fechaCompraTime" value="${_hasRealTime(compra?.fechaCompra) ? compra.fechaCompra.slice(11, 16) : ''}">
              </div>
            </div>
          </div>
          <div class="col-12">
            <div class="form-check form-switch mb-1">
              <input class="form-check-input" type="checkbox" id="chk-diferido-contado" name="diferido" value="1" ${compra?.diferido ? 'checked' : ''}>
              <label class="form-check-label" for="chk-diferido-contado">Pagos diferidos</label>
              <small class="text-muted ms-2">El total se irá cubriendo con pagos posteriores</small>
            </div>
          </div>
          <div class="col-12">
            <label class="form-label" id="lbl-total-contado">Total *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="total" value="${compra?.diferido ? (compra?.totalDiferido || compra?.total || '') : (compra?.total || '')}" required min="0" step="0.01">
            </div>
            <div id="diferido-hint-contado" class="form-text" style="display:${compra?.diferido ? 'block' : 'none'}">
              Este monto total afecta al límite disponible. Los pagos registrados lo reducirán.
            </div>
          </div>
          <div class="col-12">
            <label class="form-label">Enlace de la compra</label>
            <input type="url" class="form-control" name="enlaceCompra" value="${compra?.enlaceCompra || ''}" placeholder="https://...">
          </div>
          ${_bonifFields(compra)}
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-contado">${isEdit ? 'Guardar' : 'Crear'}</button>`
  });

  _wireBonif();
  _wireTimeToggle();
  _wireTimePicker();

  const chkDif  = document.getElementById('chk-diferido-contado');
  const hintDif = document.getElementById('diferido-hint-contado');
  chkDif?.addEventListener('change', () => {
    hintDif.style.display = chkDif.checked ? 'block' : 'none';
  });

  document.getElementById('btn-save-contado').addEventListener('click', async () => {
    const form = document.getElementById('contado-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    const [tarjetaId, numeroTarjeta] = (data.tarjetaId || '').split('::');
    data.tarjetaId     = tarjetaId;
    data.numeroTarjeta = numeroTarjeta || '';
    const totalVal = Number(data.total);
    if (data.diferido === '1') {
      data.diferido      = true;
      data.totalDiferido = totalVal;
      // total = pending amount; on create = full amount; on edit preserve pending
      data.total = isEdit && compra.diferido ? Number(compra.total) : totalVal;
    } else {
      delete data.diferido;
      data.total = totalVal;
    }
    if (!data.enlaceCompra) delete data.enlaceCompra;
    data.fechaCompra = _applyTime(data.fechaCompra, data.fechaCompraTime); delete data.fechaCompraTime;
    _saveBonif(data);
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
            <div class="d-flex align-items-center gap-1">
              <input type="date" class="form-control" style="min-width:0" name="fechaCompra" value="${(msi?.fechaCompra || toISODate(new Date())).slice(0, 10)}" required>
              <button type="button" class="btn-icon" data-toggle-time="fechaCompraTime" title="Registrar hora"><i class="bi bi-clock"></i></button>
              <div class="time-toggle-wrapper" style="display:none">
                <input type="time" class="form-control form-control-sm" name="fechaCompraTime" value="${_hasRealTime(msi?.fechaCompra) ? msi.fechaCompra.slice(11, 16) : ''}">
              </div>
            </div>
          </div>
          <div class="col-12">
            <div class="form-check form-switch mb-1">
              <input class="form-check-input" type="checkbox" id="chk-diferido-msi" name="diferido" value="1" ${msi?.diferido ? 'checked' : ''}>
              <label class="form-check-label" for="chk-diferido-msi">Pagos diferidos</label>
              <small class="text-muted ms-2">El total se irá cubriendo con pagos posteriores</small>
            </div>
          </div>
          <div class="col-md-6">
            <label class="form-label">Total de la compra *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="total" value="${msi?.diferido ? (msi?.totalDiferido || msi?.total || '') : (msi?.total || '')}" required min="0" step="0.01">
            </div>
            <div id="diferido-hint-msi" class="form-text" style="display:${msi?.diferido ? 'block' : 'none'}">
              Este monto total afecta al límite disponible. Los pagos registrados lo reducirán.
            </div>
          </div>
          <div class="col-md-3">
            <label class="form-label">Meses totales *</label>
            <input type="number" class="form-control" name="mesesTotal" value="${msi?.mesesTotal || ''}" required min="1" max="48">
          </div>
          <div class="col-md-3">
            <label class="form-label">Meses pagados</label>
            <input type="number" class="form-control" name="mesesPagados" value="${msi?.mesesPagados || 0}" min="0" id="msi-meses-pagados">
          </div>
          <div class="col-md-6">
            <label class="form-label">Mensualidad *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="mensualidad" value="${msi?.mensualidad || ''}" required min="0" step="0.01">
            </div>
          </div>
          <div class="col-md-6">
            <label class="form-label">Restante</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="restante" id="msi-restante"
                     value="${msi != null ? (msi.restante != null ? msi.restante : Math.max(0, (Number(msi.total)||0) - (Number(msi.mensualidad)||0) * (Number(msi.mesesPagados)||0))) : ''}"
                     min="0" step="0.01">
            </div>
          </div>
          <div class="col-12">
            <label class="form-label">Enlace de la compra</label>
            <input type="url" class="form-control" name="enlaceCompra" value="${msi?.enlaceCompra || ''}" placeholder="https://...">
          </div>
          ${_bonifFields(msi)}
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-msi">${isEdit ? 'Guardar' : 'Crear'}</button>`
  });

  _wireBonif();
  _wireTimeToggle();
  _wireTimePicker();

  const chkDifMsi  = document.getElementById('chk-diferido-msi');
  const hintDifMsi = document.getElementById('diferido-hint-msi');
  chkDifMsi?.addEventListener('change', () => {
    hintDifMsi.style.display = chkDifMsi.checked ? 'block' : 'none';
  });

  const _recalcMsi = () => {
    const total    = Number(document.querySelector('#msi-form [name=total]').value)    || 0;
    const meses    = Number(document.querySelector('#msi-form [name=mesesTotal]').value) || 0;
    const mens     = Number(document.querySelector('#msi-form [name=mensualidad]').value) || 0;
    const pagados  = Number(document.querySelector('#msi-form [name=mesesPagados]').value) || 0;
    if (total > 0 && meses > 0)
      document.querySelector('#msi-form [name=mensualidad]').value = (total / meses).toFixed(2);
    const mensUsada = Number(document.querySelector('#msi-form [name=mensualidad]').value) || 0;
    document.getElementById('msi-restante').value = Math.max(0, total - mensUsada * pagados).toFixed(2);
  };
  ['total', 'mesesTotal'].forEach(name => {
    document.querySelector(`#msi-form [name="${name}"]`).addEventListener('input', _recalcMsi);
  });
  ['mensualidad', 'mesesPagados'].forEach(name => {
    document.querySelector(`#msi-form [name="${name}"]`).addEventListener('input', () => {
      const total   = Number(document.querySelector('#msi-form [name=total]').value) || 0;
      const mens    = Number(document.querySelector('#msi-form [name=mensualidad]').value) || 0;
      const pagados = Number(document.querySelector('#msi-form [name=mesesPagados]').value) || 0;
      document.getElementById('msi-restante').value = Math.max(0, total - mens * pagados).toFixed(2);
    });
  });

  document.getElementById('btn-save-msi').addEventListener('click', async () => {
    const form = document.getElementById('msi-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    const [tarjetaId, numeroTarjeta] = (data.tarjetaId || '').split('::');
    data.tarjetaId     = tarjetaId;
    data.numeroTarjeta = numeroTarjeta || '';
    const totalVal     = Number(data.total);
    data.mensualidad   = Number(data.mensualidad);
    data.mesesTotal    = Number(data.mesesTotal);
    data.mesesPagados  = Number(data.mesesPagados);
    if (data.diferido === '1') {
      data.diferido      = true;
      data.totalDiferido = totalVal;
      data.total         = isEdit && msi.diferido ? Number(msi.total) : totalVal;
    } else {
      delete data.diferido;
      data.total = totalVal;
    }
    data.restante      = data.restante !== '' ? r2(Number(data.restante)) : r2(Math.max(0, data.total - data.mensualidad * data.mesesPagados));
    if (!data.enlaceCompra) delete data.enlaceCompra;
    data.fechaCompra = _applyTime(data.fechaCompra, data.fechaCompraTime); delete data.fechaCompraTime;
    _saveBonif(data);
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

function showModalConfirmarGasto(pendiente, instituciones, tarjetas, onSaved) {
  const tc = tarjetas.find(t => t.id === pendiente.tarjetaId);
  const lastFour = pendiente.numeroTarjeta
    ? String(pendiente.numeroTarjeta).replace(/\s/g, '').slice(-4)
    : (() => {
        const nums = Array.isArray(tc?.numeros) ? tc.numeros : [];
        const n = nums.find(x => x.formato === 'fisica' && x.numero) || nums.find(x => x.numero);
        return n ? String(n.numero).replace(/\s/g, '').slice(-4) : '';
      })();

  openModal({
    title: 'Confirmar Gasto Fijo',
    body: `
      <form id="confirmar-gasto-form">
        <div class="row g-3">
          <div class="col-12">
            <label class="form-label">Nombre</label>
            <input type="text" class="form-control" name="nombre" value="${pendiente.nombre}" required>
          </div>
          <div class="col-12">
            <label class="form-label">Tarjeta</label>
            <input type="text" class="form-control" value="${tc ? tc.nombre + (lastFour ? ' ···' + lastFour : '') : '—'}" disabled>
          </div>
          <div class="col-md-6">
            <label class="form-label">Forma de Pago</label>
            <select class="form-select" name="formaPago">
              <option value="automatico"    ${pendiente.formaPago === 'automatico'    ? 'selected' : ''}>Automático</option>
              <option value="retiro"        ${pendiente.formaPago === 'retiro'        ? 'selected' : ''}>Retiro</option>
              <option value="transferencia" ${pendiente.formaPago === 'transferencia' ? 'selected' : ''}>Transferencia</option>
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Fecha de Pago *</label>
            <input type="date" class="form-control" name="fechaPago" value="${(pendiente.fechaPago || '').slice(0, 10)}" required>
          </div>
          <div class="col-12">
            <label class="form-label">Importe *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="importe" value="${pendiente.importe || ''}" required min="0" step="0.01">
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
    data.importe = Number(data.importe);
    data.estado  = 'registrado';
    if (data.fechaPago?.length === 10) data.fechaPago = _addTime(data.fechaPago);
    try {
      await update('gastos', pendiente.id, data);
      closeModal();
      toast('Gasto registrado');
      onSaved();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

// ── Modal Nuevo Gasto Manual ────────────────────────────────────────────────────

function showModalNuevoGasto(gasto, instituciones, tarjetas, onSaved) {
  const isEdit     = !!gasto;
  const esFijo     = !!(gasto?.gastaFijoId || gasto?.tipo === 'gastaFijo');
  const cardPool   = esFijo ? tarjetas : tarjetas.filter(t => t.tipo === 'debito');
  const cardOpts   = buildCardOptions(
    gasto ? { tarjetaId: gasto.tarjetaId, numeroTarjeta: gasto.numeroTarjeta } : null,
    instituciones,
    cardPool,
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
            <label class="form-label">Tarjeta${esFijo ? '' : ' (débito)'} *</label>
            <select class="form-select" name="tarjetaId" required>
              <option value="">— Seleccionar —</option>
              ${cardOpts}
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Forma de Pago *</label>
            <select class="form-select" name="formaPago" required>
              <option value="">— Seleccionar —</option>
              <option value="automatico"    ${gasto?.formaPago === 'automatico'    ? 'selected' : ''}>Pago Automático</option>
              <option value="retiro"        ${gasto?.formaPago === 'retiro'        ? 'selected' : ''}>Retiro</option>
              <option value="transferencia" ${gasto?.formaPago === 'transferencia' ? 'selected' : ''}>Transferencia</option>
            </select>
          </div>
          <div class="col-12">
            <label class="form-label">Fecha de Pago *</label>
            <div class="d-flex align-items-center gap-1">
              <input type="date" class="form-control" style="min-width:0" name="fechaPago" value="${(gasto?.fechaPago || toISODate(new Date())).slice(0, 10)}" required>
              <button type="button" class="btn-icon" data-toggle-time="fechaPagoTime" title="Registrar hora"><i class="bi bi-clock"></i></button>
              <div class="time-toggle-wrapper" style="display:none">
                <input type="time" class="form-control form-control-sm" name="fechaPagoTime" value="${_hasRealTime(gasto?.fechaPago) ? gasto.fechaPago.slice(11, 16) : ''}">
              </div>
            </div>
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

  _wireTimeToggle();
  _wireTimePicker();

  document.getElementById('btn-save-nuevo-gasto').addEventListener('click', async () => {
    const form = document.getElementById('nuevo-gasto-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    const [tarjetaId, numeroTarjeta] = (data.tarjetaId || '').split('::');
    data.tarjetaId     = tarjetaId;
    data.numeroTarjeta = numeroTarjeta || '';
    data.importe       = Number(data.importe);
    data.tipo          = 'manual';
    data.estado        = 'registrado';
    data.fechaPago = _applyTime(data.fechaPago, data.fechaPagoTime); delete data.fechaPagoTime;
    data.mes           = (data.fechaPago || '').slice(0, 7) || (gasto?.mes || toISODate(new Date()).slice(0, 7));
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

// ── Helpers de navegación de mes ───────────────────────────────────────────────

function _mesAnterior(mes) {
  const [y, m] = mes.split('-').map(Number);
  return toISODate(new Date(y, m - 2, 1)).slice(0, 7);
}

function _mesSiguiente(mes) {
  const [y, m] = mes.split('-').map(Number);
  return toISODate(new Date(y, m, 1)).slice(0, 7);
}

function _labelMes(mes) {
  const [y, m] = mes.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
}

// ── Modal Registrar Pago Diferido ──────────────────────────────────────────────

function _showModalPagoDiferido(pago, compra, coleccion, pagosDiferidos, onSaved) {
  if (!compra) return;
  const isEdit = !!pago;
  const mesesTotal      = Number(compra.mesesTotal) || 0;
  const pagosExistentes = pagosDiferidos.filter(p => p.compraId === compra.id && (!isEdit || p.id !== pago.id));
  const yaRegistrado    = pagosExistentes.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const pendiente       = Number(compra.totalDiferido || (compra.total + (isEdit ? Number(pago.monto) : 0))) - yaRegistrado;
  const montoInicial    = Number(pago?.monto) || 0;
  const mensInit        = pago?.mensualidad != null
    ? Number(pago.mensualidad)
    : (mesesTotal > 0 ? montoInicial / mesesTotal : 0);
  const restInit        = pago?.restante != null
    ? Number(pago.restante)
    : montoInicial;

  const isContado = coleccion === 'contado';

  openModal({
    title: isEdit ? 'Editar Pago' : `Registrar Pago — ${compra.compra}`,
    body: `
      <form id="pago-dif-form">
        <div class="row g-3">
          <div class="col-12">
            <div class="alert alert-info py-2 mb-0" style="font-size:0.85rem">
              <strong>Pendiente por registrar:</strong> ${currency(Math.max(0, pendiente))}
            </div>
          </div>
          <div class="col-md-6" id="pd-fecha-col">
            <label class="form-label">Fecha de pago *</label>
            <div class="d-flex align-items-center gap-1">
              <input type="date" class="form-control" style="min-width:0" name="fecha" value="${(pago?.fecha || toISODate(new Date())).slice(0, 10)}" required>
              <button type="button" class="btn-icon" data-toggle-time="fechaTime" title="Registrar hora"><i class="bi bi-clock"></i></button>
              <div class="time-toggle-wrapper" style="display:none">
                <input type="time" class="form-control form-control-sm" name="fechaTime" value="${_hasRealTime(pago?.fecha) ? pago.fecha.slice(11, 16) : ''}">
              </div>
            </div>
          </div>
          <div class="col-md-6" id="pd-monto-col">
            <label class="form-label">Monto *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" id="pd-monto" name="monto" value="${isEdit ? (montoInicial || '') : Math.max(0, pendiente).toFixed(2)}"
                required min="0.01" step="0.01" max="${pendiente.toFixed(2)}" placeholder="0.00">
            </div>
          </div>
          ${!isContado ? `
          <div class="col-md-6">
            <label class="form-label">Mensualidad</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" id="pd-mensualidad" name="mensualidad"
                value="${mensInit ? mensInit.toFixed(2) : ''}" min="0" step="0.01" placeholder="0.00">
              <button type="button" class="btn btn-outline-secondary" id="pd-btn-recalc" title="Recalcular mensualidad">↺</button>
            </div>
          </div>
          <div class="col-md-6">
            <label class="form-label">Restante</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" id="pd-restante" name="restante"
                value="${restInit ? restInit.toFixed(2) : ''}" min="0" step="0.01" placeholder="0.00">
            </div>
          </div>` : ''}
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-pago-dif">${isEdit ? 'Guardar' : 'Registrar'}</button>`
  });

  const montoEl = document.getElementById('pd-monto');
  const mensEl  = document.getElementById('pd-mensualidad');
  const restEl  = document.getElementById('pd-restante');

  const _recalcMens = () => {
    const mt = Number(montoEl?.value) || 0;
    if (mensEl && mesesTotal > 0) mensEl.value = (mt / mesesTotal).toFixed(2);
    if (restEl) restEl.value = mt.toFixed(2);
  };

  _wireTimeToggle();
  _wireTimePicker();

  const _pdAdjustCols = (on) => {
    const fechaCol = document.getElementById('pd-fecha-col');
    const montoCol = document.getElementById('pd-monto-col');
    if (!fechaCol || !montoCol) return;
    fechaCol.classList.toggle('col-md-8', on);
    fechaCol.classList.toggle('col-md-6', !on);
    montoCol.classList.toggle('col-md-4', on);
    montoCol.classList.toggle('col-md-6', !on);
  };
  _pdAdjustCols(false);
  document.querySelector('[data-toggle-time="fechaTime"]')
    ?.addEventListener('click', () => {
      const on = document.querySelector('[name="fechaTime"]')
        ?.closest('.time-toggle-wrapper')?.style.display !== 'none';
      _pdAdjustCols(on);
    });

  if (!isEdit) _recalcMens();
  montoEl?.addEventListener('input', _recalcMens);
  document.getElementById('pd-btn-recalc')?.addEventListener('click', _recalcMens);

  document.getElementById('btn-save-pago-dif').addEventListener('click', async () => {
    const form = document.getElementById('pago-dif-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    data.monto = Number(data.monto);
    const newMensualidad = (data.mensualidad != null && data.mensualidad !== '') ? Number(data.mensualidad) : null;
    const newRestante    = (data.restante    != null && data.restante    !== '') ? Number(data.restante)    : null;
    if (data.monto <= 0) { toast('El monto debe ser mayor a 0', 'warning'); return; }
    if (data.monto > pendiente + 0.01) { toast('El monto supera el pendiente', 'warning'); return; }
    if (newRestante != null && newRestante > data.monto + 0.005) { toast('El restante no puede ser mayor al monto', 'warning'); return; }
    data.fecha = _applyTime(data.fecha, data.fechaTime); delete data.fechaTime;

    try {
      if (isEdit) {
        const diff = data.monto - Number(pago.monto);
        const upd = { fecha: data.fecha, monto: data.monto };
        if (newMensualidad != null) upd.mensualidad = newMensualidad;
        if (newRestante    != null) upd.restante    = newRestante;
        await update('pagosDiferidos', pago.id, upd);
        const idx = pagosDiferidos.findIndex(x => x.id === pago.id);
        if (idx >= 0) Object.assign(pagosDiferidos[idx], upd);
        compra.total = r2(Math.max(0, Number(compra.total) - diff));
        await update(coleccion, compra.id, { total: compra.total });
      } else {
        const newPago = {
          compraId: compra.id,
          compraColeccion: coleccion,
          tarjetaId: compra.tarjetaId,
          fecha: data.fecha,
          monto: data.monto
        };
        if (newMensualidad != null) newPago.mensualidad = newMensualidad;
        if (newRestante    != null) newPago.restante    = newRestante;
        const id = await create('pagosDiferidos', newPago);
        pagosDiferidos.push({ ...newPago, id });
        compra.total = r2(Math.max(0, Number(compra.total) - data.monto));
        await update(coleccion, compra.id, { total: compra.total });
      }
      closeModal();
      toast(isEdit ? 'Pago actualizado' : 'Pago registrado');
      onSaved();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

// ── Modal Editar Plan de Pago Diferido (meses, mensualidad, restante) ──────────

function _showModalEditPagoPlan(pago, compra, pagosDiferidos, onSaved) {
  if (!pago || !compra) return;
  const mesesTotal         = Number(compra.mesesTotal) || 0;
  const mensualidadDefault = Number(compra.mensualidad) || 0;
  const mesesPagados       = Number(pago.mesesPagados) || 0;
  const montoOrig          = Number(pago.monto) || 0;
  const mensualidad        = Number(pago.mensualidad != null ? pago.mensualidad : mensualidadDefault) || 0;
  const restante           = pago.restante != null
    ? Number(pago.restante)
    : Math.max(0, montoOrig - mensualidad * mesesPagados);
  // Max monto = saldo pendiente de la compra + lo que ya tiene este pago
  const maxMonto = (Number(compra.total) || 0) + montoOrig;

  openModal({
    title: `Plan de Pago — ${fmtDate(pago.fecha)}`,
    body: `
      <form id="pago-plan-form">
        <div class="row g-3">
          <div class="col-12">
            <div class="alert alert-info py-2 mb-0" style="font-size:0.85rem">
              ${mesesTotal} meses · Disponible para reasignar: <strong>${currency(maxMonto)}</strong>
            </div>
          </div>
          <div class="col-md-6" id="pp-fecha-col">
            <label class="form-label">Fecha de pago</label>
            <div class="d-flex align-items-center gap-1">
              <input type="date" class="form-control" style="min-width:0" name="fecha" id="pp-fecha"
                value="${(pago.fecha || '').slice(0, 10)}" required>
              <button type="button" class="btn-icon" data-toggle-time="fechaTime" title="Registrar hora"><i class="bi bi-clock"></i></button>
              <div class="time-toggle-wrapper" style="display:none">
                <input type="time" class="form-control form-control-sm" name="fechaTime"
                  value="${_hasRealTime(pago.fecha) ? pago.fecha.slice(11, 16) : ''}">
              </div>
            </div>
          </div>
          <div class="col-md-6" id="pp-monto-col">
            <label class="form-label">Total pago</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="monto" id="pp-monto"
                value="${montoOrig.toFixed(2)}" min="0.01" max="${maxMonto.toFixed(2)}" step="0.01">
            </div>
          </div>
          <div class="col-md-6">
            <label class="form-label">Meses pagados</label>
            <input type="number" class="form-control" name="mesesPagados" id="pp-meses-pagados"
              value="${mesesPagados}" min="0" max="${mesesTotal}">
          </div>
          <div class="col-md-6">
            <label class="form-label">Mensualidad</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="mensualidad" id="pp-mensualidad"
                value="${mensualidad.toFixed(2)}" min="0" step="0.01">
              <button type="button" class="btn btn-outline-secondary" id="btn-recalc-mens" title="Recalcular mensualidad">↺</button>
            </div>
          </div>
          <div class="col-md-6">
            <label class="form-label">Restante</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="restante" id="pp-restante"
                value="${restante.toFixed(2)}" min="0" step="0.01">
            </div>
          </div>
        </div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-pago-plan">Guardar</button>`
  });

  _wireTimeToggle();
  _wireTimePicker();

  const _ppAdjustCols = (on) => {
    const fechaCol = document.getElementById('pp-fecha-col');
    const montoCol = document.getElementById('pp-monto-col');
    if (!fechaCol || !montoCol) return;
    fechaCol.classList.toggle('col-md-8', on);
    fechaCol.classList.toggle('col-md-6', !on);
    montoCol.classList.toggle('col-md-4', on);
    montoCol.classList.toggle('col-md-6', !on);
  };
  _ppAdjustCols(false);
  document.querySelector('[data-toggle-time="fechaTime"]')
    ?.addEventListener('click', () => {
      const on = document.querySelector('[name="fechaTime"]')
        ?.closest('.time-toggle-wrapper')?.style.display !== 'none';
      _ppAdjustCols(on);
    });

  const montoEl = document.getElementById('pp-monto');
  const mesesEl = document.getElementById('pp-meses-pagados');
  const mensEl  = document.getElementById('pp-mensualidad');
  const restEl  = document.getElementById('pp-restante');

  const _recalcRestante = () => {
    const mt = Number(montoEl?.value) || 0;
    const mp = Number(mesesEl?.value) || 0;
    const mn = Number(mensEl?.value) || 0;
    if (restEl) restEl.value = Math.max(0, mt - mn * mp).toFixed(2);
  };

  document.getElementById('btn-recalc-mens')?.addEventListener('click', () => {
    const mt = Number(montoEl?.value) || 0;
    if (mensEl && mesesTotal > 0) mensEl.value = (mt / mesesTotal).toFixed(2);
    _recalcRestante();
  });

  montoEl?.addEventListener('input', _recalcRestante);
  mesesEl?.addEventListener('input', _recalcRestante);
  mensEl?.addEventListener('input', _recalcRestante);

  document.getElementById('btn-save-pago-plan').addEventListener('click', async () => {
    const form = document.getElementById('pago-plan-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data       = Object.fromEntries(new FormData(form));
    const newMonto   = Number(data.monto);
    const newRestante = Number(data.restante);

    if (newRestante > newMonto + 0.005) {
      toast('El restante no puede ser mayor al total del pago', 'danger'); return;
    }
    if (newMonto > maxMonto + 0.005) {
      toast(`El total no puede ser mayor a ${currency(maxMonto)}`, 'danger'); return;
    }

    const newFecha = _applyTime(data.fecha, data.fechaTime);
    delete data.fechaTime;
    const updates = {
      fecha:        newFecha,
      monto:        newMonto,
      mesesPagados: Number(data.mesesPagados),
      mensualidad:  Number(data.mensualidad),
      restante:     newRestante
    };
    try {
      await update('pagosDiferidos', pago.id, updates);
      if (Math.abs(newMonto - montoOrig) > 0.005) {
        compra.total = r2((Number(compra.total) || 0) + montoOrig - newMonto);
        await update('msi', compra.id, { total: compra.total });
      }
      Object.assign(pago, updates);
      const idx = pagosDiferidos.findIndex(x => x.id === pago.id);
      if (idx >= 0) Object.assign(pagosDiferidos[idx], updates);
      closeModal();
      toast('Plan actualizado');
      onSaved();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
