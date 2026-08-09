# Notificaciones push — plan completo

> Plan acordado, sin implementar todavía. Reemplaza el enfoque de `APK-ANDROID.md`: en vez de
> empaquetar una app nativa, se queda como PWA y se le agrega Web Push. Motivo del cambio y
> comparativa completa: ver el historial de conversación — en resumen, Web Push cubre Android y
> Windows por igual sin necesitar Capacitor/APK, y el único hueco real de la PWA (recordatorios
> programados sin servidor) deja de importar porque **todo el disparo de avisos queda del lado
> de Apps Script**, no del dispositivo.

## Punto de partida: ya existe un Apps Script en producción

`docs/app-script.gs` es el script real que ya corre hoy (no es parte de este plan, es la base
sobre la que se construye):

- Trigger por tiempo cada 15 minutos → `procesarCompras()`.
- Lee Gmail (`GmailApp`) buscando correos de compra de 4 fuentes (Santander, PayPal, Mercado
  Pago, Mi Saldo), con una query distinta por fuente.
- Parsea monto, tarjeta, fecha/hora y comercio de cada correo; deduplica por `msgId` guardado en
  `PropertiesService` (últimos 300).
- Arma un deep-link a `https://rezlex.github.io/Impactos/#/compras?...` con los datos como query
  params — eso precarga el formulario de alta rápida (`js/modules/quick-add.js`).
- Hoy ese link se manda por **correo** (`MailApp.sendEmail`), con un HTML armado a mano.

Este plan **no reemplaza ese flujo**, lo extiende: el mismo script gana acceso a Firestore y a
FCM para poder, además de mandar el correo, empujar una notificación push con el mismo link.

## Qué cambia respecto al plan anterior (APK)

| | Plan anterior (APK) | Este plan (PWA + Push) |
|---|---|---|
| Empaquetado | Capacitor, compilar `.apk` vía GitHub Actions | Ninguno — sigue siendo la PWA actual |
| Recordatorios de vencimientos | `@capacitor/local-notifications`, programados en el dispositivo | Los decide Apps Script leyendo Firestore, igual que la detección de compras |
| Alcance de plataformas | Solo Android | Android y Windows (Web Push es del navegador, no del SO) |
| Cambios en el código de la app | Ninguno (Capacitor no toca el JS) | Sí: registrar push, guardar token, manejar `push`/`notificationclick` en `sw.js` |

## Los dos flujos de notificación

### 1. Compra detectada (extiende el flujo que ya existe)

En `enviarLink()` del `.gs`, además del correo actual, se agrega un envío a FCM con el mismo
título/monto/link. Nada cambia en la detección ni en el parseo — es un segundo canal de salida
para el mismo evento.

### 2. Recordatorios de vencimientos y eventos (nuevo)

Una función nueva en el mismo proyecto de Apps Script, en un trigger de tiempo separado (diario,
no cada 15 min — no hace falta esa frecuencia para esto):

1. Lee `gastosFijos`, `tarjetas` y `eventos` desde Firestore vía REST, autenticado con
   `ScriptApp.getOAuthToken()`.
2. Decide qué avisar (vencimientos próximos, eventos del día — reglas exactas: pendiente de
   definir, ver abajo).
3. Llama a la API de FCM (`https://fcm.googleapis.com/v1/projects/impactos-b4307/messages:send`)
   para cada dispositivo registrado.

## Lo que hace falta agregar

**Del lado de Apps Script** (mismo proyecto que ya corre `app-script.gs`):

- En el manifiesto del proyecto (`appsscript.json`), sumar los scopes OAuth:
  `https://www.googleapis.com/auth/datastore` (leer Firestore) y
  `https://www.googleapis.com/auth/firebase.messaging` (mandar push). Los scopes actuales
  (Gmail, `MailApp`) quedan igual.
- Vincular el proyecto al mismo GCP project que Firebase (`impactos-b4307`) desde
  Configuración del proyecto → Proyecto de Google Cloud Platform — si no, el OAuth token no
  tiene permisos sobre ese Firestore/FCM.
- Función nueva para el envío FCM (helper reusable desde `enviarLink()` y desde el chequeo de
  vencimientos).
- Función nueva + trigger diario para el chequeo de vencimientos/eventos.
- Re-autorizar el script (Google pide consentimiento de nuevo al agregar scopes).

**Del lado de la PWA** (`sw.js`, y un módulo nuevo en `js/`):

- Pedir permiso de notificaciones al usuario (con un gesto explícito, no al cargar la app).
- Integrar el SDK de Firebase Cloud Messaging para web (`firebase-messaging`, mismo patrón de
  import por URL que ya usa `js/firebase.js`) para pedir el token con la clave VAPID.
- Guardar/actualizar ese token en Firestore, p. ej. `users/{uid}/dispositivos/{token}`.
- Agregar a `sw.js` los listeners `push` (mostrar la notificación) y `notificationclick` (abrir
  o enfocar el deep-link, mismo destino que ya arma `enviarLink()`).

**Del lado de Firebase Console** (fuera del repo, necesita la cuenta del usuario):

- Generar el par de claves VAPID: Configuración del proyecto → Cloud Messaging → Web Push
  certificates. Sin esto no se puede pedir el token desde el navegador.

## Plan de Firebase: sigue sin hacer falta Blaze

Igual que en el plan anterior — FCM es gratis en cualquier plan, las lecturas/escrituras desde
Apps Script cuentan contra la misma cuota gratuita de Firestore que ya usa la app (Spark), y
Apps Script tiene su propia cuota gratuita independiente del plan de Firebase. Lo único que
exige Blaze es Cloud Functions, que este plan no usa.

## Pendiente de definir

- Reglas exactas de los recordatorios: qué dispara cada aviso y con cuántos días de
  anticipación (vencimiento de tarjeta, gasto fijo, evento próximo).
- Si el push de "compra detectada" reemplaza al correo o conviven los dos canales.
- Texto/formato de las notificaciones push (título, cuerpo, ícono — reusar `icons/icon-192.png`).

## Nota sobre `APK-ANDROID.md`

Ese documento queda como registro de la evaluación que se descartó (Capacitor/APK). Este archivo
es el plan vigente.
