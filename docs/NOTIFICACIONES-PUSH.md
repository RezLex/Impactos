# Notificaciones push — plan completo

> Plan acordado, sin implementar todavía. Reemplaza el enfoque de `APK-ANDROID.md` (Capacitor):
> la app se queda como PWA y se le agrega Web Push. El disparo de todo aviso queda del lado de
> Apps Script (`docs/app-script.gs`, el que ya corre en producción), no del dispositivo — por
> eso alcanza con Web Push y no hace falta empaquetar nativo.

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

Función nueva, con su propio trigger de tiempo diario (no cada 15 min — no hace falta esa
frecuencia para un resumen). Recorre `notificaciones` con `tipo: 'compra'` y
`estatus: 'pendiente'`, y si hay alguna, manda **un solo correo** de recordatorio listándolas.

A diferencia del correo actual, el enlace de este correo **no** precarga un formulario con query
params — redirige directo a la sección de notificaciones de la app (`#/notificaciones`), donde
el usuario ve y procesa las pendientes. Ver "Flujo que se descarta" más abajo.

## Modelo de datos: colección `notificaciones`

```
notificaciones/{id}
  tipo:      'compra'                      // a futuro: 'recordatorio', etc. — no se implementa aún
  estatus:   'pendiente' | 'procesada' | 'descartada'
  datos:     { compra, total, fechaCompra, hora, tarjetaId, numeroTarjeta, meses, mensualidad, msgId, asunto }
  creado:    timestamp
```

`datos` son casi los mismos campos que hoy viajan en el query string del deep-link — el cambio
es dónde viven (Firestore en vez de la URL) y cómo llegan al modal (tap en la lista, no parseo
de `location.search`). Se suma `asunto` (`msg.getSubject()`), que hoy no se guarda en ningún
lado: la lista de notificaciones lo necesita para mostrarlo junto al comercio (ver abajo), así
que los 5 parsers pasan a capturarlo, no solo el de PayPal nuevo.

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
- Cada fila muestra **el comercio** (`datos.compra`, la descripción ya resuelta por el
  diccionario) **y el asunto** (`datos.asunto`, el asunto crudo del correo) — el asunto da
  contexto extra cuando el diccionario no reconoció el comercio.
- Tocar una notificación abre el **mismo modal que ya existe** para ajustar/registrar una
  compra (`_showContado`/`_showPlazos` en `js/modules/quick-add.js`), pasándole `datos`
  directamente como `prefill` — mismo mecanismo que usa hoy `msi.js` con el query string, solo
  que la fuente del `prefill` cambia.
- Al completar el registro (guardar la compra), el documento de notificación pasa a
  `estatus: procesada`.
- Cada fila tiene una `X` para marcarla `descartada` sin registrar nada — deja de aparecer entre
  las pendientes.

## Flujo que se descarta

El pre-registro por query string en `#/compras?desc=...&total=...` (`_prefillDesdeQuery` en
`msi.js`, alimentado hoy por el link del correo) **se elimina**. Dejar de mandar ese tipo de
enlace desde Apps Script (Trigger A ya no manda correo individual) lo vuelve código muerto; se
saca junto con la limpieza de `msi.js`. El modal de `quick-add.js` en sí **no cambia** — sigue
recibiendo un `prefill`, solo que ahora entra desde la sección de notificaciones en vez de la URL.

## Modal de compra de contado: "Acumular compra" (nuevo)

Solo aplica a `_showContado` (de contado, no a plazos). Se agrega un toggle "Acumular compra":

- Al activarlo, aparece un `<select>` con dos grupos, visualmente distinguibles (dos
  `<optgroup>`, mismo patrón que ya usa `_buildCardOptions` para separar favoritas/instituciones):
  - **Notificaciones pendientes** de esa tarjeta (`notificaciones`, `tipo: compra`,
    `estatus: pendiente`, filtradas por `tarjetaId`).
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
  ya tiene (Gmail, `MailApp`). Requiere vincular el proyecto al GCP de `impactos-b4307` y
  volver a autorizar.
- **Del lado de la PWA** sigue faltando: pedir permiso de notificaciones, integrar el SDK de
  FCM para web, guardar el token en Firestore (`users/{uid}/dispositivos`), y agregar los
  listeners `push`/`notificationclick` a `sw.js`.
- **Del lado de Firebase Console** (fuera del repo): generar el par de claves VAPID en Cloud
  Messaging → Web Push certificates.

## Pendiente de definir

- Reglas de recordatorios de vencimientos/eventos (tipo `recordatorio`) — no entran en este
  alcance, quedan para después de tener el tipo `compra` funcionando.
- Texto/formato exacto de los pushes (título, cuerpo, ícono — reusar `icons/icon-192.png`).

## Nota sobre `APK-ANDROID.md`

Ese documento queda como registro de la evaluación que se descartó (Capacitor/APK). Este archivo
es el plan vigente.
