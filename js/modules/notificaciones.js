import { getAll, update, where } from '../utils/db.js';
import { toast } from '../utils/ui.js';
import { currency, fmtDate, fmtMonth, textoLegibleSobre } from '../utils/formatters.js';
import { prefillDesdeDatos, matchTarjetaPorTerminacion } from '../utils/prefill-compra.js';
import { navigate } from '../router.js';

// Compras que el Apps Script detectó en el correo y todavía no se registran
// (tipo `compra`), más los recordatorios que agrega — corte de tarjeta,
// gasto fijo por confirmar, cierre de mes (tipos `corte`/`gastoFijo`/
// `rendimiento`). El script escribe los documentos; aquí se revisan y se
// procesan. Ver docs/NOTIFICACIONES-PUSH.md y docs/RECORDATORIOS-PUSH.md.

// El comercio y el asunto vienen de un correo externo: se interpolan escapados.
// Las comillas también, porque el asunto va además en un atributo `title`.
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Pendientes de los 4 tipos (compra, corte, gastoFijo, rendimiento), más recientes arriba. */
async function _cargarPendientes() {
  const notis = await getAll('notificaciones', where('estatus', '==', 'pendiente'));
  return notis
    .sort((a, b) => String(b.creado || '').localeCompare(String(a.creado || '')));
}

export async function render(container) {
  await renderList(container);
}

async function renderList(container) {
  try {
    const [pendientes, tarjetas, instituciones, contadoItems, msiItems] = await Promise.all([
      _cargarPendientes(),
      getAll('tarjetas'),
      getAll('instituciones'),   // solo para el color de la píldora de tarjeta
      // Las dos colecciones de compras son para la detección de duplicados por
      // msgId que hace prefillDesdeDatos.
      getAll('contado'),
      getAll('msi'),
    ]);

    const instMap = Object.fromEntries(instituciones.map(i => [i.id, i]));

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h2>Notificaciones</h2>
          <p>${pendientes.length
                ? `${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'}`
                : 'Compras detectadas en tu correo y recordatorios de la app'}</p>
        </div>
      </div>

      <div id="aviso-push"></div>

      ${pendientes.length === 0
        ? `<div class="empty-state"><i class="bi bi-bell"></i>
             <p>Nada pendiente.<br>Las compras detectadas en tu correo y los recordatorios de la app aparecerán aquí.</p>
           </div>`
        : `<div class="data-card">
             <div class="data-card-body p-0">
               ${pendientes.map(n => _fila(n, tarjetas, instMap)).join('')}
             </div>
           </div>`}`;

    _avisoPush(container);

    container.querySelectorAll('.noti-item').forEach(row =>
      row.addEventListener('click', () => _abrir(
        pendientes.find(n => n.id === row.dataset.id),
        tarjetas, contadoItems, msiItems, container)));

    container.querySelectorAll('.btn-descartar-noti').forEach(btn =>
      btn.addEventListener('click', async e => {
        e.stopPropagation();   // el click no debe abrir el modal
        const n = pendientes.find(x => x.id === btn.dataset.id);
        const aviso = n.tipo === 'compra'
          ? `¿Descartar "${n.datos?.desc || 'esta notificación'}"? No se registrará ninguna compra.`
          : `¿Descartar "${_textoRecordatorio(n).titulo}"?`;
        if (!window.confirm(aviso)) return;
        try {
          await update('notificaciones', n.id, { estatus: 'descartada' });
          toast('Notificación descartada');
          refrescarBadge();
          renderList(container);
        } catch (err) { toast('Error: ' + err.message, 'danger'); }
      }));
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
  }
}

/**
 * Invitación a activar el push, solo mientras no esté concedido. Se resuelve
 * aparte del render porque `soportaPush()` es asíncrono y no vale la pena
 * retrasar la lista por él.
 */
async function _avisoPush(container) {
  const hueco = container.querySelector('#aviso-push');
  if (!hueco) return;

  let push;
  try { push = await import('../push.js'); } catch { return; }
  // `activo`, no `permiso`: el permiso puede seguir concedido y el dispositivo
  // estar dado de baja desde Ajustes. En ese caso sí hay algo que ofrecer.
  const { soportado, permiso, activo } = await push.estadoPush();
  if (!soportado || activo) return;

  hueco.innerHTML = permiso === 'denied'
    ? `<div class="alert alert-secondary d-flex gap-2 align-items-center py-2" style="font-size:0.85rem">
         <i class="bi bi-bell-slash"></i>
         <span>Las notificaciones están bloqueadas para este sitio. Se habilitan desde los
               permisos del navegador; hasta entonces las compras solo aparecen aquí.</span>
       </div>`
    : `<div class="alert alert-info d-flex gap-2 align-items-center py-2" style="font-size:0.85rem">
         <i class="bi bi-bell"></i>
         <span class="flex-grow-1">Recibe un aviso en cuanto se detecte una compra, sin abrir la app.</span>
         <button class="btn btn-sm btn-primary flex-shrink-0" id="btn-activar-push">Activar</button>
       </div>`;

  hueco.querySelector('#btn-activar-push')?.addEventListener('click', async () => {
    if (await push.activarPush()) hueco.innerHTML = '';
  });
}

/**
 * Píldora con la terminación, teñida con el color de la institución dueña de
 * la tarjeta. La notificación solo guarda los 4 dígitos, así que hay que
 * resolverla contra las tarjetas igual que hace la precarga del modal.
 */
function _pillTarjeta(terminacion, tarjetas, instMap) {
  const digits = String(terminacion || '').replace(/\D/g, '').slice(-4);
  if (!digits) return '';   // 'NA': el correo no reveló la tarjeta

  const m       = matchTarjetaPorTerminacion(digits, tarjetas);
  const tarjeta = m && tarjetas.find(t => t.id === m.tarjetaId);
  const color   = instMap[tarjeta?.institucionId]?.color;

  // El color viene de un campo editable: se interpola en un atributo `style`,
  // así que solo pasa si es un hex de verdad.
  const hex = /^#[0-9a-f]{3,8}$/i.test(color || '') ? color : null;
  return hex
    ? `<span class="bank-chip noti-tarjeta" style="background:${hex};color:${textoLegibleSobre(hex)}">···${digits}</span>`
    : `<span class="bank-chip noti-tarjeta noti-tarjeta-nd">···${digits}</span>`;
}

function _fila(n, tarjetas, instMap) {
  if (n.tipo !== 'compra') return _filaRecordatorio(n);

  const d       = n.datos || {};
  const aPlazos = d.meses != null && d.meses !== '';

  // El año se envuelve aparte para poder ocultarlo en móvil, donde el renglón
  // va justo de ancho y estas detecciones nunca tienen más de 30 días.
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '')
    ? fmtDate(d.fecha).replace(/\s(\d{4})$/, ' <span class="noti-anio">$1</span>')
    : esc(d.fecha || '');
  const meta = [fecha, esc(d.hora || '')].filter(Boolean).join(' · ');

  // Insignias y píldora van como hermanas del comercio, no dentro: el comercio
  // se recorta con elipsis y algo adentro se cortaría a la mitad.
  return `
    <div class="noti-item" data-id="${n.id}">
      <div class="noti-monto">${currency(d.total)}</div>
      <div class="noti-comercio" title="${esc(d.desc)}">${esc(d.desc)}</div>
      ${aPlazos ? `<span class="badge-tipo badge-credito">${esc(d.meses)} MSI</span>` : ''}
      ${d.match === false ? `<span class="badge-tipo badge-pendiente">sin match</span>` : ''}
      <div class="noti-asunto" title="${esc(d.asunto)}">${esc(d.asunto || '')}</div>
      ${_pillTarjeta(d.tarjeta, tarjetas, instMap)}
      <div class="noti-meta">${meta || '—'}</div>
      <button class="btn-icon danger btn-descartar-noti" data-id="${n.id}" title="Descartar">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>`;
}

// ── Recordatorios (corte / gastoFijo / rendimiento) ─────────────────────────

const RECORDATORIO_ICONO = {
  corte: 'bi-credit-card-2-front',
  gastoFijo: 'bi-calendar-check',
  rendimiento: 'bi-graph-up-arrow',
};

/** Título/cuerpo cortos para la fila — mismos textos acordados en docs/RECORDATORIOS-PUSH.md. */
function _textoRecordatorio(n) {
  const d = n.datos || {};

  if (n.tipo === 'corte') {
    if (d.subtipo === 'faltaImpacto') return { titulo: `Genera el Impacto de ${fmtMonth(d.mes)}`, cuerpo: 'Toca para generarlo' };
    if (d.subtipo === 'sinConfirmar') return { titulo: `Cortó tu tarjeta ${d.nombre}`, cuerpo: `${currency(d.monto)} por confirmar — ${fmtMonth(d.mes)}` };
    if (d.subtipo === 'sinCerrar')    return { titulo: `Impacto de ${fmtMonth(d.mes)} sin cerrar`, cuerpo: 'Toca para revisarlo y cerrarlo' };
  }
  if (n.tipo === 'gastoFijo')   return { titulo: d.nombre, cuerpo: `Gasto fijo por confirmar — ${currency(d.importe)}` };
  if (n.tipo === 'rendimiento') return { titulo: 'Fin de mes', cuerpo: 'Revisa los rendimientos de tus cuentas' };
  return { titulo: 'Recordatorio', cuerpo: '' };
}

function _filaRecordatorio(n) {
  const { titulo, cuerpo } = _textoRecordatorio(n);
  const icono = RECORDATORIO_ICONO[n.tipo] || 'bi-bell';
  return `
    <div class="noti-item" data-id="${n.id}">
      <div class="metric-icon tint-info"><i class="bi ${icono}"></i></div>
      <div class="noti-recordatorio-texto">
        <div class="noti-recordatorio-titulo">${esc(titulo)}</div>
        <div class="noti-recordatorio-cuerpo">${esc(cuerpo)}</div>
      </div>
      <button class="btn-icon danger btn-descartar-noti" data-id="${n.id}" title="Descartar">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>`;
}

/**
 * Abre el modal del Registro Rápido —el mismo del FAB, con su vista previa de
 * ciclo, disponible e impacto— precargado con los datos de la notificación.
 * `onSaved` viaja también si el usuario alterna entre contado y plazos dentro
 * del modal, así que la notificación se cierra en cualquiera de los dos casos.
 */
async function _abrir(n, tarjetas, contadoItems, msiItems, container) {
  if (n.tipo !== 'compra') {
    // El auto-resuelto de docs/RECORDATORIOS-PUSH.md (Apps Script) es el
    // mecanismo principal para cerrar estos recordatorios; el tap solo
    // adelanta el `procesada` si el usuario entra manualmente antes.
    const ruta = n.tipo === 'corte'       ? (n.datos?.mes ? `/impacto/${n.datos.mes}` : '/impacto')
               : n.tipo === 'gastoFijo'   ? '/compras/gastos'
               : n.tipo === 'rendimiento' ? '/rendimientos'
               : '/notificaciones';
    await update('notificaciones', n.id, { estatus: 'procesada' });
    refrescarBadge();
    navigate(ruta);
    return;
  }

  const pre = prefillDesdeDatos(n.datos || {}, tarjetas, contadoItems, msiItems);

  if (pre === 'duplicado') {
    // La compra ya se registró antes (mismo msgId): no tiene caso reabrirla,
    // basta con cerrar la notificación.
    await update('notificaciones', n.id, { estatus: 'procesada' });
    toast('Esa compra ya estaba registrada', 'info');
    refrescarBadge();
    renderList(container);
    return;
  }
  if (!pre) { toast('La notificación no trae datos suficientes', 'warning'); return; }

  const { openQuickAdd } = await import('./quick-add.js');
  openQuickAdd(pre.tipo === 'msi' ? 'plazos' : 'contado', pre.datos, async () => {
    await update('notificaciones', n.id, { estatus: 'procesada' });
    refrescarBadge();
    renderList(container);
  });
}

/** Pinta los dos indicadores de pendientes. Separada para poder apagarlos al cerrar sesión. */
export function pintarBadge(total) {
  const badge = document.getElementById('nav-badge-notificaciones');
  if (badge) {
    badge.textContent = total;
    badge.hidden = total === 0;
  }
  // Burbuja flotante (solo visible en móvil por CSS)
  const burbuja = document.getElementById('noti-bubble');
  if (burbuja) {
    burbuja.hidden = total === 0;
    const n = document.getElementById('noti-bubble-count');
    // A dos dígitos el número ya no cabe en la píldora
    if (n) n.textContent = total > 9 ? '9+' : total;
  }
}

/**
 * Cuenta las pendientes y pinta el badge del sidebar y la burbuja móvil.
 * Lo llama `app.js` al iniciar sesión y esta vista tras cada cambio.
 */
export async function refrescarBadge() {
  let total = 0;
  try {
    total = (await _cargarPendientes()).length;
  } catch { return; }   // sin conexión: mejor sin indicador que con uno mentiroso
  pintarBadge(total);
}
