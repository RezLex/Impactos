import { initAuth }   from './auth.js';
import { initRouter, register, navigate } from './router.js';

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
  setupNav();
  setupRouter();
}

function onLogout() {
  document.getElementById('auth-overlay').classList.remove('d-none');
  document.getElementById('app-layout').classList.add('d-none');
  const btn = document.getElementById('btn-google-login');
  btn.disabled = false;
  btn.innerHTML = `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" alt="Google"> Iniciar sesión con Google`;
}

// ── Router setup ──────────────────────────────────────────────────────────────
function setupRouter() {
  const content = document.getElementById('app-content');
  register('/',          ()       => load('dashboard'));
  register('/tarjetas',  ()       => load('tarjetas'));
  register('/msi',       ()       => load('msi'));
  register('/fijos',     ()       => load('fijos'));
  register('/impacto',   (p, pts) => load('impacto', pts[1] || null));
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

// ── Bootstrap ────────────────────────────────────────────────────────────────
initAuth(onLogin, onLogout);
