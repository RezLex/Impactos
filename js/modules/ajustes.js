import { getAll, clearCache } from '../utils/db.js';
import { toast } from '../utils/ui.js';

/**
 * Ajustes de la app: notificaciones, tema, exportación y mantenimiento.
 *
 * Absorbió la vista de Exportar Datos y los dos controles que vivían sueltos en
 * el pie del sidebar (tema y notificaciones). Ahí ocupaban espacio permanente
 * para algo que se toca dos veces al año, y el de notificaciones solo sabía
 * activar.
 */

// Todo lo que un respaldo debe contener. `notificaciones` y `dispositivos`
// quedan fuera a propósito: la primera es una bandeja transitoria y la segunda
// son tokens de push, que fuera de este navegador no significan nada.
const COLLECTIONS = [
  { key: 'instituciones',  label: 'Instituciones'      },
  { key: 'tarjetas',       label: 'Tarjetas'           },
  { key: 'contado',        label: 'Compras de contado' },
  { key: 'msi',            label: 'Compras a plazos'   },
  { key: 'gastos',         label: 'Gastos'             },
  { key: 'pagosDiferidos', label: 'Pagos Diferidos'    },
  { key: 'gastosFijos',    label: 'Gastos Fijos'       },
  { key: 'impacto',        label: 'Impacto mensual'    },
  { key: 'inversiones',    label: 'Inversiones'        },
  { key: 'eventos',        label: 'Eventos'            },
  { key: 'festivosMX',     label: 'Festivos MX'        },
  { key: 'config',         label: 'Configuración'      },
];

const TEMAS = [
  { pref: 'sistema', icono: 'bi-circle-half', texto: 'Sistema' },
  { pref: 'claro',   icono: 'bi-sun',         texto: 'Claro'   },
  { pref: 'oscuro',  icono: 'bi-moon-stars',  texto: 'Oscuro'  },
];

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h2>Ajustes</h2>
        <p>Notificaciones, apariencia y copias de tus datos</p>
      </div>
    </div>

    <div class="data-card mb-3">
      <div class="data-card-header">
        <span><i class="bi bi-bell me-2"></i>Notificaciones</span>
      </div>
      <div class="data-card-body" id="ajustes-push">
        <div class="text-muted" style="font-size:0.87rem">Comprobando…</div>
      </div>
    </div>

    <div class="data-card mb-3">
      <div class="data-card-header">
        <span><i class="bi bi-palette me-2"></i>Apariencia</span>
      </div>
      <div class="data-card-body">
        <p style="color:var(--text-muted);font-size:0.87rem;margin-bottom:16px">
          El tema se guarda en este dispositivo, no en tu cuenta.
        </p>
        <div class="btn-group" role="group" id="ajustes-tema">
          ${TEMAS.map(t => `
            <button type="button" class="btn btn-outline-primary" data-pref="${t.pref}">
              <i class="bi ${t.icono} me-1"></i>${t.texto}
            </button>`).join('')}
        </div>
      </div>
    </div>

    <div class="data-card mb-3">
      <div class="data-card-header">
        <span><i class="bi bi-download me-2"></i>Exportar datos</span>
      </div>
      <div class="data-card-body">
        <p style="color:var(--text-muted);font-size:0.87rem;margin-bottom:20px">
          Exporta todos tus datos a Excel (una hoja por colección) o descarga un archivo JSON completo.
        </p>
        <div class="d-flex flex-wrap gap-3">
          <button class="btn btn-primary" id="btn-export-excel">
            <i class="bi bi-file-earmark-excel me-2"></i>Exportar a Excel
          </button>
          <button class="btn btn-outline-secondary" id="btn-export-json">
            <i class="bi bi-file-earmark-code me-2"></i>Exportar a JSON
          </button>
        </div>
      </div>
    </div>

    <div class="data-card mb-3">
      <div class="data-card-header">
        <span><i class="bi bi-trash3 me-2"></i>Mantenimiento</span>
      </div>
      <div class="data-card-body">
        <p style="color:var(--text-muted);font-size:0.87rem;margin-bottom:16px">
          Limpia los datos en caché de la aplicación. Útil si los datos se ven desactualizados.
        </p>
        <div class="d-flex flex-wrap gap-3">
          <button class="btn btn-outline-warning" id="btn-clear-app-cache">
            <i class="bi bi-database-x me-2"></i>Limpiar caché de datos
          </button>
          <button class="btn btn-outline-danger" id="btn-clear-sw-cache">
            <i class="bi bi-hdd-x me-2"></i>Limpiar caché del SW
          </button>
        </div>
        <div id="cache-status" style="font-size:0.78rem;color:var(--text-muted);margin-top:10px;display:none"></div>
      </div>
    </div>

    <div class="data-card">
      <div class="data-card-header">
        <span><i class="bi bi-table me-2"></i>Colecciones incluidas en la exportación</span>
      </div>
      <div class="table-wrapper">
        <table class="table table-sm mb-0">
          <thead><tr><th>Colección</th><th>Descripción</th></tr></thead>
          <tbody>
            ${COLLECTIONS.map(c => `
            <tr>
              <td class="fw-mono">${c.key}</td>
              <td style="color:var(--text-muted)">${c.label}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  _wirePush();
  _wireTema();

  document.getElementById('btn-export-excel').addEventListener('click', exportExcel);
  document.getElementById('btn-export-json').addEventListener('click', exportJSON);

  document.getElementById('btn-clear-app-cache').addEventListener('click', () => {
    clearCache();
    toast('Caché de datos limpiada');
  });

  document.getElementById('btn-clear-sw-cache').addEventListener('click', async () => {
    const btn    = document.getElementById('btn-clear-sw-cache');
    const status = document.getElementById('cache-status');
    btn.disabled = true;
    try {
      const keys    = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      }
      status.style.display = 'block';
      status.textContent   = `${keys.length} caché(s) eliminada(s): ${keys.join(', ') || '—'}`;
      toast('Caché del SW limpiada — recarga la página para re-cachear');
    } catch (e) {
      toast('Error al limpiar caché: ' + e.message, 'danger');
    } finally {
      btn.disabled = false;
    }
  });
}

// ── Notificaciones ────────────────────────────────────────────────────────────

async function _wirePush() {
  const caja = document.getElementById('ajustes-push');
  if (!caja) return;

  let push;
  try { push = await import('../push.js'); } catch {
    caja.innerHTML = `<div class="text-muted" style="font-size:0.87rem">No disponible.</div>`;
    return;
  }

  const pintar = async () => {
    const { soportado, permiso, activo } = await push.estadoPush();

    if (!soportado) {
      caja.innerHTML = `
        <div class="d-flex gap-2 align-items-start" style="font-size:0.87rem">
          <i class="bi bi-x-circle text-muted mt-1"></i>
          <span class="text-muted">Este navegador no soporta notificaciones push.
            En iPhone hacen falta iOS 16.4 o superior <strong>y</strong> tener la app agregada a
            la pantalla de inicio desde Safari.</span>
        </div>`;
      return;
    }

    // 'denied' no se arregla desde aquí: el navegador ya no vuelve a preguntar
    const bloqueado = permiso === 'denied';

    caja.innerHTML = `
      <div class="form-check form-switch mb-2">
        <input class="form-check-input" type="checkbox" role="switch" id="sw-push"
               ${activo ? 'checked' : ''} ${bloqueado ? 'disabled' : ''}>
        <label class="form-check-label" for="sw-push">
          Recibir avisos en este dispositivo
        </label>
      </div>
      <p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:0">
        ${bloqueado
          ? 'Las notificaciones están <strong>bloqueadas</strong> para este sitio. El permiso solo se puede devolver desde los permisos del navegador; hasta entonces las compras detectadas se ven únicamente en la sección Notificaciones.'
          : activo
            ? 'Recibes un aviso en cuanto se detecta una compra en tu correo, aunque la app esté cerrada. Al desactivar, este dispositivo deja de recibir; los demás siguen igual.'
            : 'Activa para recibir un aviso en cuanto se detecte una compra en tu correo, sin abrir la app. Se configura por dispositivo.'}
      </p>`;

    const sw = document.getElementById('sw-push');
    sw?.addEventListener('change', async () => {
      sw.disabled = true;
      // El resultado no se asume: si el usuario rechaza el diálogo del
      // navegador, el interruptor tiene que volver a donde estaba.
      if (sw.checked) await push.activarPush();
      else            await push.desactivarPush();
      pintar();
    });
  };

  // `push.js` avisa cuando algo cambió desde otro lado (el aviso de la sección
  // de Notificaciones, por ejemplo)
  document.addEventListener('push-cambio', pintar);
  pintar();
}

// ── Apariencia ────────────────────────────────────────────────────────────────

function _wireTema() {
  const grupo = document.getElementById('ajustes-tema');
  if (!grupo || !window.TEMA) return;

  const pintar = pref => grupo.querySelectorAll('[data-pref]').forEach(b =>
    b.classList.toggle('active', b.dataset.pref === pref));

  pintar(window.TEMA.leer());

  grupo.querySelectorAll('[data-pref]').forEach(btn =>
    btn.addEventListener('click', () => {
      window.TEMA.guardar(btn.dataset.pref);
      pintar(btn.dataset.pref);
    }));
}

// ── Exportación ───────────────────────────────────────────────────────────────

async function exportExcel() {
  const btn = document.getElementById('btn-export-excel');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Exportando…';
  try {
    const wb = XLSX.utils.book_new();
    for (const { key, label } of COLLECTIONS) {
      const rows = await getAll(key);
      if (!rows.length) continue;
      const ws = XLSX.utils.json_to_sheet(rows.map(flattenObj));
      XLSX.utils.book_append_sheet(wb, ws, label);
    }
    XLSX.writeFile(wb, `IMPACTOS_${isoDate()}.xlsx`);
    toast('Exportado correctamente');
  } catch (e) {
    toast('Error: ' + e.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-file-earmark-excel me-2"></i>Exportar a Excel';
  }
}

async function exportJSON() {
  const btn = document.getElementById('btn-export-json');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Exportando…';
  try {
    const data = {};
    for (const { key } of COLLECTIONS) data[key] = await getAll(key);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `IMPACTOS_${isoDate()}.json` });
    a.click();
    URL.revokeObjectURL(url);
    toast('Exportado correctamente');
  } catch (e) {
    toast('Error: ' + e.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-file-earmark-code me-2"></i>Exportar a JSON';
  }
}

function flattenObj(obj, prefix = '') {
  return Object.entries(obj).reduce((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(acc, flattenObj(v, key));
    else acc[key] = Array.isArray(v) ? JSON.stringify(v) : v;
    return acc;
  }, {});
}

const isoDate = () => new Date().toISOString().slice(0, 10);
