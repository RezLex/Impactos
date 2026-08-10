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
    const hash     = window.location.hash || '#/';
    const raw      = hash.replace('#', '');
    const qIdx     = raw.indexOf('?');
    // Separar ruta y query ANTES de decodificar: si se decodifica todo junto, un '&' codificado
    // (%26) dentro de un valor se vuelve un separador real y URLSearchParams corta el valor ahí.
    const rawPath  = qIdx === -1 ? raw : raw.slice(0, qIdx);
    const rawQuery = qIdx === -1 ? ''  : raw.slice(qIdx + 1);
    const path     = decodeURIComponent(rawPath) || '/';
    const parts    = path.split('/').filter(Boolean);
    const base     = '/' + (parts[0] || '');
    const query    = new URLSearchParams(rawQuery);

    const handler = _routes[path] || _routes[base] || _routes['/'];
    if (handler) {
      await handler(path, parts, query);
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
    '/notificaciones': 'Notificaciones',
    '/fijos':     'Gastos Fijos',
    '/impacto':   'Impacto Mensual',
    '/rendimientos': 'Rendimientos',
    '/eventos':   'Eventos de Ofertas',
    '/ajustes':   'Ajustes',
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
