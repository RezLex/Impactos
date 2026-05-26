import { db, auth } from '../firebase.js';
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  query, orderBy, where, writeBatch
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js';

const uid = () => auth.currentUser.uid;

const userCol  = name       => collection(db, 'users', uid(), name);
const userDoc  = (name, id) => doc(db, 'users', uid(), name, id);

export async function getAll(col, ...constraints) {
  const q = constraints.length ? query(userCol(col), ...constraints) : userCol(col);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getById(col, id) {
  const snap = await getDoc(userDoc(col, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function create(col, data) {
  const ref = await addDoc(userCol(col), { ...data, _createdAt: new Date().toISOString() });
  return ref.id;
}

export async function update(col, id, data) {
  await updateDoc(userDoc(col, id), { ...data, _updatedAt: new Date().toISOString() });
}

export async function remove(col, id) {
  await deleteDoc(userDoc(col, id));
}

export async function upsert(col, id, data) {
  await setDoc(userDoc(col, id), { ...data, _updatedAt: new Date().toISOString() }, { merge: true });
}

export async function batchCreate(col, items) {
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

export { orderBy, where };
