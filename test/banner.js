/**
 * Insignia de aviso del modo pruebas — inconfundible a propósito, porque esta es
 * una app de finanzas personales y el único punto de esto es que nadie confunda
 * datos ficticios con datos reales.
 *
 * Es una píldora pequeña fija en la esquina superior derecha, no una franja a lo
 * ancho: así no reserva espacio ni empuja el resto de la página (nada de
 * `padding-top` compensando su alto). Esa esquina está libre en toda la app real
 * — el FAB vive abajo-derecha, el nav inferior de móvil ocupa todo el ancho abajo,
 * y el header móvil no tiene nada del lado derecho.
 *
 * Se monta ANTES del login: `.auth-overlay` cubre toda la pantalla con
 * `z-index: 9999` (`css/app.css:167-171`), así que esto necesita un z-index mayor
 * para no quedar tapado detrás — quien active modo pruebas sin loguearse real debe
 * verlo igual, en la propia pantalla de autenticación.
 */

const KEY = 'impactos_modo_pruebas';

export function montarBanner() {
  if (document.getElementById('modo-prueba-banner')) return; // ya montado

  const el = document.createElement('div');
  el.id = 'modo-prueba-banner';
  el.innerHTML = `
    <style>
      #modo-prueba-banner {
        position: fixed; top: 8px; right: 8px; z-index: 999999;
        max-width: calc(100vw - 16px);
        display: flex; align-items: center; gap: 5px;
        padding: 4px 6px 4px 10px;
        background: #ff9800; color: #1a1a1a;
        border-radius: 999px;
        box-shadow: 0 2px 10px rgba(0,0,0,.35);
        font: 700 0.72rem system-ui, -apple-system, sans-serif;
      }
      #modo-prueba-banner .mp-txt { white-space: nowrap; cursor: help; }
      #modo-prueba-banner button, #modo-prueba-banner a.mp-salir {
        background: rgba(0,0,0,.15); color: #1a1a1a; border: none; border-radius: 999px;
        padding: 3px 9px; font: 700 0.68rem inherit; cursor: pointer; text-decoration: none;
        white-space: nowrap;
      }
      #modo-prueba-banner button:hover, #modo-prueba-banner a.mp-salir:hover { background: rgba(0,0,0,.28); }
      #modo-prueba-banner button:disabled { opacity: .65; cursor: default; }
    </style>
    <span class="mp-txt" title="Datos ficticios — no es la app real">🧪 PRUEBA</span>
    <button type="button" id="mp-sincronizar">Sincronizar</button>
    <a href="#" class="mp-salir" id="mp-salir" title="Volver a datos reales">Salir</a>
  `;
  document.body.appendChild(el);

  document.getElementById('mp-salir').addEventListener('click', e => {
    e.preventDefault();
    try { localStorage.removeItem(KEY); } catch {}
    location.href = location.pathname; // recarga limpia, sin el ?modoPruebas colgado
  });

  document.getElementById('mp-sincronizar').addEventListener('click', async () => {
    const btn = document.getElementById('mp-sincronizar');
    btn.disabled = true;
    btn.textContent = 'Sincronizando…';
    try {
      // Carga perezosa: nadie descarga sync.js si nunca toca este botón
      const { sincronizar } = await import('./sync.js');
      await sincronizar();
    } catch (e) {
      const { toast } = await import('../js/utils/ui.js');
      toast('Error al sincronizar: ' + e.message, 'danger');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sincronizar';
    }
  });
}
