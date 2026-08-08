/**
 * Lista única de colecciones Firestore que usa la app, bajo `users/{uid}/...`.
 * Confirmada por grep exhaustivo de `getAll/getById/create/update/remove/upsert/
 * batchCreate/batchUpdate` en `js/`, incluyendo llamadas con variable en vez de
 * literal (`msi.js`, `impacto.js` resuelven siempre a `contado` o `msi`, ya
 * cubiertas).
 *
 * La comparten `file-store.js` (para saber qué claves servir) y `sync.js` (para
 * saber qué leer de Firestore real) — así no hay dos listas que puedan
 * desalinearse, que es justo el bug que tiene hoy `js/modules/exportar.js`: a su
 * `COLLECTIONS` le faltan `contado, gastos, config, impacto`, y tiene una clave
 * `'fijos'` que no coincide con la colección real `gastosFijos` (exporta 0 filas
 * de Gastos Fijos sin que nadie lo note). No se corrige ese archivo aquí, solo se
 * evita copiar el mismo error.
 *
 * `config` (doc único `'general'`) e `impacto` (docs con id = mes `'YYYY-MM'`) solo
 * se tocan vía `getById`/`upsert` en la app real, nunca `getAll` — igual encajan en
 * la forma `{col: [ {id, ...} ] }` que usa el store de pruebas.
 *
 * `impactoMensual` (solo escrita por `js/modules/migracion.js`, herramienta de
 * importación histórica) queda fuera a propósito: si algún día hace falta probar
 * esa migración, se agrega aquí.
 *
 * Restricción dura: el SDK de Firestore para navegador no puede listar
 * colecciones (eso solo existe en el Admin SDK, del lado servidor) — por eso esta
 * lista es necesariamente manual. Si se agrega una colección nueva a la app, hay
 * que sumarla aquí también para que `Sincronizar` la traiga.
 */
export const COLECCIONES = [
  'instituciones',
  'tarjetas',
  'contado',
  'msi',
  'gastos',
  'pagosDiferidos',
  'gastosFijos',
  'festivosMX',
  'config',
  'impacto',
  'eventos',
  'inversiones',
];
