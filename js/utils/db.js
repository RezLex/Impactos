import { db, auth } from '../firebase.js';
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  query, orderBy, where, writeBatch
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js';

const uid = () => auth.currentUser.uid;

const userCol  = name       => collection(db, 'users', uid(), name);
const userDoc  = (name, id) => doc(db, 'users', uid(), name, id);

// ── Cache ─────────────────────────────────────────────────────────────────────

// Session-level in-memory cache (5-min TTL) — resets on page reload
const _mem = new Map();
const MEM_TTL  = 5 * 60 * 1000;
const MEM_COLS = new Set(['gastosFijos', 'inversiones']);

// localStorage cache — survives page reload (y sin red: base de la vista de
// Tarjetas offline). festivosMX cambia poco, TTL largo; tarjetas/instituciones
// se editan seguido y pueden divergir entre dispositivos, así que su TTL es
// corto — solo para aguantar quedarte sin señal un rato, no para reemplazar
// el refetch normal en línea (que igual invalida al primer `update`/`create`).
const LS_PREFIX = 'impactos_c_';
const LS_TTL_DEFAULT = 30 * 24 * 60 * 60 * 1000; // 30 días
const LS_TTLS = {
  festivosMX:    LS_TTL_DEFAULT,
  tarjetas:      24 * 60 * 60 * 1000, // 1 día
  instituciones: 24 * 60 * 60 * 1000,
};
const LS_COLS = new Set(Object.keys(LS_TTLS));

function _memGet(col) {
  const c = _mem.get(col);
  if (c && Date.now() < c.exp) return c.data;
  _mem.delete(col);
  return null;
}
function _memSet(col, data) {
  _mem.set(col, { data, exp: Date.now() + MEM_TTL });
}

function _lsGet(col) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + col);
    if (!raw) return null;
    const { data, exp } = JSON.parse(raw);
    if (Date.now() > exp) { localStorage.removeItem(LS_PREFIX + col); return null; }
    return data;
  } catch { return null; }
}
function _lsSet(col, data) {
  try {
    const ttl = LS_TTLS[col] ?? LS_TTL_DEFAULT;
    localStorage.setItem(LS_PREFIX + col, JSON.stringify({ data, exp: Date.now() + ttl }));
  } catch {} // ignore quota errors
}
/** Lee el caché de localStorage ignorando su vencimiento — último recurso sin red. */
function _lsGetStale(col) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + col);
    return raw ? JSON.parse(raw).data : null;
  } catch { return null; }
}

function _invalidate(col) {
  _mem.delete(col);
  if (LS_COLS.has(col)) try { localStorage.removeItem(LS_PREFIX + col); } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getAll(col, ...constraints) {
  // Return cached data for simple (no-constraint) queries
  if (!constraints.length) {
    if (LS_COLS.has(col)) {
      const hit = _lsGet(col);
      if (hit) return hit;
    } else if (MEM_COLS.has(col)) {
      const hit = _memGet(col);
      if (hit) return hit;
    }
  }

  const q = constraints.length ? query(userCol(col), ...constraints) : userCol(col);
  let snap;
  try {
    snap = await getDocs(q);
  } catch (e) {
    // Sin red: para colecciones con caché persistente, un dato vencido sigue
    // siendo mejor que nada — se sirve aunque ya haya pasado su TTL.
    if (!constraints.length && LS_COLS.has(col)) {
      const stale = _lsGetStale(col);
      if (stale) return stale;
    }
    throw e;
  }
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Store in appropriate cache
  if (!constraints.length) {
    if (LS_COLS.has(col))  _lsSet(col, data);
    else if (MEM_COLS.has(col)) _memSet(col, data);
  }

  return data;
}

export async function getById(col, id) {
  const snap = await getDoc(userDoc(col, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function create(col, data) {
  _invalidate(col);
  const ref = await addDoc(userCol(col), { ...data, _createdAt: new Date().toISOString() });
  return ref.id;
}

export async function update(col, id, data) {
  _invalidate(col);
  await updateDoc(userDoc(col, id), { ...data, _updatedAt: new Date().toISOString() });
}

export async function remove(col, id) {
  _invalidate(col);
  await deleteDoc(userDoc(col, id));
}

export async function upsert(col, id, data) {
  _invalidate(col);
  await setDoc(userDoc(col, id), { ...data, _updatedAt: new Date().toISOString() }, { merge: true });
}

export async function batchCreate(col, items) {
  _invalidate(col);
  const CHUNK = 499;
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = writeBatch(db);
    items.slice(i, i + CHUNK).forEach(item => {
      const ref = doc(userCol(col));
      batch.set(ref, { ...item, _createdAt: new Date().toISOString() });
    });
    await batch.commit();
  }
}

/**
 * Updates several documents of a collection in one atomic write.
 * Needed when a single user action touches more than one document — a transfer
 * between accounts writes both legs, and leaving one half behind would corrupt
 * the calculation on both sides.
 *
 * @param {string} col
 * @param {Array<{id:string, data:object}>} items
 */
export async function batchUpdate(col, items) {
  _invalidate(col);
  const CHUNK = 499; // atomicity holds within a chunk; a transfer is always 2 docs
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = writeBatch(db);
    items.slice(i, i + CHUNK).forEach(({ id, data }) =>
      batch.update(userDoc(col, id), { ...data, _updatedAt: new Date().toISOString() }));
    await batch.commit();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns a Firestore `where` constraint limiting a date/mes field to the last N months. */
export function recentWhere(campo, months = 24) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  const desde = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return where(campo, '>=', desde);
}

/** Invalidates all session and localStorage caches (e.g., on logout). */
export function clearCache() {
  _mem.clear();
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith(LS_PREFIX))
      .forEach(k => localStorage.removeItem(k));
  } catch {}
}

export { orderBy, where };
