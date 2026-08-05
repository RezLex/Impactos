const _routes = {};
let _appContent = null;

export function register(path, handler) {
  _routes[path] = handler;
}

export function navigate(path) {
  window.location.hash = '#' + path;
}

export function initRouter(contentEl) {
  _appContent = contentEl;

  async function resolve() {
    const hash  = window.location.hash || '#/';
    const path  = decodeURIComponent(hash.replace('#', '')).split('?')[0] || '/';
    const parts = path.split('/').filter(Boolean);
    const base  = '/' + (parts[0] || '');

    const handler = _routes[path] || _routes[base] || _routes['/'];
    if (handler) {
      await handler(path, parts);
      _updateNav(base || '/');
    }
  }

  window.addEventListener('hashchange', resolve);
  resolve();
}

function _updateNav(base) {
  const titles = {
    '/':          'Dashboard',
    '/tarjetas':  'Tarjetas',
    '/compras':   'Compras y Gastos',
    '/fijos':     'Gastos Fijos',
    '/impacto':   'Impacto Mensual',
    '/rendimientos': 'Rendimientos',
    '/eventos':   'Eventos de Ofertas',
    '/exportar':  'Exportar Datos',
    '/festivos':  'Días Festivos',
    '/admin':     'Instituciones y Tarjetas',
  };

  document.querySelectorAll('[data-route]').forEach(el => {
    const r = el.dataset.route;
    el.classList.toggle('active', r === base || (r !== '/' && base.startsWith(r)));
  });

  const titleEl = document.getElementById('mobile-page-title');
  if (titleEl) titleEl.textContent = titles[base] || 'IMPACTOS';
}
