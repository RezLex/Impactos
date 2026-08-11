# Recordatorios push — plan

> Extiende el sistema de notificaciones (`docs/NOTIFICACIONES-PUSH.md`) con los
> tipos `corte`/`gastoFijo`/`rendimiento`/`pago` que ese diseño dejó pendientes.
> Este archivo es el plan acordado.
>
> **Estado:** implementado del lado del cliente (`js/modules/notificaciones.js`)
> y escrito el Apps Script nuevo (`docs/app-script-recordatorios.gs`), **sin
> desplegar ni verificar** todavía: falta correr `pruebaRecordatorios()` desde
> el editor de Apps Script, crear el trigger diario de `procesarRecordatorios()`
> y confirmar en el teléfono real (ver "Verificación" al final de este
> archivo). El detalle vigente de cada pieza vive en `docs/DOCUMENTACION.md`;
> este archivo queda como registro del diseño acordado.

## Alcance

Cuatro recordatorios nuevos, todos proactivos (deben llegar sin que el usuario
abra la app):

1. **Corte de tarjeta** — mientras el monto a pagar siga sin confirmarse en el
   Impacto Mensual del mes en curso, recordarlo a partir del corte; mientras el
   aviso siga pendiente (no se haya descartado) no se repite.
2. **Gasto fijo por confirmar** — el día en que se detecta un gasto fijo
   pendiente de confirmar ese mes.
3. **Cierre de mes** — el último día de cada mes, para recordar ajustar los
   rendimientos de las cuentas.
4. **Pago pendiente por quincena** — a partir de la fecha de nómina anterior
   al pago de cada tarjeta (Q1 o Q2), cuántas tarjetas del Impacto activo
   siguen sin pagarse; misma regla que el corte: mientras el aviso siga
   pendiente (no se haya descartado) no se repite.

Decisiones ya tomadas:
- El switch único de push en Ajustes cubre los cuatro tipos nuevos (sin
  sub-toggles); `js/modules/ajustes.js` no se toca.
- El recordatorio de gasto fijo redirige a `#/compras/gastos` (tab "Gastos" del
  módulo Compras y Gastos — `register('/compras', (p, pts, query) => load('msi',
  pts[1] || null, query))` en `js/app.js:52`, y `renderView(container, tab)` en
  `js/modules/msi.js:76,212` ya sabe abrir directo en `tab === 'gastos'`).
- El recordatorio de corte se apoya en el snapshot `impacto/{YYYY-MM}` (no en un
  cálculo de fecha independiente) y no se reenvía por tiempo — mientras el
  último aviso siga `pendiente` (el usuario no lo descartó), no se repite.
- Toda la lógica nueva va en un **archivo `.gs` separado** dentro del mismo
  proyecto de Apps Script, para no tocar el pipeline de compras que ya está en
  producción.

## Archivo nuevo: `docs/app-script-recordatorios.gs`

Los archivos `.gs` de un mismo proyecto de Apps Script comparten un solo scope
global — así que este archivo puede llamar directo a lo que ya existe en
`app-script.gs` sin duplicarlo ni importarlo: `PROJECT_ID`, `UID`, `FS_DOCS`,
`FS_API`, `FCM_SEND`, `fsFetch`, `fsVal`, `fsMap`, `fsMapa`, `idDeRuta`, `pesos`,
`escapar`, `fmt`, `listarTokens`. **No se modifica `app-script.gs`.**

Constantes propias del archivo nuevo:
```js
const FS_IMPACTO     = FS_DOCS + '/users/' + UID + '/impacto';
const FS_GASTOSFIJOS = FS_DOCS + '/users/' + UID + '/gastosFijos';
const FS_GASTOS      = FS_DOCS + '/users/' + UID + '/gastos';
const FS_TARJETAS    = FS_DOCS + '/users/' + UID + '/tarjetas';
const FS_FESTIVOS    = FS_DOCS + '/users/' + UID + '/festivosMX';
```

### Trigger diario único: `procesarRecordatorios()`
Un solo trigger de tiempo (independiente de los dos que ya tiene
`app-script.gs`, para que un bug acá no afecte la detección de compras), que
llama a las cuatro rutinas de abajo y al final manda **un solo push** agrupando lo
que se haya creado/reenviado en la corrida (mismo patrón "uno si es una, resumen
si son varias" que ya usa `enviarPush`/`textoResumen` en `app-script.gs`, pero
implementado en este archivo con su propio `enviarPushRecordatorios(items)` ya
que los `datos` no tienen la forma de una compra).

### 1. Corte de tarjeta — `revisarCortes()`

`impacto/{YYYY-MM}` es un doc **por mes calendario, independiente** — la app no
obliga a cerrar un mes antes de abrir el siguiente
(`js/modules/impacto.js:_crearImpacto` crea el doc del mes que se visite, sin
tocar los anteriores). Es decir, en agosto puede seguir habiendo un
`impacto/2026-07` con `estado: 'activo'` y una tarjeta sin confirmar — si la
revisión solo mirara el mes calendario actual, ese caso quedaría fuera del
radar para siempre. Por eso `revisarCortes()` no pide un mes puntual: **lista
todos** los `impacto` con `estado === 'activo'` (colección chica, un doc por
mes — mismo patrón de "traer todo y filtrar en memoria" que ya usa
`listarNotificaciones()` en `app-script.gs`) y revisa cada uno:

Tres subtipos posibles, marcados en `datos.subtipo` (además de discriminar el
mensaje, evita que compartan clave de dedupe entre sí):

- **`faltaImpacto`** — mes calendario actual sin doc (nunca se abrió
  `#/impacto` este mes). `datos: { subtipo: 'faltaImpacto', mes }`. Redirige a
  `#/impacto` (que ya lo crea al abrirse). Chequeo solo del mes actual — los
  meses futuros no existen por diseño, y uno pasado sin doc simplemente nunca
  se abrió (no es "un mes atorado", no aplica el caso de abajo).
- **`sinConfirmar`** — por cada `impacto` con `estado === 'activo'` (el actual
  o uno anterior sin cerrar), por cada entrada de `tarjetas[]` con
  `fechaCorte` y `confirmado !== true` (`docs/DOCUMENTACION.md` — campos de
  `impacto.tarjetas[]`). `datos: { subtipo: 'sinConfirmar', tarjetaId, nombre,
  mes, fechaCorte, monto: montoAPagar ?? estimadoTotal }`.
- **`sinCerrar`** — por cada `impacto` con `estado === 'activo'` **y `mes <
  mesActual`** (un mes ya terminado que se quedó abierto), sin importar el
  estado de sus tarjetas: recordatorio a nivel mes para cerrarlo. `datos: {
  subtipo: 'sinCerrar', mes }`. Es el respaldo para cuando todas las tarjetas
  ya están `confirmado`/`pagado` (entonces `sinConfirmar` ya se autorresolvió)
  pero el usuario nunca tocó "Cerrar mes" — sin este subtipo ese caso quedaría
  sin ningún aviso. Corre en paralelo e independiente de `sinConfirmar`: un
  mes puede tener ambos a la vez, o solo `sinCerrar` si ya no le falta
  confirmar nada.

Todos redirigen a `#/impacto/{mes}` (`js/modules/impacto.js` navega por mes vía
`navigate('/impacto/' + mes)`, línea 258-259 — así abre directo el mes
atrasado, no el actual). Si `mes` no es el mes calendario actual, el texto del
push lo aclara ("de {mes}") para no confundirlo con el mes en curso.

**Sin reintento por tiempo (los tres subtipos, mismo mecanismo):** en vez de
crear un documento nuevo cada vez (que llenaría la bandeja de duplicados), se
mantiene **un solo doc** por clave natural (`subtipo + mes` para
`faltaImpacto`/`sinCerrar`; `subtipo + tarjetaId + mes` para `sinConfirmar`):
- Ya existe un doc `pendiente` para esa clave → no se toca. Mientras el
  usuario no lo descarte (o lo abra y quede `procesada`), no se manda otro
  aviso aunque pasen varias corridas — evita repetir el mismo recordatorio
  todos los días.
- No existe doc `pendiente` para esa clave (nunca se creó, o el último se
  descartó/procesó sin que la condición de fondo se resolviera) → si ya pasó
  al menos 1 día desde la fecha que dispara la condición (`fechaCorte` para
  `sinConfirmar`; el día 1 del mes para `faltaImpacto`; el día 1 del mes
  siguiente al que quedó abierto, para `sinCerrar`), se crea uno nuevo y
  entra a la lista del push.
- Doc `pendiente` cuya condición ya no es vigente (el usuario confirmó, el
  impacto ya se creó, o el mes ya se cerró) → pasa solo a
  `estatus: 'procesada'` — se autorresuelve sin que el usuario tenga que
  tocarlo.

### 2. Gasto fijo por confirmar — `revisarGastosFijos()`

Como `gastos` (los "por confirmar") se crea de forma perezosa solo al abrir
`#/compras` (`js/modules/msi.js:161-210`), acá sí hace falta calcular la fecha
de forma independiente — se porta `calcularFechaGastoMes`
(`js/modules/msi.js:2089-2131`) y `_sigHabil` (`js/modules/msi.js:2080-2086`) a
este archivo nuevo, leyendo `gastosFijos` y `festivosMX` vía Firestore REST.

- Para cada `gastoFijo`, calcula la fecha de este mes. Si `fecha === hoy` **y
  no existe ya** un doc en `gastos` con ese `gastaFijoId` para este mes, crea el
  `gastos` pendiente (mismo shape que `js/modules/msi.js:195-198`: `tipo:
  'gastaFijo', estado: 'pendiente', mes, gastaFijoId, nombre, tarjetaId, ...`) y
  una `notificaciones` `{ tipo: 'gastoFijo', estatus: 'pendiente', datos: {
  gastaFijoId, nombre, importe, fechaPago } }`. Así cuando el usuario entre a
  `#/compras/gastos`, ya está creado y `msi.js` no lo duplica (su propio chequeo
  de "ya existe" lo cubre).
- Sin reintento: es un evento puntual (una vez confirmado o descartado desde la
  pestaña Gastos, no vuelve a aparecer).

### 3. Cierre de mes — `revisarCierreMes()`

Si hoy es el último día del mes, crea **una sola** `notificaciones` `{ tipo:
'rendimiento', estatus: 'pendiente', datos: { mes } }` (dedupe por `mes`, sin
reintento — es un solo aviso al mes).

### 4. Pago pendiente por quincena — `revisarPagosPendientes()`

A diferencia de las tres anteriores, esta **sí depende de que haya mes activo
único** (`docs/IMPACTO-MES-ACTIVO.md`): toma directo el (único) `impacto` con
`estado === 'activo'` — sin él, no hay nada que revisar.

Cada tarjeta de ese impacto ya trae `fechaNomina` en el snapshot (el mismo
campo que calcula `js/modules/impacto.js` para mostrar el badge `1Q`/`2Q` en
la columna "Pago" — la quincena, día 15 o último día del mes ajustado a
hábil, anterior o igual a la fecha límite de pago real de la tarjeta). Se
agrupan las tarjetas con `pagado !== true` por su `fechaNomina` exacta (no por
"la quincena de este mes en abstracto" — una tarjeta cuyo pago cae a
principios de mes puede mapear a la nómina de fin del mes anterior); cada
grupo es un candidato con `datos: { mes, fechaNomina, quincena, cantidad,
resumen }` (`quincena` es solo la etiqueta según el día de `fechaNomina`;
`resumen` son hasta 2 nombres + "y N más", mismo criterio que `textoResumen`
en `app-script.gs`) y `fechaDisparo = fechaNomina`, con id
`pago-{mes}-{fechaNomina}`. Redirige a `#/impacto` **sin mes** (no a
`#/impacto/{mes}`): el aviso puede quedar pendiente varios días, y si en ese
tiempo el usuario ya cerró el mes desde la app, `datos.mes` quedaría
apuntando a un mes que ya no es el activo — mejor dejar que la propia app
resuelva cuál es el vigente (`_resolverMesActivo`,
`docs/IMPACTO-MES-ACTIVO.md`).

Se procesa con el **mismo `_procesarCandidatos` que `corte`** (misma regla de
"sin reintento por tiempo" — ver arriba): mientras el grupo tenga un aviso
`pendiente`, no se reenvía aunque pasen varias corridas; se autorresuelve a
`procesada` en cuanto ya no queda ninguna tarjeta sin pagar en ese grupo
(todas con `pagado: true`, el Impacto se cerró, o ya no es el mes activo).

### Textos del push
- Corte, `faltaImpacto`: `Genera el Impacto de {mes}` / `toca para generarlo`.
- Corte, `sinConfirmar`: `Cortó tu tarjeta {nombre}` / `{monto} por confirmar —
  toca para revisarlo` (si `mes` no es el actual, agrega `(de {mes})`).
- Corte, `sinCerrar`: `Impacto de {mes} sin cerrar` / `toca para revisarlo y
  cerrarlo`.
- Gasto fijo: `{nombre} — gasto fijo por confirmar` / `{importe}`.
- Rendimiento: `Fin de mes` / `revisa los rendimientos de tus cuentas`.
- Pago: `{cantidad} tarjeta(s) por pagar (Q1|Q2)` / `{resumen} — toca para
  revisarlas`.
- Igual que hoy: **un solo push por corrida** (detalle si es uno, resumen si
  son varios), `data-only`, `tag` = id del doc.
- **`ruta`** (nuevo): cuando la corrida manda el detalle de un solo
  recordatorio, el payload FCM incluye `ruta` (`_rutaRecordatorio()`) con el
  destino exacto — `/impacto` (`pago`), `/impacto/{mes}` o `/impacto` (`corte`
  según traiga `datos.mes`), `/compras/gastos` (`gastoFijo`), `/rendimientos`
  (`rendimiento`). `sw.js` la usa al abrir el push (`payload.ruta ||
  '/notificaciones'`) — antes iba **siempre** a `/notificaciones` sin importar
  el tipo, aunque el tap dentro de la lista (`_abrir` en
  `js/modules/notificaciones.js`) ya redirigiera bien; ahora el push nativo
  también abre directo. Cuando son varios mezclados no hay un solo destino,
  así que no se manda `ruta` y cae al fallback de `sw.js`.

### Funciones de prueba
Mismo patrón que ya usa `app-script.gs` (`pruebaFirestore`, `pruebaPushUna/
Varias`, `diagnostico`): `pruebaRecordatorios()` corre las cuatro rutinas en
modo lectura/log, sin escribir, para validar en el editor de Apps Script antes
de crear el trigger de producción. `pruebaRevisarPagosPendientes()` corre solo
la nueva; `pruebaPushPagoPendiente()` manda un push de prueba con datos de
mentira.

## Cambios en el cliente

### `js/modules/notificaciones.js`
- `_cargarPendientes` (línea 16-23): quitar el filtro fijo a `tipo === 'compra'`
  y traer los 4 tipos — esto también hace que `refrescarBadge`/`pintarBadge`
  (líneas 199-226) cuenten los recordatorios sin tocarlos.
- `_fila` (línea 143-169): agregar una plantilla genérica para
  `corte`/`gastoFijo`/`rendimiento`/`pago` (ícono + texto corto), separada de
  la plantilla de compra (monto, comercio, MSI, píldora de tarjeta).
- `_abrir` (línea 177-197): para los tipos nuevos, en vez de `openQuickAdd`,
  navegar (`window.location.hash`) a `#/impacto/{mes}` para `corte` (si el doc
  no trae `mes`, a `#/impacto` genérico), `#/impacto` **sin mes** para `pago`
  (siempre — ver arriba por qué no usa `datos.mes`), `#/compras/gastos`
  (gastoFijo) o `#/rendimientos` (rendimiento), y marcar
  `estatus: 'procesada'` con el mismo `update('notificaciones', n.id, ...)`
  que ya usa el flujo de compra. Nota: para `corte` y `pago`, el auto-resuelto
  que hace Apps Script (ver arriba) es el mecanismo principal; el tap solo
  adelanta el `procesada` si el usuario entra manualmente antes del próximo
  trigger.
- Sin cambios en `_avisoPush`, en el botón `X` de descartar, ni en el resto.

### Sin cambios
- `js/modules/ajustes.js`, `sw.js` (push listener genérico y data-only),
  `js/push.js`, `js/app.js`, y **`docs/app-script.gs`** (el pipeline de
  compras queda intacto).

## Documentación
- Este archivo reemplaza la sección "Pendiente de definir" de
  `docs/NOTIFICACIONES-PUSH.md` — falta cruzar la referencia ahí una vez
  implementado.
- `docs/DOCUMENTACION.md`: ampliar el modelo de `notificaciones` (los 5 tipos y
  la forma de `datos` por tipo) cuando se implemente.

## Verificación (al implementar)
- Apps Script no tiene test runner: correr desde el editor, en este orden,
  antes de activar el trigger nuevo (mismo patrón que `app-script.gs`):
  1. `diagnosticoColecciones()` — cuenta documentos reales por colección, sin
     escribir nada; confirma que el `UID` y los scopes leen bien.
  2. `pruebaFirestoreRecordatorios()` — round-trip de escritura/lectura/
     borrado contra Firestore para los cuatro tipos nuevos (`corte`,
     `gastoFijo`, `rendimiento`, `pago`), sin dejar residuo.
  3. `pruebaRevisarCortes()`, `pruebaRevisarGastosFijos()`,
     `pruebaRevisarCierreMes()`, `pruebaRevisarPagosPendientes()` — cada
     rutina en modo lectura contra datos reales (sin escribir ni mandar push);
     o `pruebaRecordatorios()` para correr las cuatro juntas y ver además el
     texto del push que se mandaría.
  4. `pruebaPushCorteFaltaImpacto()` / `pruebaPushCorteSinConfirmar()` /
     `pruebaPushCorteSinCerrar()` / `pruebaPushGastoFijo()` /
     `pruebaPushRendimiento()` / `pruebaPushPagoPendiente()` /
     `pruebaPushRecordatoriosVarios()` — mandan push real con datos de
     mentira a los dispositivos ya registrados, uno por subtipo y uno de
     resumen mezclado; no tocan Firestore.
- Cliente: `node --check` sobre `js/modules/notificaciones.js`. Por instrucción
  de `docs/CLAUDE.md`, no se levanta Playwright salvo pedido explícito — queda
  pendiente de confirmar visualmente en el teléfono real antes de un deploy
  oficial, como marca el flujo de despliegue de prueba (`-Tn`) del propio
  `CLAUDE.md`.
- No se hace `git commit`/`push` ni se sube el contador de caché del Service
  Worker salvo que se pida explícitamente (regla ya vigente del repo).
