export function toast(msg, type = 'success') {
  const icons = { success:'check-circle-fill', danger:'x-circle-fill', warning:'exclamation-triangle-fill', info:'info-circle-fill' };
  const id = 'toast-' + Date.now();
  document.getElementById('toast-container').insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast align-items-center text-white bg-${type} border-0" role="alert" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body"><i class="bi bi-${icons[type]||icons.info} me-2"></i>${msg}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`);
  const el = document.getElementById(id);
  const t = new bootstrap.Toast(el, { delay: 3500 });
  t.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

export function loading(container) {
  container.innerHTML = `<div class="loading-overlay"><div class="spinner-border text-primary" role="status"></div></div>`;
}

export function confirmDelete(nombre) {
  return window.confirm(`¿Eliminar "${nombre}"? Esta acción no se puede deshacer.`);
}

// Generic modal: openModal({ title, body, footer })
export function openModal({ title, body, footer = '', size = '' }) {
  // Al encadenar modales (cerrar uno y abrir otro en su 'hidden'), el contenedor
  // se vacía antes de que Bootstrap termine de retirar su backdrop: la instancia
  // se queda sin elemento y el backdrop sobrevive con opacity .5 sobre toda la
  // pantalla, que además intercepta los clics. Se limpia antes de montar.
  const previo = document.getElementById('app-modal');
  if (previo) bootstrap.Modal.getInstance(previo)?.dispose();
  document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());

  document.getElementById('modal-container').innerHTML = `
    <div class="modal fade" id="app-modal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered ${size ? 'modal-' + size : ''}">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">${title}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">${body}</div>
          ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
        </div>
      </div>
    </div>`;
  const m = new bootstrap.Modal(document.getElementById('app-modal'));
  m.show();
  document.getElementById('app-modal').addEventListener('hidden.bs.modal', () => {
    document.getElementById('modal-container').innerHTML = '';
  }, { once: true });
  return m;
}

export function closeModal() {
  const el = document.getElementById('app-modal');
  if (el) bootstrap.Modal.getInstance(el)?.hide();
}
