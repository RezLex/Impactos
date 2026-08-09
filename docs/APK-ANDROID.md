# APK Android — plan de adaptación

> Plan acordado, sin implementar todavía. Objetivo: empaquetar IMPACTOS como app nativa de
> Android que reciba notificaciones aunque no esté abierta ni la esté sirviendo GitHub Pages en
> ese momento.

## Por qué no alcanza con la PWA actual

La app ya es una PWA instalable (`manifest.json`, `sw.js`, iconos), pero:

- Sirve los archivos estáticos desde GitHub Pages — si esa página no está disponible en el
  momento de instalar/actualizar, la PWA no arranca desde cero.
- Los datos reales (`js/firebase.js`, `js/utils/db.js`) viven en Firestore vía CDN
  (`gstatic.com/firebasejs`), así que seguirán necesitando red para sincronizar sin importar
  cómo se empaquete el front. Esto es independiente del hosting y no cambia con el APK.

## Empaquetado: Capacitor, no TWA

Se descartó una Trusted Web Activity (que solo envuelve la URL en vivo) a favor de
**Capacitor**: copia `index.html`, `js/`, `css/` e `icons/` dentro del propio APK, así la app
arranca sin depender de que GitHub Pages esté online. Ventaja adicional: no exige cambiar nada
del código actual (sigue siendo JS vanilla sin build step; Capacitor no bundlea ni transpila).

Compilación del `.apk`: este entorno tiene Java 21 y Gradle 8.14.3 pero **no** tiene el Android
SDK instalado. Camino elegido: dejar el proyecto Capacitor listo en el repo (`capacitor.config`,
carpeta `android/`) y compilar vía **GitHub Actions** (`gradlew assembleDebug` con el SDK
provisto por el runner), sin depender de instalar el SDK en este contenedor.

## Notificaciones

Dos mecanismos complementarios, ambos usando la infraestructura de Firebase ya existente
(`impactos-b4307`) sin subir de plan (ver más abajo):

### 1. Recordatorios locales

Plugin `@capacitor/local-notifications`. Al sincronizar con Firestore (vencimientos de
tarjetas, gastos fijos, eventos), la app programa notificaciones directamente en el sistema
operativo del teléfono. Disparan aunque la app esté cerrada y sin conexión en ese momento —
no dependen de ningún servidor.

### 2. Push disparado por Google Apps Script

Para avisos que deben llegar aunque el teléfono no haya sincronizado hace días (o dependan de
mirar el estado global en Firestore, no solo lo que ya bajó al dispositivo):

1. La app pide permiso de notificaciones y obtiene su token de **Firebase Cloud Messaging**
   (`@capacitor/push-notifications`).
2. El token se guarda en Firestore (p. ej. `users/{uid}/dispositivos`).
3. Un proyecto de **Google Apps Script**, vinculado al mismo proyecto de GCP que Firebase
   (`impactos-b4307`), corre con un trigger por tiempo (diario/horario). Lee Firestore vía REST
   con `ScriptApp.getOAuthToken()`, decide qué avisar, y llama a la API de FCM para empujar el
   push a los tokens guardados.

Se eligió Apps Script en vez de **Cloud Functions** específicamente para no necesitar el plan
Blaze (ver siguiente sección) — Apps Script es un producto de Google separado, con su propia
cuota gratuita de triggers y ejecuciones.

## Plan de Firebase: no hace falta subir a Blaze

Los tres componentes involucrados corren dentro del plan **Spark** (gratuito) actual:

| Componente | Plan requerido |
|---|---|
| FCM (enviar los pushes) | Gratis en cualquier plan, sin límite de mensajes |
| Lecturas/escrituras de Firestore desde Apps Script | Misma cuota gratuita de Spark que ya usa la app web (50K lecturas / 20K escrituras por día) |
| Google Apps Script | Producto de Google aparte, cuota propia, no depende del plan de Firebase |

Lo que sí exige Blaze es **Cloud Functions** (trigger automático Firestore → código de
servidor) — es justo lo que se evita usando un trigger de tiempo en Apps Script en su lugar. Si
algún día el volumen de datos superara la cuota diaria gratuita de Firestore, ahí sí tocaría
subir de plan, pero no es algo que este esquema de notificaciones dispare por sí mismo.

## División de trabajo

**De este lado (repo, lo puede hacer Claude):**

- Setup de Capacitor (`capacitor.config`, carpeta `android/`, workflow de GitHub Actions para
  compilar el APK).
- Plugin y lógica de recordatorios locales (programar/cancelar según los datos sincronizados).
- Registro del token FCM en Firestore.
- Script `.gs` para pegar en Apps Script (lectura de Firestore + envío de push vía FCM).

**Del lado del usuario (fuera del repo, necesita su cuenta de Google/Firebase):**

- En Firebase Console: agregar la app Android al proyecto `impactos-b4307` y descargar
  `google-services.json`.
- Crear el proyecto de Apps Script, vincularlo al mismo proyecto de GCP, autorizarlo y activar
  el trigger de tiempo.

## Pendiente de definir

- Reglas exactas de cada tipo de aviso (qué dispara cada notificación, con cuántos días de
  anticipación).
- Confirmar si se quiere compilar también un `.aab` firmado para Play Store, o solo un `.apk`
  de instalación directa.
