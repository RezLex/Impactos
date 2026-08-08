/**
 * Lectura real y autenticada de Firestore, para el botón "Sincronizar" del modo
 * pruebas — deliberadamente NO pasa por `db.js`: en modo pruebas el import map ya
 * redirige `../js/utils/db.js` al store de archivo, así que importarlo normal aquí
 * terminaría llamándose a sí mismo. En vez de eso, se importan `db`/`auth` directo
 * de `js/firebase.js` (sin remapear) y las funciones de Firestore del mismo CDN
 * que usa `db.js` real.
 *
 * El bucle de colecciones es el mismo patrón que ya usa
 * `js/modules/exportar.js`:`exportJSON()`, con la lista canónica de
 * `collections.js` en vez de la lista incompleta de `exportar.js`. La diferencia
 * es el destino: en vez de un `Blob` + `<a download>` (que dejaba el archivo
 * varado en el dispositivo que hizo clic, sin forma directa de llegar al
 * servidor), se hace `POST /api/fixture` — el mismo endpoint de escritura que ya
 * usa `file-store.js` para cada mutación local. Por eso ya no importa desde qué
 * dispositivo de la LAN se sincronice: el que escribe el archivo es siempre el
 * servidor, nunca el navegador que hizo clic.
 *
 * Carga perezosa: `banner.js` solo hace `import('./sync.js')` cuando alguien
 * toca el botón — nadie paga el costo de este archivo si nunca sincroniza.
 */

import { db, auth } from '../js/firebase.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js';
import { toast } from '../js/utils/ui.js';
import { COLECCIONES } from './collections.js';

export async function sincronizar() {
  const user = auth.currentUser;
  if (!user) {
    toast('Iniciá sesión con tu cuenta real primero — Sincronizar lee tu Firestore real.', 'warning');
    return;
  }

  const data = {};
  for (const col of COLECCIONES) {
    const snap = await getDocs(collection(db, 'users', user.uid, col));
    data[col] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  const res = await fetch('/api/fixture', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`El servidor no pudo guardar el archivo (${res.status}) — ¿está corriendo "python test/serve.py"?`);
  }

  toast('Sincronizado — recargá para ver los datos reales.', 'success');
}
