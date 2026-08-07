import { getAll, getById, create, update, remove } from '../utils/db.js';
import { currency, fmtDate, textoLegibleSobre, rgbLegibleSobre } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import {
  resumenCuenta, totalizarResumenes, rendimientoEntre, timelineCuenta,
  historialDiario, configCuenta, hoyISO, isoDay, diasEntre,
  TRAMOS_DEFAULT, BASE_ANUAL_DEFAULT,
  MODO_PROGRESIVO, MODO_UNICO, ISR_CAPITAL, ISR_INTERES,
  TASA_NOMINAL, TASA_EFECTIVA, REDONDEO_CONTINUO, REDONDEO_CENTAVOS,
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

// ── Ayuda contextual de los campos de configuración ───────────────────────────

/**
 * Qué significa cada campo y cómo entra en el cálculo. Los ejemplos usan cifras
 * inventadas a propósito: la ayuda explica el concepto, no la configuración de
 * ninguna institución en particular.
 */
const AYUDA = {
  monto: {
    titulo: 'Monto invertido y fecha',
    cuerpo: `
      <p>El saldo <strong>real</strong> que tenía la cuenta el día que lo capturaste, tal como lo
         mostraba la app de tu institución.</p>
      <h6>Cómo afecta al cálculo</h6>
      <p>Es el punto de partida de todo. El saldo actual se obtiene componiendo día a día desde
         ese monto y esa fecha hasta hoy, y los rendimientos diario, mensual y anual se calculan
         sobre el saldo ya actualizado — no sobre el capital original.</p>
      <p class="inv-ayuda-ej">Capturas $10,000 con fecha de hace 5 días → se componen 5 días de
         interés antes de mostrar cualquier cifra.</p>`,
  },
  tramos: {
    titulo: 'Límites de rendimiento',
    cuerpo: `
      <p>Los escalones de saldo, cada uno con su tasa anual. Solo capturas el límite superior y la
         tasa: el <em>desde</em> se deriva del <em>hasta</em> del tramo anterior, de modo que no
         puede haber huecos ni traslapes. El último tramo siempre es abierto.</p>
      <h6>Cómo afecta al cálculo</h6>
      <p>Definen qué tasa gana cada peso de tu saldo. Cómo se combinan depende del campo
         <strong>Aplicación</strong>.</p>`,
  },
  modoTramos: {
    titulo: 'Aplicación de los tramos',
    cuerpo: `
      <p><strong>Progresivo</strong> — cada porción del saldo gana la tasa de su propio tramo,
         igual que funciona el ISR. Varios tramos aportan al mismo tiempo.</p>
      <p><strong>Tasa única</strong> — todo el saldo gana la tasa del único tramo en el que cae.</p>
      <h6>Cómo afecta al cálculo</h6>
      <p>Cambia el interés de cada día. La tasa única produce escalones: al cruzar un límite el
         rendimiento puede <em>bajar</em>, porque el saldo entero pasa a la tasa menor.</p>
      <p class="inv-ayuda-ej">Con tramos $25,000 al 10% y el resto al 5%, un saldo de $30,000 gana
         al año:<br>
         · progresivo → $25,000×10% + $5,000×5% = <strong>$2,750</strong><br>
         · tasa única → $30,000×5% = <strong>$1,500</strong></p>`,
  },
  modoTasa: {
    titulo: 'Interpretación de la tasa',
    cuerpo: `
      <p><strong>Nominal</strong> — la tasa se reparte entre los días del año y se capitaliza a
         diario, así que al cabo de 12 meses rinde algo más que el número publicado.</p>
      <p><strong>Efectiva (GAT)</strong> — la tasa publicada ya incluye esa capitalización: en un
         año rinde exactamente ese número.</p>
      <h6>Cómo afecta al cálculo</h6>
      <p>Es el ajuste que más desvía el resultado si se elige mal — con la misma tasa, interpretarla
         como nominal genera del orden de 5% a 8% más interés diario que como efectiva. Conviene
         confirmarlo contra un abono real antes de darlo por bueno.</p>
      <p class="inv-ayuda-ej">Una tasa de 12% sobre $10,000 durante un año:<br>
         · nominal → tasa diaria 12%÷365, y al final <strong>$1,274</strong> (GAT 12.75%)<br>
         · efectiva → tasa diaria (1.12)^(1/365)−1, y al final <strong>$1,200</strong> (GAT 12%)</p>`,
  },
  isr: {
    titulo: 'Retención de ISR',
    cuerpo: `
      <p>El impuesto que la institución retiene de tus rendimientos y entera al SAT.</p>
      <h6>Cómo afecta al cálculo</h6>
      <p>Se descuenta <strong>cada día antes de reinvertir</strong>, así que reduce tanto el abono
         diario como el saldo que sigue componiendo. Los montos que muestra la app —diario,
         mensual, anual, hasta hoy— ya vienen netos.</p>
      <p>Déjalo en <strong>0</strong> si no aplica o si tu institución la retiene por separado; en
         ese caso las cifras quedan brutas.</p>`,
  },
  isrSobre: {
    titulo: 'Base de la retención',
    cuerpo: `
      <p><strong>Sobre el capital</strong> — la tasa es anual y se aplica al saldo, no a lo ganado.
         Así opera la retención en México.</p>
      <p><strong>Sobre el interés</strong> — se retiene un porcentaje de lo que generaste ese día;
         el número no se anualiza ni usa una base.</p>
      <h6>Cómo afecta al cálculo</h6>
      <p>Sobre el capital la retención es prácticamente fija: se cobra aunque el rendimiento sea
         bajo, y puede llegar a superarlo. Sobre el interés siempre es proporcional, así que el
         rendimiento neto nunca queda en negativo.</p>
      <p class="inv-ayuda-ej">Saldo $100,000 con 0.9%:<br>
         · sobre el capital → $900 al año, gane lo que gane<br>
         · sobre el interés → 0.9% de lo ganado, nada si no generó</p>`,
  },
  baseAnual: {
    titulo: 'Base anual del interés',
    cuerpo: `
      <p>Cuántos días considera tu institución que tiene un año al repartir la tasa entre los días.
         Lo habitual es 365, pero algunas usan 360 por convención comercial.</p>
      <h6>Cómo afecta al cálculo</h6>
      <p>Con base 360 el interés diario resulta <strong>1.4% mayor</strong> que con 365, porque la
         tasa se divide entre menos días. También define cuántas capitalizaciones se usan para
         reportar el GAT.</p>`,
  },
  baseIsr: {
    titulo: 'Base anual del ISR',
    cuerpo: `
      <p>La misma idea que la base del interés, pero para la retención. <strong>No siempre
         coinciden</strong>: hay instituciones que pagan intereses sobre una base y retienen sobre
         la otra, y lo indican en sus términos.</p>
      <h6>Cómo afecta al cálculo</h6>
      <p>Cambia cuánto se retiene cada día. El efecto es pequeño comparado con la base del interés,
         pero basta para desajustar el centavo al comparar contra un abono real.</p>
      <p>Solo aplica cuando la retención se calcula sobre el capital.</p>`,
  },
  redondeoTasa: {
    titulo: 'Cómo se muestra la tasa ponderada',
    cuerpo: `
      <p>Las instituciones no despliegan la tasa igual: unas truncan los decimales y otras
         redondean.</p>
      <h6>Cómo afecta al cálculo</h6>
      <p><strong>No afecta ningún monto.</strong> Es solo presentación: cambia el porcentaje que se
         muestra en la tarjeta para que coincida con lo que ves en tu app y no te haga dudar de si
         el cálculo está bien.</p>
      <p class="inv-ayuda-ej">Una tasa real de 14.849%:<br>
         · truncar → se muestra <strong>14.84%</strong><br>
         · redondear → se muestra <strong>14.85%</strong></p>`,
  },
  redondeoDiario: {
    titulo: 'Redondeo diario',
    cuerpo: `
      <p><strong>Continuo</strong> — el interés y la retención de cada día se capitalizan con su
         valor exacto, sin redondear.</p>
      <p><strong>Centavos</strong> — se redondean a centavos antes de sumarse al saldo, igual que
         cuando la institución los abona y los retiene como dos movimientos discretos.</p>
      <h6>Cómo afecta al cálculo</h6>
      <p>Con instituciones que solo muestran un neto ya limpio, no hay diferencia perceptible.
         Pero si ves el abono y la retención como movimientos separados en tu estado de cuenta,
         dejarlo en <strong>continuo</strong> puede hacer que el "Rendimiento neto del día" no
         cuadre con restar esos dos movimientos, y que el saldo proyectado se desvíe del real
         centavo a centavo con el tiempo.</p>
      <p class="inv-ayuda-ej">Saldo $9,006.56 al 10%, retención 0.90%, base 360:<br>
         · continuo → bruto $2.501822…, retención $0.225164…, neto exacto $2.276658… → se
         muestra <strong>$2.28</strong><br>
         · centavos → bruto <strong>$2.50</strong>, retención <strong>$0.23</strong>, neto
         <strong>$2.27</strong> — igual que en el estado de cuenta</p>`,
  },
  rendimientoObtenido: {
    titulo: 'Rendimiento obtenido',
    cuerpo: `
      <p>Lo que la cuenta te ha pagado <strong>de verdad</strong> hasta la fecha que registres,
         tomado de tu estado de cuenta.</p>
      <h6>Cómo afecta al cálculo</h6>
      <p>El indicador <strong>Hasta hoy</strong> parte de ese número real y le suma únicamente la
         proyección desde esa fecha, en vez de proyectar todo el periodo. Mientras más seguido lo
         actualices, menos margen de error acumula la estimación.</p>`,
  },
};

/** Botón "i" que abre la ayuda de un campo. */
const btnAyuda = clave =>
  `<button type="button" class="btn-ayuda" data-ayuda="${clave}"
           aria-label="Qué significa este campo" title="Qué significa este campo">
     <i class="bi bi-info-circle"></i>
   </button>`;

/**
 * Abre la ayuda en su propio modal, independiente de `openModal`, para poder
 * apilarse sobre el formulario de la cuenta sin destruirlo.
 */
function showAyuda(clave) {
  const a = AYUDA[clave];
  if (!a) return;

  document.getElementById('inv-ayuda')?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fade" id="inv-ayuda" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title"><i class="bi bi-info-circle me-2"></i>${a.titulo}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body inv-ayuda-body">${a.cuerpo}</div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Entendido</button>
          </div>
        </div>
      </div>
    </div>`);

  const el = document.getElementById('inv-ayuda');
  el.addEventListener('hidden.bs.modal', () => {
    el.remove();
    // Al cerrarse encima de otro modal, Bootstrap le quita el bloqueo de scroll al body
    if (document.querySelector('.modal.show')) document.body.classList.add('modal-open');
  }, { once: true });
  new bootstrap.Modal(el).show();
}

// Un solo listener delegado para todos los botones "i", presentes y futuros
let _ayudaLista = false;
function activarAyuda() {
  if (_ayudaLista) return;
  document.addEventListener('click', e => {
    const b = e.target.closest('.btn-ayuda');
    // Hay botones que reusan el estilo sin ser ayuda de un campo (p. ej. el de tramos)
    if (!b || !b.dataset.ayuda) return;
    e.preventDefault();
    e.stopPropagation();
    showAyuda(b.dataset.ayuda);
  });
  _ayudaLista = true;
}

// Estado de la calculadora — sobrevive a los re-render del módulo
const _calc = { cuentaId: '', desde: '', hasta: '' };

export async function render(container) {
  activarAyuda();
  try {
    await renderView(container);
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error al cargar Rendimientos: ${esc(e.message)}</div>`;
    console.error(e);
  }
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
        <div class="d-flex flex-wrap gap-2">
          <button class="btn btn-outline-primary btn-sm" id="btn-calc-periodo"
                  ${cuentas.length ? '' : 'disabled title="Registra una cuenta de inversión primero"'}>
            <i class="bi bi-calendar-range me-1"></i>Calcular periodo
          </button>
          <button class="btn btn-primary btn-sm" id="btn-nueva-cuenta"
                  ${instituciones.length ? '' : 'disabled title="Registra una institución en Administración primero"'}>
            <i class="bi bi-plus-lg me-1"></i>Nueva Cuenta
          </button>
        </div>
      </div>

      <!-- ── Acumulado de todas las cuentas ── -->
      <div class="row g-3 mb-3">
        <div class="col-6 col-sm-6 col-xl-3">
          <div class="metric-card h-100">
            <div class="metric-icon tint-success"><i class="bi bi-piggy-bank-fill"></i></div>
            <div class="metric-info">
              <div class="metric-value">${currency(tot.saldoActual)}</div>
              <div class="metric-label">Saldo actual</div>
              <div class="metric-sub">Capital ${currency(tot.capital)}</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-sm-6 col-xl-3">
          <div class="metric-card h-100">
            <div class="metric-icon tint-info"><i class="bi bi-graph-up-arrow"></i></div>
            <div class="metric-info">
              <div class="metric-value text-success">${currency(tot.rendimientoHastaHoy)}</div>
              <div class="metric-label">Hasta hoy</div>
              <div class="metric-sub">Desde la última actualización</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-sm-6 col-xl-3">
          <div class="metric-card h-100">
            <div class="metric-icon tint-warn-alt"><i class="bi bi-sun-fill"></i></div>
            <div class="metric-info">
              <div class="metric-value">${currency(tot.diario)}</div>
              <div class="metric-label">Rendimiento diario</div>
              <div class="metric-sub">Mensual ${currency(tot.mensual)}</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-sm-6 col-xl-3">
          <div class="metric-card h-100">
            <div class="metric-icon tint-purple"><i class="bi bi-calendar3"></i></div>
            <div class="metric-info">
              <div class="metric-value">${currency(tot.anual)}</div>
              <div class="metric-label">Proyección anual</div>
              <div class="metric-sub">GAT ${pct(tot.gat)}</div>
            </div>
          </div>
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
      : `<div class="row g-3 justify-content-center">
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

    container.querySelectorAll('.btn-inv-hist').forEach(b =>
      b.addEventListener('click', () => {
        const c = cuentas.find(x => x.id === b.dataset.id);
        showHistorialModal(c, nombreCuenta(c, instNombre(c)));
      }));

    container.querySelectorAll('.btn-inv-tramos').forEach(b =>
      b.addEventListener('click', () => {
        const c = cuentas.find(x => x.id === b.dataset.id);
        showTramosModal(c, instMap[c.institucionId]);
      }));

    container.querySelectorAll('.btn-inv-detalle').forEach(b =>
      b.addEventListener('click', () => {
        const c = cuentas.find(x => x.id === b.dataset.id);
        showDetalleModal(c, instMap[c.institucionId], accion => {
          if (accion === 'editar') showCuentaModal(container, instituciones, c);
        });
      }));

    container.querySelectorAll('.btn-inv-del').forEach(b =>
      b.addEventListener('click', async () => {
        const c = cuentas.find(x => x.id === b.dataset.id);
        if (!confirmDelete(nombreCuenta(c, instNombre(c)))) return;
        await remove(COL, c.id);
        toast('Cuenta eliminada');
        renderView(container);
      }));

    const btnCalc = document.getElementById('btn-calc-periodo');
    if (btnCalc && !btnCalc.disabled)
      btnCalc.addEventListener('click', () => showCalculadoraModal(cuentas, instMap, hoy));

  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error al cargar Rendimientos: ${esc(e.message)}</div>`;
    console.error(e);
  }
}

// ── Tarjeta de cuenta ─────────────────────────────────────────────────────────

function cuentaCard(c, r, inst) {
  const color       = inst?.color || '#607d8b';
  const institucion = inst?.nombre || 'Sin institución';
  // Cada institución despliega su tasa a su manera; se respeta lo configurado
  const fmtTasa     = c.redondeoTasa === 'redondear' ? pct : pctTrunc;
  // La tasa solo es un promedio ponderado cuando más de un tramo aporta; con uno
  // solo no hay nada que desglosar y el botón de ayuda sobra
  const ponderado   = r.desglose.filter(t => t.monto > 0).length > 1;

  return `
    <div class="col-12 col-md-6 col-xl-4 col-xxl-3">
      <div class="inv-card">
        <div class="inv-head" style="background:${color};--on-color:${textoLegibleSobre(color)};--on-color-rgb:${rgbLegibleSobre(color)}">
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

        <div class="inv-saldo">
          <div class="inv-saldo-lbl">Saldo actual estimado</div>
          <div class="inv-saldo-val">${currency(r.saldoActual)}</div>

          <div class="inv-tasa">
            <span class="inv-tasa-lbl">Rendimiento anual</span>
            <span class="inv-tasa-val">${fmtTasa(r.tasaNominal)}</span>
            ${ponderado ? `
              <button type="button" class="btn-ayuda btn-inv-tramos" data-id="${c.id}"
                      aria-label="Cómo se compone esta tasa" title="Cómo se compone esta tasa">
                <i class="bi bi-info-circle"></i>
              </button>` : ''}
          </div>

          <div class="inv-saldo-rend">
            <span>Hasta hoy <strong>${currency(r.rendimientoHastaHoy)}</strong></span>
            <span class="inv-saldo-pto">·</span>
            <span>Último <strong>${currency(r.ayer)}</strong></span>
            <button type="button" class="btn-inv-hist inv-hist-btn" data-id="${c.id}"
                    title="Ver el rendimiento día por día">
              <i class="bi bi-clock-history"></i>
            </button>
          </div>
        </div>

        <div class="inv-yields">
          <div class="inv-y">
            <span class="inv-y-lbl">Diario</span>
            <span class="inv-y-val">${currency(r.diario)}</span>
          </div>
          <div class="inv-y">
            <span class="inv-y-lbl">Mensual<small>30 d</small></span>
            <span class="inv-y-val">${currency(r.mensual)}</span>
          </div>
          <div class="inv-y">
            <span class="inv-y-lbl">Anual<small>365 d</small></span>
            <span class="inv-y-val">${currency(r.anual)}</span>
          </div>
        </div>

        <button type="button" class="inv-detalle-btn btn-inv-detalle" data-id="${c.id}">
          <i class="bi bi-list-columns-reverse me-2"></i>Ver detalle
        </button>
      </div>
    </div>`;
}

// ── Tramos: barra de proporción + desglose ────────────────────────────────────

/** Colores del reparto por tramo — mismo orden que los tramos. */
const COLORES_TRAMO = ['#2e7d32', '#1565c0', '#e65100', '#6a0dad', '#00838f'];

/**
 * Barra apilada + tabla con cuánto del saldo vive en cada tramo y cuánto aporta.
 * Sustituye al resaltado del "tramo activo", que sugería que solo esa tasa
 * aplicaba cuando en modo progresivo todos los tramos con dinero aportan.
 */
function bloqueTramos(r) {
  const esUnico = r.modo === MODO_UNICO;
  const conAporte = r.desglose.filter(t => t.monto > 0);

  return `
    <div class="inv-tr-wrap">
      <div class="inv-tr-bar" role="img"
           aria-label="Reparto del saldo entre los tramos de tasa">
        ${conAporte.map((t, i) => `
          <span class="inv-tr-seg" style="width:${t.pct}%;background:${COLORES_TRAMO[r.desglose.indexOf(t) % COLORES_TRAMO.length]}"
                title="${currency(t.monto)} al ${pct(t.tasa)} — ${t.pct.toFixed(1)}% del saldo"></span>`).join('')}
      </div>
      <div class="inv-tr-leg">
        ${conAporte.map(t => `
          <span class="inv-tr-leg-item">
            <span class="inv-tr-dot" style="background:${COLORES_TRAMO[r.desglose.indexOf(t) % COLORES_TRAMO.length]}"></span>
            ${t.pct.toFixed(1)}% al ${pct(t.tasa)}
          </span>`).join('')}
      </div>

      <div class="table-wrapper">
        <table class="table table-sm inv-tr-tabla mb-0">
          <thead><tr>
            <th>Tramo</th>
            <th class="text-end">Tasa</th>
            <th class="text-end">En el tramo</th>
            <th class="text-end">Aporte/día</th>
          </tr></thead>
          <tbody>
            ${r.desglose.map((t, i) => `
              <tr class="${t.monto > 0 ? '' : 'inv-tr-vacio'}">
                <td>
                  ${t.monto > 0 ? `<span class="inv-tr-dot" style="background:${COLORES_TRAMO[i % COLORES_TRAMO.length]}"></span>` : ''}
                  ${rangoTramo(t, i === 0)}
                  ${t.marginal && !esUnico ? `<span class="inv-tr-marg" title="Aquí entraría tu próximo peso">marginal</span>` : ''}
                </td>
                <td class="text-end fw-500">${pct(t.tasa)}</td>
                <td class="text-end">${t.monto > 0 ? currency(t.monto) : '—'}</td>
                <td class="text-end">${t.monto > 0 ? currency(t.aporte) : '—'}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td>TOTAL</td>
            <td class="text-end">${pct(r.tasaNominal)}</td>
            <td class="text-end">${currency(r.saldoActual)}</td>
            <td class="text-end">${currency(r.diarioBruto)}</td>
          </tr></tfoot>
        </table>
      </div>
      <p class="inv-tr-nota">
        ${esUnico
          ? 'Tasa única: todo el saldo gana la tasa del tramo en el que cae.'
          : 'Progresivo: cada porción del saldo gana la tasa de su propio tramo, y todas suman al rendimiento del día.'}
      </p>
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

// ── Vista Detalle ─────────────────────────────────────────────────────────────

/** Cómo se obtiene la tasa diaria a partir de la anual, en texto. */
function formulaTasa(tasa, r) {
  return r.modoTasa === TASA_EFECTIVA
    ? `(1 + ${pct(tasa)})<sup>1/${r.base}</sup> − 1`
    : `${pct(tasa)} ÷ ${r.base}`;
}

function showDetalleModal(cuenta, inst, refrescar) {
  const r         = resumenCuenta(cuenta, hoyISO());
  const esUnico   = r.modo === MODO_UNICO;
  const fmtTasa   = cuenta.redondeoTasa === 'redondear' ? pct : pctTrunc;
  const conAporte = r.desglose.filter(t => t.monto > 0);
  const etiqueta  = nombreCuenta(cuenta, inst?.nombre);

  const fila = (etq, val, nota = '', ayuda = '') => `
    <div class="inv-cfg-row">
      <span class="inv-cfg-lbl">${etq}${ayuda ? btnAyuda(ayuda) : ''}</span>
      <span class="inv-cfg-val">${val}${nota ? ` <span class="inv-cfg-nota">${nota}</span>` : ''}</span>
    </div>`;

  openModal({
    size: 'lg',
    title: `Detalle — ${esc(etiqueta)}`,
    body: `
      <div class="inv-det-sec">
        <div class="inv-det-tit"><i class="bi bi-calculator me-2"></i>Cómo sale el rendimiento de hoy</div>
        <div class="inv-op">
          <div class="inv-op-row inv-op-base">
            <span>Saldo actual estimado</span>
            <span>${currency(r.saldoActual)}</span>
          </div>
          ${conAporte.map(t => `
            <div class="inv-op-row">
              <span class="inv-op-formula">${currency(t.monto)} × ${formulaTasa(t.tasa, r)}</span>
              <span>${currency(t.aporte)}</span>
            </div>`).join('')}
          <div class="inv-op-row inv-op-sub">
            <span>Interés bruto del día</span>
            <span>${currency(r.diarioBruto)}</span>
          </div>
          ${r.isrAnual > 0 ? `
            <div class="inv-op-row inv-op-neg">
              <span class="inv-op-formula">${r.isrSobre === ISR_INTERES
                ? `Retención · ${currency(r.diarioBruto)} × ${pct(r.isrAnual)} del interés`
                : `Retención · ${currency(r.saldoActual)} × ${pct(r.isrAnual)} ÷ ${r.baseIsr}`}</span>
              <span>− ${currency(r.isrDiario)}</span>
            </div>` : ''}
          <div class="inv-op-row inv-op-total">
            <span>Rendimiento neto del día</span>
            <span>${currency(r.diario)}</span>
          </div>
        </div>
      </div>

      <div class="inv-det-sec">
        <div class="inv-det-tit"><i class="bi bi-bar-chart-steps me-2"></i>Tramos${btnAyuda('modoTramos')}</div>
        ${bloqueTramos(r)}
      </div>

      <div class="inv-det-sec">
        <div class="inv-det-tit"><i class="bi bi-sliders me-2"></i>Configuración</div>
        <div class="inv-cfg">
          ${fila('Monto invertido', currency(r.capital), `al ${fmtDate(r.fechaBase)} · ${r.dias} d`, 'monto')}
          ${fila('Rendimiento obtenido', currency(r.rendimientoObtenido), `al ${fmtDate(r.fechaRendimiento)}`, 'rendimientoObtenido')}
          ${fila('Aplicación de tramos', esUnico ? 'Tasa única' : 'Progresivo', '', 'modoTramos')}
          ${fila('Interpretación de la tasa', r.modoTasa === TASA_EFECTIVA ? 'Efectiva (GAT)' : 'Nominal', '', 'modoTasa')}
          ${fila('Base anual — interés', `${r.base} días`, '', 'baseAnual')}
          ${fila('Retención ISR', r.isrAnual > 0 ? pct(r.isrAnual) : 'sin retención',
                 r.isrAnual > 0
                   ? (r.isrSobre === ISR_INTERES ? 'del interés' : `s/ capital · base ${r.baseIsr}`)
                   : '', 'isr')}
          ${fila('Tasa ponderada', fmtTasa(r.tasaNominal), '', 'redondeoTasa')}
          ${fila('GAT', pct(r.gat), r.modoTasa === TASA_EFECTIVA ? 'igual a la publicada' : 'antes de impuestos')}
        </div>
      </div>`,
    footer: `
      <button type="button" class="btn btn-outline-secondary btn-sm" id="det-hist">
        <i class="bi bi-clock-history me-1"></i>Historial diario
      </button>
      <button type="button" class="btn btn-outline-primary btn-sm" id="det-edit">
        <i class="bi bi-pencil me-1"></i>Editar
      </button>
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cerrar</button>`
  });

  // Detalle, historial y edición comparten `#modal-container`, así que hay que
  // encadenarlos: se espera al cierre real en vez de adivinar con un timeout
  const trasCerrar = fn => {
    const el = document.getElementById('app-modal');
    if (!el) { fn(); return; }
    el.addEventListener('hidden.bs.modal', () => setTimeout(fn, 0), { once: true });
    closeModal();
  };

  document.getElementById('det-hist').addEventListener('click', () =>
    trasCerrar(() => showHistorialModal(cuenta, etiqueta)));
  document.getElementById('det-edit').addEventListener('click', () =>
    trasCerrar(() => refrescar('editar')));
}

// ── Modal: cómo se compone la tasa ponderada ──────────────────────────────────

function showTramosModal(cuenta, inst) {
  const r       = resumenCuenta(cuenta, hoyISO());
  const fmtTasa = cuenta.redondeoTasa === 'redondear' ? pct : pctTrunc;

  openModal({
    size: 'lg',
    title: `Rendimiento anual — ${esc(nombreCuenta(cuenta, inst?.nombre))}`,
    body: `
      <p class="text-muted mb-3" style="font-size:0.82rem">
        La tasa que ves, <strong>${fmtTasa(r.tasaNominal)}</strong>, es un
        <strong>promedio ponderado</strong>: tu saldo está repartido en más de un tramo y cada
        porción gana su propia tasa. No es que todo tu dinero rinda a una sola.
      </p>
      ${bloqueTramos(r)}`,
    footer: `<button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Entendido</button>`
  });
}

// ── Modal: historial de rendimientos diarios ──────────────────────────────────

// ── Calculadora entre 2 fechas ───────────────────────────────────────────────
// Vive en un modal, no en la vista: es una consulta puntual y ocupaba una card
// permanente. El estado (_calc) es de módulo, así que la selección de cuenta y
// el rango sobreviven al cierre del modal y a los re-render de la vista.
function showCalculadoraModal(cuentas, instMap, hoy) {
  const instNombre = c => instMap[c.institucionId]?.nombre || 'Sin institución';

  openModal({
    size: 'lg',
    title: '<i class="bi bi-calendar-range me-2"></i>Calcular entre 2 fechas',
    body: `
      <div class="row g-2 align-items-end">
        <div class="col-12 col-sm-6">
          <label class="form-label small text-muted mb-1">Cuenta</label>
          <select class="form-select form-select-sm" id="calc-cuenta">
            <option value="">Todas las cuentas</option>
            ${cuentas.map(c => `
              <option value="${c.id}" ${_calc.cuentaId === c.id ? 'selected' : ''}>
                ${esc(instNombre(c))}${alias(c) ? ' — ' + esc(alias(c)) : ''}
              </option>`).join('')}
          </select>
        </div>
        <div class="col-6 col-sm-3">
          <label class="form-label small text-muted mb-1">Desde</label>
          <input type="date" class="form-control form-control-sm" id="calc-desde" value="${_calc.desde}">
        </div>
        <div class="col-6 col-sm-3">
          <label class="form-label small text-muted mb-1">Hasta</label>
          <input type="date" class="form-control form-control-sm" id="calc-hasta" value="${_calc.hasta}">
        </div>
      </div>
      <div id="calc-result"></div>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cerrar</button>
      <button type="button" class="btn btn-primary btn-sm" id="calc-run">
        <i class="bi bi-calculator me-1"></i>Calcular
      </button>`,
  });

  const runCalc = () => {
    _calc.cuentaId = document.getElementById('calc-cuenta').value;
    _calc.desde    = document.getElementById('calc-desde').value;
    _calc.hasta    = document.getElementById('calc-hasta').value;
    document.getElementById('calc-result').innerHTML =
      calcularPeriodo(cuentas, instMap, _calc, hoy);
  };

  document.getElementById('calc-run').addEventListener('click', runCalc);
  ['calc-cuenta', 'calc-desde', 'calc-hasta'].forEach(id =>
    document.getElementById(id).addEventListener('change', runCalc));

  // El modal se abre justamente para calcular: mostramos el resultado de entrada
  runCalc();
}

function showHistorialModal(cuenta, etiqueta) {
  const filas   = historialDiario(cuenta, hoyISO()).reverse(); // más reciente primero
  const conIsr  = filas.some(f => f.isr > 0.0000001);
  const totNeto = filas.reduce((s, f) => s + f.neto, 0);
  const totIsr  = filas.reduce((s, f) => s + f.isr, 0);
  const cols    = conIsr ? 5 : 3;

  openModal({
    size: 'lg',
    title: `Rendimiento diario — ${esc(etiqueta)}`,
    body: filas.length === 0
      ? `<div class="empty-state" style="padding:28px 0">
           <i class="bi bi-clock-history"></i>
           <p>Aún no hay días transcurridos desde la última captura
              (${fmtDate(isoDay(cuenta.fechaActualizacion))}).<br>
              El primer rendimiento aparecerá mañana.</p>
         </div>`
      : `<p class="text-muted mb-2" style="font-size:0.78rem">
           Cada renglón es el día que <strong>generó</strong> el interés; las instituciones lo abonan
           a la madrugada siguiente. Calculado desde ${currency(cuenta.montoInvertido)}
           capturados el ${fmtDate(isoDay(cuenta.fechaActualizacion))}.
         </p>
         <div class="table-wrapper inv-hist-tabla">
           <table class="table table-sm mb-0">
             <thead><tr>
               <th>Día</th>
               <th class="text-end">Saldo inicial</th>
               ${conIsr ? '<th class="text-end">Bruto</th><th class="text-end">ISR</th>' : ''}
               <th class="text-end">Rendimiento</th>
             </tr></thead>
             <tbody>
               ${filas.map((f, i) => `
                 <tr class="${i === 0 ? 'inv-hist-ayer' : ''}">
                   <td>${fmtDate(f.fecha)}${i === 0 ? '<span class="inv-tr-marg">último</span>' : ''}</td>
                   <td class="text-end text-muted">${currency(f.saldoInicial)}</td>
                   ${conIsr ? `<td class="text-end text-muted">${currency(f.bruto)}</td>
                               <td class="text-end text-danger">−${currency(f.isr)}</td>` : ''}
                   <td class="text-end fw-semibold text-success">${currency(f.neto)}</td>
                 </tr>`).join('')}
             </tbody>
             <tfoot><tr>
               <td colspan="${cols - (conIsr ? 3 : 1)}">TOTAL · ${filas.length} ${filas.length === 1 ? 'día' : 'días'}</td>
               ${conIsr ? `<td></td><td class="text-end text-danger">−${currency(totIsr)}</td>` : ''}
               <td class="text-end text-success">${currency(totNeto)}</td>
             </tr></tfoot>
           </table>
         </div>`,
    footer: `<button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cerrar</button>`
  });
}

// ── Modal: alta / edición de cuenta ───────────────────────────────────────────

function showCuentaModal(container, instituciones, cuenta, onSaved = null) {
  // Desde la vista Detalle hay que repintar el detalle, no la lista
  const refrescar = () => onSaved ? onSaved() : renderView(container);
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
            <label class="form-label">Monto invertido *${btnAyuda('monto')}</label>
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
          </div>
        </div>

        <div class="row g-2 mb-3">
          <div class="col-12 col-sm-6">
            <label class="form-label">Rendimiento obtenido${btnAyuda('rendimientoObtenido')}</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="rendimientoObtenido" step="0.01"
                     value="${cuenta?.rendimientoObtenido ?? ''}" placeholder="0.00">
            </div>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label">Fecha de actualización del rendimiento</label>
            <input type="date" class="form-control" name="fechaActualizacionRendimiento" max="${hoy}"
                   value="${isoDay(cuenta?.fechaActualizacionRendimiento) || ''}">
          </div>
        </div>

        <hr class="my-3">

        <div class="d-flex justify-content-between align-items-center mb-2">
          <label class="form-label mb-0">Límites de rendimiento${btnAyuda('tramos')}</label>
          <button type="button" class="btn btn-outline-primary btn-sm" id="inv-add-tramo">
            <i class="bi bi-plus-lg me-1"></i>Tramo
          </button>
        </div>
        <div class="row g-2 mb-2">
          <div class="col-12 col-sm-6">
            <label class="form-label form-label-sm">Aplicación${btnAyuda('modoTramos')}</label>
            <select class="form-select form-select-sm" name="modoTramos" id="inv-modo">
              <option value="${MODO_PROGRESIVO}" ${cuenta?.modoTramos !== MODO_UNICO ? 'selected' : ''}>Progresivo por tramos</option>
              <option value="${MODO_UNICO}"      ${cuenta?.modoTramos === MODO_UNICO ? 'selected' : ''}>Tasa única según el saldo</option>
            </select>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label form-label-sm">Interpretación de la tasa${btnAyuda('modoTasa')}</label>
            <select class="form-select form-select-sm" name="modoTasa" id="inv-modo-tasa">
              <option value="${TASA_NOMINAL}"  ${cuenta?.modoTasa !== TASA_EFECTIVA ? 'selected' : ''}>La tasa es nominal</option>
              <option value="${TASA_EFECTIVA}" ${cuenta?.modoTasa === TASA_EFECTIVA ? 'selected' : ''}>La tasa es efectiva (GAT)</option>
            </select>
          </div>
        </div>
        <div id="inv-tramos"></div>

        <div class="mt-3">
          <a class="small text-decoration-none" data-bs-toggle="collapse" href="#inv-adv" role="button">
            <i class="bi bi-sliders me-1"></i>Avanzado
          </a>
          <div class="collapse ${cuenta?.isrAnual
            || cuenta?.isrSobre === ISR_INTERES || cuenta?.redondeoTasa === 'redondear'
            || cuenta?.redondeoDiario === REDONDEO_CENTAVOS
            || (cuenta?.baseAnual && cuenta.baseAnual !== BASE_ANUAL_DEFAULT)
            || (cuenta?.baseIsr   && cuenta.baseIsr   !== BASE_ANUAL_DEFAULT) ? 'show' : ''}" id="inv-adv">
            <div class="row g-2 mt-1">
              <div class="col-12"><div class="inv-adv-sep">Retención de ISR</div></div>
              <div class="col-12 col-sm-5">
                <label class="form-label"><span id="inv-isr-label">Tasa de retención</span>${btnAyuda('isr')}</label>
                <div class="input-group">
                  <input type="number" class="form-control" name="isrAnual" min="0" step="0.01"
                         value="${cuenta?.isrAnual ?? ''}" placeholder="0.00">
                  <span class="input-group-text">%</span>
                </div>
              </div>
              <div class="col-12 col-sm-7">
                <label class="form-label">Se calcula sobre${btnAyuda('isrSobre')}</label>
                <select class="form-select" name="isrSobre" id="inv-isr-sobre">
                  <option value="${ISR_CAPITAL}" ${cuenta?.isrSobre !== ISR_INTERES ? 'selected' : ''}>El capital — tasa anual</option>
                  <option value="${ISR_INTERES}" ${cuenta?.isrSobre === ISR_INTERES ? 'selected' : ''}>El interés ganado — % directo</option>
                </select>
              </div>

              <div class="col-12"><div class="inv-adv-sep">Convenciones de cálculo</div></div>
              <div class="col-12 col-sm-4">
                <label class="form-label">Base anual — interés${btnAyuda('baseAnual')}</label>
                <select class="form-select" name="baseAnual">
                  <option value="365" ${Number(cuenta?.baseAnual) !== 360 ? 'selected' : ''}>365 días</option>
                  <option value="360" ${Number(cuenta?.baseAnual) === 360 ? 'selected' : ''}>360 días</option>
                </select>
              </div>
              <div class="col-12 col-sm-4" id="inv-baseisr-wrap">
                <label class="form-label">Base anual — ISR${btnAyuda('baseIsr')}</label>
                <select class="form-select" name="baseIsr">
                  <option value="365" ${Number(cuenta?.baseIsr) !== 360 ? 'selected' : ''}>365 días</option>
                  <option value="360" ${Number(cuenta?.baseIsr) === 360 ? 'selected' : ''}>360 días</option>
                </select>
              </div>
              <div class="col-12 col-sm-4">
                <label class="form-label">Tasa ponderada${btnAyuda('redondeoTasa')}</label>
                <select class="form-select" name="redondeoTasa">
                  <option value="truncar"    ${cuenta?.redondeoTasa !== 'redondear' ? 'selected' : ''}>Truncar</option>
                  <option value="redondear"  ${cuenta?.redondeoTasa === 'redondear' ? 'selected' : ''}>Redondear</option>
                </select>
              </div>
              <div class="col-12 col-sm-4">
                <label class="form-label">Redondeo diario${btnAyuda('redondeoDiario')}</label>
                <select class="form-select" name="redondeoDiario">
                  <option value="${REDONDEO_CONTINUO}" ${cuenta?.redondeoDiario !== REDONDEO_CENTAVOS ? 'selected' : ''}>Continuo</option>
                  <option value="${REDONDEO_CENTAVOS}" ${cuenta?.redondeoDiario === REDONDEO_CENTAVOS ? 'selected' : ''}>A centavos</option>
                </select>
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

  // ── Campos que cambian según la base de la retención ──────────────────────
  const selSobre = document.getElementById('inv-isr-sobre');

  const sincronizarIsr = () => {
    const sobreInteres = selSobre.value === ISR_INTERES;
    // Sobre el interés el número es un porcentaje directo, no una tasa anual
    document.getElementById('inv-isr-label').textContent =
      sobreInteres ? 'Porcentaje retenido' : 'Tasa de retención anual';
    // La base del ISR solo tiene sentido cuando la tasa se anualiza sobre el capital
    document.getElementById('inv-baseisr-wrap').style.display = sobreInteres ? 'none' : '';
  };

  selSobre.addEventListener('change', sincronizarIsr);
  sincronizarIsr();

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
      modoTasa:           raw.modoTasa === TASA_EFECTIVA ? TASA_EFECTIVA : TASA_NOMINAL,
      baseAnual:          Number(raw.baseAnual) || BASE_ANUAL_DEFAULT,
      isrAnual:           Number(raw.isrAnual)  || 0,
      isrSobre:           raw.isrSobre === ISR_INTERES ? ISR_INTERES : ISR_CAPITAL,
      baseIsr:            Number(raw.baseIsr)   || BASE_ANUAL_DEFAULT,
      redondeoTasa:       raw.redondeoTasa === 'redondear' ? 'redondear' : 'truncar',
      redondeoDiario:     raw.redondeoDiario === REDONDEO_CENTAVOS ? REDONDEO_CENTAVOS : REDONDEO_CONTINUO,
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
      refrescar();
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
