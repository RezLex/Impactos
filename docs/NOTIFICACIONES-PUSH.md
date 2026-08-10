# Notificaciones push — plan completo

> Reemplaza el enfoque de `APK-ANDROID.md` (Capacitor): la app se queda como PWA y se le agrega
> Web Push. El disparo de todo aviso queda del lado de Apps Script (`docs/app-script.gs`, el que
> ya corre en producción), no del dispositivo — por eso alcanza con Web Push y no hace falta
> empaquetar nativo.
>
> **Estado:** se implementa en fases. Fase 1 (Apps Script → Firestore) escrita en
> `docs/app-script.gs`, pendiente de desplegar. Fases 2 (sección en la app), 3 (Web Push) y
> 4 (acumular compra), sin empezar.

## Arranque: dos triggers en vez de uno

Hoy `docs/app-script.gs` tiene un solo trigger, `procesarCompras()`, cada 15 minutos, que
detecta compras por correo y manda un email con el deep-link de precarga. Se separa en dos:

### Trigger A — cada 15 min, sin cambios de frecuencia

Sigue siendo `procesarCompras()`. Cambia lo que hace al detectar una compra nueva:

1. Escribe un documento en una colección nueva de Firestore, `notificaciones` (ver modelo de
   datos abajo), con estatus `pendiente`.
2. Manda un **push** vía FCM a los dispositivos registrados del usuario (título/monto/comercio,
   con el `id` del documento de notificación).
3. **Ya no manda el correo individual por compra** — ese correo queda reemplazado por el push.
   El único correo que sigue existiendo es el de "correos sin parsear" (fallos), que no cambia.

### Trigger B — una vez al día, a una hora fija (nuevo)

`resumenPendientes()`, con su propio trigger de tiempo diario (no cada 15 min — no hace falta esa
frecuencia para un resumen). Hace dos cosas con una sola lectura de la colección:

1. Recorre `notificaciones` con `tipo: 'compra'` y `estatus: 'pendiente'`, y si hay alguna, manda
   **un solo correo** de recordatorio listándolas.
2. **Limpieza:** borra las que ya están `procesada`/`descartada` y llevan más de `RETENCION_DIAS`
   (30) desde `creado`. Las pendientes nunca se borran solas. Nada más "verifica" estatus en
   background: el cambio de `pendiente` a `procesada`/`descartada` lo escribe la app en el momento
   en que se registra o se descarta la compra.

A diferencia del correo actual, el enlace de este correo **no** precarga un formulario con query
params — redirige directo a la sección de notificaciones de la app (`#/notificaciones`), donde
el usuario ve y procesa las pendientes.

## Modelo de datos: colección `notificaciones`

```
users/{uid}/notificaciones/{id}
  tipo:      'compra'                      // a futuro: 'recordatorio', etc. — no se implementa aún
  estatus:   'pendiente' | 'procesada' | 'descartada'
  datos:     { desc, total, fecha, hora, tarjeta, meses?, mensualidad?, msgId, asunto, match }
  creado:    timestamp
```

`datos` usa **los mismos nombres de campo que hoy viajan en el query string del deep-link**; el
cambio es dónde viven (Firestore en vez de la URL) y cómo llegan al modal (tap en la lista, no
parseo de `location.search`). Conservar los nombres es deliberado: la conversión de esa forma al
`prefill` del modal ya existe y está probada (`_prefillDesdeQuery` en `msi.js`), y se reutiliza
tal cual en vez de escribir una segunda traducción.

Por lo mismo se guarda **`tarjeta`, la terminación de 4 dígitos** (o `'NA'`), no `tarjetaId`: el
mapeo terminación → tarjeta lo hace la app con `_matchTarjetaPorTerminacion` sobre las tarjetas
que ya tiene cargadas. Resolverlo en el script obligaría a leer `users/{uid}/tarjetas` desde Apps
Script y dejaría el documento apuntando a un id que después se puede editar o borrar.

Se suma `asunto` (`msg.getSubject()`), que hoy no se guarda en ningún lado: la lista de
notificaciones lo muestra junto al comercio (ver abajo). No hace falta tocar los 5 parsers para
eso — se captura una sola vez en `procesarCompras`, junto a `msgId`, que ya es donde se rellenan
los campos comunes a todas las fuentes.

## Nueva fuente de correo: PayPal "Autorizó un pago"

Además de las 4 fuentes actuales, el Apps Script debe procesar los correos de
`service@paypal.com.mx` con asunto que empieza con **"Autorizó un pago"** — son de autorización
de pago (no el recibo final que ya cubre `parsePaypal`). Reviso varios reales en la bandeja para
sacar el patrón:

- Asunto: `Autorizó un pago para {comercio}` — el comercio sale limpio del propio asunto, igual
  que ya hace `parseMercadoPago` con el suyo.
- Cuerpo: `Ha autorizado un pago de $195.70 MXN a UBR PAGOS MEXICO` (a veces con `€`/otra
  moneda). Mismo patrón de monto que los parsers existentes.
- Tarjeta: aparece en la sección "Formas de pago utilizadas", formato `Visa-2167` — coincide con
  la regex que ya usa `parsePaypal` para tarjeta, se puede reusar tal cual.
- Fecha: viene como `8 ago 2026` (texto, no `DD/MM/YYYY`) — más simple dejarla en blanco y que
  `procesarCompras` la rellene con `msg.getDate()`, igual que ya hacen `parsePaypal`,
  `parseMercadoPago` y `parseMiSaldo`.

Va al mismo pipeline que las otras 4 fuentes: crea su documento en `notificaciones` con
`tipo: 'compra'` igual que cualquier detección — sin lógica especial de deduplicación contra
"Recibo de su pago". Si un mismo pago genera las dos notificaciones, el usuario descarta la que
sobre desde la sección de notificaciones (la `X`); no se filtra en el script.

## Sección "Notificaciones" en la app (nueva)

Nuevo módulo (p. ej. `js/modules/notificaciones.js`), ruta `#/notificaciones`:

- Por default muestra las de `estatus: pendiente` y `tipo: compra` (a futuro habrá más tipos,
  como recordatorios de vencimiento, pero esos no se implementan todavía — el filtro por
  defecto ya queda pensado para convivir con ellos).
- Cada fila muestra **el comercio** (`datos.desc`, la descripción ya resuelta por el
  diccionario) **y el asunto** (`datos.asunto`, el asunto crudo del correo) — el asunto da
  contexto extra cuando el diccionario no reconoció el comercio (`datos.match === false`).
- Tocar una notificación abre el **mismo modal que ya existe** para ajustar/registrar una
  compra (`_showContado`/`_showPlazos` en `js/modules/quick-add.js`), pasándole `datos`
  directamente como `prefill` — mismo mecanismo que usa hoy `msi.js` con el query string, solo
  que la fuente del `prefill` cambia.
- Al completar el registro (guardar la compra), el documento de notificación pasa a
  `estatus: procesada`.
- Cada fila tiene una `X` para marcarla `descartada` sin registrar nada — deja de aparecer entre
  las pendientes.

## Flujo anterior: se queda como fallback

El pre-registro por query string en `#/compras?desc=...&total=...` (`_prefillDesdeQuery` en
`msi.js`) **no se elimina**. Apps Script deja de mandar ese tipo de enlace, pero el camino sigue
vivo: los correos viejos que queden en la bandeja siguen funcionando, y queda disponible por si
alguna vez conviene volver a mandar un enlace precargado.

Lo que sí cambia es dónde vive la lógica: `_prefillDesdeQuery` y `_matchTarjetaPorTerminacion` se
mueven a `js/utils/prefill-compra.js` como `prefillDesdeDatos(datos, ...)`, operando sobre un
objeto plano. `_prefillDesdeQuery` queda como envoltorio de una línea
(`prefillDesdeDatos(Object.fromEntries(query), ...)`) y la sección de notificaciones llama a la
misma función con los `datos` del documento — una sola traducción, no dos que puedan desalinearse.

El modal de `quick-add.js` en sí **no cambia**: sigue recibiendo un `prefill`, solo que ahora
suele entrar desde la sección de notificaciones en vez de la URL.

## Modal de compra de contado: "Acumular compra" (nuevo)

Solo aplica a `_showContado` (de contado, no a plazos). Se agrega un toggle "Acumular compra":

- Al activarlo, aparece un `<select>` con dos grupos, visualmente distinguibles (dos
  `<optgroup>`, mismo patrón que ya usa `_buildCardOptions` para separar favoritas/instituciones):
  - **Notificaciones pendientes** de esa tarjeta (`notificaciones`, `tipo: compra`,
    `estatus: pendiente`). El filtro se resuelve en JS pasando `datos.tarjeta` (terminación) por
    `matchTarjetaPorTerminacion`, porque la notificación no guarda `tarjetaId`. Si el modal se
    abrió *desde* una notificación, esa se excluye de su propia lista.
  - **Compras registradas**: las últimas 5 compras de contado de esa tarjeta (mismo patrón de
    `recentWhere`/`getAll('contado')` que ya usa el módulo, filtrando por `tarjetaId` y
    ordenando por fecha descendente, límite 5).
- Al elegir una opción y guardar: el total de la compra nueva = total del form + total de la
  opción elegida para acumular. Esto es igual sin importar de qué grupo venga la opción.
- Al completar el registro, lo que pasa con la opción elegida depende de qué era:
  - Si era una **compra ya registrada**: se **elimina** (su monto ya quedó absorbido en la
    nueva) — comportamiento sin cambios respecto al planteo original.
  - Si era una **notificación pendiente**: no hay nada que borrar (nunca llegó a ser una
    compra registrada) — pasa a `estatus: procesada`, igual que si se hubiera tocado desde la
    sección de notificaciones.

## Lo que sigue igual del plan anterior

- **Firebase se queda en el plan Spark** — FCM es gratis en cualquier plan, las
  lecturas/escrituras de Apps Script cuentan contra la misma cuota gratuita de Firestore que ya
  usa la app, y Apps Script tiene su propia cuota independiente. Nada de esto necesita Blaze.
- **Scopes nuevos en el Apps Script existente**: `https://www.googleapis.com/auth/datastore`
  (Firestore) y `https://www.googleapis.com/auth/firebase.messaging` (FCM), sumados a los que
  ya tiene (Gmail, `MailApp`), y volver a autorizar. `impactos-b4307` es a la vez el proyecto de
  Firebase y el de Google Cloud (Firebase corre sobre GCP: mismo id, mismo IAM, mismas APIs), así
  que basta con que la cuenta que autoriza el script tenga acceso a él; si se prefiere vincular el
  script a ese proyecto de GCP en vez de al que crea Apps Script, el número que pide es
  `1087836294078` — el mismo `messagingSenderId` de `js/firebase.js`.
  Además, una propiedad de script `UID` con el UID del dueño de los datos
  (el mismo de `_config/owner`): la ruta de la colección es `users/{uid}/notificaciones` y Apps
  Script no tiene sesión de Firebase Auth de donde deducirlo.
- **Del lado de la PWA** sigue faltando: pedir permiso de notificaciones, integrar el SDK de
  FCM para web, guardar el token en Firestore (`users/{uid}/dispositivos`), y agregar los
  listeners `push`/`notificationclick` a `sw.js`.
- **Del lado de Firebase Console** (fuera del repo): generar el par de claves VAPID en Cloud
  Messaging → Web Push certificates.

## Texto de los pushes

Mensajes **data-only** (sin bloque `notification`), para que el `push` de `sw.js` controle el
`showNotification` y el navegador no muestre además una copia propia:

- Título: `$1,234.56 — Amazon`, más ` (6 MSI)` cuando la compra trae meses.
- Cuerpo: `···2167 · toca para registrar`, o el asunto crudo del correo cuando
  `match === false` (ahí el comercio no dice nada útil).
- Ícono: `icons/icon-192.png`. `tag` = id del documento de notificación, para que un reintento no
  apile copias de la misma compra.

## Pendiente de definir

- Reglas de recordatorios de vencimientos/eventos (tipo `recordatorio`) — no entran en este
  alcance, quedan para después de tener el tipo `compra` funcionando.

## Nota sobre `APK-ANDROID.md`

Ese documento queda como registro de la evaluación que se descartó (Capacitor/APK). Este archivo
es el plan vigente.
