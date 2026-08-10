import { initAuth }   from './auth.js';
import { initRouter, register, navigate } from './router.js';
import { clearCache } from './utils/db.js';

const APP_VERSION = '1.9.3-T5';

// ── Module loader (lazy) ──────────────────────────────────────────────────────
async function load(name, ...args) {
  const container = document.getElementById('app-content');
  container.innerHTML = `<div class="loading-overlay"><div class="spinner-border text-primary" role="status"></div></div>`;
  const mod = await import(`./modules/${name}.js`);
  await mod.render(container, ...args);
}

// ── Auth lifecycle ────────────────────────────────────────────────────────────
function onLogin() {
  document.getElementById('auth-overlay').classList.add('d-none');
  document.getElementById('app-layout').classList.remove('d-none');
  document.getElementById('quick-add-fab').classList.remove('d-none');
  const vEl = document.getElementById('sidebar-version');
  if (vEl) vEl.textContent = `v${APP_VERSION}`;
  setupNav();
  setupTema();
  setupRouter();
  setupFab();
  // Contador de compras detectadas sin registrar. Va aparte del router para
  // que se vea aunque la sesión arranque en otra vista.
  import('./modules/notificaciones.js').then(m => m.refrescarBadge()).catch(() => {});
  // Web Push: cablea el botón del sidebar y refresca el token si ya hay permiso
  import('./push.js').then(m => m.initPush()).catch(() => {});
}

function onLogout() {
  clearCache();
  // Si no, el contador y la burbuja quedan colgados con la cifra del usuario
  // anterior detrás de la pantalla de login
  import('./modules/notificaciones.js').then(m => m.pintarBadge(0)).catch(() => {});
  document.getElementById('auth-overlay').classList.remove('d-none');
  document.getElementById('app-layout').classList.add('d-none');
  document.getElementById('quick-add-fab').classList.add('d-none');
  const btn = document.getElementById('btn-google-login');
  btn.disabled = false;
  btn.innerHTML = `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" alt="Google"> Iniciar sesión con Google`;
}

// ── Router setup ──────────────────────────────────────────────────────────────
function setupRouter() {
  const content = document.getElementById('app-content');
  register('/',          ()       => load('dashboard'));
  register('/tarjetas',  ()       => load('tarjetas'));
  register('/compras',   (p, pts, query) => load('msi', pts[1] || null, query));
  register('/msi',       ()       => navigate('/compras'));
  register('/notificaciones', ()  => load('notificaciones'));
  register('/fijos',     ()       => load('fijos'));
  register('/impacto',   (p, pts) => load('impacto', pts[1] || null));
  register('/rendimientos', ()    => load('rendimientos'));
  register('/eventos',   (p, pts) => {
    if (pts[1]) load('evento-detalle', pts[1]);
    else        load('eventos');
  });
  register('/exportar',  ()       => load('exportar'));
  register('/festivos',  ()       => load('festivos'));
  register('/admin',     ()       => load('admin-tarjetas'));
  initRouter(content);
}

// ── Navigation toggles ────────────────────────────────────────────────────────
function setupNav() {
  const openSidebar  = () => {
    document.getElementById('sidebar').classList.add('mobile-open');
    document.getElementById('sidebar-overlay').classList.add('show');
  };
  const closeSidebar = () => {
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('sidebar-overlay').classList.remove('show');
  };

  document.getElementById('mobile-menu-btn').addEventListener('click', openSidebar);
  document.getElementById('bottom-menu-btn').addEventListener('click', openSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

  // Close sidebar on nav link click (mobile)
  document.querySelectorAll('.sidebar-nav .nav-link, .sidebar-footer .nav-link').forEach(a =>
    a.addEventListener('click', closeSidebar)
  );

  // Desktop collapse
  const toggle = document.getElementById('sidebar-toggle');
  if (toggle) {
    const saved = localStorage.getItem('sidebar-collapsed') === 'true';
    if (saved) document.getElementById('sidebar').classList.add('collapsed');
    toggle.addEventListener('click', () => {
      const s = document.getElementById('sidebar');
      s.classList.toggle('collapsed');
      localStorage.setItem('sidebar-collapsed', s.classList.contains('collapsed'));
    });
  }
}

// ── Tema claro / oscuro ───────────────────────────────────────────────────────
// El modo ya viene aplicado por el script inline de index.html (window.TEMA);
// aquí solo se maneja el botón que cicla Sistema → Claro → Oscuro.
const TEMAS = [
  { pref: 'sistema', icono: 'bi-circle-half', texto: 'Sistema' },
  { pref: 'claro',   icono: 'bi-sun',         texto: 'Claro'   },
  { pref: 'oscuro',  icono: 'bi-moon-stars',  texto: 'Oscuro'  }
];

function setupTema() {
  const btn = document.getElementById('btn-tema');
  if (!btn || !window.TEMA) return;

  const pintar = pref => {
    const t = TEMAS.find(x => x.pref === pref) || TEMAS[0];
    btn.innerHTML = `<i class="bi ${t.icono}"></i><span>Tema: ${t.texto}</span>`;
    btn.title     = `Tema: ${t.texto}`;
  };

  pintar(window.TEMA.leer());

  btn.addEventListener('click', () => {
    const i    = TEMAS.findIndex(t => t.pref === window.TEMA.leer());
    const next = TEMAS[(i + 1) % TEMAS.length].pref;
    window.TEMA.guardar(next);
    pintar(next);
  });

  // En modo Sistema, seguir en vivo el cambio de tema del sistema operativo
  window.TEMA.mq.addEventListener('change', () => {
    if (window.TEMA.leer() === 'sistema') window.TEMA.aplicar('sistema');
  });
}

// ── Floating Action Button ────────────────────────────────────────────────────
function setupFab() {
  const fab  = document.getElementById('fab-btn');
  const menu = document.getElementById('fab-menu');

  fab.addEventListener('click', e => {
    e.stopPropagation();
    const open = !menu.hidden;
    menu.hidden = open;
    fab.classList.toggle('open', !open);
  });

  document.addEventListener('click', () => {
    menu.hidden = true;
    fab.classList.remove('open');
  });

  document.querySelectorAll('.fab-item').forEach(btn =>
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      menu.hidden = true;
      fab.classList.remove('open');
      const { openQuickAdd } = await import('./modules/quick-add.js');
      openQuickAdd(btn.dataset.action);
    })
  );
}

// ── Service Worker ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());

  // Tap en un push con la app ya abierta: el SW pide la navegación por mensaje
  // en vez de navegar la pestaña él mismo, que la recargaría entera.
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.tipo !== 'navegar' || !e.data.ruta) return;
    navigate(e.data.ruta);
    import('./modules/notificaciones.js').then(m => m.refrescarBadge()).catch(() => {});
  });
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
initAuth(onLogin, onLogout);
