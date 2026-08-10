import { getAll, getById, create, update, remove, recentWhere, where } from '../utils/db.js';
import { r2 } from '../utils/formatters.js';
import { opcionesAcumulables, totalAcumulado } from '../utils/acumular.js';

// Mediodía es la hora neutra que se guarda cuando NO se capturó hora real
const _hasRealTime = dt => dt?.length > 10 && !dt.includes('T12:00:00');

// Escapar para interpolar dentro de un atributo HTML (la descripción viene de
// un enlace externo y puede traer comillas)
const _attr = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Recoge lo que el usuario tenga capturado para arrastrarlo al otro modal
const _leerFormulario = (formId, base = {}) => {
  const form = document.getElementById(formId);
  if (!form) return base;
  const d = Object.fromEntries(new FormData(form));
  const [tarjetaId, numeroTarjeta] = (d.tarjetaId || '').split('::');
  return {
    ...base,
    compra:        d.compra || '',
    total:         d.total || '',
    enlaceCompra:  d.enlaceCompra || '',
    tarjetaId:     tarjetaId || '',
    numeroTarjeta: numeroTarjeta || '',
    fechaCompra:   _applyTime(d.fechaCompra, d.fechaCompraTime),
    // Se relee del campo, no de `base`: si el usuario la editó (o la borró)
    // antes de cambiar de modal, debe viajar el valor actual
    hora:          d.fechaCompraTime || undefined,
  };
};

const _addTime = s => {
  if (!s || s.length !== 10) return s;
  const n = new Date();
  const today = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
  return s === today
    ? `${s}T${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`
    : `${s}T12:00:00`;
};

const _applyTime = (dateStr, timeStr) => {
  if (!dateStr || dateStr.length !== 10) return dateStr;
  if (timeStr) return `${dateStr}T${timeStr}:00`;
  return _addTime(dateStr);
};

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

    // Si el campo ya trae hora (precarga desde un enlace), hay que mostrarlo:
    // si no, el dato existe y se guardaría, pero el usuario no lo ve.
    if (input.value) {
      wrapper.style.display = '';
      btn.querySelector('i').style.color = 'var(--bs-primary)';
    }

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

const _bonifFieldsQA = (item) => {
  const b = item?.bonificacion;
  return `
    <div class="col-12">
      <div class="form-check mb-1">
        <input class="form-check-input" type="checkbox" id="has-bonif" ${b ? 'checked' : ''}>
        <label class="form-check-label" for="has-bonif" style="font-size:0.85rem">Bonificación / cashback esperado</label>
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
};

const _saveBonifQA = (data) => {
  const tipo     = data.bonificacionTipo;
  const valor    = Number(data.bonificacionValor);
  const fecha    = data.bonificacionFecha;
  const enlace   = data.bonificacionEnlace || '';
  const aplicada = !!data.bonificacionAplicada;
  delete data.bonificacionTipo; delete data.bonificacionValor; delete data.bonificacionFecha;
  delete data.bonificacionEnlace; delete data.bonificacionAplicada;
  const hasBonif = document.getElementById('has-bonif')?.checked;
  if (hasBonif && valor > 0 && fecha) data.bonificacion = {
    tipo, valor, fechaMaxima: fecha,
    ...(enlace   ? { enlace }   : {}),
    ...(aplicada ? { aplicada } : {}),
  };
  else delete data.bonificacion;
};

const _wireBonifQA = () => {
  const chk = document.getElementById('has-bonif');
  const flds = document.getElementById('bonif-fields');
  if (chk && flds) chk.addEventListener('change', () => { flds.style.display = chk.checked ? '' : 'none'; });
};

import { currency, fmtDate, fmtMonth } from '../utils/formatters.js';
import { toast, openModal, closeModal } from '../utils/ui.js';
import { calcularMes, toISODate, anteriorNomina } from '../utils/ciclo.js';
import { calcularSaldo } from '../utils/saldo.js';
import { proyectarMes, getGastosDebitoCompleto } from '../utils/impacto-calc.js';

async function _loadData() {
  const [instituciones, tarjetas, festivosMX, contado, msi, gastos, gastosFijos, pagosDiferidos] = await Promise.all([
    getAll('instituciones'),
    getAll('tarjetas'),
    getAll('festivosMX'),
    getAll('contado'),
    getAll('msi'),
    getAll('gastos', recentWhere('mes')),
    getAll('gastosFijos'),
    getAll('pagosDiferidos'),
  ]);
  return { instituciones, tarjetas, festivosMX, contado, msi, gastos, gastosFijos, pagosDiferidos };
}

function _buildCardOptions(item, instituciones, tarjetas, soloCredito = false) {
  const instMap = Object.fromEntries(instituciones.map(i => [i.id, i]));
  const lista   = (soloCredito ? tarjetas.filter(t => t.tipo === 'credito') : tarjetas).filter(t => !t.oculta);

  // El texto del <option> se muestra tal cual cuando el <select> colapsa a la
  // opción elegida — ahí se pierde el <optgroup> que hoy da el nombre del
  // banco, así que la institución va siempre en el texto, no solo en Favoritas.
  const _opts = cards => cards
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .flatMap(t => {
      const numeros    = Array.isArray(t.numeros) ? t.numeros : [];
      const all        = [...numeros.filter(n => n.formato === 'fisica' && n.numero),
                          ...numeros.filter(n => n.formato === 'digital' && n.numero)];
      const instPrefix = instMap[t.institucionId]?.nombre
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

  const favoritas = lista.filter(t => t.favorita);
  const normales  = lista.filter(t => !t.favorita);
  const favGroup  = favoritas.length ? `<optgroup label="⭐ Favoritas">${_opts(favoritas)}</optgroup>` : '';

  const byInst = {};
  normales.forEach(t => {
    const id = t.institucionId || '__';
    if (!byInst[id]) byInst[id] = { inst: instMap[id] || null, cards: [] };
    byInst[id].cards.push(t);
  });
  const instGroups = Object.values(byInst)
    .sort((a, b) => (a.inst?.nombre || '').localeCompare(b.inst?.nombre || '', 'es'))
    .map(({ inst, cards }) => `<optgroup label="${inst?.nombre || 'Sin institución'}">${_opts(cards)}</optgroup>`)
    .join('');

  return favGroup + instGroups;
}

// ── Acumular compra ───────────────────────────────────────────────────────────
// La regla de qué es acumulable vive en `utils/acumular.js`; aquí solo está el
// modal. Solo aplica de contado: a plazos el plan de mensualidades es del cargo
// original y fusionarlos daría una mensualidad que no existe.

// Se cachea a nivel de módulo, no del modal: si abres y cierras varias veces
// seguidas no tiene sentido releer. Se descarta al recargar la página.
let _notisPendientes = null;

async function _cargarNotisPendientes() {
  if (_notisPendientes) return _notisPendientes;
  try {
    const todas = await getAll('notificaciones', where('estatus', '==', 'pendiente'));
    _notisPendientes = todas.filter(n => n.tipo === 'compra');
  } catch {
    _notisPendientes = [];   // sin permiso o sin conexión: el toggle queda vacío
  }
  return _notisPendientes;
}

const ACUM_HTML = `
  <div class="col-12">
    <div class="form-check mb-1">
      <input class="form-check-input" type="checkbox" id="qa-acumular">
      <label class="form-check-label" for="qa-acumular" style="font-size:0.85rem">
        Acumular compra <span class="text-muted">— sumar otro cargo de esta misma tarjeta</span>
      </label>
    </div>
    <div id="qa-acumular-campos" style="display:none">
      <select class="form-select form-select-sm" id="qa-acumular-sel">
        <option value="">— Nada por acumular —</option>
      </select>
      <div class="form-text" id="qa-acumular-nota"></div>
    </div>
  </div>`;

/**
 * Cablea el toggle. Devuelve `() => opción elegida | null`, que el guardado usa
 * para sumar el importe y decidir qué hacer con el origen.
 *
 * @param {string} msgIdActual  msgId de la notificación desde la que se abrió el
 *   modal, si aplica: no tiene sentido ofrecerle acumularse consigo misma.
 */
function _wireAcumular(tarjetas, contado, msgIdActual, alCambiar) {
  const chk    = document.getElementById('qa-acumular');
  const campos = document.getElementById('qa-acumular-campos');
  const sel    = document.getElementById('qa-acumular-sel');
  const nota   = document.getElementById('qa-acumular-nota');
  const selTc  = document.querySelector('#qa-contado-form [name="tarjetaId"]');
  const inTot  = document.querySelector('#qa-contado-form [name="total"]');
  if (!chk || !sel) return () => null;

  const opciones = new Map();   // value -> { tipo, id, total, etiqueta }

  const elegido = () => (chk.checked && opciones.get(sel.value)) || null;

  const tarjetaActual = () => (selTc?.value || '').split('::')[0];

  const repoblar = () => {
    const tcId = tarjetaActual();
    opciones.clear();

    const { notificaciones: notis, compras } = opcionesAcumulables({
      tarjetaId: tcId,
      notificaciones: _notisPendientes || [],
      contado,
      tarjetas,
      msgIdActual,
    });

    const opt = (tipo, id, total, texto) => {
      const value = `${tipo}:${id}`;
      opciones.set(value, { tipo, id, total: Number(total) || 0, etiqueta: texto });
      return `<option value="${value}">${_attr(texto)}</option>`;
    };

    const grupoNotis = notis.length ? `<optgroup label="Notificaciones pendientes">${
      notis.map(n => opt('noti', n.id, n.datos?.total,
        `${currency(n.datos?.total)} — ${n.datos?.desc || 'Sin descripción'}`)).join('')
    }</optgroup>` : '';

    const grupoCompras = compras.length ? `<optgroup label="Compras registradas">${
      compras.map(c => opt('contado', c.id, c.total,
        `${currency(c.total)} — ${c.compra || 'Sin descripción'} · ${fmtDate((c.fechaCompra || '').slice(0, 10))}`)).join('')
    }</optgroup>` : '';

    const vacio = !grupoNotis && !grupoCompras;
    sel.innerHTML =
      `<option value="">${vacio
        ? (tcId ? '— Nada por acumular en esta tarjeta —' : '— Elige una tarjeta primero —')
        : '— Selecciona qué acumular —'}</option>` + grupoNotis + grupoCompras;
    sel.disabled = vacio;
    pintarNota();
  };

  const pintarNota = () => {
    const e = elegido();
    if (!e) { nota.textContent = ''; return; }
    const suma = totalAcumulado(inTot?.value, e);
    nota.innerHTML = `Total resultante: <strong>${currency(suma)}</strong>` + (e.tipo === 'contado'
      ? ' · la compra elegida se eliminará al guardar'
      : ' · la notificación se marcará como procesada');
  };

  const refrescar = () => { pintarNota(); alCambiar?.(); };

  chk.addEventListener('change', async () => {
    campos.style.display = chk.checked ? '' : 'none';
    if (chk.checked) { await _cargarNotisPendientes(); repoblar(); }
    refrescar();
  });
  // Cambiar de tarjeta cambia por completo qué se puede acumular
  selTc?.addEventListener('change', () => { if (chk.checked) repoblar(); refrescar(); });
  sel.addEventListener('change', refrescar);
  inTot?.addEventListener('input', pintarNota);

  return elegido;
}

/** Cierra el origen de lo acumulado: la compra absorbida se borra, la notificación se marca. */
async function _cerrarAcumulado(acum) {
  if (!acum) return;
  if (acum.tipo === 'contado') {
    await remove('contado', acum.id);
  } else {
    await update('notificaciones', acum.id, { estatus: 'procesada' });
    // El cache local quedó viejo, y el contador del sidebar también
    _notisPendientes = null;
    import('./notificaciones.js').then(m => m.refrescarBadge()).catch(() => {});
  }
}

// ── Preview ───────────────────────────────────────────────────────────────────

const PREVIEW_HTML = `
  <div id="qa-preview" style="display:none;margin-top:12px;padding:12px;background:var(--surface-2);border-radius:8px;border:1px solid var(--border)">
    <div style="font-size:var(--fs-small);text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);margin-bottom:8px">
      <i class="bi bi-lightning-charge-fill me-1 text-warning"></i>Vista previa
    </div>
    <div class="d-flex flex-wrap gap-3 mb-2" style="font-size:0.8rem">
      <div><span class="text-muted">Corte: </span><span id="qa-prev-corte" class="fw-500">—</span></div>
      <div><span class="text-muted">Límite pago: </span><span id="qa-prev-pago" class="fw-500">—</span></div>
      <div><span style="color:var(--bs-primary);font-weight:600"><i class="bi bi-wallet2 me-1"></i><span id="qa-prev-nomina">—</span></span></div>
    </div>
    <div class="d-flex flex-wrap gap-3 mb-2" style="font-size:0.8rem">
      <div><span class="text-muted">Disponible: </span><strong id="qa-prev-disp" class="text-success">—</strong></div>
      <div><span class="text-muted">Usado: </span><strong id="qa-prev-usado">—</strong></div>
    </div>
    <div id="qa-prev-impacto-section" style="display:none;border-top:1px solid var(--border);padding-top:8px">
      <div style="font-size:var(--fs-small);text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);margin-bottom:6px">
        Impacto <span id="qa-prev-mes">—</span>
      </div>
      <div class="d-flex flex-wrap gap-3" style="font-size:0.8rem">
        <div>
          <span class="text-muted">Esta tarjeta: </span>
          <span id="qa-prev-tc-antes" class="text-muted">—</span>
          <span class="text-muted mx-1">→</span>
          <strong id="qa-prev-tc-despues">—</strong>
        </div>
        <div>
          <span class="text-muted">Total impacto: </span>
          <span id="qa-prev-gi-antes" class="text-muted">—</span>
          <span class="text-muted mx-1">→</span>
          <strong id="qa-prev-gi-despues">—</strong>
        </div>
      </div>
    </div>
  </div>`;

async function _updatePreview(tarjetaId, fecha, total, monthlyAmount, tarjetas, festivosMX, contado = [], msi = [], gastos = [], gastosFijos = [], pagosDiferidos = []) {
  const preview = document.getElementById('qa-preview');
  if (!preview) return;

  const tarjeta = tarjetas.find(t => t.id === tarjetaId);
  if (!tarjeta || !fecha) { preview.style.display = 'none'; return; }

  preview.style.display = 'block';

  // ── Fechas de ciclo ──────────────────────────────────────────────────────
  const corteEl  = document.getElementById('qa-prev-corte');
  const pagoEl   = document.getElementById('qa-prev-pago');
  const nominaEl = document.getElementById('qa-prev-nomina');
  let impactoMes = null;

  if (tarjeta.ciclo) {
    const d = new Date(String(fecha).includes('T') ? fecha : fecha + 'T12:00:00');
    let year = d.getFullYear(), month = d.getMonth();
    let p = calcularMes(tarjeta.ciclo, year, month, festivosMX);
    if (p.fechaCorte && p.fechaCorte < d) {
      const nx = new Date(year, month + 1, 1);
      p = calcularMes(tarjeta.ciclo, nx.getFullYear(), nx.getMonth(), festivosMX);
    }
    corteEl.textContent = p.fechaCorte ? fmtDate(toISODate(p.fechaCorte)) : '—';
    pagoEl.textContent  = p.fechaPago  ? fmtDate(toISODate(p.fechaPago))  : '—';
    if (p.fechaPago) {
      const nom = anteriorNomina(p.fechaPago, festivosMX);
      nominaEl.textContent = nom ? fmtDate(toISODate(nom)) : '—';
      if (nom) impactoMes = toISODate(nom).slice(0, 7);
    } else { nominaEl.textContent = '—'; }
  } else {
    corteEl.textContent = pagoEl.textContent = nominaEl.textContent = 'Sin ciclo';
  }

  // ── Saldo (con calcularSaldo para aplicar compras posteriores) ───────────
  const saldo      = calcularSaldo(tarjeta, contado, msi, gastos, pagosDiferidos);
  const limite     = Number(tarjeta.limiteTotal) || 0;
  const disponible = saldo ? saldo.disponible : (tarjeta.saldoDisponible != null ? Number(tarjeta.saldoDisponible) : null);
  const usado      = saldo ? saldo.usado      : (disponible != null && limite ? limite - disponible : null);
  const despues    = disponible != null ? disponible - total : null;

  const dispFinal  = disponible != null ? disponible - total : null;
  const usadoFinal = usado      != null ? usado      + total : null;

  const dispEl = document.getElementById('qa-prev-disp');
  dispEl.textContent = dispFinal  != null ? currency(dispFinal)  : '—';
  dispEl.style.color = dispFinal != null && dispFinal < 0 ? 'var(--bs-danger)' : 'var(--bs-success)';

  document.getElementById('qa-prev-usado').textContent = usadoFinal != null ? currency(usadoFinal) : '—';

  // ── Impacto relacionado ──────────────────────────────────────────────────
  const impactoSection = document.getElementById('qa-prev-impacto-section');
  if (!impactoMes) { impactoSection.style.display = 'none'; return; }

  document.getElementById('qa-prev-mes').textContent = fmtMonth(impactoMes);
  impactoSection.style.display = 'block';

  try {
    let impacto = await getById('impacto', impactoMes);

    // For future months without stored impacto, calculate projection
    if (!impacto && impactoMes > toISODate(new Date()).slice(0, 7)) {
      const tarjetasCredito = tarjetas.filter(t => t.tipo === 'credito' || t.tipo === 'prestamo');
      impacto = proyectarMes(impactoMes, toISODate(new Date()).slice(0, 7),
        msi, contado, gastos, tarjetasCredito, 0, festivosMX, gastosFijos, tarjetas);
    }

    if (!impacto) {
      document.getElementById('qa-prev-tc-antes').textContent   = '—';
      document.getElementById('qa-prev-tc-despues').textContent = currency(monthlyAmount);
      document.getElementById('qa-prev-gi-antes').textContent   = '—';
      document.getElementById('qa-prev-gi-despues').textContent = currency(monthlyAmount);
      return;
    }
    const tcData    = impacto.tarjetas?.find(t => t.tarjetaId === tarjetaId);
    const tcActual  = tcData ? (Number(tcData.estimadoTotal) || 0) : 0;
    // Misma fórmula que /impacto: sum(estimadoTotal) + gastos débito en vivo
    const debitoIds    = new Set(tarjetas.filter(t => t.tipo === 'debito').map(t => t.id));
    const gastosDebLive = getGastosDebitoCompleto(gastos, gastosFijos, impactoMes, debitoIds, tarjetas, festivosMX);
    const gastoDebito   = gastosDebLive.reduce((s, g) => s + (Number(g.importe) || 0), 0);
    const giActual      = (impacto.tarjetas || []).reduce((s, t) => s + (Number(t.estimadoTotal) || 0), 0) + gastoDebito;

    document.getElementById('qa-prev-tc-antes').textContent   = currency(tcActual);
    document.getElementById('qa-prev-tc-despues').textContent = currency(tcActual + monthlyAmount);
    document.getElementById('qa-prev-gi-antes').textContent   = currency(giActual);
    document.getElementById('qa-prev-gi-despues').textContent = currency(giActual + monthlyAmount);
  } catch (_) {
    impactoSection.style.display = 'none';
  }
}

let _previewTimer = null;
// `extraTotalFn` suma al total un importe que no está en ningún campo del
// formulario — hoy solo lo usa "Acumular compra". Sin esto la vista previa
// mentiría justo en lo que sirve para decidir: disponible e impacto del mes.
// Devuelve su propio refrescador, para poder dispararla desde fuera de los
// campos que vigila.
function _wirePreview(formId, tarjetaValField, fechaField, totalField, tarjetas, festivosMX, monthlyAmountFn = null, contado = [], msi = [], gastos = [], gastosFijos = [], pagosDiferidos = [], extraTotalFn = null) {
  const getValues = () => {
    const form = document.getElementById(formId);
    if (!form) return;
    const tarjetaId     = (form.querySelector(`[name="${tarjetaValField}"]`)?.value || '').split('::')[0];
    const fecha         = form.querySelector(`[name="${fechaField}"]`)?.value || '';
    const total         = (Number(form.querySelector(`[name="${totalField}"]`)?.value) || 0)
                          + (extraTotalFn ? extraTotalFn() : 0);
    const monthlyAmount = monthlyAmountFn ? monthlyAmountFn(form) : total;
    clearTimeout(_previewTimer);
    _previewTimer = setTimeout(() => _updatePreview(tarjetaId, fecha, total, monthlyAmount, tarjetas, festivosMX, contado, msi, gastos, gastosFijos, pagosDiferidos), 250);
  };

  const watchFields = new Set([tarjetaValField, fechaField, totalField]);
  if (monthlyAmountFn) {
    // Also watch mensualidad field changes
    watchFields.add('mensualidad');
    watchFields.add('mesesTotal');
  }

  watchFields.forEach(name => {
    const el = document.getElementById(formId)?.querySelector(`[name="${name}"]`);
    if (el) { el.addEventListener('input', getValues); el.addEventListener('change', getValues); }
  });

  getValues();
  return getValues;
}

// ── Public ────────────────────────────────────────────────────────────────────

// `prefill` precarga el formulario (lo usa el pre-registro por URL de msi.js).
// `onSaved` permite al llamante refrescar su vista tras guardar.
export async function openQuickAdd(action, prefill = null, onSaved = null) {
  const { instituciones, tarjetas, festivosMX, contado, msi, gastos, gastosFijos, pagosDiferidos } = await _loadData();
  if (action === 'contado')     _showContado(instituciones, tarjetas, festivosMX, contado, msi, gastos, gastosFijos, pagosDiferidos, prefill, onSaved);
  else if (action === 'plazos') _showPlazos(instituciones, tarjetas, festivosMX, contado, msi, gastos, gastosFijos, pagosDiferidos, prefill, onSaved);
  else if (action === 'gasto')  _showGasto(instituciones, tarjetas, festivosMX, contado, msi, gastos, gastosFijos, pagosDiferidos);
}

// ── De Contado ────────────────────────────────────────────────────────────────

function _showContado(instituciones, tarjetas, festivosMX, contado, msi, gastos, gastosFijos, pagosDiferidos = [], prefill = null, onSaved = null) {
  const p = prefill || {};
  openModal({
    title: 'Nueva Compra De Contado',
    size: 'lg',
    body: `
      <form id="qa-contado-form">
        <input type="hidden" name="msgId" value="${p.msgId || ''}">
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Tarjeta *</label>
            <select class="form-select" name="tarjetaId" required>
              <option value="">— Seleccionar —</option>
              ${_buildCardOptions(prefill, instituciones, tarjetas, true)}
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Fecha de compra *</label>
            <div class="d-flex align-items-center gap-1">
              <input type="date" class="form-control" style="min-width:0" name="fechaCompra" value="${(p.fechaCompra || '').slice(0, 10) || toISODate(new Date())}" required>
              <button type="button" class="btn-icon" data-toggle-time="fechaCompraTime" title="Registrar hora"><i class="bi bi-clock"></i></button>
              <div class="time-toggle-wrapper" style="display:none">
                <input type="time" class="form-control form-control-sm" name="fechaCompraTime" value="${p.hora ?? (_hasRealTime(p.fechaCompra) ? p.fechaCompra.slice(11, 16) : '')}">
              </div>
            </div>
          </div>
          <div class="col-md-6">
            <label class="form-label">Total *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="total" value="${p.total ?? ''}" required min="0" step="0.01">
            </div>
          </div>
          <div class="col-md-6">
            <label class="form-label">Enlace</label>
            <input type="url" class="form-control" name="enlaceCompra" value="${p.enlaceCompra || ''}" placeholder="https://...">
          </div>
          <div class="col-12">
            <label class="form-label">Descripción *</label>
            <input type="text" class="form-control" name="compra" value="${_attr(p.compra)}" required placeholder="Ej: Amazon — Auriculares">
          </div>
          ${ACUM_HTML}
          ${_bonifFieldsQA(null)}
        </div>
      </form>
      ${PREVIEW_HTML}`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      ${prefill ? `<button type="button" class="btn btn-outline-primary btn-sm" id="qa-to-plazos" title="Registrar esta compra a meses en vez de contado">
        <i class="bi bi-calendar-range me-1"></i>Es a plazos
      </button>` : ''}
      <button type="button" class="btn btn-primary btn-sm" id="qa-save-contado">Guardar</button>`,
  });

  _wireBonifQA();
  _wireTimeToggle();
  _wireTimePicker();

  // Se cablean en este orden y con el indirecto de `refrescarPreview` porque se
  // necesitan mutuamente: la vista previa tiene que sumar lo acumulado, y
  // elegir algo que acumular tiene que redibujarla.
  let refrescarPreview = () => {};
  const acumElegido = _wireAcumular(tarjetas, contado, p.msgId, () => refrescarPreview());
  refrescarPreview = _wirePreview('qa-contado-form', 'tarjetaId', 'fechaCompra', 'total', tarjetas,
    festivosMX, null, contado, msi, gastos, gastosFijos, pagosDiferidos,
    () => acumElegido()?.total || 0);

  // Solo en el pre-registro por enlace: la fuente no siempre dice si fue a
  // meses, así que se permite cambiar de opinión sin recapturar los datos.
  const btnPlazos = document.getElementById('qa-to-plazos');
  if (btnPlazos) btnPlazos.addEventListener('click', () => {
    const datos = _leerFormulario('qa-contado-form', p);
    const el = document.getElementById('app-modal');
    // Esperar al cierre: abrir el segundo modal encima deja el backdrop huérfano
    el.addEventListener('hidden.bs.modal', () =>
      _showPlazos(instituciones, tarjetas, festivosMX, contado, msi, gastos, gastosFijos, pagosDiferidos, datos, onSaved),
      { once: true });
    closeModal();
  });

  document.getElementById('qa-save-contado').addEventListener('click', async () => {
    const form = document.getElementById('qa-contado-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    const [tarjetaId, numeroTarjeta] = (data.tarjetaId || '').split('::');
    data.tarjetaId = tarjetaId;
    data.numeroTarjeta = numeroTarjeta || '';
    data.total = Number(data.total);
    const acum = acumElegido();
    if (acum) data.total = totalAcumulado(data.total, acum);
    if (!data.enlaceCompra) delete data.enlaceCompra;
    if (!data.msgId) delete data.msgId;
    data.fechaCompra = _applyTime(data.fechaCompra, data.fechaCompraTime); delete data.fechaCompraTime;
    _saveBonifQA(data);
    try {
      await create('contado', data);
      // Después de crear, nunca antes: si falla el cierre del origen queda una
      // notificación pendiente de más, que se descarta a mano. Al revés se
      // habría borrado una compra sin nada que la reemplace.
      await _cerrarAcumulado(acum);
      closeModal();
      toast(acum ? 'Compra registrada, acumulando el cargo anterior' : 'Compra registrada');
      if (onSaved) onSaved();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

// ── A Plazos ──────────────────────────────────────────────────────────────────

function _showPlazos(instituciones, tarjetas, festivosMX, contado, msi, gastos, gastosFijos, pagosDiferidos = [], prefill = null, onSaved = null) {
  const p = prefill || {};
  openModal({
    title: 'Nueva Compra A Plazos',
    size: 'lg',
    body: `
      <form id="qa-plazos-form">
        <input type="hidden" name="msgId" value="${p.msgId || ''}">
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Tarjeta de crédito *</label>
            <select class="form-select" name="tarjetaId" required>
              <option value="">— Seleccionar —</option>
              ${_buildCardOptions(prefill, instituciones, tarjetas, true)}
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Fecha de compra *</label>
            <div class="d-flex align-items-center gap-1">
              <input type="date" class="form-control" style="min-width:0" name="fechaCompra" value="${(p.fechaCompra || '').slice(0, 10) || toISODate(new Date())}" required>
              <button type="button" class="btn-icon" data-toggle-time="fechaCompraTime" title="Registrar hora"><i class="bi bi-clock"></i></button>
              <div class="time-toggle-wrapper" style="display:none">
                <input type="time" class="form-control form-control-sm" name="fechaCompraTime" value="${p.hora ?? (_hasRealTime(p.fechaCompra) ? p.fechaCompra.slice(11, 16) : '')}">
              </div>
            </div>
          </div>
          <div class="col-md-6">
            <label class="form-label">Total *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="total" id="qa-total" value="${p.total ?? ''}" required min="0" step="0.01">
            </div>
          </div>
          <div class="col-md-3">
            <label class="form-label">Meses *</label>
            <input type="number" class="form-control" name="mesesTotal" id="qa-meses" value="${p.mesesTotal ?? ''}" required min="1" max="48">
          </div>
          <div class="col-md-3">
            <label class="form-label">Mensualidad *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="mensualidad" id="qa-mensualidad" value="${p.mensualidad ?? ''}" required min="0" step="0.01">
            </div>
          </div>
          <div class="col-md-6">
            <label class="form-label">Enlace</label>
            <input type="url" class="form-control" name="enlaceCompra" value="${p.enlaceCompra || ''}" placeholder="https://...">
          </div>
          <div class="col-12">
            <label class="form-label">Descripción *</label>
            <input type="text" class="form-control" name="compra" value="${_attr(p.compra)}" required placeholder="Ej: Amazon — Teclado">
          </div>
          ${_bonifFieldsQA(null)}
        </div>
      </form>
      ${PREVIEW_HTML}`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      ${prefill ? `<button type="button" class="btn btn-outline-primary btn-sm" id="qa-to-contado" title="Registrar esta compra de contado en vez de a meses">
        <i class="bi bi-bag me-1"></i>Es de contado
      </button>` : ''}
      <button type="button" class="btn btn-primary btn-sm" id="qa-save-plazos">Guardar</button>`,
  });

  const recalc = () => {
    const t = Number(document.getElementById('qa-total').value) || 0;
    const m = Number(document.getElementById('qa-meses').value) || 0;
    if (t > 0 && m > 0)
      document.getElementById('qa-mensualidad').value = (t / m).toFixed(2);
  };
  document.getElementById('qa-total').addEventListener('input', recalc);
  document.getElementById('qa-meses').addEventListener('input', recalc);

  _wireBonifQA();
  _wireTimeToggle();
  _wireTimePicker();
  _wirePreview('qa-plazos-form', 'tarjetaId', 'fechaCompra', 'total', tarjetas, festivosMX,
    form => Number(form.querySelector('[name=mensualidad]')?.value) || 0, contado, msi, gastos, gastosFijos, pagosDiferidos);

  // Solo derivar total/meses si el enlace no trajo la mensualidad del banco,
  // que puede no cuadrar exactamente con la división por redondeos.
  if (p.mensualidad == null) recalc();

  const btnContado = document.getElementById('qa-to-contado');
  if (btnContado) btnContado.addEventListener('click', () => {
    const datos = _leerFormulario('qa-plazos-form', p);
    const el = document.getElementById('app-modal');
    el.addEventListener('hidden.bs.modal', () =>
      _showContado(instituciones, tarjetas, festivosMX, contado, msi, gastos, gastosFijos, pagosDiferidos, datos, onSaved),
      { once: true });
    closeModal();
  });

  document.getElementById('qa-save-plazos').addEventListener('click', async () => {
    const form = document.getElementById('qa-plazos-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    const [tarjetaId, numeroTarjeta] = (data.tarjetaId || '').split('::');
    data.tarjetaId     = tarjetaId;
    data.numeroTarjeta = numeroTarjeta || '';
    data.total         = Number(data.total);
    data.mensualidad   = Number(data.mensualidad);
    data.mesesTotal    = Number(data.mesesTotal);
    data.mesesPagados  = 0;
    data.restante      = r2(Math.max(0, data.total - data.mensualidad * data.mesesPagados));
    if (!data.enlaceCompra) delete data.enlaceCompra;
    if (!data.msgId) delete data.msgId;
    data.fechaCompra = _applyTime(data.fechaCompra, data.fechaCompraTime); delete data.fechaCompraTime;
    _saveBonifQA(data);
    try {
      await create('msi', data);
      closeModal();
      toast('Compra MSI registrada');
      if (onSaved) onSaved();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}

// ── Gasto ─────────────────────────────────────────────────────────────────────

function _showGasto(instituciones, tarjetas, festivosMX, contado, msi, gastos, gastosFijos, pagosDiferidos = []) {
  const debitoCards = tarjetas.filter(t => t.tipo === 'debito');
  openModal({
    title: 'Nuevo Gasto',
    body: `
      <form id="qa-gasto-form">
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Tarjeta (débito) *</label>
            <select class="form-select" name="tarjetaId" required>
              <option value="">— Seleccionar —</option>
              ${_buildCardOptions(null, instituciones, debitoCards, false)}
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Forma de pago *</label>
            <select class="form-select" name="formaPago" required>
              <option value="">— Seleccionar —</option>
              <option value="retiro">Retiro</option>
              <option value="transferencia">Transferencia</option>
            </select>
          </div>
          <div class="col-12">
            <label class="form-label">Fecha *</label>
            <div class="d-flex align-items-center gap-1">
              <input type="date" class="form-control" style="min-width:0" name="fechaPago" value="${toISODate(new Date())}" required>
              <button type="button" class="btn-icon" data-toggle-time="fechaPagoTime" title="Registrar hora"><i class="bi bi-clock"></i></button>
              <div class="time-toggle-wrapper" style="display:none">
                <input type="time" class="form-control form-control-sm" name="fechaPagoTime" value="">
              </div>
            </div>
          </div>
          <div class="col-md-6">
            <label class="form-label">Importe *</label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="number" class="form-control" name="importe" required min="0" step="0.01">
            </div>
          </div>
          <div class="col-12">
            <label class="form-label">Nombre *</label>
            <input type="text" class="form-control" name="nombre" required placeholder="Ej: Retiro Banorte">
          </div>
        </div>
      </form>
      ${PREVIEW_HTML}`,
    footer: `
      <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" id="qa-save-gasto">Registrar</button>`,
  });

  _wireTimeToggle();
  _wireTimePicker();
  _wirePreview('qa-gasto-form', 'tarjetaId', 'fechaPago', 'importe', tarjetas, festivosMX,
    form => Number(form.querySelector('[name=importe]')?.value) || 0, contado, msi, gastos, gastosFijos, pagosDiferidos);

  document.getElementById('qa-save-gasto').addEventListener('click', async () => {
    const form = document.getElementById('qa-gasto-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    const [tarjetaId, numeroTarjeta] = (data.tarjetaId || '').split('::');
    data.tarjetaId     = tarjetaId;
    data.numeroTarjeta = numeroTarjeta || '';
    data.importe       = Number(data.importe);
    data.tipo          = 'manual';
    data.estado        = 'registrado';
    data.fechaPago = _applyTime(data.fechaPago, data.fechaPagoTime); delete data.fechaPagoTime;
    data.mes           = data.fechaPago.slice(0, 7);
    if (!data.numeroTarjeta) delete data.numeroTarjeta;
    try {
      await create('gastos', data);
      closeModal();
      toast('Gasto registrado');
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
  });
}
