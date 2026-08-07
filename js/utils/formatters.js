const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });

export const currency = v => (v == null || isNaN(v)) ? '—' : mxn.format(v);
export const r2       = n => Math.round((Number(n) || 0) * 100) / 100;

export const percent  = v => (v == null) ? '—' : (v * 100).toFixed(0) + '%';

export function excelDateToISO(serial) {
  if (!serial || isNaN(serial)) return null;
  const d = new Date(Math.round((Number(serial) - 25569) * 86400 * 1000));
  return d.toISOString().split('T')[0];
}

/**
 * Si un fondo `#rrggbb` es lo bastante claro como para necesitar texto negro
 * encima, según su luminancia percibida (fórmula YIQ). Para el color
 * configurado de una institución, cuyo tono elige el usuario libremente.
 */
function esColorClaro(hex) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150;
}

/** Color de texto legible (negro o blanco) sobre un fondo `#rrggbb`. */
export const textoLegibleSobre = hex => esColorClaro(hex) ? '#000' : '#fff';

/**
 * Triplete `r,g,b` (sin `rgba()`) del texto legible sobre un fondo `#rrggbb`,
 * para componer overlays translúcidos a juego: `rgba(var(--on-color-rgb), .15)`.
 */
export const rgbLegibleSobre = hex => esColorClaro(hex) ? '0,0,0' : '255,255,255';

/** El triplete opuesto a `rgbLegibleSobre` — para el estado hover de botones que invierten fondo/texto. */
export const rgbInversoSobre = hex => esColorClaro(hex) ? '255,255,255' : '0,0,0';

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
}

export function fmtShortDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${parseInt(d)} ${months[parseInt(m)-1]}`;
}

export function fmtMonth(yyyymm) {
  if (!yyyymm) return '';
  const [y, m] = yyyymm.split('-');
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return `${months[parseInt(m)-1]} ${y}`;
}

export function fmtMonthShort(yyyymm) {
  if (!yyyymm) return '';
  const [y, m] = yyyymm.split('-');
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${months[parseInt(m)-1]}-${y}`;
}

export function currentYYYYMM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

export function prevMonth(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

export function nextMonth(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

export function maskCard(n) {
  if (!n) return '—';
  const c = String(n).replace(/\s/g, '');
  return c.length >= 4 ? '**** ' + c.slice(-4) : c;
}

export function daysUntil(dayOfMonth) {
  const now = new Date();
  let t = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
  if (t <= now) t.setMonth(t.getMonth() + 1);
  return Math.ceil((t - now) / 864e5);
}

export function bankClass(nombre) {
  if (!nombre) return '';
  const n = nombre.toLowerCase();
  if (n.includes('banamex'))     return 'bank-banamex';
  if (n.includes('banorte'))     return 'bank-banorte';
  if (n.includes('bbva'))        return 'bank-bbva';
  if (n.includes('mercado'))     return 'bank-mercadopago';
  if (n.includes('nu'))          return 'bank-nu';
  if (n.includes('rappi'))       return 'bank-rappi';
  if (n.includes('revolut'))     return 'bank-revolut';
  if (n.includes('santander'))   return 'bank-santander';
  return '';
}
