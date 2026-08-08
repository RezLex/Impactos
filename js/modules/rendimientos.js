import { getAll, getById, create, update, remove, batchUpdate } from '../utils/db.js';
import { currency, fmtDate, r2, textoLegibleSobre, rgbLegibleSobre } from '../utils/formatters.js';
import { toast, confirmDelete, openModal, closeModal } from '../utils/ui.js';
import {
  resumenCuenta, totalizarResumenes, rendimientoEntre, eventosCuenta,
  historialDiario, timelineCuenta, configCuenta, hoyISO, isoDay, diasEntre,
  conciliar, recalcularAjustes, capturasDescartadas, historialConsistente,
  movimientosTransferencia, validarTransferencia, esTransferencia,
  conTransferencia, sinTransferencia,
  TRAMOS_DEFAULT, BASE_ANUAL_DEFAULT,
  MODO_PROGRESIVO, MODO_UNICO, ISR_CAPITAL, ISR_INTERES,
  TASA_NOMINAL, TASA_EFECTIVA, REDONDEO_CONTINUO, REDONDEO_CENTAVOS,
  MOV_APORTE, MOV_RETIRO,
} from '../utils/rendimiento.js';

const COL = 'inversiones';

/**
 * Tope de capturas de saldo archivadas. Cada entrada pesa unas decenas de bytes
 * y el documento admite 1 MB, así que el límite existe solo para acotar el caso
 * patológico — no para ahorrar espacio. Perder capturas viejas rompe los
 * reportes de periodos anteriores, que es justo lo que sostiene el historial.
 *
 * Los movimientos y los ajustes NO se recortan: sin ellos el pasado deja de
 * reconstruirse.
 */
const MAX_HIST = 1000;

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

/**
 * Quita el `cambio` —metadato de la comparación— antes de persistir. `derivado`
 * sí se guarda: distingue el ajuste que absorbe todo el residuo del que el
 * usuario dimensionó a mano, y solo el primero se recalcula.
 */
const limpiarAjustes = lista => lista.map(({ cambio, ...a }) => a);

/**
 * Recalcula los ajustes derivados de cómo quedaría la cuenta y, si alguno cambia
 * de importe, lo confirma antes de guardar: editar la raíz o mover dinero en el
 * pasado no debe correr cifras a espaldas del usuario. El motivo se conserva
 * siempre — la clasificación es criterio suyo, solo se rehace la aritmética.
 *
 * @returns {Array|null} ajustes listos para persistir, o `null` si se canceló
 */
function ajustesTrasEditar(cuentaResultante, etiqueta = '') {
  const recalculados = recalcularAjustes(cuentaResultante);
  const cambian = recalculados.filter(a => Math.abs(a.cambio) >= 0.01);
  if (!cambian.length) return limpiarAjustes(recalculados);

  const detalle = cambian.map(a =>
    `  · ${fmtDate(a.fecha)}:  ${currency(a.monto - a.cambio)}  →  ${currency(a.monto)}`).join('\n');
  const donde = etiqueta ? ` en ${etiqueta}` : '';
  const plural = cambian.length > 1 ? 's' : '';
  return window.confirm(
    `Este cambio recalcula ${cambian.length} ajuste${plural} ya registrado${plural}${donde}:\n\n` +
    `${detalle}\n\nSe conserva el motivo de cada uno. ¿Continuar?`)
    ? limpiarAjustes(recalculados)
    : null;
}

/**
 * Si la nueva fecha de una raíz (monto invertido o rendimiento obtenido) es
 * anterior a capturas que ya había, esas quedan "en el futuro" respecto a la
 * nueva raíz y no pueden seguir siendo su historial — se descartan, pero solo
 * con confirmación explícita: es una corrección deliberada del punto de partida
 * (por ejemplo, arrancar una cuenta vieja desde otra fecha sin reconstruir todo
 * el camino intermedio), no algo que deba pasar en silencio.
 *
 * @returns {Array|undefined|null} historial listo para persistir, `undefined` si
 *   no había nada que descartar (el `historial` de entrada sigue sirviendo tal
 *   cual), o `null` si el usuario canceló.
 */
function historialTrasCorregirRaiz(historial, nuevaFecha, etiqueta) {
  const descartadas = capturasDescartadas(historial, nuevaFecha);
  if (!descartadas.length) return undefined;

  const detalle = descartadas.map(h => `  · ${fmtDate(h.fecha)}: ${currency(h.monto)}`).join('\n');
  const plural = descartadas.length > 1 ? 's' : '';
  return window.confirm(
    `La nueva fecha de ${etiqueta} (${fmtDate(nuevaFecha)}) es anterior a ` +
    `${descartadas.length} captura${plural} ya registrada${plural}:\n\n${detalle}\n\n` +
    `Se van a descartar del historial — la cuenta arranca de nuevo desde este punto. ¿Continuar?`)
    ? historialConsistente(historial, nuevaFecha)
    : null;
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

// ── Menú de acciones poco frecuentes ──────────────────────────────────────────

/**
 * El menú se monta en el `<body>`, no dentro de la tarjeta: `.inv-card` usa
 * `overflow: hidden` para recortar el encabezado de color a las esquinas
 * redondeadas, y cualquier menú anclado adentro saldría cortado.
 */
let _menu = null;

function cerrarMenu() {
  _menu?.remove();
  _menu = null;
}

function abrirMenu(boton, acciones) {
  const mismo = _menu?.dataset.owner === boton.dataset.id;
  cerrarMenu();
  if (mismo) return; // segundo clic sobre el mismo botón: alterna

  const menu = document.createElement('div');
  menu.className = 'inv-menu';
  menu.dataset.owner = boton.dataset.id;
  menu.style.visibility = 'hidden';
  menu.innerHTML = acciones.map((a, i) => `
    <button type="button" class="inv-menu-item ${a.peligro ? 'danger' : ''}" data-i="${i}">
      <i class="bi bi-${a.icono}"></i>${esc(a.texto)}
    </button>`).join('');
  document.body.appendChild(menu);

  // Se alinea por la derecha del botón y cae hacia abajo, salvo que no quepa
  const r = boton.getBoundingClientRect();
  const { offsetWidth: ancho, offsetHeight: alto } = menu;
  const left = Math.max(8, Math.min(r.right - ancho, window.innerWidth - ancho - 8));
  const top  = (r.bottom + alto + 8 > window.innerHeight && r.top - alto - 4 > 0)
    ? r.top - alto - 4
    : r.bottom + 4;
  menu.style.left = `${left + window.scrollX}px`;
  menu.style.top  = `${top + window.scrollY}px`;
  menu.style.visibility = '';

  menu.querySelectorAll('.inv-menu-item').forEach(b =>
    b.addEventListener('click', () => {
      cerrarMenu();
      acciones[Number(b.dataset.i)].accion();
    }));
  _menu = menu;
}

let _menuListo = false;
function activarMenus() {
  if (_menuListo) return;
  // Un clic en el propio botón lo gestiona su handler, que ya alterna
  document.addEventListener('click', e => {
    if (!e.target.closest('.inv-menu') && !e.target.closest('.btn-inv-mas')) cerrarMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarMenu(); });
  window.addEventListener('resize', cerrarMenu);
  window.addEventListener('scroll', cerrarMenu, true); // captura: también scroll interno
  _menuListo = true;
}

// Estado de la calculadora — sobrevive a los re-render del módulo
const _calc = { cuentaId: '', desde: '', hasta: '' };

export async function render(container) {
  activarAyuda();
  activarMenus();
  cerrarMenu(); // al cambiar de vista no debe sobrevivir en el body
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

    // Editar y eliminar viven en un menú: se usan poco y el borrado no debe
    // quedar pegado a las acciones de captura diaria
    container.querySelectorAll('.btn-inv-mas').forEach(b =>
      b.addEventListener('click', () => {
        const c = cuentas.find(x => x.id === b.dataset.id);
        abrirMenu(b, [
          {
            icono: 'pencil', texto: 'Editar cuenta',
            accion: () => showCuentaModal(container, instituciones, c),
          },
          {
            icono: 'trash3', texto: 'Eliminar cuenta', peligro: true,
            accion: async () => {
              if (!confirmDelete(nombreCuenta(c, instNombre(c)))) return;
              try {
                await remove(COL, c.id);
                toast('Cuenta eliminada');
                renderView(container);
              } catch (e) { toast('Error: ' + e.message, 'danger'); }
            },
          },
        ]);
      }));

    container.querySelectorAll('.btn-inv-ajuste').forEach(b =>
      b.addEventListener('click', () => {
        const c = cuentas.find(x => x.id === b.dataset.id);
        showAjusteModal(container, c, resumenes.get(c.id), nombreCuenta(c, instNombre(c)));
      }));

    container.querySelectorAll('.btn-inv-mov').forEach(b =>
      b.addEventListener('click', () => {
        const c = cuentas.find(x => x.id === b.dataset.id);
        showMovimientosModal(container, c, cuentas, instMap);
      }));

    container.querySelectorAll('.btn-inv-hist').forEach(b =>
      b.addEventListener('click', () => {
        const c = cuentas.find(x => x.id === b.dataset.id);
        showHistorialModal(container, c, nombreCuenta(c, instNombre(c)));
      }));

    container.querySelectorAll('.btn-inv-tramos').forEach(b =>
      b.addEventListener('click', () => {
        const c = cuentas.find(x => x.id === b.dataset.id);
        showTramosModal(c, instMap[c.institucionId]);
      }));

    container.querySelectorAll('.btn-inv-detalle').forEach(b =>
      b.addEventListener('click', () => {
        const c = cuentas.find(x => x.id === b.dataset.id);
        showDetalleModal(container, c, instMap[c.institucionId], accion => {
          if (accion === 'editar') showCuentaModal(container, instituciones, c);
        });
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
            <button class="btn-inv-act btn-inv-ajuste"   data-id="${c.id}" title="Ajuste — saldo y rendimiento reales"><i class="bi bi-arrow-repeat"></i></button>
            <button class="btn-inv-act btn-inv-mov"      data-id="${c.id}" title="Aportaciones, retiros y traspasos"><i class="bi bi-arrow-left-right"></i></button>
            <button class="btn-inv-act btn-inv-mas"      data-id="${c.id}" title="Más acciones"
                    aria-haspopup="menu"><i class="bi bi-three-dots-vertical"></i></button>
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
    const res = rendimientoEntre(eventosCuenta(c), sel.desde, sel.hasta, configCuenta(c));
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

/**
 * La misma fórmula que `formulaTasa`, pero en abstracto — "tasa anual" en vez
 * del número de un tramo concreto. La usa el historial diario, que describe el
 * método una sola vez para toda la tabla en vez de la operación de un día
 * puntual (que es lo que sí hace `showDetalleModal`, con los montos de hoy).
 */
function formulaTasaAbstracta(r) {
  return r.modoTasa === TASA_EFECTIVA
    ? `(1 + tasa anual)<sup>1/${r.base}</sup> − 1`
    : `tasa anual ÷ ${r.base}`;
}

/**
 * Explica cómo se calcula el interés de cualquier día de la cuenta, según su
 * configuración — no los montos de un día en particular (eso ya lo hace
 * `showDetalleModal`), sino el método en sí, para poder verificarlo contra un
 * estado de cuenta o replicarlo a mano.
 */
function bloqueFormula(r) {
  const fila = (etq, val, cls = '') =>
    `<div class="inv-op-row ${cls}"><span class="inv-op-formula">${etq}</span><span class="inv-op-formula">${val}</span></div>`;

  return `
    <div class="inv-op">
      ${fila('Interés bruto del día', 'saldo aplicable × tasa diaria', 'inv-op-base')}
      ${fila(`Tasa diaria (${r.modoTasa === TASA_EFECTIVA ? 'efectiva' : 'nominal'})`, formulaTasaAbstracta(r))}
      ${fila('Saldo aplicable', r.modo === MODO_UNICO
        ? 'todo el saldo, a la tasa del tramo en el que cae'
        : 'la suma de lo que aporta cada tramo (progresivo, como el ISR)')}
      ${r.isrAnual > 0 ? fila('Retención ISR', r.isrSobre === ISR_INTERES
        ? `interés bruto × ${pct(r.isrAnual)}`
        : `saldo × ${pct(r.isrAnual)} ÷ ${r.baseIsr}`, 'inv-op-neg') : ''}
      ${fila('Rendimiento neto del día', 'bruto − ISR', 'inv-op-total')}
    </div>
    <p class="inv-tr-nota">
      ${r.redondeo === REDONDEO_CENTAVOS
        ? 'Bruto e ISR se redondean a centavos antes de sumarse al saldo.'
        : 'Sin redondeo diario: el saldo compone con el valor exacto, sin centavos de por medio.'}
      Un movimiento (aporte o retiro) rinde ese mismo día sobre el saldo <strong>anterior</strong>
      — el saldo nuevo empieza a componer recién desde el día siguiente.
    </p>`;
}

function showDetalleModal(container, cuenta, inst, refrescar) {
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
    trasCerrar(() => showHistorialModal(container, cuenta, etiqueta)));
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

/**
 * Arma y descarga el reporte de un historial: la misma tabla que se ve en el
 * modal, más una columna "(exacto)" por cada importe —sin redondear a
 * centavos, tal como lo maneja el motor internamente— y una segunda hoja que
 * documenta la fórmula y la configuración con la que se calculó todo, para que
 * el archivo se explique solo sin tener que volver a la app.
 */
function generarReporteHistorial(cuenta, etiqueta, filas, r) {
  const r2v = n => Math.round((Number(n) || 0) * 100) / 100;

  // Varias correcciones pueden caer el mismo día — se listan todas, no solo la última
  const motivosPorFecha = new Map();
  (Array.isArray(cuenta.ajustes) ? cuenta.ajustes : []).forEach(a => {
    const f = isoDay(a?.fecha);
    if (!f) return;
    motivosPorFecha.set(f, [...(motivosPorFecha.get(f) || []), a.motivo || 'Sin motivo']);
  });

  const filasReporte = filas.map(f => ({
    Fecha: f.fecha,
    Saldo: r2v(f.saldoFinal), 'Saldo (exacto)': f.saldoFinal,
    'Rendimiento del día': r2v(f.neto), 'Rendimiento del día (exacto)': f.neto,
    Bruto: r2v(f.bruto), 'Bruto (exacto)': f.bruto,
    ISR: r2v(f.isr), 'ISR (exacto)': f.isr,
    'Saldo inicial': r2v(f.saldoInicial), 'Saldo inicial (exacto)': f.saldoInicial,
    Movimiento: f.movimiento || 0,
    'Ajuste de rendimiento': f.ajuste || 0,
    'Motivo del ajuste': (motivosPorFecha.get(f.fecha) || []).join(' · '),
  }));

  const config = [
    { Campo: 'Cuenta', Valor: etiqueta },
    { Campo: 'Interpretación de la tasa', Valor: r.modoTasa === TASA_EFECTIVA ? 'Efectiva (GAT)' : 'Nominal' },
    { Campo: 'Fórmula de la tasa diaria', Valor: r.modoTasa === TASA_EFECTIVA
        ? `(1 + tasa anual) ^ (1/${r.base}) − 1` : `tasa anual ÷ ${r.base}` },
    { Campo: 'Base anual (días)', Valor: r.base },
    { Campo: 'Aplicación de tramos', Valor: r.modo === MODO_UNICO ? 'Tasa única' : 'Progresivo' },
    { Campo: 'Tramos', Valor: r.desglose.map((t, i) => `${rangoTramo(t, i === 0)} → ${pct(t.tasa)}`).join('   |   ') },
    { Campo: 'Retención ISR', Valor: r.isrAnual > 0
        ? `${pct(r.isrAnual)} ${r.isrSobre === ISR_INTERES ? 'del interés' : `sobre capital, base ${r.baseIsr}`}`
        : 'Sin retención' },
    { Campo: 'Redondeo diario', Valor: r.redondeo === REDONDEO_CENTAVOS
        ? 'A centavos, antes de sumarse al saldo' : 'Continuo (sin redondear)' },
    { Campo: 'Regla de movimientos', Valor: 'Un aporte o retiro rinde su día de llegada sobre el saldo ' +
        'anterior; el saldo nuevo empieza a componer recién desde el día siguiente.' },
    { Campo: 'Generado', Valor: new Date().toLocaleString('es-MX') },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasReporte), 'Rendimiento diario');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(config), 'Cómo se calculó');
  const nombreArchivo = etiqueta.replace(/[^\w]+/g, '_');
  XLSX.writeFile(wb, `Rendimiento_${nombreArchivo}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function showHistorialModal(container, cuenta, etiqueta) {
  let filas, r;   // recalculados cada vez que se re-renderiza el cuerpo
  let cambiado = false; // si se registró algún ajuste, la tarjeta necesita refrescar al cerrar

  /** Reconstruye `filas`/`r` desde la cuenta actual y repinta el cuerpo del modal. */
  function pintarHistorial() {
    r     = resumenCuenta(cuenta, hoyISO());
    filas = historialDiario(cuenta, hoyISO()).reverse(); // más reciente primero
    const conIsr  = filas.some(f => f.isr > 0.0000001);
    const totNeto = filas.reduce((s, f) => s + f.neto + (f.ajuste || 0), 0);
    const totIsr  = filas.reduce((s, f) => s + f.isr, 0);
    const cols    = conIsr ? 5 : 3;

    // Ajustes agrupados por fecha, para distinguir en cada renglón si lo que cayó
    // ese día fue una corrección al interés de ESE día ('diario') o un ajuste de
    // saldo/rendimiento total que solo coincide en fecha ('saldo' — o sin `tipo`,
    // que es como quedaron los ajustes creados antes de esta distinción).
    const ajustesPorFecha = new Map();
    (Array.isArray(cuenta.ajustes) ? cuenta.ajustes : []).forEach(a => {
      const f = isoDay(a?.fecha);
      if (!f) return;
      ajustesPorFecha.set(f, [...(ajustesPorFecha.get(f) || []), a]);
    });

    // Mismo punto de partida que usa `historialDiario` por dentro — el más
    // reciente del timeline completo, no el campo `fechaActualizacion` suelto.
    const timeline = timelineCuenta(cuenta);
    const ultimo   = timeline[timeline.length - 1];

    const seccionFormula = `
      <div class="mt-2 mb-3">
        <a class="small text-decoration-none" data-bs-toggle="collapse" href="#inv-hist-formula" role="button">
          <i class="bi bi-calculator me-1"></i>Cómo se calcula
        </a>
        <div class="collapse" id="inv-hist-formula">
          <div class="mt-2">${bloqueFormula(r)}</div>
        </div>
      </div>`;

    document.querySelector('#app-modal .modal-body').innerHTML = filas.length === 0
      ? `<div class="empty-state" style="padding:28px 0">
           <i class="bi bi-clock-history"></i>
           <p>Aún no hay días transcurridos desde la última captura
              (${ultimo ? fmtDate(ultimo.fecha) : '—'}).<br>
              El primer rendimiento aparecerá mañana.</p>
         </div>
         ${seccionFormula}`
      : `<p class="text-muted mb-2" style="font-size:0.78rem">
           Cada renglón es el día que <strong>generó</strong> el interés; las instituciones lo abonan
           a la madrugada siguiente. Calculado desde ${currency(ultimo?.monto)}
           capturados el ${ultimo ? fmtDate(ultimo.fecha) : '—'}.
         </p>
         <div class="table-wrapper inv-hist-tabla">
           <table class="table table-sm mb-0">
             <thead><tr>
               <th>Día</th>
               <th class="text-end">Saldo</th>
               ${conIsr ? '<th class="text-end">Bruto</th><th class="text-end">ISR</th>' : ''}
               <th class="text-end">Rendimiento</th>
             </tr></thead>
             <tbody>
               ${filas.map((f, i) => {
                 // Un ajuste "diario" corrige justo el interés de este renglón — se
                 // resalta en naranja. Uno de "saldo" viene de conciliar el total
                 // capturado contra otra fecha; puede caer el mismo día por
                 // coincidencia, pero no dice nada sobre el cálculo de ESTE día en
                 // particular, así que solo se marca con un indicador.
                 const ajustesDia = ajustesPorFecha.get(f.fecha) || [];
                 const diarios    = ajustesDia.filter(a => a.tipo === 'diario');
                 const saldos     = ajustesDia.filter(a => a.tipo !== 'diario'); // legado sin tipo = saldo
                 const hayDiario  = diarios.length > 0;
                 const montoDiario = diarios.reduce((s, a) => s + (Number(a.monto) || 0), 0);
                 const montoSaldo  = saldos.reduce((s, a) => s + (Number(a.monto) || 0), 0);
                 // El renglón que se ve es lo calculado MÁS el ajuste — no tiene
                 // sentido mostrar solo el interés y esconder la corrección en la
                 // etiqueta chiquita de al lado
                 const rendimientoDelDia = f.neto + (f.ajuste || 0);
                 return `
                 <tr class="${i === 0 ? 'inv-hist-ayer' : ''}">
                   <td>
                     ${fmtDate(f.fecha)}${i === 0 ? '<span class="inv-tr-marg">último</span>' : ''}
                     ${Math.abs(f.movimiento || 0) >= 0.01
                       ? `<span class="inv-tr-marg" title="Movimiento aplicado ese día">${
                            f.movimiento > 0 ? '+' : '−'}${currency(Math.abs(f.movimiento))}</span>` : ''}
                     ${hayDiario
                       ? `<span class="inv-tr-marg" title="Ajuste al rendimiento de este día">ajuste ${
                            montoDiario > 0 ? '+' : '−'}${currency(Math.abs(montoDiario))}</span>` : ''}
                     ${saldos.length
                       ? `<span class="inv-tr-marg" title="Ajuste de saldo/rendimiento total aplicado este día: ${
                            montoSaldo > 0 ? '+' : '−'}${currency(Math.abs(montoSaldo))}">saldo</span>` : ''}
                   </td>
                   <td class="text-end text-muted">${currency(f.saldoFinal)}</td>
                   ${conIsr ? `<td class="text-end text-muted">${currency(f.bruto)}</td>
                               <td class="text-end text-danger">−${currency(f.isr)}</td>` : ''}
                   <td class="text-end fw-semibold ${hayDiario ? 'text-warning' : 'text-success'}"
                       ${hayDiario ? 'title="Incluye el ajuste diario registrado ese día"' : ''}>
                     ${currency(rendimientoDelDia)}
                     <button type="button" class="btn btn-link btn-sm p-0 ms-1 inv-hist-corregir"
                             data-fecha="${f.fecha}" data-neto="${f.neto}"
                             title="Corregir este día" style="line-height:1;vertical-align:-1px">
                       <i class="bi bi-pencil-square"></i>
                     </button>
                   </td>
                 </tr>`;
               }).join('')}
             </tbody>
             <tfoot><tr>
               <td colspan="${cols - (conIsr ? 3 : 1)}">TOTAL · ${filas.length} ${filas.length === 1 ? 'día' : 'días'}</td>
               ${conIsr ? `<td></td><td class="text-end text-danger">−${currency(totIsr)}</td>` : ''}
               <td class="text-end text-success">${currency(totNeto)}</td>
             </tr></tfoot>
           </table>
         </div>
         ${seccionFormula}`;

    document.querySelectorAll('.inv-hist-corregir').forEach(b =>
      b.addEventListener('click', () =>
        mostrarCorreccionDia(b.dataset.fecha, Number(b.dataset.neto))));

    const btnReporte = document.getElementById('inv-hist-reporte');
    if (btnReporte) btnReporte.classList.toggle('d-none', filas.length === 0);
  }

  // El historial y la corrección comparten `#app-modal` (uno a la vez, como el
  // resto de la app) — encadenarlos espera el cierre real en vez de adivinar
  // con un timeout, mismo patrón que ya usa `showDetalleModal`.
  const trasCerrar = fn => {
    const el = document.getElementById('app-modal');
    if (!el) { fn(); return; }
    el.addEventListener('hidden.bs.modal', () => setTimeout(fn, 0), { once: true });
    closeModal();
  };

  /** Abre (o reabre) el modal del historial con su barra de acciones de siempre. */
  function abrirHistorial() {
    openModal({
      size: 'lg',
      title: `Rendimiento diario — ${esc(etiqueta)}`,
      body: '<div class="text-center py-4"><span class="spinner-border spinner-border-sm"></span></div>',
      footer: `
        <button type="button" class="btn btn-outline-primary btn-sm" id="inv-hist-reporte">
          <i class="bi bi-file-earmark-excel me-1"></i>Generar reporte
        </button>
        <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cerrar</button>`
    });

    document.getElementById('inv-hist-reporte').addEventListener('click', () => {
      const btn = document.getElementById('inv-hist-reporte');
      btn.disabled = true;
      try {
        generarReporteHistorial(cuenta, etiqueta, filas, r);
        toast('Reporte generado');
      } catch (e) {
        toast('Error al generar el reporte: ' + e.message, 'danger');
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('app-modal')?.addEventListener('hidden.bs.modal', () => {
      if (cambiado) renderView(container);
    }, { once: true });

    pintarHistorial();
  }

  /**
   * Corrección puntual de un día, en su propio modal — la diferencia entre lo
   * que calculó la app y lo que de verdad reportó el banco ese día se registra
   * como ajuste, el mismo mecanismo que usa el modal de Ajuste. El valor
   * precargado ya viene redondeado a centavos, igual que se ve en la tabla, y
   * los botones ± lo mueven de centavo en centavo para no tener que escribir
   * el número completo por una diferencia mínima.
   */
  function mostrarCorreccionDia(fecha, netoCalculado) {
    const inicial = r2(netoCalculado);

    trasCerrar(() => {
      openModal({
        title: `Corregir rendimiento — ${fmtDate(fecha)}`,
        body: `
          <div class="inv-op mb-3">
            <div class="inv-op-row inv-op-base">
              <span class="inv-op-formula">Esta app calculó ese día</span>
              <span>${currency(inicial)}</span>
            </div>
          </div>
          <label class="form-label">Rendimiento real reportado por el banco</label>
          <div class="input-group">
            <button type="button" class="btn btn-outline-secondary" id="corr-menos" title="Restar un centavo">
              <i class="bi bi-dash-lg"></i>
            </button>
            <span class="input-group-text">$</span>
            <input type="number" class="form-control text-center" id="corr-real" step="0.01" value="${inicial}">
            <button type="button" class="btn btn-outline-secondary" id="corr-mas" title="Sumar un centavo">
              <i class="bi bi-plus-lg"></i>
            </button>
          </div>
          <div id="corr-nota" class="inv-upd-delta mt-2"></div>`,
        footer: `
          <button type="button" class="btn btn-secondary btn-sm" id="corr-cancelar">Cancelar</button>
          <button type="button" class="btn btn-primary btn-sm" id="corr-guardar">Registrar ajuste</button>`
      });

      const input = document.getElementById('corr-real');
      const nota  = document.getElementById('corr-nota');
      const pintarDelta = () => {
        const real = Number(input.value);
        if (!isFinite(real) || input.value === '') { nota.innerHTML = ''; return; }
        const delta = r2(real - inicial);
        nota.innerHTML = Math.abs(delta) < 0.01
          ? `<i class="bi bi-check-circle text-success me-1"></i>Coincide — no hace falta ajuste.`
          : `<i class="bi bi-info-circle me-1"></i>Se registrará un ajuste de
             <strong class="${delta > 0 ? 'text-success' : 'text-danger'}">${delta > 0 ? '+' : ''}${currency(delta)}</strong>
             el ${fmtDate(fecha)}.`;
      };
      input.addEventListener('input', pintarDelta);
      pintarDelta();

      const moverCentavo = dir => {
        input.value = r2((Number(input.value) || 0) + dir * 0.01).toFixed(2);
        pintarDelta();
      };
      document.getElementById('corr-menos').addEventListener('click', () => moverCentavo(-1));
      document.getElementById('corr-mas').addEventListener('click', () => moverCentavo(1));

      document.getElementById('corr-cancelar').addEventListener('click', () => trasCerrar(abrirHistorial));

      document.getElementById('corr-guardar').addEventListener('click', async () => {
        const real  = Number(input.value);
        const delta = r2(real - inicial);
        if (!isFinite(real) || Math.abs(delta) < 0.01) {
          toast('No hay diferencia que registrar', 'warning'); return;
        }
        const nuevos = [...(cuenta.ajustes || []), {
          fecha, monto: delta, motivo: 'Corrección detectada en el historial diario',
          tipo: 'diario', derivado: false,
        }];
        // Mismo resguardo que el resto de la app: si esto corre el residuo de
        // otro ajuste ya registrado, se confirma antes de guardar en cadena
        const ajustes = ajustesTrasEditar({ ...cuenta, ajustes: nuevos }, etiqueta);
        if (!ajustes) return;
        try {
          await update(COL, cuenta.id, { ajustes });
          cuenta.ajustes = ajustes;
          cambiado = true;
          toast('Ajuste registrado');
          trasCerrar(abrirHistorial); // el saldo/rendimiento de ahí en adelante ya cambió
        } catch (e) { toast('Error: ' + e.message, 'danger'); }
      });
    });
  }

  abrirHistorial();
}

// ── Modal: movimientos y transferencias ───────────────────────────────────────

/**
 * Alta y baja de aportaciones, retiros y traspasos entre cuentas del módulo.
 *
 * Un traspaso se captura una sola vez y se guarda como dos movimientos espejo,
 * uno en cada cuenta. Ambas patas se escriben en una sola operación: dejar media
 * transferencia descuadraría los dos lados a la vez.
 */
function showMovimientosModal(container, cuenta, cuentas, instMap) {
  const hoy      = hoyISO();
  const otras    = cuentas.filter(c => c.id !== cuenta.id);
  const nombreDe = c => nombreCuenta(c, instMap[c.institucionId]?.nombre);
  const etiqueta = nombreDe(cuenta);
  let cambiado   = false;

  const lista = () => (Array.isArray(cuenta.movimientos) ? cuenta.movimientos : [])
    .slice()
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))); // más reciente primero

  /**
   * Persiste el cambio en una o dos cuentas a la vez, recalculando los ajustes
   * que dependan de ellas. Devuelve `false` si el usuario canceló el recálculo.
   */
  async function guardar(cambios) {
    const items = [];
    for (const { cta, movimientos } of cambios) {
      const ajustes = ajustesTrasEditar({ ...cta, movimientos }, nombreDe(cta));
      if (!ajustes) return false;
      const data = { movimientos };
      if (ajustes.length || (cta.ajustes || []).length) data.ajustes = ajustes;
      items.push({ id: cta.id, data, cta });
    }
    await batchUpdate(COL, items.map(({ id, data }) => ({ id, data })));
    items.forEach(({ cta, data }) => Object.assign(cta, data)); // refleja en memoria
    cambiado = true;
    return true;
  }

  function filaMov(m, i) {
    const esTr   = esTransferencia(m);
    const entra  = m.tipo !== MOV_RETIRO;
    const signo  = entra ? 1 : -1;
    const contra = esTr ? cuentas.find(c => c.id === m.contraparteId) : null;

    return `
      <tr>
        <td>${fmtDate(isoDay(m.fecha))}</td>
        <td>
          ${entra ? 'Aporte' : 'Retiro'}
          ${esTr ? `<span class="inv-tr-marg" title="Traspaso entre cuentas propias">
                      ${entra ? 'desde' : 'hacia'} ${esc(contra ? nombreDe(contra) : 'cuenta eliminada')}
                    </span>` : ''}
          ${m.nota ? `<small class="text-muted d-block">${esc(m.nota)}</small>` : ''}
        </td>
        <td class="text-end fw-semibold ${entra ? 'text-success' : 'text-danger'}">
          ${entra ? '+' : '−'}${currency(Math.abs(Number(m.monto) || 0))}
        </td>
        <td class="text-end">
          <button class="btn-icon danger mov-del" data-i="${i}"
                  title="${esTr ? 'Eliminar el traspaso en ambas cuentas' : 'Eliminar movimiento'}">
            <i class="bi bi-trash3"></i>
          </button>
        </td>
      </tr>`;
  }

  function pintar() {
    const movs = lista();
    document.getElementById('mov-body').innerHTML = `
      ${movs.length === 0
        ? `<div class="empty-state" style="padding:22px 0">
             <i class="bi bi-arrow-left-right"></i>
             <p>Sin movimientos registrados.<br>
                Los aportes y retiros se separan del rendimiento para no inflar lo ganado.</p>
           </div>`
        : `<div class="table-wrapper inv-hist-tabla">
             <table class="table table-sm mb-0">
               <thead><tr>
                 <th>Fecha</th><th>Concepto</th><th class="text-end">Monto</th><th></th>
               </tr></thead>
               <tbody>${movs.map(filaMov).join('')}</tbody>
             </table>
           </div>`}

      <form id="mov-form" class="mt-3">
        <div class="inv-adv-sep">Nuevo movimiento</div>
        <div class="row g-2 mt-1">
          <div class="col-6 col-sm-3">
            <label class="form-label form-label-sm">Tipo</label>
            <select class="form-select form-select-sm" name="tipo" id="mov-tipo">
              <option value="${MOV_APORTE}">Entra dinero</option>
              <option value="${MOV_RETIRO}">Sale dinero</option>
            </select>
          </div>
          <div class="col-6 col-sm-3">
            <label class="form-label form-label-sm">Monto *</label>
            <div class="input-group input-group-sm">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="monto" required min="0.01" step="0.01" placeholder="0.00">
            </div>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label form-label-sm" id="mov-contra-lbl">Procedencia</label>
            <select class="form-select form-select-sm" name="contraparteId" id="mov-contra"
                    ${otras.length ? '' : 'disabled title="No hay otra cuenta de inversión registrada"'}>
              <option value="">Fuera del módulo</option>
              ${otras.map(c => `<option value="${c.id}">${esc(nombreDe(c))}</option>`).join('')}
            </select>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label form-label-sm" id="mov-fecha-lbl">Fecha *</label>
            <input type="date" class="form-control form-control-sm" name="fecha" required max="${hoy}" value="${hoy}">
          </div>
          <div class="col-12 col-sm-6 d-none" id="mov-fecha2-wrap">
            <label class="form-label form-label-sm">Fecha de llegada</label>
            <input type="date" class="form-control form-control-sm" name="fechaDestino" max="${hoy}">
            <div class="form-text">Opcional. Entre instituciones el dinero tarda, y en tránsito no genera interés en ninguna.</div>
          </div>
          <div class="col-12">
            <label class="form-label form-label-sm">Nota</label>
            <input type="text" class="form-control form-control-sm" name="nota" placeholder="Opcional">
          </div>
        </div>
        <div class="d-flex justify-content-end mt-2">
          <button type="button" class="btn btn-primary btn-sm" id="mov-add">
            <i class="bi bi-plus-lg me-1"></i>Agregar
          </button>
        </div>
      </form>`;

    // El selector de contraparte cambia de sentido según entre o salga dinero
    const selTipo   = document.getElementById('mov-tipo');
    const selContra = document.getElementById('mov-contra');
    const sincronizar = () => {
      const entra = selTipo.value !== MOV_RETIRO;
      document.getElementById('mov-contra-lbl').textContent = entra ? 'Procedencia' : 'Destino';
      const esTraspaso = !!selContra.value;
      document.getElementById('mov-fecha2-wrap').classList.toggle('d-none', !esTraspaso);
      document.getElementById('mov-fecha-lbl').textContent = esTraspaso ? 'Fecha de salida *' : 'Fecha *';
    };
    selTipo.addEventListener('change', sincronizar);
    selContra.addEventListener('change', sincronizar);
    sincronizar();

    document.getElementById('mov-add').addEventListener('click', agregar);
    document.querySelectorAll('.mov-del').forEach(b =>
      b.addEventListener('click', () => borrar(movs[Number(b.dataset.i)])));
  }

  async function agregar() {
    const form = document.getElementById('mov-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const raw = Object.fromEntries(new FormData(form));

    const monto = Number(raw.monto);
    const entra = raw.tipo !== MOV_RETIRO;
    const nota  = (raw.nota || '').trim();

    try {
      if (!raw.contraparteId) {
        const movimientos = [...(cuenta.movimientos || []),
          { fecha: raw.fecha, tipo: entra ? MOV_APORTE : MOV_RETIRO, monto, nota }];
        if (!await guardar([{ cta: cuenta, movimientos }])) return;
        toast('Movimiento registrado');
      } else {
        const otra = cuentas.find(c => c.id === raw.contraparteId);
        // Desde esta cuenta: si entra dinero, la contraparte es el origen
        const spec = {
          origenId:  entra ? otra.id : cuenta.id,
          destinoId: entra ? cuenta.id : otra.id,
          monto, fecha: raw.fecha, fechaDestino: raw.fechaDestino || null, nota,
        };
        const error = validarTransferencia(spec);
        if (error) { toast(error, 'warning'); return; }

        const { origen, destino } = movimientosTransferencia(spec);
        const patas = entra
          ? [{ cta: cuenta, pata: destino }, { cta: otra, pata: origen }]
          : [{ cta: cuenta, pata: origen },  { cta: otra, pata: destino }];
        const ok = await guardar(patas.map(({ cta, pata }) =>
          ({ cta, movimientos: conTransferencia(cta.movimientos, pata) })));
        if (!ok) return;
        toast(`Traspaso registrado en ambas cuentas`);
      }
      pintar();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  }

  async function borrar(mov) {
    const esTr = esTransferencia(mov);
    const otra = esTr ? cuentas.find(c => c.id === mov.contraparteId) : null;
    if (!window.confirm(esTr
      ? `¿Eliminar el traspaso? Se quita también de ${otra ? nombreDe(otra) : 'la otra cuenta'}.`
      : '¿Eliminar este movimiento?')) return;

    try {
      const cambios = esTr
        ? [{ cta: cuenta, movimientos: sinTransferencia(cuenta.movimientos, mov.transferenciaId) },
           ...(otra ? [{ cta: otra, movimientos: sinTransferencia(otra.movimientos, mov.transferenciaId) }] : [])]
        : [{ cta: cuenta, movimientos: (cuenta.movimientos || []).filter(m => m !== mov) }];
      if (!await guardar(cambios)) return;
      toast('Movimiento eliminado');
      pintar();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  }

  openModal({
    size: 'lg',
    title: `Movimientos — ${esc(etiqueta)}`,
    body: `
      <p class="text-muted mb-2" style="font-size:0.78rem">
        El dinero que entra o sale <strong>no es rendimiento</strong>: registrarlo aquí evita que
        se confunda con lo ganado. Puedes capturarlo con fecha pasada — se aplica en su día y
        corrige el rendimiento del periodo.
      </p>
      <div id="mov-body"></div>`,
    footer: `<button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cerrar</button>`
  });

  pintar();

  // Los saldos de las tarjetas cambian con cada movimiento: se repintan al salir
  document.getElementById('app-modal')?.addEventListener('hidden.bs.modal', () => {
    if (cambiado) renderView(container);
  }, { once: true });
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
      // Si la nueva fecha es más vieja que capturas que ya había (p. ej. arrancar
      // una cuenta vieja desde otro punto de partida), esas quedan en el futuro
      // respecto a la nueva raíz y hay que descartarlas — con confirmación
      const histCorregido = historialTrasCorregirRaiz(
        data.historial || cuenta.historial, data.fechaActualizacion, 'monto invertido');
      if (histCorregido === null) return;
      if (histCorregido !== undefined) data.historial = histCorregido;

      const prevFR = isoDay(cuenta.fechaActualizacionRendimiento);
      if (prevFR && prevFR !== data.fechaActualizacionRendimiento) {
        data.historialRendimiento = pushHistorial(cuenta.historialRendimiento, {
          fecha: prevFR, monto: Number(cuenta.rendimientoObtenido) || 0,
        });
      }
      const histRCorregido = historialTrasCorregirRaiz(
        data.historialRendimiento || cuenta.historialRendimiento,
        data.fechaActualizacionRendimiento, 'rendimiento obtenido');
      if (histRCorregido === null) return;
      if (histRCorregido !== undefined) data.historialRendimiento = histRCorregido;
    }

    // Cambiar tasa, tramos o la captura raíz mueve los residuos que explicaban
    // los ajustes ya registrados: se rehacen antes de guardar, no después
    if (isEdit) {
      const ajustes = ajustesTrasEditar({ ...cuenta, ...data });
      if (!ajustes) return;
      if (ajustes.length || (cuenta.ajustes || []).length) data.ajustes = ajustes;
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

/**
 * Desglose de la conciliación: de dónde sale el saldo esperado y qué sobra.
 * El residuo es lo único que el usuario tiene que clasificar — nunca calcular.
 */
function bloqueConciliacion(c) {
  const fila = (etq, val, cls = '', valCls = '') =>
    `<div class="inv-op-row ${cls}"><span>${etq}</span><span class="${valCls}">${val}</span></div>`;
  const firmado = v => `${v < 0 ? '−' : '+'}${currency(Math.abs(v))}`;

  return `
    <div class="inv-op mt-2">
      ${fila(`Saldo capturado el ${fmtDate(c.desde)}`, currency(c.saldoAnterior), 'inv-op-base')}
      ${fila(`<span class="inv-op-formula">Rendimiento proyectado · ${c.dias} ${c.dias === 1 ? 'día' : 'días'}</span>`,
             firmado(c.rendimientoProyectado))}
      ${Math.abs(c.movimientos) >= 0.01
        ? fila('<span class="inv-op-formula">Movimientos registrados</span>', firmado(c.movimientos)) : ''}
      ${Math.abs(c.ajustes) >= 0.01
        ? fila('<span class="inv-op-formula">Ajustes registrados</span>', firmado(c.ajustes)) : ''}
      ${fila('Saldo esperado', currency(c.saldoEsperado), 'inv-op-sub')}
      ${fila('Saldo real capturado', currency(c.saldoReal), 'inv-op-sub')}
      ${c.cuadra
        ? fila('<i class="bi bi-check-circle text-success me-1"></i>Cuadra al centavo', '', 'inv-op-total')
        : fila('Sin explicar', firmado(c.residuo), 'inv-op-total',
               c.residuo < 0 ? 'text-danger' : 'text-success')}
    </div>`;
}

/**
 * Ajuste — captura de una sola vez el saldo y el rendimiento reales, que casi
 * siempre se leen del mismo estado de cuenta en el mismo momento. Antes eran dos
 * modales separados ("Actualizar monto" y "Actualizar rendimiento"); comparten
 * una sola fecha porque no tiene sentido capturarlos por separado si vienen de
 * la misma foto de la cuenta.
 */
function showAjusteModal(container, cuenta, r, etiqueta) {
  const hoy           = hoyISO();
  const estimadoMonto = r2(r.saldoActual);
  const estimadoRend  = r2(r.rendimientoHastaHoy);
  const cfg           = configCuenta(cuenta);

  let conc = null;              // última conciliación calculada
  let montoTocado = false;      // si el usuario ya ajustó el importe a clasificar
  let tipoTocado  = false;

  let cambiado = false; // si se editó/borró algún ajuste, la tarjeta necesita refrescar al cerrar

  openModal({
    size: 'lg',
    title: `Ajuste — ${esc(etiqueta)}`,
    body: `
      <div class="mb-3">
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div class="inv-adv-sep mb-0">Ajustes registrados</div>
          <div class="btn-group btn-group-sm" role="group" id="ajuste-filtro">
            <button type="button" class="btn btn-outline-secondary active" data-filtro="saldo">Saldo</button>
            <button type="button" class="btn btn-outline-secondary" data-filtro="diario">Diario</button>
            <button type="button" class="btn btn-outline-secondary" data-filtro="todos">Todos</button>
          </div>
        </div>
        <div id="ajuste-lista-wrap" class="mt-2"></div>
      </div>
      <hr class="my-3">

      <p class="text-muted mb-2" style="font-size:0.78rem">
        Capturá el saldo y el rendimiento <strong>reales</strong> que muestra tu estado de cuenta —
        normalmente salen juntos de la misma consulta. Los valores anteriores quedan en el historial.
      </p>
      <form id="ajuste-form">
        <div class="row g-2 mb-3">
          <div class="col-12 col-sm-6">
            <label class="form-label">Fecha *</label>
            <input type="date" class="form-control" name="fecha" required max="${hoy}" value="${hoy}">
          </div>
        </div>

        <div class="inv-adv-sep">Saldo</div>
        <div class="inv-upd-est mt-2">
          <div>
            <div class="inv-upd-est-lbl">Saldo estimado a hoy</div>
            <div class="inv-upd-est-val">${currency(estimadoMonto)}</div>
          </div>
          <button type="button" class="btn btn-outline-primary btn-sm" id="inv-usar-est">
            <i class="bi bi-magic me-1"></i>Usar este valor
          </button>
        </div>
        <div class="row g-2 mt-1">
          <div class="col-12">
            <label class="form-label">Monto invertido *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="montoInvertido" required min="0" step="0.01"
                     value="${estimadoMonto}">
            </div>
          </div>
        </div>
        <div id="conc-desglose" class="mt-2"></div>
        <div id="conc-clasif" class="d-none">
          <div class="row g-2 mt-1">
            <div class="col-12 col-sm-7">
              <label class="form-label form-label-sm">¿Qué fue esa diferencia?</label>
              <select class="form-select form-select-sm" id="conc-tipo">
                <option value="ajuste">Deriva del cálculo — registrar ajuste</option>
                <option value="movimiento">Aportación o retiro que no registré</option>
                <option value="">Dejarlo sin clasificar por ahora</option>
              </select>
            </div>
            <div class="col-12 col-sm-5">
              <label class="form-label form-label-sm">Importe</label>
              <div class="input-group input-group-sm">
                <span class="input-group-text">$</span>
                <input type="number" class="form-control" id="conc-monto" step="0.01">
              </div>
            </div>
          </div>
          <div id="conc-nota" class="inv-upd-delta"></div>
        </div>

        <hr class="my-3">

        <div class="inv-adv-sep">Rendimiento obtenido</div>
        <div class="inv-upd-est mt-2">
          <div>
            <div class="inv-upd-est-lbl">Rendimiento estimado a hoy</div>
            <div class="inv-upd-est-val">${currency(estimadoRend)}</div>
          </div>
          <button type="button" class="btn btn-outline-primary btn-sm" id="rend-usar-est">
            <i class="bi bi-magic me-1"></i>Usar este valor
          </button>
        </div>
        <div class="row g-2 mt-1">
          <div class="col-12">
            <label class="form-label">Rendimiento obtenido *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="rendimientoObtenido" required step="0.01"
                     value="${estimadoRend}">
            </div>
          </div>
        </div>
        <div id="rend-upd-delta" class="inv-upd-delta"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-ajuste">Guardar</button>`
  });

  const form       = document.getElementById('ajuste-form');
  const inputMonto = form.montoInvertido;
  const inputRend  = form.rendimientoObtenido;
  const desglose   = document.getElementById('conc-desglose');
  const clasif     = document.getElementById('conc-clasif');
  const selTipo    = document.getElementById('conc-tipo');
  const inpMonto   = document.getElementById('conc-monto');
  const deltaRend  = document.getElementById('rend-upd-delta');

  const pintarNota = () => {
    if (!conc || conc.cuadra) return;
    const tipo  = selTipo.value;
    const v     = r2(Number(inpMonto.value) || 0);
    const resto = r2(conc.residuo - (tipo ? v : 0));
    const partes = [];

    if (tipo === 'ajuste' && Math.abs(conc.derivaAnual) >= 0.005) {
      partes.push(`Equivale a <strong>${conc.derivaAnual.toFixed(2)}% anual</strong> sobre el capital.
        Si el signo se repite captura tras captura, revisa <em>Base anual</em>,
        <em>Interpretación de la tasa</em> o <em>Redondeo diario</em>.`);
    }
    if (tipo === 'movimiento') {
      partes.push(`Se registrará como ${v < 0 ? 'un retiro' : 'una aportación'} del
        ${fmtDate(form.fecha.value)}. Si fue un traspaso desde otra de tus cuentas,
        regístralo en <em>Movimientos</em> para que quede en ambas.`);
    }
    if (Math.abs(resto) >= 0.01) {
      partes.push(`Quedará sin explicar <strong>${currency(resto)}</strong>.`);
    }
    document.getElementById('conc-nota').innerHTML =
      partes.length ? `<i class="bi bi-info-circle me-1"></i>${partes.join(' ')}` : '';
  };

  const pintarMonto = () => {
    const v     = Number(inputMonto.value);
    const fecha = form.fecha.value;
    conc = (inputMonto.value !== '' && isFinite(v) && fecha) ? conciliar(cuenta, v, fecha, cfg) : null;

    if (!conc) {
      desglose.innerHTML = `<div class="inv-upd-delta text-muted"><i class="bi bi-info-circle me-1"></i>${
        inputMonto.value === '' ? 'Captura el saldo real de tu estado de cuenta.'
                                 : 'No hay una captura anterior contra la cual conciliar.'}</div>`;
      clasif.classList.add('d-none');
      return;
    }

    desglose.innerHTML = bloqueConciliacion(conc);
    clasif.classList.toggle('d-none', conc.cuadra);
    if (conc.cuadra) return;

    if (!montoTocado) inpMonto.value = r2(conc.residuo);
    // Una diferencia pequeña frente al capital sabe a deriva; una grande, a dinero
    if (!tipoTocado) selTipo.value = Math.abs(conc.derivaAnual) < 2 ? 'ajuste' : 'movimiento';
    pintarNota();
  };

  const pintarRend = () => {
    const v = Number(inputRend.value);
    if (!isFinite(v) || inputRend.value === '') { deltaRend.innerHTML = ''; return; }
    const d = r2(v - estimadoRend);
    if (Math.abs(d) < 0.01) {
      deltaRend.innerHTML = `<i class="bi bi-check-circle text-success me-1"></i>Coincide con el rendimiento estimado.`;
    } else {
      deltaRend.innerHTML = `<i class="bi bi-arrow-left-right me-1"></i>Diferencia vs. estimado:
        <strong class="${d > 0 ? 'text-success' : 'text-danger'}">${d > 0 ? '+' : ''}${currency(d)}</strong>
        <span class="text-muted">— puede deberse a ajustes de tasa o retenciones no contempladas.</span>`;
    }
  };

  inputMonto.addEventListener('input', pintarMonto);
  form.fecha.addEventListener('change', pintarMonto);
  selTipo.addEventListener('change', () => { tipoTocado = true; pintarNota(); });
  inpMonto.addEventListener('input', () => { montoTocado = true; pintarNota(); });
  inputRend.addEventListener('input', pintarRend);

  document.getElementById('inv-usar-est').addEventListener('click', () => {
    inputMonto.value = estimadoMonto;
    montoTocado = tipoTocado = false;
    pintarMonto();
  });
  document.getElementById('rend-usar-est').addEventListener('click', () => {
    inputRend.value = estimadoRend;
    pintarRend();
  });

  pintarMonto();
  pintarRend();

  // ── Ajustes registrados: filtrar, editar y eliminar ───────────────────────

  // 'saldo' es lo que se ve al abrir — es lo que este modal genera; los
  // 'diario' (creados desde el historial) son la excepción, no la regla acá
  let filtroAjustes = 'saldo';

  /** Sin `tipo` (ajustes de antes de esta distinción) cuenta como 'saldo'. */
  const tipoDe = a => a.tipo === 'diario' ? 'diario' : 'saldo';

  const filaAjuste = a => `
    <tr>
      <td>${fmtDate(isoDay(a.fecha))}</td>
      <td>
        ${esc(a.motivo || '—')}
        ${filtroAjustes === 'todos'
          ? `<span class="inv-tr-marg">${tipoDe(a) === 'diario' ? 'diario' : 'saldo'}</span>` : ''}
        ${a.derivado === false
          ? ' <span class="inv-tr-marg" title="Importe fijado a mano, no se recalcula solo">manual</span>' : ''}
      </td>
      <td class="text-end fw-semibold ${a.monto < 0 ? 'text-danger' : 'text-success'}">
        ${a.monto < 0 ? '−' : '+'}${currency(Math.abs(a.monto))}
      </td>
      <td class="text-end text-nowrap">
        <button type="button" class="btn-icon ajuste-editar" data-i="${a._i}" title="Editar"><i class="bi bi-pencil"></i></button>
        <button type="button" class="btn-icon danger ajuste-borrar" data-i="${a._i}" title="Eliminar"><i class="bi bi-trash3"></i></button>
      </td>
    </tr>`;

  function pintarAjustes() {
    const lista = (Array.isArray(cuenta.ajustes) ? cuenta.ajustes : [])
      .map((a, i) => ({ ...a, _i: i }))
      .filter(a => filtroAjustes === 'todos' || tipoDe(a) === filtroAjustes)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

    document.querySelectorAll('#ajuste-filtro button').forEach(b =>
      b.classList.toggle('active', b.dataset.filtro === filtroAjustes));

    document.getElementById('ajuste-lista-wrap').innerHTML = `
      <div class="table-wrapper">
        <table class="table table-sm mb-0">
          <thead><tr><th>Fecha</th><th>Motivo</th><th class="text-end">Monto</th><th></th></tr></thead>
          <tbody>
            ${lista.length ? lista.map(filaAjuste).join('')
              : `<tr><td colspan="4" class="text-muted text-center py-2">Sin ajustes de tipo "${filtroAjustes}"</td></tr>`}
          </tbody>
        </table>
      </div>
      <div id="ajuste-edit-form"></div>`;

    document.querySelectorAll('.ajuste-editar').forEach(b =>
      b.addEventListener('click', () => mostrarEdicionAjuste(Number(b.dataset.i))));
    document.querySelectorAll('.ajuste-borrar').forEach(b =>
      b.addEventListener('click', () => borrarAjuste(Number(b.dataset.i))));
  }

  document.querySelectorAll('#ajuste-filtro button').forEach(b =>
    b.addEventListener('click', () => {
      filtroAjustes = b.dataset.filtro;
      pintarAjustes();
    }));

  function mostrarEdicionAjuste(i) {
    const a = cuenta.ajustes[i];
    document.getElementById('ajuste-edit-form').innerHTML = `
      <div class="inv-adv-sep mt-3">Editar ajuste</div>
      <div class="row g-2 mt-1">
        <div class="col-12 col-sm-4">
          <label class="form-label form-label-sm">Fecha</label>
          <input type="date" class="form-control form-control-sm" id="ea-fecha" max="${hoy}" value="${isoDay(a.fecha)}">
        </div>
        <div class="col-12 col-sm-4">
          <label class="form-label form-label-sm">Motivo</label>
          <input type="text" class="form-control form-control-sm" id="ea-motivo" value="${esc(a.motivo || '')}">
        </div>
        <div class="col-12 col-sm-4">
          <label class="form-label form-label-sm">Monto</label>
          <div class="input-group input-group-sm">
            <span class="input-group-text">$</span>
            <input type="number" class="form-control" id="ea-monto" step="0.01" value="${a.monto}">
          </div>
        </div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-2">
        <button type="button" class="btn btn-outline-secondary btn-sm" id="ea-cancelar">Cancelar</button>
        <button type="button" class="btn btn-primary btn-sm" id="ea-guardar">Guardar cambios</button>
      </div>`;

    document.getElementById('ea-cancelar').addEventListener('click', () => {
      document.getElementById('ajuste-edit-form').innerHTML = '';
    });
    document.getElementById('ea-guardar').addEventListener('click', async () => {
      const fecha  = document.getElementById('ea-fecha').value;
      const motivo = document.getElementById('ea-motivo').value.trim();
      const monto  = r2(Number(document.getElementById('ea-monto').value) || 0);
      if (!fecha || Math.abs(monto) < 0.01) {
        toast('Completá la fecha y un monto distinto de cero', 'warning'); return;
      }
      // Un importe puesto a mano ya no es el que deriva solo del residuo — se
      // marca así para que un futuro recálculo no lo pise sin querer. El resto
      // de campos (como `tipo`) se conserva tal cual — esto no cambia si el
      // ajuste es de saldo o diario, solo su fecha/motivo/monto.
      const nuevos = cuenta.ajustes.map((x, j) =>
        j === i ? { ...x, fecha, motivo, monto, derivado: false } : x);
      await aplicarCambioAjustes(nuevos, 'Ajuste actualizado');
    });
  }

  async function borrarAjuste(i) {
    const a = cuenta.ajustes[i];
    if (!window.confirm(`¿Eliminar el ajuste del ${fmtDate(isoDay(a.fecha))} (${currency(a.monto)})?`)) return;
    await aplicarCambioAjustes(cuenta.ajustes.filter((_, j) => j !== i), 'Ajuste eliminado');
  }

  // Editar o borrar un ajuste puede correr el residuo de OTRO ajuste derivado
  // (todo se recalcula sobre el mismo timeline) — mismo resguardo de diff que
  // usa editar la raíz, antes de guardar en silencio.
  async function aplicarCambioAjustes(nuevos, mensaje) {
    const ajustes = ajustesTrasEditar({ ...cuenta, ajustes: nuevos }, etiqueta);
    if (!ajustes) return;
    try {
      await update(COL, cuenta.id, { ajustes });
      cuenta.ajustes = ajustes;
      cambiado = true;
      toast(mensaje);
      pintarAjustes();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  }

  pintarAjustes();

  document.getElementById('app-modal')?.addEventListener('hidden.bs.modal', () => {
    if (cambiado) renderView(container);
  }, { once: true });

  document.getElementById('btn-save-ajuste').addEventListener('click', async () => {
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const nuevaFecha = form.fecha.value;

    const data = {
      montoInvertido:                Number(form.montoInvertido.value),
      fechaActualizacion:            nuevaFecha,
      rendimientoObtenido:           Number(form.rendimientoObtenido.value),
      fechaActualizacionRendimiento: nuevaFecha,
    };

    // Saldo: la captura anterior pasa al historial (misma fecha ⇒ corrección)
    const prevF = isoDay(cuenta.fechaActualizacion);
    if (prevF && prevF !== nuevaFecha) {
      data.historial = pushHistorial(cuenta.historial, {
        fecha: prevF, monto: Number(cuenta.montoInvertido) || 0,
      });
    }
    const histCorregido = historialTrasCorregirRaiz(
      data.historial || cuenta.historial, nuevaFecha, 'monto invertido');
    if (histCorregido === null) return;
    if (histCorregido !== undefined) data.historial = histCorregido;

    // Rendimiento: mismo criterio, misma fecha
    const prevFR = isoDay(cuenta.fechaActualizacionRendimiento);
    if (prevFR && prevFR !== nuevaFecha) {
      data.historialRendimiento = pushHistorial(cuenta.historialRendimiento, {
        fecha: prevFR, monto: Number(cuenta.rendimientoObtenido) || 0,
      });
    }
    const histRCorregido = historialTrasCorregirRaiz(
      data.historialRendimiento || cuenta.historialRendimiento, nuevaFecha, 'rendimiento obtenido');
    if (histRCorregido === null) return;
    if (histRCorregido !== undefined) data.historialRendimiento = histRCorregido;

    // Clasificación del residuo del saldo — el importe puede cubrirlo entero o solo una parte
    const tipo    = selTipo.value;
    const importe = r2(Number(inpMonto.value) || 0);
    if (conc && !conc.cuadra && tipo && Math.abs(importe) >= 0.01) {
      if (tipo === 'ajuste') {
        data.ajustes = [...(cuenta.ajustes || []), {
          fecha: nuevaFecha, monto: importe, motivo: 'Deriva del cálculo',
          tipo: 'saldo', // ajuste al saldo/rendimiento total, no a un día puntual
          // Solo se recalcula si absorbe todo el residuo
          derivado: Math.abs(importe - conc.residuo) < 0.01,
        }];
      } else {
        data.movimientos = [...(cuenta.movimientos || []), {
          fecha: nuevaFecha, tipo: importe < 0 ? MOV_RETIRO : MOV_APORTE,
          monto: Math.abs(importe), nota: 'Detectado al conciliar',
        }];
      }
    }

    const ajustes = ajustesTrasEditar({ ...cuenta, ...data });
    if (!ajustes) return;
    if (ajustes.length || (cuenta.ajustes || []).length) data.ajustes = ajustes;

    try {
      await update(COL, cuenta.id, data);
      closeModal();
      toast('Cuenta ajustada');
      renderView(container);
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
