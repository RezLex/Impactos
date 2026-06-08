import { getAll, clearCache } from '../utils/db.js';
import { toast } from '../utils/ui.js';

const COLLECTIONS = [
  { key: 'instituciones', label: 'Instituciones' },
  { key: 'tarjetas',      label: 'Tarjetas'      },
  { key: 'msi',           label: 'MSI'            },
  { key: 'fijos',         label: 'Gastos Fijos'   },
  { key: 'eventos',       label: 'Eventos'        },
  { key: 'festivosMX',    label: 'Festivos MX'    },
];

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h2>Exportar Datos</h2>
        <p>Descarga una copia de tus datos financieros</p>
      </div>
    </div>

    <div class="data-card">
      <div class="data-card-header">
        <span><i class="bi bi-download me-2"></i>Opciones de exportación</span>
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
        <span><i class="bi bi-table me-2"></i>Colecciones incluidas</span>
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
