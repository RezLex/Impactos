import { getAll, recentWhere } from '../utils/db.js';
import { maskCard, currency, fmtShortDate, currentYYYYMM, nextMonth } from '../utils/formatters.js';
import { toISODate, calcularMes } from '../utils/ciclo.js';
import { calcularSaldo } from '../utils/saldo.js';

const COLORS = {
  'Banamex':'#e31837','Banorte':'#da1c2b','BBVA':'#004481',
  'Mercado Pago':'#009ee3','NU':'#820ad1','Rappi':'#ff441f',
  'Revolut':'#0075eb','Santander':'#ec0000'
};

const TIPO_BADGE = {
  credito:  { cls: 'badge-credito',  label: 'Crédito'  },
  debito:   { cls: 'badge-debito',   label: 'Débito'   },
  prestamo: { cls: 'badge-prestamo', label: 'Préstamo' },
};

const TIPO_ORDER = { debito: 0, credito: 1, prestamo: 2 };

function darkenHex(hex, amount = 45) {
  const h = (hex || '#607d8b').replace('#', '');
  const r = Math.max(0, parseInt(h.slice(0,2),16)-amount);
  const g = Math.max(0, parseInt(h.slice(2,4),16)-amount);
  const b = Math.max(0, parseInt(h.slice(4,6),16)-amount);
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}

function redIcon(red) {
  switch (red) {
    case 'Visa':
      return `<svg class="bct-net" viewBox="0 0 46 16" aria-label="Visa"><text x="1" y="15" font-family="Times New Roman,serif" font-style="italic" font-weight="900" font-size="18" fill="white">VISA</text></svg>`;
    case 'Mastercard':
      return `<svg class="bct-net" viewBox="0 0 34 22" aria-label="Mastercard"><circle cx="11" cy="11" r="11" fill="#EB001B"/><circle cx="23" cy="11" r="11" fill="#F79E1B" fill-opacity=".9"/></svg>`;
    case 'Maestro':
      return `<svg class="bct-net" viewBox="0 0 34 22" aria-label="Maestro"><circle cx="11" cy="11" r="11" fill="#CC0000" fill-opacity=".9"/><circle cx="23" cy="11" r="11" fill="#009BE0" fill-opacity=".9"/></svg>`;
    case 'Amex':
      return `<svg class="bct-net" viewBox="0 0 44 16" aria-label="Amex"><text x="0" y="13" font-family="Arial,sans-serif" font-weight="800" font-size="12" fill="white" letter-spacing="2">AMEX</text></svg>`;
    case 'Carnet':
      return `<svg class="bct-net" viewBox="0 0 52 16" aria-label="Carnet"><text x="0" y="13" font-family="Arial,sans-serif" font-weight="700" font-size="12" fill="white" letter-spacing="1">CARNET</text></svg>`;
    case 'Discover':
      return `<svg class="bct-net" viewBox="0 0 60 16" aria-label="Discover"><text x="0" y="13" font-family="Arial,sans-serif" font-weight="700" font-size="11" fill="white" letter-spacing=".5">DISCOVER</text></svg>`;
    default: return '';
  }
}

export async function render(container) {
  container.innerHTML = `<div class="loading-overlay"><div class="spinner-border text-primary" role="status"></div></div>`;
  await renderView(container);
}

async function renderView(container) {
  try {
    const [instituciones, tarjetas, festivosMX, contado, msi, gastos] = await Promise.all([
      getAll('instituciones'),
      getAll('tarjetas'),
      getAll('festivosMX'),
      getAll('contado'),
      getAll('msi'),
      getAll('gastos', recentWhere('mes')),
    ]);

    const saldoMap = new Map(
      tarjetas.map(t => [t.id, calcularSaldo(t, contado, msi, gastos)])
    );

    const instMap = {};
    instituciones.forEach(i => { instMap[i.id] = i; });

    let filtroTipo = 'todos';
    let filtroInst = '';

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Tarjetas</h2>
          <p>${tarjetas.length} tarjetas</p>
        </div>
      </div>
      <div class="filter-bar">
        <div class="filter-chips" id="filtro-tipo">
          <button class="filter-chip active" data-tipo="todos">Todas</button>
          <button class="filter-chip" data-tipo="debito">Débito</button>
          <button class="filter-chip" data-tipo="credito">Crédito</button>
          <button class="filter-chip" data-tipo="prestamo">Préstamo</button>
        </div>
        <select class="filter-select" id="filtro-inst">
          <option value="">Todas las instituciones</option>
          ${instituciones
              .sort((a,b) => a.nombre.localeCompare(b.nombre,'es'))
              .map(i => `<option value="${i.id}">${i.nombre}</option>`)
              .join('')}
        </select>
      </div>
      <div class="wallet-grid" id="wallet-grid"></div>`;

    const renderGrid = () => {
      const grid = document.getElementById('wallet-grid');

      const filtered = tarjetas
        .filter(t => {
          if (filtroTipo !== 'todos' && t.tipo !== filtroTipo) return false;
          if (filtroInst && t.institucionId !== filtroInst) return false;
          return true;
        })
        .sort((a, b) => {
          const na = instMap[a.institucionId]?.nombre || '';
          const nb = instMap[b.institucionId]?.nombre || '';
          const ic = na.localeCompare(nb, 'es');
          if (ic !== 0) return ic;
          const tc = (TIPO_ORDER[a.tipo] ?? 3) - (TIPO_ORDER[b.tipo] ?? 3);
          if (tc !== 0) return tc;
          return a.nombre.localeCompare(b.nombre, 'es');
        });

      if (filtered.length === 0) {
        grid.innerHTML = `<div class="empty-state"><i class="bi bi-credit-card-2-front"></i><p>No hay tarjetas para mostrar.</p></div>`;
        grid.classList.remove('wallet-stack');
        return;
      }

      grid.innerHTML = filtered.map(t => renderWalletCard(t, instMap[t.institucionId], festivosMX, saldoMap.get(t.id))).join('');

      const shells = [...grid.querySelectorAll('.wcard-shell')];
      const mobile = window.innerWidth < 992;

      if (mobile && shells.length > 1) {
        // ── Stack mode — Opción C (móvil) ────────────────────────────────────
        grid.classList.add('wallet-stack');
        let activeIdx = 0;

        const updateStack = () => {
          shells.forEach((shell, i) => {
            const active = i === activeIdx;
            shell.classList.toggle('stack-active', active);
            if (!active) shell.querySelector('.wcard-wrap').classList.remove('flipped');
          });

          shells.forEach((shell, i) => {
            if (shell.classList.contains('stack-active')) {
              shell.style.borderRadius = '12px';
              return;
            }
            const nextActive = i < shells.length - 1 && shells[i + 1].classList.contains('stack-active');
            const isLast = i === shells.length - 1 || nextActive;
            shell.style.borderRadius = isLast ? '12px' : '12px 12px 0 0';
          });

          // Márgenes y z-index por JS para separación uniforme
          shells.forEach((shell, i) => {
            const active = shell.classList.contains('stack-active');
            const isFirst = i === 0;
            const prevIsActive = i > 0 && shells[i - 1].classList.contains('stack-active');
            const isLast = i === shells.length - 1;

            if (isFirst)           shell.style.marginTop = '0px';
            else if (active)       shell.style.marginTop = '12px';
            else if (prevIsActive) shell.style.marginTop = '0px';
            else                   shell.style.marginTop = '-14px';

            shell.style.marginBottom = (active && !isLast) ? '12px' : '0px';

            shell.style.zIndex = active ? shells.length + 1 : i + 1;
          });

          shells[activeIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };

        shells.forEach((shell, i) => {
          shell.addEventListener('click', e => {
            if (e.target.closest('.btn-copy-data')) return;
            if (i !== activeIdx) {
              activeIdx = i;
              updateStack();
            } else {
              shell.querySelector('.wcard-wrap').classList.toggle('flipped');
            }
          });
        });

        updateStack();
      } else {
        // ── Grid mode (desktop) ──────────────────────────────────────────────
        grid.classList.remove('wallet-stack');
        shells.forEach(shell => {
          shell.querySelector('.wcard-wrap').addEventListener('click', e => {
            if (!e.target.closest('.btn-copy-data')) {
              shell.querySelector('.wcard-wrap').classList.toggle('flipped');
            }
          });
        });
      }

      // Copy buttons (todos los modos)
      grid.querySelectorAll('.btn-copy-data').forEach(btn => {
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
    };

    document.getElementById('filtro-tipo').addEventListener('click', e => {
      const btn = e.target.closest('[data-tipo]');
      if (!btn) return;
      document.querySelectorAll('#filtro-tipo [data-tipo]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filtroTipo = btn.dataset.tipo;
      renderGrid();
    });

    document.getElementById('filtro-inst').addEventListener('change', e => {
      filtroInst = e.target.value;
      renderGrid();
    });

    renderGrid();
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

function renderWalletCard(c, inst, festivosMX, saldo = null) {
  const color  = inst?.color || COLORS[inst?.nombre] || '#607d8b';
  const dark   = darkenHex(color, 45);
  const badge  = TIPO_BADGE[c.tipo] ?? TIPO_BADGE.debito;
  const numeros  = (Array.isArray(c.numeros) ? c.numeros : []).filter(n => n.numero || n.fechaVencimiento);
  const fisicas  = numeros.filter(n => n.formato === 'fisica');
  const digitales = numeros.filter(n => n.formato === 'digital');

  const chips = [];
  if (c.tipo === 'credito' || c.tipo === 'prestamo') {
    if (saldo?.usado != null)
      chips.push(`<span class="wcard-chip"><i class="bi bi-bar-chart-fill me-1"></i>${currency(saldo.usado)}</span>`);
    else if (c.limiteTotal)
      chips.push(`<span class="wcard-chip"><i class="bi bi-wallet2 me-1"></i>${currency(Number(c.limiteTotal))}</span>`);
    if (c.ciclo?.diaCorte || (c.ciclo?.diasAlCorte && c.ciclo?.diaPago)) {
      const hoy  = new Date(); hoy.setHours(0, 0, 0, 0);
      const p    = calcularMes(c.ciclo, hoy.getFullYear(), hoy.getMonth(), festivosMX);
      const prev = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const pp   = calcularMes(c.ciclo, prev.getFullYear(), prev.getMonth(), festivosMX);

      const _chip = (icon, date) =>
        `<span class="wcard-chip"><i class="bi bi-${icon} me-1"></i>${fmtShortDate(toISODate(date))}</span>`;

      if (pp.fechaPago && pp.fechaPago >= hoy) {
        // Pago del período anterior pendiente o es hoy — es el más urgente
        chips.push(_chip('calendar-check', pp.fechaPago));
        if (p.fechaCorte) chips.push(_chip('scissors', p.fechaCorte));
      } else if (p.fechaCorte <= hoy) {
        const nd = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
        const ps = calcularMes(c.ciclo, nd.getFullYear(), nd.getMonth(), festivosMX);
        if (p.fechaPago && p.fechaPago <= hoy) {
          // Corte y pago del ciclo actual ya pasaron — mostrar siguiente ciclo
          if (ps.fechaCorte) chips.push(_chip('scissors', ps.fechaCorte));
          if (ps.fechaPago)  chips.push(_chip('calendar-check', ps.fechaPago));
        } else {
          // Corte pasó, pago pendiente
          if (p.fechaPago)   chips.push(_chip('calendar-check', p.fechaPago));
          if (ps.fechaCorte) chips.push(_chip('scissors', ps.fechaCorte));
        }
      } else {
        // Ciclo normal: corte no ha pasado, pago anterior ya saldado
        if (p.fechaCorte) chips.push(_chip('scissors', p.fechaCorte));
        if (p.fechaPago)  chips.push(_chip('calendar-check', p.fechaPago));
      }
    }
  }

  const front = `
    <div class="wcard-front" style="background:linear-gradient(135deg,${color} 0%,${dark} 100%)">
      <div class="wcard-top">
        <div>
          <div class="wcard-inst">${inst?.nombre || ''}</div>
          <div class="wcard-name">${c.nombre}</div>
        </div>
        <span class="badge-tipo ${badge.cls}">${badge.label}</span>
      </div>
      <div class="wcard-bottom">
        <div class="wcard-chips">${chips.join('')}</div>
        ${redIcon(c.red)}
      </div>
    </div>`;

  const isCredPrest = c.tipo === 'credito' || c.tipo === 'prestamo';
  const backChips = isCredPrest ? [
    c.limiteTotal ? `<span class="wcard-chip"><i class="bi bi-wallet2 me-1"></i>${currency(Number(c.limiteTotal))}</span>` : '',
    saldo ? `<span class="wcard-chip" style="${saldo.ajustado ? '' : 'color:#4caf50'}"><i class="bi bi-credit-card me-1"></i>${currency(saldo.disponible)}</span>` : '',
  ].filter(Boolean).join('') : '';

  const backRows = [
    c.clabe ? renderWcardField('CLABE', maskCard(c.clabe), c.clabe) : '',
    c.tipo === 'prestamo' && c.numeroPago ? renderWcardField('No. Pago', c.numeroPago, c.numeroPago) : '',
    ...fisicas.map(n => renderWcardNum(n)),
    ...digitales.map(n => renderWcardNum(n)),
  ].filter(Boolean).join('');

  const back = `
    <div class="wcard-back">
      <div class="wcard-stripe" style="display:flex;align-items:center">${backChips ? `<div class="wcard-chips px-3">${backChips}</div>` : ''}</div>
      <div class="wcard-back-body">
        ${backRows || '<p class="opacity-50 small text-center mt-2">Sin datos registrados</p>'}
      </div>
    </div>`;

  return `<div class="wcard-shell"><div class="wcard-wrap"><div class="wcard-inner">${front}${back}</div></div></div>`;
}

function renderWcardField(label, masked, raw) {
  return `
    <div class="wcard-field">
      <span class="wcard-field-label">${label}</span>
      <span class="fw-mono">${masked}</span>
      <button class="btn-copy-data ms-auto" data-value="${raw}" title="Copiar"><i class="bi bi-copy"></i></button>
    </div>`;
}

function renderWcardNum(n) {
  const label = n.formato === 'fisica' ? 'Física' : 'Digital';
  return `
    <div class="wcard-field">
      <span class="wcard-field-label">${label}</span>
      ${n.numero
        ? `<span class="fw-mono">${maskCard(n.numero)}</span>
           <button class="btn-copy-data ms-1" data-value="${n.numero}" title="Copiar"><i class="bi bi-copy"></i></button>`
        : `<span class="opacity-50">—</span>`}
      ${n.fechaVencimiento ? `<span class="wcard-venc ms-auto">${n.fechaVencimiento}</span>` : ''}
    </div>`;
}
