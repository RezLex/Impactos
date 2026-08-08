/**
 * Sustituto de `js/utils/db.js` para el modo pruebas del front completo.
 *
 * Se activa vía un import map que `index.html` inyecta solo si `?modoPruebas=1` se
 * usó alguna vez (ver el script inline al inicio de su `<head>`) — este módulo
 * jamás se carga en uso normal. Expone exactamente la misma superficie pública que
 * `db.js`, así que ningún módulo de la app se entera del cambio.
 *
 * Fuente de datos: `fixtures/firestore.json` — que es a la vez de dónde se lee al
 * cargar Y adónde se escribe en cada mutación, vía `POST /api/fixture` contra
 * `test/serve.py` (el único servidor de este proyecto que entiende ese endpoint;
 * `python -m http.server` normal no). Si el archivo no existe todavía (nadie
 * sincronizó ni mutó nada en esta máquina), se cae a `fixtures/seed.json` —
 * datos ficticios generados con el motor real, commiteados.
 *
 * El archivo es la ÚNICA fuente de verdad: no hay copia en `localStorage` que
 * pueda quedar desincronizada. Eso es deliberado — antes existía esa copia para
 * sobrevivir a un reload, pero al vivir solo ahí, cambiar de pestaña (por
 * ejemplo a una de incógnito, con su propio `localStorage` aislado) hacía
 * parecer que los cambios se habían perdido, cuando en realidad nunca habían
 * llegado a ningún lado persistente. Escribir siempre al archivo evita esa clase
 * de sorpresa por completo.
 */

import { montarBanner } from './banner.js';
import { COLECCIONES } from './collections.js';

// El banner se monta ya, sin esperar a que carguen los datos — así se ve incluso
// en la pantalla de login real, que sigue siendo el único punto de entrada.
montarBanner();

async function cargarFixture() {
  for (const nombre of ['firestore.json', 'seed.json']) {
    try {
      const res = await fetch(new URL(`./fixtures/${nombre}`, import.meta.url), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch {}
  }
  return null; // sin red y sin nada que leer — se arranca vacío, no se rompe
}

let store = {};

const ready = (async () => {
  store = (await cargarFixture()) || {};
  // Asegura que todas las colecciones canónicas existan, aunque el fixture no las traiga
  COLECCIONES.forEach(c => { store[c] ||= []; });
})();

// Las escrituras se encolan (nunca en paralelo) para que dos mutaciones seguidas
// no se pisen entre sí escribiendo el archivo en el orden equivocado.
let cola = Promise.resolve();
let avisado = false;

function persistir() {
  const cuerpo = JSON.stringify(store);
  cola = cola.then(() =>
    fetch('/api/fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpo })
      .then(res => { if (!res.ok) throw new Error(res.statusText); })
      .catch(async () => {
        // Sin test/serve.py corriendo (p. ej. quedó `python -m http.server`
        // normal) no hay a quién escribirle — el cambio sigue disponible en
        // memoria para esta pestaña, pero no queda en el archivo. Se avisa una
        // sola vez, no en cada mutación.
        if (avisado) return;
        avisado = true;
        const { toast } = await import('../js/utils/ui.js');
        toast('No se pudo guardar en el archivo — ¿está corriendo "python test/serve.py"? ' +
              'Los cambios de esta sesión no van a persistir.', 'warning');
      })
  );
}

const col     = name => (store[name] ||= []);
const clonar  = o => JSON.parse(JSON.stringify(o));
const nuevoId = () => 'id-' + Math.random().toString(36).slice(2, 10);

function aplicaConstraint(row, c) {
  if (!c) return true;
  const v = row[c.field];
  switch (c.op) {
    case '>=': return v >= c.value;
    case '<=': return v <= c.value;
    case '==': return v === c.value;
    case '!=': return v !== c.value;
    case '<':  return v <  c.value;
    case '>':  return v >  c.value;
    default:   return true;
  }
}

// ── Superficie pública, idéntica a js/utils/db.js ──────────────────────────────

export async function getAll(name, ...constraints) {
  await ready;
  let rows = clonar(col(name));
  constraints.forEach(c => { rows = rows.filter(r => aplicaConstraint(r, c)); });
  return rows;
}

export async function getById(name, id) {
  await ready;
  const d = col(name).find(x => x.id === id);
  return d ? clonar(d) : null;
}

export async function create(name, data) {
  await ready;
  const id = nuevoId();
  col(name).push({ id, ...clonar(data), _createdAt: new Date().toISOString() });
  persistir();
  return id;
}

export async function update(name, id, data) {
  await ready;
  const i = col(name).findIndex(x => x.id === id);
  if (i < 0) throw new Error(`No existe ${name}/${id}`);
  col(name)[i] = { ...col(name)[i], ...clonar(data), _updatedAt: new Date().toISOString() };
  persistir();
}

export async function remove(name, id) {
  await ready;
  store[name] = col(name).filter(x => x.id !== id);
  persistir();
}

export async function upsert(name, id, data) {
  await ready;
  const i = col(name).findIndex(x => x.id === id);
  if (i < 0) col(name).push({ id, ...clonar(data) });
  else       col(name)[i] = { ...col(name)[i], ...clonar(data) };
  persistir();
}

export async function batchCreate(name, items) {
  await ready;
  items.forEach(it => col(name).push({ id: nuevoId(), ...clonar(it) }));
  persistir();
}

/**
 * Igual que en Firestore, atómica dentro de una colección: se valida que TODOS los
 * ids existan antes de tocar cualquiera, para que una transferencia con una pata
 * rota falle entera en vez de dejar media escritura — mismo comportamiento que
 * `db.js` real.
 */
export async function batchUpdate(name, items) {
  await ready;
  const faltan = items.filter(({ id }) => !col(name).some(x => x.id === id));
  if (faltan.length) throw new Error(`No existen: ${faltan.map(f => f.id).join(', ')}`);
  items.forEach(({ id, data }) => {
    const i = col(name).findIndex(x => x.id === id);
    col(name)[i] = { ...col(name)[i], ...clonar(data), _updatedAt: new Date().toISOString() };
  });
  persistir();
}

/** Replica el mismo corte `YYYY-MM` que `db.js:recentWhere` — real, no ignorado. */
export function recentWhere(campo, months = 24) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  const desde = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return where(campo, '>=', desde);
}

export function where(field, op, value) { return { field, op, value }; }

/** No se usa para ordenar de verdad — ningún módulo hoy pasa un orderBy real a getAll. */
export const orderBy = () => null;

/** No hay remoto que invalidar en modo pruebas: el store ya es la fuente de verdad. */
export function clearCache() {}
