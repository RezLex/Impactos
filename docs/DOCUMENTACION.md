# IMPACTOS — Documentación del Proyecto

> Aplicación web personal para la gestión de finanzas bancarias: tarjetas de crédito/débito, compras a meses sin intereses, gastos fijos, impacto mensual y planeación de eventos de ofertas.

---

## Tabla de Contenidos

1. [Descripción General](#descripción-general)
2. [Stack Tecnológico](#stack-tecnológico)
3. [Estructura de Archivos](#estructura-de-archivos)
4. [Configuración Firebase](#configuración-firebase)
5. [Seguridad y Acceso](#seguridad-y-acceso)
6. [Modelo de Datos — Firestore](#modelo-de-datos--firestore)
7. [Módulos de la Aplicación](#módulos-de-la-aplicación)
8. [Navegación y Routing](#navegación-y-routing)
9. [Pre-registro de Compra vía URL](#pre-registro-de-compra-vía-url)
10. [Ciclo de Facturación](#ciclo-de-facturación)
11. [Cálculo de Saldo Disponible](#cálculo-de-saldo-disponible)
12. [Cálculo de Impacto Mensual](#cálculo-de-impacto-mensual)
13. [Cálculo de Rendimientos](#cálculo-de-rendimientos)
14. [Cálculo de Nómina](#cálculo-de-nómina)
15. [Tema Claro / Oscuro](#tema-claro--oscuro)
16. [Ejecución Local](#ejecución-local)
17. [Entorno de Pruebas (Modo Pruebas)](#entorno-de-pruebas-modo-pruebas)
18. [Despliegue en GitHub Pages](#despliegue-en-github-pages)
19. [Instituciones Bancarias Soportadas](#instituciones-bancarias-soportadas)

---

## Descripción General

IMPACTOS es una Single Page Application (SPA) que reemplaza un archivo Excel de gestión financiera personal. Permite administrar:

- Cuentas y tarjetas bancarias de múltiples instituciones
- Compras a Meses Sin Intereses (MSI) con seguimiento de progreso y cálculo automático de fechas de pago
- Gastos fijos mensuales recurrentes
- Estado mensual de todas las tarjetas (impacto)
- Planeación y comparación de compras en eventos de ofertas (Hot Sale, Buen Fin, etc.)
- Catálogo de días festivos oficiales de México
- Compras detectadas automáticamente en el correo, listas para registrar de un toque
  (ver [Notificaciones](#notificaciones-notificaciones))

**Características principales:**
- Interfaz responsiva: sidebar en desktop, bottom navigation en móvil; en móvil las tarjetas se muestran en stack con efecto de superposición
- Autenticación exclusiva con Google (usuario único)
- Datos almacenados en Firebase Firestore (en la nube, accesibles desde cualquier dispositivo)
- Sin build step — se sirve directamente como archivos estáticos desde GitHub Pages
- Instalable como PWA (Progressive Web App) en Android, iOS y desktop; funciona offline con Service Worker
- Versión de la app visible en el footer del sidebar (`v1.9.3-T10`)
- Tema claro/oscuro con tres estados (Sistema · Claro · Oscuro), conmutable desde el sidebar

---

## Stack Tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Estructura | HTML5 | — |
| Estilos | CSS3 + Bootstrap | 5.3.2 |
| Iconos | Bootstrap Icons | 1.11.3 |
| Lógica | JavaScript ES6+ (Vanilla, sin framework) | — |
| Base de datos | Firebase Firestore | 11.8.1 |
| Autenticación | Firebase Auth (Google Sign-In) | 11.8.1 |
| Exportación Excel | SheetJS (XLSX) | 0.18.5 |
| Gráficas | Chart.js | 4.4.0 |
| Hosting | GitHub Pages | — |

---

## Estructura de Archivos

```
impactos/
├── index.html                  # Shell de la SPA — layout completo
├── manifest.json               # Web App Manifest para PWA
├── sw.js                       # Service Worker — caché de assets + estrategia network-first
├── DOCUMENTACION.md            # Este archivo
│
├── icons/
│   ├── icon-192.png            # Ícono PWA 192×192 (banco estilizado, maskable)
│   ├── icon-512.png            # Ícono PWA 512×512 (maskable)
│   ├── favicon-32.png          # Pestaña del navegador — a sangre, sin el margen del maskable
│   ├── favicon-16.png          # Ídem, para pantallas sin escalado
│   └── badge-96.png            # Silueta monocroma para el `badge` de las notificaciones push
│
├── css/
│   └── app.css                 # Todos los estilos (variables, layout, componentes)
│
└── js/
    ├── app.js                  # Punto de entrada — auth, nav, router bootstrap, SW registration
    ├── auth.js                 # Google Sign-In + verificación de acceso por UID
    ├── firebase.js             # Inicialización Firebase (config + exports app/db/auth)
    ├── push.js                 # Web Push: permiso, token FCM y mensajes en primer plano
    ├── router.js               # Hash router con lazy loading de módulos
    │
    ├── modules/
    │   ├── dashboard.js        # Vista principal — métricas, impacto del mes, últimas compras, gastos
    │   ├── tarjetas.js         # Vista de tarjetas en formato wallet (flip cards)
    │   ├── admin-tarjetas.js   # CRUD de instituciones y tarjetas
    │   ├── msi.js              # Módulo "Compras y Gastos": De Contado + A Plazos + Gastos
    │   ├── notificaciones.js   # Compras detectadas en el correo, pendientes de registrar
    │   ├── fijos.js            # CRUD de gastos fijos mensuales
    │   ├── impacto.js          # Impacto mensual rediseñado — confirmación, pago, cierre
    │   ├── rendimientos.js     # Cuentas de inversión y cálculo de rendimientos compuestos
    │   ├── eventos.js          # Lista de eventos de ofertas
    │   ├── evento-detalle.js   # Detalle de evento: planeación, realizadas, promos
    │   ├── festivos.js         # CRUD de días festivos oficiales MX
    │   ├── ajustes.js         # Ajustes: notificaciones, tema, exportación y mantenimiento
    │   └── quick-add.js        # Registro rápido de compras y gastos (FAB)
    │
    └── utils/
        ├── acumular.js         # Qué se le puede acumular a una compra de contado
        ├── db.js               # CRUD genérico para Firestore
        ├── formatters.js       # Formateo de moneda, fechas, seriales Excel, etc.
        ├── ciclo.js            # Cálculo de ciclos de facturación y nómina
        ├── saldo.js            # Cálculo de saldo disponible/usado con ajuste por compras
        ├── impacto-calc.js     # Cálculos del Impacto mensual (filtrado, estimados, proyección)
        ├── prefill-compra.js   # Compra detectada → precarga del modal (notificaciones y URL)
        ├── rendimiento.js      # Motor de rendimientos compuestos con tramos progresivos
        └── ui.js               # Toast, modals, confirmaciones reutilizables
```

> `test/` (entorno de pruebas + suite del motor de cálculo) y `package.json`, `_config.yml`,
> `.gitignore` en la raíz se commitean con la app pero quedan fuera del sitio publicado en Pages —
> ver [Entorno de Pruebas (Modo Pruebas)](#entorno-de-pruebas-modo-pruebas).

---

## Configuración Firebase

La configuración del proyecto Firebase se encuentra en `js/firebase.js`:

```javascript
const firebaseConfig = {
  apiKey:            "...",
  authDomain:        "impactos-b4307.firebaseapp.com",
  projectId:         "impactos-b4307",
  storageBucket:     "impactos-b4307.firebasestorage.app",
  messagingSenderId: "...",
  appId:             "..."
};
```

**Servicios utilizados:**
- **Authentication** — proveedor Google habilitado
- **Firestore Database** — modo producción, región `nam5`

**Dominios autorizados en Firebase Auth:**
- `localhost` — para desarrollo local
- `127.0.0.1` — para Live Server de VS Code
- `TU_USUARIO.github.io` — para producción en GitHub Pages

---

## Seguridad y Acceso

### Autenticación
La app usa Google Sign-In. Solo una cuenta está autorizada. El control se realiza en dos capas:

**Capa 1 — Código (`auth.js`):**
Al iniciar sesión, se lee el documento `_config/owner` en Firestore. Si el UID del usuario logueado no coincide con el UID almacenado, se ejecuta `signOut()` inmediatamente y se muestra un mensaje de acceso denegado.

**Capa 2 — Reglas de Firestore:**
Aunque alguien logre evadir la capa de código, las reglas de Firestore impiden cualquier lectura o escritura de datos que no pertenezcan al UID autorizado.

### Configuración del documento de acceso

El documento `_config/owner` en Firestore debe crearse manualmente en Firebase Console:

```
Colección: _config
Documento: owner
Campo:     uid  (string)  →  [UID del usuario autorizado]
```

### Reglas de Firestore

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Configuración del sistema — solo lectura para usuarios autenticados
    match /_config/{document} {
      allow read: if request.auth != null;
      allow write: if false;
    }

    // Datos de usuario — solo el propietario puede leer y escribir
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

> **Nota:** Los usuarios que intentan ingresar con cuentas no autorizadas quedan registrados en Firebase Authentication pero no pueden acceder a ningún dato. Se pueden eliminar manualmente desde Firebase Console → Authentication → Usuarios.

---

## Modelo de Datos — Firestore

Todos los datos del usuario se almacenan bajo la ruta `users/{uid}/`, lo que garantiza aislamiento por usuario.

> **Fechas con hora**: `fechaCompra` (contado/msi), `fechaPago` (gastos) y `fechaActualizacionSaldo` se almacenan con hora exacta del momento del registro (`YYYY-MM-DDTHH:MM:SS` o ISO UTC completo). Esto permite comparaciones precisas en el mismo día para el cálculo de saldo disponible. Las fechas que corresponden al día actual usan la hora exacta en ese momento; las fechas de otros días usan mediodía (`T12:00:00`) como hora neutra.

### `instituciones/{id}`

| Campo | Tipo | Descripción |
|---|---|---|
| `nombre` | string | Nombre de la institución (ej. Banamex) |
| `numeroCliente` | string? | Número de cliente en la institución |
| `color` | string | Color hex para la UI (ej. `#e31837`) |
| `bonificacionConIva` | boolean? | Si la institución aplica IVA (16%) sobre los montos de bonificación/cashback |

### `tarjetas/{id}`

**Campos comunes:**

| Campo | Tipo | Descripción |
|---|---|---|
| `institucionId` | string | ID de la institución padre |
| `nombre` | string | Alias de la tarjeta (ej. Clásica, Oro) |
| `tipo` | string | `credito`, `debito` o `prestamo` |
| `clabe` | string? | CLABE interbancaria (18 dígitos) |
| `numeros` | array | Números de tarjeta (ver estructura abajo) |
| `favorita` | boolean? | Si está marcada como favorita para aparecer primero en los selects |
| `oculta` | boolean? | Si está oculta — no aparece en `/tarjetas` ni en ningún selector. Una tarjeta favorita no puede ocultarse y una oculta no puede marcarse como favorita |

**Campos de `credito` y `prestamo`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `limiteTotal` | number? | Límite de crédito o monto del préstamo |
| `ciclo` | object? | Configuración del ciclo de facturación (ver sección [Ciclo de Facturación](#ciclo-de-facturación)) |
| `saldoDisponible` | number? | Saldo disponible en el momento de la última actualización manual |
| `fechaActualizacionSaldo` | string? | Datetime ISO de la última actualización de saldo (`YYYY-MM-DDTHH:MM:SS.mmmZ`) |

> `saldoDisponible` es el dato base guardado manualmente. El saldo real se obtiene restando las compras y gastos registrados con `fechaCompra`/`fechaPago` posterior a `fechaActualizacionSaldo` (ver [Cálculo de Saldo Disponible](#cálculo-de-saldo-disponible)).

**Campos exclusivos de `prestamo`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `numeroPago` | string? | Referencia/número de pago |

**Estructura de cada elemento en `numeros`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `formato` | string | `fisica` o `digital` |
| `numero` | string? | Número completo de la tarjeta |
| `fechaVencimiento` | string? | Vencimiento en formato `MM/AA` |

### `contado/{id}`
Compras de contado (sin meses) con cualquier tipo de tarjeta.

| Campo | Tipo | Descripción |
|---|---|---|
| `tarjetaId` | string | ID de la tarjeta usada |
| `numeroTarjeta` | string | Número específico de tarjeta usado (física o digital) |
| `compra` | string | Descripción de la compra |
| `fechaCompra` | string | Datetime ISO de la compra (`YYYY-MM-DDTHH:MM:SS`) |
| `total` | number | Monto total de la compra |
| `enlaceCompra` | string? | URL al comprobante o página de la compra |
| `bonificacion` | object? | Bonificación/cashback esperado (ver estructura abajo) |

**Estructura de `bonificacion` (contado y msi):**

| Campo | Tipo | Descripción |
|---|---|---|
| `tipo` | string | `porcentaje` o `cantidad` |
| `valor` | number | Porcentaje (ej. 10) o monto fijo |
| `fechaMaxima` | string | Fecha límite para recibir la bonificación (`YYYY-MM-DD`) |
| `enlace` | string? | URL de la promoción |
| `aplicada` | boolean? | `true` cuando la bonificación ya fue recibida |

> El monto real de la bonificación se calcula dinámicamente: si `tipo = 'porcentaje'`, es `total × valor/100`; si la institución tiene `bonificacionConIva = true`, se multiplica por 1.16. En la tabla se muestra el total neto (tachado el original), el monto de bonificación y la fecha límite con código de color: 🟡 pendiente, 🔴 vencida, 🟢 aplicada.

> La **fecha de pago** no se almacena — para tarjetas de crédito se calcula dinámicamente a partir del ciclo configurado en la tarjeta.

### `gastos/{id}`
Gastos registrados por mes. Incluye dos orígenes: gastos fijos confirmados (tarjetas de crédito) y entradas manuales de retiro/transferencia (tarjetas de débito).

| Campo | Tipo | Descripción |
|---|---|---|
| `tipo` | string | `gastaFijo` (confirmado desde Gastos Fijos) o `manual` (entrada directa) |
| `estado` | string | `pendiente` · `registrado` · `descartado` |
| `mes` | string | Mes al que pertenece el gasto (`YYYY-MM`) |
| `nombre` | string | Descripción del gasto |
| `tarjetaId` | string | ID de la tarjeta usada |
| `numeroTarjeta` | string? | Número específico de tarjeta (física o digital) |
| `formaPago` | string | `automatico`, `retiro` o `transferencia` |
| `fechaPago` | string | Datetime ISO del gasto ("Fecha Gasto", `YYYY-MM-DDTHH:MM:SS`) |
| `importe` | number | Monto del gasto |
| `gastaFijoId` | string? | ID del gasto fijo origen (solo cuando `tipo = 'gastaFijo'`) |

**Ciclo de vida de un gasto fijo:**
1. Al abrir el módulo, los gastos fijos cuya fecha calculada ≤ hoy y sin registro en `gastos` para ese mes se crean con `estado: 'pendiente'`
2. Al confirmar → `estado: 'registrado'` (el usuario puede ajustar nombre, forma de pago, fecha e importe)
3. Al descartar → `estado: 'descartado'` (no se muestra ni se recrea)
4. Entradas manuales se crean directamente con `estado: 'registrado'`

### `msi/{id}`
Compras a plazos (meses sin intereses). Las fechas de primer y último pago **no se almacenan** — se calculan dinámicamente a partir del ciclo de la tarjeta y la fecha de compra.

| Campo | Tipo | Descripción |
|---|---|---|
| `tarjetaId` | string | ID de la tarjeta de crédito usada |
| `numeroTarjeta` | string | Número específico de tarjeta usado (física o digital) |
| `compra` | string | Descripción de la compra |
| `fechaCompra` | string | Datetime ISO de la compra (`YYYY-MM-DDTHH:MM:SS`) |
| `total` | number | Monto total de la compra |
| `mensualidad` | number | Monto mensual a pagar |
| `mesesTotal` | number | Total de meses del plan |
| `mesesPagados` | number | Meses ya pagados |
| `restante` | number? | Monto pendiente; si no está en BD se calcula como `total - mensualidad × mesesPagados` |
| `enlaceCompra` | string? | URL al comprobante o página de la compra |
| `bonificacion` | object? | Bonificación/cashback esperado (misma estructura que `contado`) |
| `liquidado` | boolean? | `true` cuando la compra está completamente saldada |
| `fechaLiquidacion` | string? | Fecha ISO en que se marcó como liquidada (`YYYY-MM-DD`) |

### `notificaciones/{id}`

Bandeja de avisos accionables: compras que el Apps Script detectó en el correo, más los tres
recordatorios que agrega `docs/app-script-recordatorios.gs` (corte de tarjeta, gasto fijo por
confirmar, cierre de mes). Es la **única colección que escribe algo distinto de la app**: la
crean `procesarCompras()` y `procesarRecordatorios()` (ver `docs/app-script.gs`,
`docs/app-script-recordatorios.gs`, `docs/NOTIFICACIONES-PUSH.md` y
`docs/RECORDATORIOS-PUSH.md`); la app solo la lee y le cambia el `estatus`.

| Campo | Tipo | Descripción |
|---|---|---|
| `tipo` | string | `compra` \| `corte` \| `gastoFijo` \| `rendimiento` |
| `estatus` | string | `pendiente`, `procesada` o `descartada` |
| `datos` | object | El detalle del aviso — forma distinta por `tipo` (ver abajo) |
| `creado` | string | Timestamp ISO del momento en que se creó el documento |

El documento de un recordatorio de corte usa como **id** su propia clave natural en vez de un id
autogenerado (`faltaImpacto-{mes}`, `sinConfirmar-{tarjetaId}-{mes}`, `sinCerrar-{mes}`) — así
la corrida diaria hace *upsert* sobre el mismo doc en vez de acumular uno nuevo por aviso. Mientras
ese doc siga `pendiente`, la corrida diaria no manda otro aviso aunque la condición siga vigente
(no hay reintento por tiempo); en cuanto el usuario lo descarta o se marca `procesada` sin que la
condición de fondo se haya resuelto, la siguiente corrida vuelve a crear uno. Los de `gastoFijo` y
`rendimiento` no se repiten nunca (eventos puntuales), pero también usan clave natural como id para
no duplicarse entre corridas: `gastoFijo-{gastaFijoId}-{mes}` y `rendimiento-{mes}`.

**Estructura de `datos` en `tipo: compra`** — son los mismos nombres de campo que viajaban en el
query string del [pre-registro por URL](#pre-registro-de-compra-vía-url), a propósito: las dos
entradas comparten la traducción de `js/utils/prefill-compra.js`.

| Campo | Tipo | Descripción |
|---|---|---|
| `desc` | string | Comercio ya resuelto por el diccionario del script, o el nombre crudo si no hubo match |
| `total` | number | Importe cargado |
| `fecha` | string | `YYYY-MM-DD`; si el correo no la trae, la del correo |
| `hora` | string | `HH:mm` |
| `tarjeta` | string | **Terminación** de 4 dígitos, o `NA` si el correo no la revela. No es un `tarjetaId`: el mapeo lo hace la app con `matchTarjetaPorTerminacion` |
| `meses` | number? | Solo en compras a plazos — su presencia es lo que decide el tipo |
| `mensualidad` | number? | Solo en compras a plazos; manda sobre `total / meses` |
| `msgId` | string | Id del mensaje de Gmail — sirve para detectar que la compra ya se registró |
| `asunto` | string | Asunto crudo del correo, el contexto que salva la fila cuando no hubo match |
| `match` | boolean | Si el diccionario reconoció el comercio |

**Estructura de `datos` en `tipo: corte`** — discriminada por `datos.subtipo`:

| Campo | Tipo | Descripción |
|---|---|---|
| `subtipo` | string | `faltaImpacto` \| `sinConfirmar` \| `sinCerrar` |
| `mes` | string | `YYYY-MM` del impacto afectado |
| `tarjetaId` | string? | Solo en `sinConfirmar` |
| `nombre` | string? | Solo en `sinConfirmar` — alias de la tarjeta |
| `fechaCorte` | string? | Solo en `sinConfirmar` |
| `monto` | number? | Solo en `sinConfirmar` — `montoAPagar` confirmado, o `estimadoTotal` si aún no |

**Estructura de `datos` en `tipo: gastoFijo`:** `{ gastaFijoId, nombre, importe, fechaPago }`.

**Estructura de `datos` en `tipo: rendimiento`:** `{ mes }`.

El `estatus` no lo revisa ningún proceso en segundo plano: lo escribe la app al registrar o descartar. El trigger diario del script sí borra las `procesada`/`descartada` con más de 30 días.

### `dispositivos/{token}`

Dispositivos suscritos a Web Push. **El id del documento es el token de FCM**, así que reabrir la app reescribe el mismo registro en vez de acumular uno por sesión. Los escribe `js/push.js`; los lee el Apps Script para saber a dónde enviar, y los borra cuando FCM responde que el token ya no existe.

| Campo | Tipo | Descripción |
|---|---|---|
| `ua` | string | `navigator.userAgent` — para reconocer de qué dispositivo es |
| `visto` | string | Timestamp ISO del último inicio de sesión que refrescó el token |

### `gastosFijos/{id}`

| Campo | Tipo | Descripción |
|---|---|---|
| `nombre` | string | Nombre del gasto (ej. Netflix) |
| `tarjetaId` | string? | ID de la tarjeta de cobro |
| `numeroTarjeta` | string? | Número específico de tarjeta (física o digital) |
| `diaCobro` | string? | Texto libre de referencia (ej. `8`, `1ra Quincena`) |
| `importe` | number | Monto mensual |
| `fechaInicio` | string? | Fecha ISO de inicio para cobros por intervalo (`YYYY-MM-DD`) |
| `diasIntervalo` | number? | Días entre cobros (ej. `30`). Requiere `fechaInicio` |
| `semanaDelMes` | number? | Semana del mes: `1`, `2`, `3`, `4` o `-1` (última) |
| `diaSemana` | number? | Día de la semana: `1`=Lunes … `7`=Domingo. Requiere `semanaDelMes` |
| `formaPago` | string? | `automatico`, `retiro` o `transferencia` |

> **Configuraciones de cobro recurrente** (mutuamente excluyentes por registro):
> - **Intervalo fijo:** `fechaInicio` + `diasIntervalo` — ej. cada 30 días desde el 20/12/2024
> - **Día de semana del mes:** `semanaDelMes` + `diaSemana` — ej. 1er Martes de cada mes

### `festivosMX/{id}`
Días festivos oficiales de México usados para ajustar fechas de corte y pago a días hábiles.

| Campo | Tipo | Descripción |
|---|---|---|
| `fecha` | string | Fecha ISO del festivo (`YYYY-MM-DD`) |
| `nombre` | string | Nombre del festivo (ej. Día de la Independencia) |

### `config/general` *(configuración de usuario)*
Documento único con preferencias globales.

| Campo | Tipo | Descripción |
|---|---|---|
| `nominaAprox` | number? | Nómina de referencia para calcular el Restante Esperado en cada Impacto |

### `impacto/{YYYY-MM}`
Impacto mensual. El ID del documento es el mes en formato `YYYY-MM`. Reemplaza a la colección `impactoMensual` anterior.

| Campo | Tipo | Descripción |
|---|---|---|
| `mes` | string | Mes del impacto (`YYYY-MM`) |
| `estado` | string | `activo` · `cerrado` |
| `presupuesto` | number | Ingresos reales del mes (editable mientras activo) |
| `nominaRef` | number | Snapshot de `nominaAprox` al crear el impacto |
| `fechaCierre` | string? | Fecha ISO de cierre |
| `tarjetas` | array | Un registro por cada tarjeta de crédito/préstamo visible (no oculta) |
| `gastosDebito` | array | Snapshot de gastos débito guardado al cerrar |
| `totales` | object | Resúmenes calculados (ver abajo) |

**Estructura de cada elemento en `tarjetas[]`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `tarjetaId` | string | ID de la tarjeta |
| `nombre` | string | Snapshot alias |
| `institucion` | string | Snapshot nombre institución |
| `color` | string | Snapshot color institución |
| `fechaCorte` | string? | Fecha de corte del ciclo para este mes |
| `fechaPago` | string? | Fecha límite de pago del ciclo |
| `fechaNomina` | string? | Fecha de nómina anterior al pago (`YYYY-MM-DD`) — usada para ordenamiento |
| `limiteTotal` | number | Snapshot límite total |
| `saldoDisponible` | number? | Snapshot saldo disponible al crear |
| `estimadoContado` | number | Estimado de compras de contado |
| `estimadoPlazos` | number | Estimado de mensualidades A Plazos |
| `estimadoGastos` | number | Estimado de gastos de crédito |
| `estimadoTotal` | number | Suma de los tres estimados |
| `confirmado` | boolean | Si el usuario confirmó los datos para este mes |
| `montoAPagar` | number? | Monto confirmado/editado a pagar |
| `fechaCorteConf` | string? | Fecha corte confirmada por el usuario |
| `fechaPagoConf` | string? | Fecha pago confirmada por el usuario |
| `limiteTotalConf` | number? | Límite confirmado |
| `saldoDispConf` | number? | Saldo disponible confirmado |
| `pagado` | boolean | Si se registró el pago |
| `fechaPagado` | string? | Fecha en que se registró el pago |

**Estructura de `totales`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `estimadoCredito` | number | Suma estimados de todas las tarjetas |
| `pagoCredito` | number | Suma montos pagados registrados |
| `gastoDebito` | number | Suma gastos débito del mes |
| `restanteEsperado` | number | `nominaRef - estimadoCredito - gastoDebito` |
| `restante` | number | `presupuesto - pagoCredito - gastoDebito` |
| `creditoTotal` | number | Suma de límites de todas las tarjetas |
| `creditoDisponible` | number | Suma de saldos disponibles |
| `deudaTotal` | number | `creditoTotal - creditoDisponible` |

> Los estimados se recalculan automáticamente al abrir el Impacto activo. Si hay nuevas compras desde la última apertura, los estimados se actualizan en Firestore.

### `inversiones/{id}`
Cuentas de inversión del módulo **Rendimientos**. Una cuenta pertenece a una institución ya registrada.

| Campo | Tipo | Descripción |
|---|---|---|
| `institucionId` | string | ID de la institución padre |
| `nombre` | string? | Alias de la cuenta (ej. Cajita, Ahorro+). Opcional — si está vacío se muestra el nombre de la institución |
| `montoInvertido` | number | Último saldo **real observado** de la cuenta. Solo se edita desde el modal **Ajuste**; al crear la cuenta arranca en `0` — el abono inicial se guarda como movimiento, no aquí |
| `fechaActualizacion` | string | Fecha (`YYYY-MM-DD`) en que ese monto era el saldo real. Al crear la cuenta es un día antes de la fecha de inversión que se captura (el estado previo al primer abono) |
| `tramos` | array | Límites de rendimiento de la vigencia **actual** (ver estructura abajo) |
| `modoTramos` | string? | Cómo se aplican los tramos de la vigencia actual: `progresivo` (default) o `unico` |
| `modoTasa` | string? | Cómo se interpreta la tasa publicada de la vigencia actual: `nominal` (default) o `efectiva` |
| `tasaDesde` | string? | Fecha (`YYYY-MM-DD`) desde la que aplica la vigencia actual. Ausente = aplicó siempre — el valor de casi todas las cuentas, que nunca registraron un cambio de tasa |
| `historialTasas` | array? | Vigencias de tasa superadas: `{ desde, tramos, modoTramos, modoTasa }`, sin límite de tamaño. Ver *Vigencias de tasa* |
| `baseAnual` | number? | Días del año para el **interés**: `365` (default) o `360` |
| `isrAnual` | number? | Retención en %. `0` o ausente = cálculo bruto. Su significado depende de `isrSobre` |
| `isrSobre` | string? | Base de la retención: `capital` (default, tasa anual) o `interes` (% directo de lo ganado) |
| `baseIsr` | number? | Días del año para la **retención**: `365` (default) o `360`. Solo aplica con `isrSobre: 'capital'` |
| `redondeoTasa` | string? | Cómo mostrar la tasa ponderada: `truncar` (default) o `redondear` |
| `redondeoDiario` | string? | Cómo se capitalizan el interés y el ISR de cada día: `continuo` (default, exactos), `centavos` (redondeados por separado antes de sumarse) o `acumulado` (remanente fraccionario que se paga cuando completa un centavo — ver *Redondeo diario*) |
| `calendarioAbono` | string? | Qué días abona la institución: `natural` (default, todos los días), `habilAcumula` (devenga siempre pero solo abona en día hábil) o `habilSolo` (los inhábiles no devengan). Ver *Calendario de abono* |
| `historial` | array? | Capturas anteriores de `montoInvertido`: `{ fecha, monto }`, máximo 60, ascendente |
| `movimientos` | array? | Aportes, retiros y traspasos — no son rendimiento (ver estructura abajo) |
| `ajustes` | array? | Correcciones al rendimiento que el modelo no predijo (ver estructura abajo) |
| ~~`referencia`~~ | string? | **Obsoleto** — ya no se captura ni se muestra. Puede seguir presente en documentos antiguos |
| ~~`notas`~~ | string? | **Obsoleto** — ídem |
| ~~`rendimientoObtenido`~~ / ~~`fechaActualizacionRendimiento`~~ / ~~`historialRendimiento`~~ | — | **Obsoletos** — la captura manual de un rendimiento real se quitó; "Hasta hoy" siempre sale de la proyección día por día (`historialDiario`). Pueden seguir presentes en documentos antiguos, ignorados |

**Estructura de cada elemento en `movimientos`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `fecha` | string | Fecha ISO (`YYYY-MM-DD`) en que el dinero sale o entra |
| `tipo` | string | `aporte` o `retiro` |
| `monto` | number | Siempre positivo — el signo lo da `tipo`, no el número |
| `nota` | string? | Texto libre |
| `transferenciaId` | string? | Presente solo si es una pata de traspaso entre cuentas propias — une las dos patas espejo |
| `contraparteId` | string? | ID de la otra cuenta del traspaso (solo junto con `transferenciaId`) |

> Un traspaso entre dos cuentas del módulo se guarda como **dos** movimientos espejo (un retiro en el origen, un aporte en el destino) unidos por el mismo `transferenciaId`, cada uno en el documento de su propia cuenta — así cada cuenta se sigue calculando sola, sin depender de cargar la otra. Se capturan una sola vez desde el modal de **Movimientos**; editarlos o eliminarlos actualiza ambas patas a la vez (`js/utils/db.js`:`batchUpdate`). Si el dinero tarda en llegar (traspaso entre instituciones distintas), la pata de destino puede llevar una fecha posterior a la de origen — esos días en tránsito no generan interés en ninguna de las dos cuentas.

**Estructura de cada elemento en `ajustes`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `fecha` | string | Fecha ISO (`YYYY-MM-DD`) en que se aplica la corrección |
| `monto` | number | Con signo — positivo suma al rendimiento, negativo resta |
| `motivo` | string | Texto libre; criterio del usuario, nunca se recalcula |
| `tipo` | string? | `saldo` (default si falta) — corrige el saldo/rendimiento acumulado hasta esa fecha, capturado desde el modal de **Ajuste** · `diario` — corrige el rendimiento de un día puntual, capturado desde una fila del **Historial diario**. Es una etiqueta de presentación: el motor de cálculo no la lee, ambos tipos afectan el saldo y el rendimiento acumulado exactamente igual |
| `derivado` | boolean | `true` si el importe se recalcula solo cuando cambia algo anterior (absorbe el residuo completo de una conciliación); `false` si el usuario lo dimensionó a mano y debe respetarse tal cual |

**Estructura de cada elemento en `tramos`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `hasta` | number\|null | Límite superior del tramo; `null` en el último tramo (*en adelante*) |
| `tasa` | number | Tasa anual del tramo en porcentaje (ej. `15`). Si es nominal o efectiva lo decide `modoTasa` |

> El `desde` de cada tramo **no se almacena**: se deriva del `hasta` del tramo anterior. Esto elimina huecos y solapes por captura. El array se normaliza al leerlo (`normalizarTramos`), que además ordena los tramos y garantiza que siempre exista un tramo abierto final.

> `montoInvertido` + `fechaActualizacion` son el punto observado más reciente; las capturas anteriores viven en `historial[]`. Entre dos puntos observados el saldo se proyecta; al llegar a un punto observado el saldo se reemplaza por el valor real y la diferencia se reporta como **aportación** (o retiro), nunca como rendimiento. Solo se captura desde el modal **Ajuste** (con su conciliación) — "Editar cuenta" ya no lo toca salvo al crear la cuenta.

**Estructura de cada elemento en `historialTasas`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `desde` | string\|null | Fecha (`YYYY-MM-DD`) desde la que aplicó esta vigencia. `null` = desde el origen de la cuenta — solo la vigencia más antigua puede tenerlo |
| `tramos` | array | Los tramos de esta vigencia, misma estructura que el `tramos` de la raíz |
| `modoTramos` | string? | `progresivo` o `unico`, como valían en esta vigencia |
| `modoTasa` | string? | `nominal` o `efectiva`, como valía en esta vigencia |

> `tramos`/`modoTramos`/`modoTasa`/`tasaDesde` en la raíz son la vigencia **actual** — mismo patrón que `montoInvertido`/`fechaActualizacion` para el saldo, pero para la tasa. Editar los tramos sin cambiar `tasaDesde` corrige la vigencia actual en su sitio (sin abrir una nueva); cambiar `tasaDesde` empuja los tramos que había a `historialTasas` tal como estaban, y de ahí en adelante cada día del historial usa la tasa que estaba vigente **ese día**, no la de hoy. Ver *Vigencias de tasa*.

### `eventos/{id}`

| Campo | Tipo | Descripción |
|---|---|---|
| `nombre` | string | Nombre del evento |
| `tipo` | string | `Hot Sale`, `Buen Fin`, `Cyber Monday`, etc. |
| `fechaInicio` | string | Fecha ISO de inicio |
| `fechaFin` | string | Fecha ISO de fin |
| `planCompras` | array | Productos planeados |
| `comprasRealizadas` | array | Compras ya realizadas |
| `promociones` | array | Promociones por institución |

### `_config/owner` *(fuera del namespace de usuario)*

| Campo | Tipo | Descripción |
|---|---|---|
| `uid` | string | UID de Firebase Auth del único usuario autorizado |

---

## Módulos de la Aplicación

### Dashboard (`#/`)
Vista principal rediseñada con datos en tiempo real del mes actual:
- **2 metric cards:** Total a pagar (`estimadoCredito + gastoDebito`, con desglose Contado/Plazos/Gastos) · Restante y Esperado (divisor vertical)
- **3ª metric card — Rendimientos** (solo si hay cuentas de inversión): **Diario** y **Hasta hoy** con el mismo patrón dividido de las otras dos, y el saldo total como subtexto. Toda la tarjeta enlaza a `#/rendimientos`. Los montos son netos de la retención configurada en cada cuenta
- **Barra de crédito:** Crédito total, Disponible y Deuda con barra de progreso visual, a todo lo ancho

> **Por qué las metric cards usan `col-xxl-4` y no `col-lg-4`:** con tres tarjetas en una fila, cada una necesita ~313px para que el importe no se corte con elipsis. Descontando el sidebar eso solo se cumple desde ~1400px de viewport. Por debajo de `xxl` la tercera baja a su propio renglón (`col-lg-6`) en vez de estrujar a las tres. Sin cuentas de inversión la fila vuelve a ser de dos tarjetas a `col-lg-6` y el layout es idéntico al original.
- **Últimas compras** — hasta 20 compras recientes unificando De Contado y A Plazos, ordenadas por fecha:
  - Badge `Contado` (gris) para compras de contado
  - Badge `X/Y msi` (azul) con mensualidad/mes y total subtexto para A Plazos en curso
  - Enlace directo al comprobante si la compra tiene `enlaceCompra`
- **Gastos Fijos del mes** — lista con estado (Registrado/Pendiente/Sin registrar) y montos
- **Tarjetas del mes** — estado de cada tarjeta de crédito (pagada/pendiente/espera corte) con badge 1Q/2Q
- En desktop el dashboard no requiere scroll de página (altura dinámica calculada con `100dvh`)

### Tarjetas (`#/tarjetas`)
Vista de cartera (wallet) de todas las tarjetas registradas:
- Tarjetas visuales con gradiente del color institucional y volteo 3D para ver datos al reverso
- **En desktop:** cuadrícula de tarjetas (flip al hacer clic)
- **En móvil:** stack vertical con efecto de superposición — la tarjeta activa se expande, las demás se colapsan mostrando institución y alias en una línea
- Filtros por tipo (Todas / Débito / Crédito / Préstamo) y por institución
- Ordenamiento: institución → tipo (Débito → Crédito → Préstamo) → alias
- **Frente** (crédito/préstamo): chip de saldo usado calculado (`bi-bar-chart-fill`) + Para crédito y préstamo: chips con fechas del ciclo activo (corte/pago); cuando el pago anterior está pendiente se muestra primero
- **Reverso** (crédito/préstamo): chips de Límite total y Saldo disponible en la franja negra superior; CLABE y números en el cuerpo
- El saldo disponible se muestra en verde si no hay compras posteriores a la última actualización, o en blanco si fue ajustado (ver [Cálculo de Saldo Disponible](#cálculo-de-saldo-disponible))

### Instituciones y Tarjetas (`#/admin`)
CRUD completo de instituciones y tarjetas:
- Tabla agrupada por institución con encabezado coloreado
- Número de cliente de la institución visible y copiable
- Por tarjeta: tipo, red, números (F/D), CLABE, límite, **saldo disponible calculado**, **saldo usado**, ciclo
- Saldo disponible: verde si coincide con el valor en BD, negro si hay compras/gastos posteriores que lo redujeron
- Detección automática de red al pegar número de tarjeta (IIN/BIN)
- Modal de institución: checkbox **"Las bonificaciones incluyen IVA (16%)"** que guarda `bonificacionConIva` en la institución
- Modal de tarjeta con secciones dinámicas según tipo:
  - Crédito y préstamo: sección "Saldo disponible" con campos Disponible y Usado (se calculan mutuamente a partir del límite); guarda `saldoDisponible` + `fechaActualizacionSaldo` automáticamente
  - Crédito y préstamo: límite total
  - Crédito: ciclo de facturación
  - Préstamo: número de pago
- Instituciones agrupadas con acordeón plegable/expandible por institución
- Tarjetas con botón ⭐ para marcar/desmarcar favoritas y botón 👁 para ocultar/mostrar
  - Una tarjeta **favorita** no puede ocultarse (botón 👁 deshabilitado)
  - Una tarjeta **oculta** no puede marcarse como favorita (botón ⭐ deshabilitado)

> Las tarjetas marcadas como favoritas aparecen en un grupo `⭐ Favoritas` al inicio de todos los selectores del proyecto (Compras, Gastos Fijos, Registro Rápido). Las tarjetas del grupo Favoritas no se duplican en los grupos de institución del mismo selector.
>
> Cada opción de tarjeta muestra el nombre de la institución como prefijo (`Institución — Tarjeta ···4118`), en todos los grupos y no solo en Favoritas: el `<optgroup>` que agrupa por institución no aparece en el texto colapsado del `<select>` una vez elegida una opción, así que sin el prefijo la tarjeta seleccionada quedaría sin decir a qué banco pertenece.

> Las tarjetas **ocultas** (`oculta: true`) se excluyen automáticamente de `/tarjetas` y de todos los selectores del sistema. Para **De Contado** y **A Plazos** (formulario normal y registro rápido) los selectores muestran únicamente tarjetas de **crédito** (no débito ni préstamo).

### Compras y Gastos (`#/compras`)
Gestión de compras y gastos, organizada en tres pestañas. Cada tab recuerda el estado de acordeones (plegado/expandido) en `localStorage`.

**Pestaña De Contado** (colección `contado`)
- Filtro de período: navegación mes/año (`‹ Mayo 2026 ›`) + toggle **Fecha Compra | Fecha Pago**
  - *Fecha Pago*: filtra por la nómina anterior al límite de pago del ciclo (mismo ajuste que en A Plazos)
- Vista en acordeón agrupada por institución; botón **Colapsar/Expandir todo**
- Tabla: descripción + enlace, tarjeta (alias + últimos 4), fecha de compra, fecha de pago, total
- **Fecha de pago:** nómina anterior en azul (icono billetera) + límite del ciclo en gris (icono tarjeta)
- Para tarjetas de débito la columna de fecha de pago queda vacía
- **Columna Total:** cuando la compra tiene `bonificacion` configurada, muestra el precio neto junto al total original tachado, el monto de bonificación y la fecha límite con código de color

**Pestaña A Plazos** (colección `msi`)
- Vista en acordeón **agrupada por institución**; botón **Colapsar/Expandir todo**
- Filtros: **En curso** (default) / **Liquidados** / **Todos**
- Tabla "En curso": Compra · Tarjeta · Meses · Primer Pago · Próximo Pago · Último Pago · Mensualidad · Restante · **Total** · Acciones
- **Próximo Pago:** calculado como el ciclo del mes `primerCicloMes + mesesPagados`; se muestra resaltado en azul (icono billetera + icono tarjeta)
- Primer y Último pago: mismas dos líneas pero sin resalte
- **Columna Total:** cuando la compra tiene `bonificacion` configurada, muestra el precio neto (total − bonificación) junto al total original tachado, el monto de bonificación y la fecha límite con código de color (🟡 pendiente, 🔴 vencida, 🟢 aplicada)
- `restante`: se usa el valor almacenado en BD; si no existe se calcula. Campo editable en el modal, se recalcula automáticamente al cambiar total/mensualidad/mesesPagados
- **Acción Pagar mensualidad** (`bi-coin`): incrementa `mesesPagados + 1`, reduce `restante - mensualidad`, y suma la mensualidad al `saldoDisponible` de la tarjeta (sin actualizar `fechaActualizacionSaldo`)
- **Acción Liquidar:** marca la compra como saldada, registra `fechaLiquidacion`
- Al pagar la última mensualidad o guardar con `mesesPagados = mesesTotal` se ofrece liquidar automáticamente
- Vista "En curso": métricas de deuda total + mensualidad combinada
- Vista "Liquidados"/"Todos": métricas de total de compras + cantidad

**Pestaña Gastos** (colección `gastos`)
- Filtro de período: navegación mes/año + toggle **Fecha Gasto | Fecha Pago**
  - *Fecha Pago*: para crédito filtra por nómina anterior al ciclo; para débito usa la fecha de gasto
- **Sección "Pendientes de confirmar"** (siempre mes actual): gastos fijos cuya fecha calculada ≤ hoy y no confirmados/descartados este mes. Se persisten en BD con `estado: 'pendiente'` al abrir el módulo
  - Botón **Confirmar**: modal pre-cargado (nombre, tarjeta solo lectura, forma pago, fecha, importe); guarda con `estado: 'registrado'`
  - Botón **Descartar** (×): guarda `estado: 'descartado'`; no reaparece ni se recrea
- **Sección "Gastos registrados"**: tabla filtrada por período con Nombre, Tarjeta, Forma de Pago, Fecha Gasto, **Fecha Pago** (ciclo calculado para crédito), Importe
- **Nueva entrada manual**: solo tarjetas de débito; forma de pago Retiro o Transferencia; `estado: 'registrado'`

> **Regla:** registros de tarjeta de crédito en `gastos` provienen únicamente de confirmar un gasto fijo. Las entradas manuales usan solo tarjetas de débito.

### Notificaciones (`#/notificaciones`)

Bandeja de avisos accionables (colección [`notificaciones`](#notificacionesid)): compras que el
Apps Script detectó en el correo, y los tres recordatorios de `docs/RECORDATORIOS-PUSH.md` —
corte de tarjeta, gasto fijo por confirmar, cierre de mes. Sustituye al correo individual por
compra que se mandaba antes; ver `docs/NOTIFICACIONES-PUSH.md`.

- Lista **los 4 tipos** con `estatus: pendiente`, más recientes arriba (`_cargarPendientes`) — ya
  no filtra por `tipo`, así que `refrescarBadge`/`pintarBadge` cuentan los recordatorios sin
  cambios adicionales.
- **Fila de compra** (`tipo: compra`): importe, comercio (`datos.desc`), el **asunto crudo del
  correo** (`datos.asunto`), fecha/hora y la terminación de la tarjeta como píldora teñida con el
  color de su institución (se resuelve con `matchTarjetaPorTerminacion`, porque la notificación
  solo guarda los 4 dígitos; sin coincidencia va en gris neutro). Dos insignias más: `N MSI` en
  compras a plazos y `sin match` cuando el diccionario del script no reconoció el comercio — ahí
  el asunto es lo único que orienta.
  - **Escritorio:** todo en un renglón, con el asunto absorbiendo el ancho sobrante. **Móvil:**
    dos renglones exactos — arriba lo que identifica el cargo, abajo el asunto. El asunto baja
    con `order`, no reordenando el HTML, y el año de la fecha se oculta para que el primer
    renglón quepa (ninguna detección pasa de 30 días).
  - **Tocar la fila** abre el modal del Registro Rápido precargado (`prefillDesdeDatos` →
    `openQuickAdd`), el mismo del FAB, con su vista previa de ciclo, disponible e impacto. Al
    guardar, la notificación pasa a `estatus: procesada`. Si el modal se cambia de contado a
    plazos (o al revés), la notificación se cierra igual: `onSaved` viaja con el cambio.
  - Si el `msgId` ya está en `contado` o `msi`, la compra se registró antes: no se abre el modal,
    la notificación se marca `procesada` directamente.
- **Fila de recordatorio** (`tipo: corte` \| `gastoFijo` \| `rendimiento`): plantilla genérica más
  simple — ícono por tipo, título y cuerpo corto (`_textoRecordatorio`, mismos textos que el push
  de `docs/app-script-recordatorios.gs`). **Tocar la fila** no abre el modal de compra: navega a
  `#/impacto/{mes}` (corte), `#/compras/gastos` (gastoFijo) o `#/rendimientos` (rendimiento), y
  marca `estatus: procesada`. El auto-resuelto que hace Apps Script cuando la condición deja de
  cumplirse (tarjeta confirmada, impacto creado, mes cerrado) sigue siendo el mecanismo
  principal — el tap solo adelanta el `procesada` si el usuario entra manualmente antes de la
  próxima corrida.
- **La `×`** la marca `descartada` sin registrar/procesar nada, con confirmación — igual en los 4
  tipos.
- **Indicadores de pendientes**, los dos alimentados por `refrescarBadge` (que llama `app.js` al
  iniciar sesión y esta vista tras cada cambio; `pintarBadge(0)` los apaga al cerrar sesión):
  - **Escritorio:** insignia con el número en el enlace del sidebar. Con el sidebar colapsado se
    convierte en un punto sobre la campana — la regla que oculta las etiquetas se llevaba también
    el badge y no quedaba señal alguna.
  - **Móvil:** campana flotante en la esquina superior derecha (`#noti-bubble`), fija sobre el
    header. Sin fondo propio: el color lo pone el contador, que es lo que debe saltar. La sección
    no cabe en la bottom nav, así que sin ella habría que abrir el cajón para enterarse. Solo
    aparece si hay pendientes —es una alerta, no navegación permanente— y lleva a
    `#/notificaciones` de un toque. El contador se corta en `9+`.

#### Notificaciones push (Web Push / FCM)

El aviso instantáneo de la misma cadena. La app se queda como PWA — no hay APK; ver
`docs/APK-ANDROID.md` para la evaluación que se descartó.

- **Activación:** botón en el pie del sidebar (`#btn-push`) y aviso dentro de `#/notificaciones`
  mientras el permiso no esté concedido. Tiene que salir de un gesto del usuario:
  `Notification.requestPermission()` lo exige. Si el permiso quedó en `denied`, el botón se
  deshabilita — el navegador ya no vuelve a preguntar y hay que ir a los permisos del sitio.
- **Token:** `js/push.js` pide el token con la clave VAPID y lo guarda en
  [`dispositivos`](#dispositivostoken). Reusa el registro de `./sw.js` con
  `navigator.serviceWorker.ready`; un registro nuevo dejaría la suscripción en un Service Worker
  distinto del que atiende los push. El token se refresca en cada inicio de sesión, porque FCM lo
  rota y uno viejo deja de recibir sin avisar.
- **Envío:** `enviarPush()` en `docs/app-script.gs`, contra la API v1 de FCM, **una sola vez al
  final de cada corrida** de `procesarCompras` y no una por compra: un reproceso puede detectar
  diez correos de golpe. Si fue una compra manda el detalle (`$1,372.23 — Amazon`); si fueron
  varias, un resumen (`3 compras detectadas` / `Uber, Amazon y 1 más · $1,654.93 en total`).
  Va en su propio `try`: si el push falla, las notificaciones ya están guardadas y se ven al abrir
  la app — no debe provocar un reintento, que las duplicaría. Los tokens muertos
  (404 / `UNREGISTERED`) se borran ahí mismo.
- Para probar los dos formatos sin tocar la colección: `pruebaPushUna()` y `pruebaPushVarias()`,
  que además imprimen el texto en el log (útil cuando el aviso no llega a verse porque el sistema
  operativo lo tiene silenciado).
- **Mensajes data-only**, sin bloque `notification`. Es lo que permite que el listener `push` de
  `sw.js` decida qué mostrar; con bloque `notification` Chrome pinta además la suya y saldrían
  dos avisos por compra. El `tag` es el id del documento, así que un reintento reemplaza en vez
  de apilar.
- **Tap en el aviso:** si la app ya está abierta, el Service Worker le manda
  `{tipo:'navegar', ruta}` por `postMessage` y `app.js` navega. Un `navigate()` a la misma URL
  con otro hash recargaría la pestaña y se perdería lo que estuviera a medias.
- **Con la app en primer plano** el push no llega al Service Worker sino a `onMessage`: ahí basta
  un toast y refrescar el contador, en vez de una notificación del sistema encima de la app que
  ya estás mirando.
- **Requisitos externos:** clave VAPID en `js/push.js` (Firebase Console → Cloud Messaging → Web
  Push certificates) y el scope `firebase.messaging` en el Apps Script. En iOS hace falta 16.4+
  **y la PWA instalada** desde Safari; en una pestaña normal no hay permiso posible.

### Gastos Fijos (`#/fijos`)
Registro de gastos recurrentes (módulo en la sección **Administración** del nav):
- Tabla ordenada por institución → nombre del gasto, con totalizador al pie
- Asociación a tarjeta y número específico (física o digital)
- Tres modos de configuración de cobro (se muestra como texto en tabla):
  - **Texto libre:** campo `diaCobro` (ej. "15", "1ra Quincena")
  - **Intervalo fijo:** "Cada N días desde [fecha]" — se ajusta a siguiente día hábil
  - **Día de semana del mes:** "1er Martes de cada mes" — se ajusta a siguiente día hábil
- Al abrir el tab Gastos, los gastos fijos con fecha calculada ≤ hoy y sin registro en `gastos` ese mes se crean automáticamente como `pendiente`
- Los gastos fijos con `diaCobro` como texto no numérico no se precargan automáticamente

### Impacto Mensual (`#/impacto` o `#/impacto/YYYY-MM`)
Rediseñado completo. Gestión del estado financiero mensual por tarjeta:

**Mes activo:**
- Presupuesto editable + Nómina ref. + Restante / Esperado
- Barra de crédito total / disponible / deuda
- Tabla de tarjetas de crédito: Límite, Disponible, Corte, Pago (con badge 1Q/2Q)
- **Disponible en tiempo real:** la columna Disponible y el total del métrico usan `calcularSaldo` (mismo cálculo que /tarjetas y /admin) — no el snapshot almacenado en el impacto. Si el campo fue confirmado manualmente (`saldoDispConf`), ese valor tiene precedencia sobre el calculado.
- Datos confirmables individualmente por campo (✓ verde al confirmar)
- **Registrar pago**: habilitado después del corte; actualiza `saldoDisponible` y avanza `mesesPagados` de A Plazos
- **Cerrar mes**: requiere todas las tarjetas pagadas; guarda snapshot + totales
- Auto-creación del impacto al abrir el módulo si no existe para el mes actual
- Estimados se recalculan al reabrir (nuevas compras quedan reflejadas)

**Meses pasados (cerrados):** solo lectura

**Meses futuros (proyección):** estimados calculados al vuelo con pago progresivo simulado de A Plazos y gastos fijos; no muestra columnas de Límite/Disponible

> **Deduplicación de gastos fijos en proyección:** si un gasto fijo ya fue confirmado (`estado: 'registrado'`) en el mes del corte del ciclo de pago proyectado (`mesCorte = periodo.fechaCorte.slice(0,7)`) o en el mes proyectado mismo, se omite de `estimadoGastosFijos` para esa tarjeta — el registro confirmado ya es capturado por `getGastosCreditoMes` en `estimadoGastos`, incluso si fue cambiado a otra tarjeta al editar.

### Rendimientos (`#/rendimientos`)
Alta y administración de cuentas de inversión, con el cálculo de rendimientos compuestos de cada una.

**Encabezado — acumulado de todas las cuentas** (4 metric cards):
- **Saldo actual** (capital + rendimiento generado) con el capital como subtexto
- **Hasta hoy** — rendimiento acumulado desde la última actualización de cada cuenta
- **Rendimiento diario** con el mensual (30 d) como subtexto
- **Proyección anual** (365 d) con el GAT efectivo como subtexto

**Calcular entre 2 fechas:** selector de cuenta (una o todas) + rango de fechas. Devuelve el rendimiento del periodo, los días, el saldo inicial y final, y las aportaciones netas (separadas del rendimiento). Con más de una cuenta agrega un desglose por cuenta. Avisos:
- Si el inicio es anterior al primer saldo registrado de una cuenta, su cálculo arranca en ese primer registro y se marca el recorte
- Si la fecha final es futura, se indica que el resultado incluye proyección

Las tarjetas se centran cuando la última fila no se llena (`justify-content-center`), y el grid va de 1 columna en móvil a 4 en `xxl`.

**Tarjeta por cuenta** — solo el estado, sin configuración. De arriba abajo:

| Bloque | Contenido |
|---|---|
| Encabezado | Color de la institución, institución arriba y alias abajo (si no hay alias, la institución ocupa la línea principal) y las acciones |
| Saldo | **Saldo actual estimado**, el importe protagonista |
| Tasa | **Rendimiento anual** con la tasa del saldo actual, y una **ⓘ** que abre el desglose por tramos |
| Ganado | Línea descriptiva `Hasta hoy $X · Último $Y` con un botón 🕐 que abre el historial diario |
| Rendimientos | **Diario · Mensual (30 d) · Anual (365 d)**, netos de ISR, en una fila con divisores |
| Pie | Botón **Ver detalle** |

- Acciones del encabezado: **Ajuste** (🔄 `bi-arrow-repeat`) — captura de saldo/rendimiento reales · **Movimientos** (⇄ `bi-arrow-left-right`) — aportes, retiros y traspasos · **⋮ Más acciones** — menú flotante con *Editar cuenta*, *Historial de tasas* y *Eliminar cuenta*. Se usan poco y el borrado no debe quedar pegado a las acciones de captura diaria, así que viven aparte en el menú
- La **ⓘ** de la tasa aparece **solo si más de un tramo tiene dinero**. Con un único tramo aportando, la tasa no es un promedio y no hay nada que desglosar, así que el botón se omite

**Modal Detalle** — se abre desde la tarjeta, en tres secciones:
1. **Cómo sale el rendimiento de hoy** — la aritmética renglón por renglón: la porción de cada tramo con su fórmula, el bruto, la retención y el neto
2. **Tramos** — barra de reparto y desglose (ver abajo)
3. **Configuración** — resumen de solo lectura de todos los campos, cada uno con su **ⓘ**

Al pie, botones para saltar al **Historial diario** o a **Editar**. Como los tres comparten `#modal-container`, el salto espera al evento `hidden.bs.modal` antes de abrir el siguiente.

**Modal Historial diario** — un renglón por día desde la primera ancla de la cuenta hasta **hoy inclusive** (no solo desde la última captura: capturar un ajuste de tipo *saldo* mueve la ancla más reciente hacia adelante, y si la tabla solo mirara desde ahí, capturar un dato borraría de la vista todo el historial anterior — ver [Modelo de eventos](#modelo-de-eventos-anclas-movimientos-y-ajustes)), por defecto del más reciente al más antiguo, con el más reciente marcado como *hoy*. El encabezado **Día** es clicable (ícono ↓/↑) y alterna el orden de la tabla entre más reciente primero y más antiguo primero — el orden es solo de despliegue: el reporte Excel y los totales no cambian, y el renglón marcado *hoy* se identifica por fecha, no por posición, así que sigue siendo el correcto en cualquiera de los dos órdenes. Columnas: día, **Saldo** (el saldo al *cierre* de ese día, ya con su rendimiento aplicado — no el saldo con el que arrancó), bruto e ISR (solo si hay retención) y rendimiento.

En una cuenta con **calendario de abono**, los días inhábiles **no llevan renglón propio** (`plegarDiasInhabiles`): su saldo es el del día hábil anterior y su interés no se acreditó, así que como fila solo parten en tres cifras un rendimiento que la institución reporta como un solo abono. Se pliegan sobre el día que los paga, que muestra el acumulado, una etiqueta `+N días` y el desglose día por día en el tooltip. Excepción: un día inhábil con un **movimiento o un ajuste** sí se conserva —eso no es interés y no se puede plegar sin perderlo de vista— y aparece con $0 de rendimiento, porque su interés viajó igual al día del abono. Lo devengado que al cierre de la tabla todavía no tiene día de abono se dice en una nota bajo la tabla, no en una fila. El día exacto en que entra en vigor una vigencia de tasa distinta lleva su propia etiqueta con el resumen de la tasa nueva (tooltip con la anterior). El rendimiento de un día con un ajuste tipo `diario` se muestra en **naranja** y ya incluye ese ajuste (neto + ajuste); un día con un ajuste tipo `saldo` capturado ahí lleva solo un pequeño indicador junto a la fecha, sin cambiar el color del rendimiento — ese tipo de ajuste corrige el acumulado, no el rendimiento puntual de ese día. Encabezado y totales fijos al hacer scroll.
- Cada fila tiene un botón **corregir** (lápiz) que abre, en un modal aparte, la captura de un ajuste tipo `diario` para ese día: precarga **exactamente la cifra del renglón** —redondeada a centavos, con los ajustes que ya tuviera y, con calendario, el puente completo— con botones **−¢ / +¢** para afinarla, y guarda la diferencia contra ella usando el mismo mecanismo de conciliación que el modal de Ajuste. Precarga lo mostrado y no el interés "puro" del día a propósito: es lo único contra lo que se puede comparar (el banco reporta un abono, no el desglose), y evita volver a sumar un ajuste que ya existía. Al guardar, vuelve a abrir el historial ya actualizado
- Bloque colegible **Cómo se calcula** — la misma fórmula y configuración que el modal Detalle, para no tener que saltar de modal para entender una cifra de la tabla
- Botón **Generar reporte** — exporta la tabla a CSV con una columna adicional "(exacto)" sin redondear por cada importe (saldo, rendimiento, bruto, ISR, saldo inicial), más movimiento, ajuste de rendimiento y su motivo por día, y una segunda sección con la fórmula y la configuración con la que se calculó todo — para que el archivo se explique solo sin volver a la app. En cuentas con calendario de abono agrega *Abonado*, *Pendiente de abono* e *Inhábil* por día, y la regla de abono en la sección de configuración

**Modal Movimientos** — aportes, retiros y traspasos entre cuentas propias del módulo; el dinero que entra o sale **no es rendimiento**, así que se separa para no inflarlo. Lista de movimientos (más reciente primero) con opción de captura retroactiva — se aplica en su día y corrige el rendimiento del periodo — y de eliminar cada uno.
- Un movimiento sin contraparte es un aporte o retiro suelto
- Elegir una contraparte lo convierte en **traspaso**: se registran las dos patas (retiro en origen, aporte en destino) atómicamente vía `batchUpdate`, unidas por `transferenciaId`. Con una **fecha de llegada** distinta a la de salida, el dinero pasa esos días "en tránsito" sin generar interés en ninguna de las dos cuentas — para transferencias entre instituciones distintas que tardan en acreditarse
- Eliminar cualquiera de las dos patas de un traspaso elimina la otra también, con confirmación

**Modal Historial de tasas** (menú ⋮) — lista de solo lectura de las vigencias de tasa de la cuenta: periodo (`desde` – el día antes de que empiece la siguiente, o *hoy* para la vigente), aplicación e interpretación, y un resumen de la tasa (un solo % si es tasa única, o cada tasa separada por `/` si son varios tramos). Solo las vigencias pasadas tienen borrar — la actual se cambia editando la cuenta, que es lo que abre un periodo nuevo. Borrar un periodo mueve el rendimiento de los días que cubría, así que pasa por el mismo resguardo de `ajustesTrasEditar` que cualquier otro cambio a la raíz del cálculo. Con una sola vigencia (el caso normal), el modal lo dice explícitamente en vez de mostrar una tabla de un renglón.

**Modal Ajuste** — la única forma de capturar el saldo real de la cuenta una vez creada; "Editar cuenta" ya no lo permite (ver más abajo).
- **Saldo**: muestra el saldo estimado a hoy con botón *Usar este valor*; al capturar un monto distinto, un panel de **conciliación** desglosa la diferencia (`conciliar()`) y pide clasificarla como *deriva del cálculo* (se guarda como ajuste tipo `saldo`, marcado `derivado: true` si absorbe el residuo completo) o *aportación/retiro que no se registró* (redirige a Movimientos). Guarda la captura anterior en `historial`
- **Ajustes registrados** — lista filtrable (**Saldo · Diario · Todos**, abre siempre en *Saldo*) de todos los ajustes de la cuenta, con edición inline y borrado. Editar o eliminar un ajuste recalcula en cascada los demás ajustes derivados y pide confirmación si alguno cambia de importe (`ajustesTrasEditar`)
- Si la nueva fecha de captura es anterior a datos ya existentes en `historial`, se ofrece descartarlos con confirmación explícita (`historialConsistente` / `capturasDescartadas`) — es una corrección deliberada del punto de partida, nunca algo silencioso

> Hasta una versión anterior, este modal también tenía una sección **Rendimiento obtenido** para capturar aparte una cifra real de rendimiento acumulado (con su propio historial y un botón para "quitar la captura"). Se quitó: "Hasta hoy" ahora siempre sale de la proyección día por día (`historialDiario`), nunca de una cifra capturada a mano.

**Bloque de tramos** — sustituye al resaltado del "tramo activo", que sugería que solo esa tasa aplicaba cuando en modo progresivo todos los tramos con dinero aportan a la vez:
- Barra apilada con el reparto del saldo, coloreada por tramo, con leyenda de porcentajes
- Tabla `Tramo · Tasa · En el tramo · Aporte/día` con totales; los tramos sin dinero se atenúan y el que recibiría el siguiente peso lleva la etiqueta *marginal*

**Modal de cuenta:** institución, nombre (opcional), monto invertido y fecha de inversión (solo al crear), **Aplicación** e **Interpretación de la tasa**, editor de tramos y sección *Avanzado*.
- **Monto invertido y fecha solo se capturan al crear la cuenta**, y no como ancla directa: el monto se registra como un **movimiento tipo aporte** (nota `Abono inicial`) fechado el día de inversión que se captura — rinde igual que cualquier otro depósito, nada su propio día y componiendo desde el siguiente. La ancla de la cuenta (`montoInvertido`/`fechaActualizacion`) arranca un día antes, en `$0`, que es el estado real previo a ese primer abono. Al editar una cuenta existente el modal ya no muestra estos campos: en su lugar, una nota con el saldo actual estimado remite al modal **Ajuste** para capturar un saldo real nuevo (con conciliación) y a **Movimientos** para revisar el abono inicial u otras aportaciones/retiros. Evita el doble camino: antes se podía editar el saldo desde "Editar cuenta" SIN conciliar, sin quedar registrado como aportación/retiro ni como deriva del cálculo
- El editor de tramos muestra el **Desde** derivado en tiempo real y el último tramo siempre es *En adelante*
- Validación: todo tramo salvo el último requiere límite superior, y los límites deben ir en aumento
- Bajo el editor de tramos, **Vigente desde**: vacío si esta tasa aplicó siempre (el caso normal). Ponerle una fecha nueva registra un cambio de tasa — los tramos que había pasan al historial de tasas tal como estaban, y de ahí en adelante cada día del cálculo usa la que le corresponde por fecha, no la de hoy. Editar los tramos sin tocar esta fecha corrige la vigencia actual en su sitio, sin abrir una nueva. Con historial de tasas ya registrado, el campo es obligatorio (no puede haber dos vigencias "desde siempre")

*Avanzado* agrupa lo que varía entre instituciones:

| Bloque | Campos |
|---|---|
| Retención de ISR | Tasa · Se calcula sobre (capital / interés) |
| Convenciones de cálculo | Base anual del interés · Base anual del ISR · Tasa ponderada (truncar / redondear) · Redondeo diario (continuo / centavos / acumulado) |
| Calendario de abono | Cuándo se acredita el interés: todos los días · solo hábiles acumulando · solo hábiles sin devengo |

La etiqueta de la tasa de retención cambia según `isrSobre`, y *Base anual — ISR* se oculta cuando la retención es sobre el interés (ahí no se anualiza). Al elegir un calendario hábil, una nota bajo el select avisa si no hay festivos cargados en **Días Festivos** — el cálculo sigue siendo correcto para los fines de semana, pero un puente se le escaparía. La sección *Avanzado* se abre desplegada cuando alguno de sus campos está fuera del default, el calendario incluido.

### Ayuda contextual

Ningún campo lleva texto de ayuda inline: cada uno tiene un botón **ⓘ** que abre un modal breve con el concepto y un apartado *Cómo afecta al cálculo*, casi siempre con un ejemplo numérico. Hay doce, uno por campo, y viven en el diccionario `AYUDA` de `rendimientos.js`.

> Los ejemplos usan cifras inventadas a propósito. La ayuda explica el concepto, no la configuración de ninguna institución en particular.

Detalles de implementación que conviene conocer antes de tocarlos:
- La ayuda **no usa `openModal`**: monta su propio modal en `<body>` para poder apilarse sobre el formulario de la cuenta sin destruirlo. Al cerrarse restaura la clase `modal-open` del body si todavía hay un modal abierto detrás
- Un solo listener delegado atiende todos los botones, presentes y futuros. Ignora los que no traen `data-ayuda`, porque el botón del desglose de tramos reusa el estilo sin ser ayuda de un campo

> **Qué capturar (monto):** el saldo que muestra la app del banco en ese momento, tal cual. Ese saldo **ya incluye** el interés abonado esa madrugada, así que al capturarlo con la fecha de hoy la tarjeta mostrará `Hasta hoy $0.00`. Al día siguiente, `Hasta hoy` ya reflejará ese abono.

### Eventos de Ofertas (`#/eventos`)
Lista de eventos registrados con acceso rápido a cada uno.

### Detalle de Evento (`#/eventos/{id}`)
Vista con 3 pestañas:

**Planeación:**
- Lista de productos que se desean comprar
- Por cada producto: tabla de opciones (tienda × banco/promoción)
- Columnas calculadas: precio con descuento, mensualidad con MSI
- Resaltado automático de la mejor opción (menor mensualidad o menor precio)
- Botón "Elegir" para marcar la opción seleccionada

**Compras Realizadas:**
- Registro de lo que ya se compró con campos de rastreo y seguimiento

**Promociones:**
- Tabla de enlaces a las publicaciones de cada institución para el evento

### Días Festivos (`#/festivos`)
CRUD del catálogo de días festivos oficiales de México:
- Tabla con fecha y nombre del festivo
- Usado por el motor de cálculo de ciclos para ajustar fechas de corte y pago a días hábiles

### Ajustes (`#/ajustes`)

Absorbió la antigua vista *Exportar Datos* y los dos controles que vivían sueltos en el pie del
sidebar. Ahí ocupaban espacio permanente para algo que se toca dos veces al año, y el de
notificaciones solo sabía activar. `#/exportar` redirige aquí, igual que `#/msi` a `#/compras`.

**Notificaciones** — un interruptor por dispositivo:
- **Activar** pide el permiso del navegador (si hace falta) y registra el token en
  [`dispositivos`](#dispositivostoken).
- **Desactivar** borra ese token y anula la suscripción con `deleteToken`. Es importante entender
  por qué son dos cosas distintas: **el permiso del navegador no se puede revocar desde
  JavaScript**, así que se corta por el otro lado — el Apps Script se queda sin a dónde enviar.
  El permiso sigue concedido, y por eso volver a activar no pregunta nada.
- Por lo mismo, el estado real se lee de `pushManager.getSubscription()`, no de
  `Notification.permission`: pueden discrepar, y la suscripción es la que manda
  (`estadoPush()` en `js/push.js`).
- Con el permiso en `denied` el interruptor se deshabilita: el navegador ya no vuelve a
  preguntar y hay que devolverlo desde los permisos del sitio.
- Si el dispositivo no soporta push, en vez del interruptor sale la explicación (en iPhone hacen
  falta iOS 16.4+ y la PWA instalada).

**Apariencia** — Sistema · Claro · Oscuro, como tres opciones visibles en vez del botón que
ciclaba entre ellas. En `app.js` solo queda el seguimiento en vivo del tema del sistema operativo,
que debe funcionar esté abierta la vista que esté.

**Exportar datos:**
- **Excel:** un `.xlsx` con una hoja por colección
- **JSON:** un `.json` con todas las colecciones en un objeto
- El nombre incluye la fecha (`IMPACTOS_YYYY-MM-DD`)
- Se exportan las 12 colecciones con datos del usuario. Quedan fuera `notificaciones` (bandeja
  transitoria) y `dispositivos` (tokens de push, que fuera de su navegador no significan nada)

> **Corregido al mover la vista:** la lista de colecciones del módulo viejo tenía la clave `fijos`,
> que no existe —la colección real es `gastosFijos`—, así que la hoja de Gastos Fijos salía vacía
> sin avisar; y le faltaban `contado`, `gastos`, `impacto` y `config` por completo. Para algo que
> se usa como respaldo era una pérdida silenciosa de datos.

**Mantenimiento:**
- **Limpiar caché de datos:** limpia el caché en memoria y el de `localStorage` (`clearCache` de
  `db.js`). Útil si los datos se ven desactualizados sin recargar.
- **Limpiar caché del SW:** elimina todas las entradas del Cache Storage y fuerza una recarga del
  Service Worker. No afecta la base de datos en Firebase.

### Botón de Registro Rápido (FAB)
Botón flotante (`+`) disponible en todos los módulos después de iniciar sesión:
- Posición: esquina inferior derecha (encima del bottom nav en móvil)
- Al pulsar: despliega 3 opciones — **Gasto** · **A Plazos** · **De Contado**
- Cada opción abre un modal auto-contenido que carga datos frescos de Firestore
- **Preview en tiempo real**: al seleccionar tarjeta, fecha y monto muestra fechas del ciclo (corte, límite pago, nómina anterior), Disponible y Usado con cálculo aplicado, e impacto en el mes relacionado (tarjeta + global, incluyendo proyecciones)
- Guarda directamente sin requerir navegar al módulo correspondiente
- La Descripción/Nombre va al final del formulario para no bloquear el preview

#### Acumular compra (solo De Contado)

Para cuando un cargo en realidad continúa a otro anterior: la segunda mitad de una cuenta, un
cobro que el comercio partió en dos. En vez de dos compras sueltas se registra una sola por la
suma. **No aplica a plazos**: ahí el plan de mensualidades es del cargo original y fusionarlos
daría una mensualidad que no existe.

Al activar el toggle aparece un `<select>` con dos `<optgroup>`, ambos filtrados por la tarjeta
elegida en el formulario (la regla vive en `js/utils/acumular.js`, probada en
`test/acumular.test.mjs`):

- **Notificaciones pendientes** — de [`notificaciones`](#notificacionesid). Se filtran resolviendo
  `datos.tarjeta` con `matchTarjetaPorTerminacion`, porque el documento no guarda `tarjetaId`. Si
  el modal se abrió *desde* una notificación, esa se excluye: no tiene sentido acumularse consigo
  misma (se detecta por `msgId`).
- **Compras registradas** — las 5 más recientes de contado de esa tarjeta.

Comportamiento:

- La colección de notificaciones se carga **al activar el toggle**, no en `_loadData`: así los
  otros dos modales del FAB no pagan una lectura extra por abrirse.
- Cambiar de tarjeta repuebla el select; cambiar de opción o de total repinta la nota con el
  **total resultante** y con lo que va a pasar con el origen.
- La **vista previa incluye lo acumulado** (`extraTotalFn` en `_wirePreview`). Sin eso mentiría
  justo en lo que sirve para decidir: disponible e impacto del mes.
- Al guardar, el total es la suma. Después de crear la compra —nunca antes— se cierra el origen:
  una **compra registrada** se elimina (su monto quedó absorbido); una **notificación** pasa a
  `estatus: procesada`. El orden importa: al revés, un fallo dejaría una compra borrada sin nada
  que la reemplace, mientras que así lo peor que puede pasar es una notificación pendiente de más,
  que se descarta a mano.

---

## Navegación y Routing

La app usa **hash routing** (`#/ruta`) para compatibilidad con GitHub Pages sin configuración adicional de servidor.

| Ruta | Módulo | Descripción |
|---|---|---|
| `#/` | dashboard.js | Dashboard principal |
| `#/tarjetas` | tarjetas.js | Vista wallet de tarjetas |
| `#/compras` | msi.js | Compras y Gastos (De Contado + A Plazos + Gastos); `#/compras/gastos` abre directamente la pestaña Gastos |
| `#/msi` | — | Redirige a `#/compras` (compatibilidad) |
| `#/notificaciones` | notificaciones.js | Compras detectadas en el correo, pendientes de registrar |
| `#/fijos` | fijos.js | Gastos fijos |
| `#/impacto` | impacto.js | Mes actual |
| `#/impacto/2026-05` | impacto.js | Mes específico |
| `#/rendimientos` | rendimientos.js | Cuentas de inversión y sus rendimientos |
| `#/eventos` | eventos.js | Lista de eventos |
| `#/eventos/{id}` | evento-detalle.js | Detalle de evento |
| `#/admin` | admin-tarjetas.js | CRUD instituciones y tarjetas |
| `#/festivos` | festivos.js | Catálogo de festivos MX |
| `#/ajustes` | ajustes.js | Ajustes de la app (absorbió Exportar Datos) |
| `#/exportar` | — | Redirige a `#/ajustes` (compatibilidad) |

Los módulos se cargan de forma **lazy** (`import()` dinámico).

**Sidebar (escritorio):**
- **Principal:** Dashboard, Tarjetas, Compras y Gastos, Notificaciones, Impacto Mensual, Rendimientos
- **Administración:** Instituciones y Tarjetas, Gastos Fijos, Días Festivos — catálogos que se dan
  de alta una vez y el resto de la app consulta. No confundir con `#/ajustes`, que son los ajustes
  de la app y vive en el pie
- **Footer:** Ajustes, Cerrar Sesión

**Bottom nav (móvil):** Tarjetas · Compras y Gastos · **Dashboard** · Impacto · Rendimientos.

- El Dashboard va **al centro**, no en un extremo: es el destino más frecuente y el centro de la
  barra es lo más cómodo con el pulgar.
- Los cinco lugares son destinos. **No hay botón de Menú**: el cajón se abre con la hamburguesa
  del header, y ese hueco rinde más como acceso directo a Rendimientos.
- Los ítems duplicados en la bottom nav se ocultan del sidebar en móvil (`data-hide-mobile`), así
  que el cajón queda con lo que no cabe abajo: Notificaciones, Administración y el pie.

> **Eventos de Ofertas está oculto del nav** en ambos tamaños. La ruta `#/eventos` y su módulo
> siguen funcionando; solo se quitó el acceso desde el menú. El bloque está comentado en
> `index.html`, listo para devolverlo.

---

## Pre-registro de Compra vía URL

> **Camino secundario.** El Apps Script ya no manda este enlace: ahora escribe un documento en
> [`notificaciones`](#notificacionesid) y la compra se registra desde
> [`#/notificaciones`](#notificaciones-notificaciones). Esta ruta se conserva para que los correos
> viejos que sigan en la bandeja funcionen, y por si alguna vez conviene volver a mandar un enlace
> precargado. **Las dos entradas comparten la misma traducción**
> (`prefillDesdeDatos` en `js/utils/prefill-compra.js`): lo que se describe abajo sobre resolución
> de tarjeta, anti-duplicado, mensualidad y hora aplica igual a las notificaciones, que traen esos
> mismos campos desde Firestore en vez de la URL.

Un enlace externo puede abrir la app con `#/compras?desc=...&total=...` y precargar el modal de
Registro Rápido con los datos de la compra, lista para revisar y confirmar. No se guarda nada
automáticamente — el usuario siempre confirma en el modal antes de escribir en Firestore.

### Parámetros

Siete parámetros, siempre en este orden dentro del hash. Los que no aplican a una compra de
contado (`meses`, `mensualidad`) **se omiten del query string**, nunca llegan vacíos.

| Parámetro | Formato | Presencia | Notas |
|---|---|---|---|
| `desc` | texto libre | Siempre | Descripción de la compra |
| `total` | decimal con punto | Siempre | Cargo real a la tarjeta, sin símbolo ni separador de millares (`1372.23`) |
| `fecha` | `AAAA-MM-DD` | Siempre | Fecha de la compra |
| `hora` | `HH:MM` 24h | Siempre | Hora de la compra |
| `tarjeta` | 4 dígitos | Siempre | Terminación de la tarjeta; `NA` si no se pudo determinar |
| `meses` | entero, 3–24 | Solo a plazos | Número de mensualidades. Su sola presencia es lo que marca la compra como A Plazos |
| `mensualidad` | decimal con punto | Solo a plazos | Pago mensual real, siempre junto con `meses` |
| `msgId` | texto | Siempre | Llave de idempotencia — no es un dato de la compra |

```
#/compras?desc=Oxxo%20Casa&total=271.00&fecha=2026-08-02&hora=10:44&tarjeta=4902&msgId=1a0f...
#/compras?desc=API%20Global&total=1372.23&fecha=2026-07-27&hora=17:10&tarjeta=6734&meses=6&mensualidad=228.71&msgId=19fa...
```

### Cómo se procesa

**Router (`router.js`):** el hash se separa en ruta y query **antes** de decodificar — si se
decodificara todo junto, un `%26` dentro de un valor se volvería un separador real y
`URLSearchParams` cortaría el valor ahí. La ruta `/compras` recibe el query como tercer
argumento (`URLSearchParams`) y lo pasa a `msi.js` (`js/app.js`).

**Tipo de compra:** lo decide la *presencia* de `meses`, no un parámetro `tipo` aparte. Sin
`meses` → De Contado; con `meses` → A Plazos (`msi.js` → `render()`).

**Resolución de tarjeta (`matchTarjetaPorTerminacion`):** busca la terminación solo entre
tarjetas de **crédito** — los selectores de Compras y Registro Rápido no listan débito, así que
casar con una de débito dejaría el campo sin opción correspondiente. Si la terminación aparece
en más de una tarjeta o número, **gana la física**: es la que suele aparecer en el cargo del
banco, y el orden en que vienen los números no lo garantiza. Sin coincidencia (incluye
`tarjeta=NA`), el modal abre sin tarjeta preseleccionada.

**Anti-duplicado:** `msgId` se busca en **ambas** colecciones (`contado` y `msi`), no solo en la
del tipo que trae el enlace — desde el modal se puede cambiar de tipo antes de guardar, así que
un mismo `msgId` puede haber terminado en cualquiera de las dos. Si ya existe, no se abre modal
y se muestra un toast; si no, `prefillDesdeDatos` arma el objeto de precarga (`_prefillDesdeQuery`
en `msi.js` es solo el envoltorio que le pasa el query string convertido a objeto plano).

**Mensualidad:** si el enlace la trae, tiene prioridad sobre el cálculo `total / meses` del
modal — puede no coincidir exactamente por redondeos del banco.

**Hora:** viaja como campo explícito (`datos.hora`), no se deduce del datetime combinado. La
razón: en el resto de la app, `T12:00:00` es el centinela interno de "sin hora capturada"
(`_hasRealTime`), así que una compra real a las 12:00 en punto se habría perdido al reconstruirla
desde el datetime.

**Limpieza de la URL:** al procesar el query, `history.replaceState` quita `?...` de la barra de
direcciones sin disparar `hashchange` — así un refresh o "atrás" no reabre el modal con datos
viejos.

### El modal

El pre-registro abre el modal del **Registro Rápido** (`quick-add.js` → `openQuickAdd(action,
prefill, onSaved)`), no los modales propios de la vista de Compras — trae la vista previa
(fechas de ciclo, disponible/usado, impacto del mes), que es justo lo que conviene revisar antes
de aceptar un dato que no capturó el usuario directamente.

Con precarga (y solo con precarga) aparece un botón para cambiar de tipo sin recapturar nada:
**"Es a plazos"** en el modal De Contado, **"Es de contado"** en el de A Plazos. Arrastran lo que
el usuario tenga en pantalla en ese momento (`_leerFormulario`), no solo lo que trajo el enlace,
y esperan a que el modal actual termine de cerrarse (`hidden.bs.modal`) antes de abrir el otro —
abrirlos encima dejaría un backdrop huérfano.

> `openModal` (`utils/ui.js`) descarta la instancia de Bootstrap y cualquier `.modal-backdrop`
> suelto antes de montar un modal nuevo. Es necesario para este encadenamiento: sin eso, el
> segundo salto entre modales dejaba un backdrop con `opacity .5` bloqueando toda la pantalla.

---

## Ciclo de Facturación

El módulo `js/utils/ciclo.js` calcula las fechas de corte y pago de cada tarjeta de crédito/préstamo, ajustando automáticamente a días hábiles usando el catálogo de festivos MX.

### Estructura del objeto `ciclo`

| Campo | Tipo | Descripción |
|---|---|---|
| `metodoCiclo` | string | `a`, `b` o `c` (ver modos abajo) |
| `diaCorte` | number? | Día de corte (modos A y B) |
| `diaPago` | number? | Día de pago fijo (modos A y C) |
| `diasAlPago` | number? | Días desde el corte hasta el pago (modo B) |
| `diasAlCorte` | number? | Días antes del pago que ocurre el corte (modo C) |
| `ajusteCorte` | string | `siguiente` o `anterior` — dirección del ajuste a día hábil |
| `ajustePago` | string | `siguiente` o `anterior` — dirección del ajuste a día hábil |
| `baseCalculo` | string? | `original` o `ajustado` — base para calcular el otro extremo |

### Modos de cálculo

**Modo A — Días fijos:**
- Corte: día fijo del mes (`diaCorte`)
- Pago: día fijo del mes (`diaPago`); si `diaPago ≤ diaCorte`, el pago cae el mes siguiente

**Modo B — Días desde el corte:**
- Corte: día fijo del mes (`diaCorte`)
- Pago: `diaCorte + diasAlPago` días

**Modo C — Días antes del pago:**
- Pago: día fijo del mes (`diaPago`)
- Corte: `diaPago - diasAlCorte` días antes del pago

### Ajuste a día hábil
Si la fecha calculada cae en fin de semana o festivo, se mueve al día hábil `siguiente` o `anterior` según la configuración de cada tarjeta. Se aplica por separado a corte y pago.

### API pública de `ciclo.js`

```javascript
// Fechas de corte y pago para un mes específico
calcularMes(ciclo, year, month, festivosMX) → { fechaCorte: Date, fechaPago: Date }

// Período actual abierto (avanza al siguiente mes si hoy ya pasó el corte)
periodoActual(ciclo, festivosMX) → { fechaCorte: Date, fechaPago: Date }

// Depósito de nómina anterior a una fecha dada
anteriorNomina(date, festivosMX) → Date

// Convierte Date a string 'YYYY-MM-DD'
toISODate(date) → string
```

---

## Cálculo de Saldo Disponible

El módulo `js/utils/saldo.js` exporta `calcularSaldo` para obtener el saldo real de una tarjeta de crédito o préstamo aplicando las compras y gastos posteriores a la última actualización manual.

```javascript
calcularSaldo(tarjeta, contado, msi, gastos)
→ { disponible: number, usado: number|null, ajustado: boolean, gastoPosterior: number } | null
```

**Lógica:**
1. Toma `tarjeta.saldoDisponible` como base
2. Suma todos los items de `contado`, `msi` y `gastos` (`estado: 'registrado'`) donde:
   - `tarjetaId === tarjeta.id`
   - Si `fechaActualizacionSaldo` está seteada: `fechaCompra`/`fechaPago` > `fechaActualizacionSaldo`
   - Si `fechaActualizacionSaldo` es `null`: **se restan todas las compras** (sin filtro de fecha)
3. `disponible = max(0, saldoDisponible - gastoPosterior)`
4. `usado = limiteTotal - disponible`
5. `ajustado = gastoPosterior > 0`

**Usos:**
- `admin-tarjetas.js`: columnas Saldo disponible (verde/negro) y Saldo usado en la tabla
- `tarjetas.js`: chip "Usado" en el frente del plástico; chips "Límite" y "Disponible" en la franja del reverso
- `impacto.js`: columna Disponible en la tabla de tarjetas del mes activo + métrico total de crédito disponible
- La acción **Pagar mensualidad** en A Plazos suma la mensualidad a `saldoDisponible` en Firestore sin tocar `fechaActualizacionSaldo`

> `calcularCicloParaMes` revisa 3 meses (actual, anterior y siguiente) para identificar correctamente el período de facturación incluso cuando la fecha de pago cae en día 1 del mes.

---

## Cálculo de Impacto Mensual

El módulo `js/utils/impacto-calc.js` concentra toda la lógica de cálculo del Impacto. Exporta:

```javascript
// Período del ciclo que contiene una fecha de compra
calcularCicloParaMes(ciclo, mes, festivosMX) → { fechaCorte, fechaPago } | null

// Compras de contado para una tarjeta cuya anteriorNomina(fechaPago_ciclo) cae en mes
getContadoMes(contado, tarjetaId, ciclo, mes, festivosMX) → items[]

// Mensualidades A Plazos cuyo próximo pago (anteriorNomina) cae en mes
getPlazosMes(msi, tarjetaId, ciclo, mes, festivosMX) → items[]

// Gastos crédito confirmados cuya anteriorNomina(fechaPago_ciclo) cae en mes
getGastosCreditoMes(gastos, tarjetaId, ciclo, mes, festivosMX) → items[]

// Gastos débito del mes (con gastos fijos incluidos por estado)
getGastosDebitoCompleto(gastos, gastosFijos, mes, debitoIds, tarjetas, festivosMX) → items[]

// Estimados de una tarjeta para un mes
calcularEstimadoTarjeta(tarjeta, contado, msi, gastos, festivosMX, mes) → { estimadoContado, estimadoPlazos, estimadoGastos, estimadoTotal }

// Totales de crédito desde tarjetas[] del impacto
calcularTotalesCredito(tarjetasImpacto) → { creditoTotal, creditoDisponible, deudaTotal }

// Totales en tiempo real para impacto activo
// saldoVivoMap: { [tarjetaId]: number } — saldo calculado por calcularSaldo, omite tarjetas con saldoDispConf
recalcTotalesImpacto(impacto, gastosDebitoLive, nominaOverride?, saldoVivoMap?) → totales

// Proyección de un mes futuro con pago progresivo simulado
// gastosFijosItems se incluyen solo si no existe ya un registro confirmado cuyo `mes`
// coincida con el mes proyectado o con el mes del corte del ciclo de pago (mesCorte)
proyectarMes(mes, currentMes, msi, contado, gastos, tarjetasCredito, nominaAprox, festivosMX, gastosFijos?, todasTarjetas?, pagosDiferidos?) → impactoData
```

**Criterio clave de asignación al mes**: una compra/gasto pertenece al Impacto del mes `M` si `anteriorNomina(fechaPago_del_ciclo_que_contiene_la_fecha_de_compra)` cae dentro del mes `M`.

---

## Cálculo de Rendimientos

El módulo `js/utils/rendimiento.js` concentra el cálculo de rendimientos de las cuentas de inversión.

### Modelo de tasa

**Aplicación de los tramos** — configurable por cuenta en `modoTramos`. Con tramos `0–25k @15%`, `25k–100k @7%`, `100k+ @5%` y un saldo de $150,000:

| Modo | Cálculo | Anual |
|---|---|---|
| `progresivo` (default) | `$25,000×15% + $75,000×7% + $50,000×5%` | $11,500 |
| `unico` | `$150,000 × 5%` — solo el tramo donde cae el saldo | $7,500 |

`progresivo` es el modelo de las cuentas de rendimiento mexicanas; Revolut lo llama *"tasa promedio ponderada, según el monto de dinero que tengas en cada nivel"*.

`unico` existe para productos que operan por escalón. Produce discontinuidades — con $100,000 se ganan $7,000 anuales y con $100,001 solo $5,000 — que en `progresivo` no ocurren.

**Interpretación de la tasa** — configurable por cuenta en `modoTasa`. Es la decisión que más desvía el resultado si se elige mal: con la misma tasa publicada, `nominal` genera del orden de 5% a 8% más interés diario que `efectiva`.

| Modo | Tasa diaria | Un año de capitalización | GAT |
|---|---|---|---|
| `nominal` (default) | `tasa / base` | rinde **por encima** de la tasa publicada | mayor que la tasa |
| `efectiva` | `(1 + tasa)^(1/base) − 1` | rinde **exactamente** la tasa publicada | igual a la tasa |

Con 12% sobre $10,000 durante un año: `nominal` deja $1,274 (GAT 12.75%) y `efectiva` deja $1,200 (GAT 12%).

> Ambas interpretaciones existen en el mercado mexicano y las instituciones no siempre lo dicen. **El modo se verifica contra un abono real, no se supone** — ver la sección de verificación abajo.

**Composición.**

```
saldo_{d+1} = saldo_d + interesDiario(saldo_d) − isrDiario(saldo_d)
```

Como la tasa depende del saldo y el saldo crece cada día, la composición se resuelve **iterando día a día**; no hay fórmula cerrada. El bucle está acotado a 100 años para blindar el cálculo contra fechas mal capturadas.

**GAT Nominal.** Se reporta como lo publican las instituciones: **antes de impuestos** y con tantas capitalizaciones como días tenga la base del producto — no 365 días reales. Con `baseAnual: 360`, una tasa nominal de 15% da `(1 + 0.15/360)^360 − 1 = 16.18%`. Usar 365 iteraciones sobre una base de 360 daría 16.42% y no cuadraría con lo publicado.

**Tasa ponderada.** Es el promedio de las tasas de los tramos pesado por el dinero que hay en cada uno. Se calcula **sobre las tasas configuradas**, no a partir del interés diario, así que no depende de `base` ni de `modoTasa` y sigue siendo comparable con lo que muestra la app del banco.

**Retención de ISR** — configurable por cuenta en `isrSobre`:

| Modo | Fórmula | Significado de `isrAnual` |
|---|---|---|
| `capital` (default) | `saldo × (isrAnual/100) / baseIsr` | Tasa **anual** sobre el capital — así opera México |
| `interes` | `interesBruto × (isrAnual/100)` | Porcentaje **directo** de lo ganado; no se anualiza ni usa `baseIsr` |

En ambos casos se descuenta cada día **antes** de capitalizar, porque lo que se reinvierte es el interés neto. Los montos que muestra la UI (diario, mensual, anual, hasta hoy) son **netos** — es lo que realmente se abona. La tasa ponderada y el GAT se reportan **brutos**, que es como los publica la institución.

> Con `isrSobre: 'interes'` el neto nunca puede ser negativo (la retención es una fracción de lo ganado). Con `isrSobre: 'capital'` sí puede serlo si la retención supera al interés — es un escenario real y el motor lo permite, acotando el saldo a cero.

> **Por qué `baseIsr` es un campo aparte:** las dos bases no siempre coinciden. Revolut MX lo documenta explícitamente — *"las retenciones fiscales […] se calculan sobre la base de un año de 365 días, mientras que los pagos de intereses diarios se calculan sobre la base de un año de 360 días"*.

### Redondeo diario

Cómo se capitalizan el interés y el ISR de cada día — configurable por cuenta en `redondeoDiario`:

| Modo | Cómo paga | Cuándo usarlo |
|---|---|---|
| `continuo` (default) | Bruto e ISR exactos, sin redondear | Instituciones que solo muestran un neto ya limpio — no hay nada contra qué comparar centavo a centavo |
| `centavos` | Bruto e ISR se redondean cada día, **de forma independiente**, antes de sumarse al saldo | Cuentas donde se ve el abono y la retención como dos movimientos discretos en el estado de cuenta |
| `acumulado` | Bruto e ISR llevan cada uno un **remanente fraccionario**: se suma el exacto de cada día y se paga el centavo completo que ya se juntó; la fracción sobrante sigue viva para el día siguiente | Igual que `centavos`, pero sin perder ni ganar centavos con el paso del tiempo |

El remanente de `acumulado` se reinicia a cero en cada ancla — la fracción de centavo que llevaba no es observable en una captura real, mismo criterio que `residuo` (ver *Modelo de eventos*).

**Motivación (Revolut MX, 2026-08-10).** Con `continuo`, una fila podía mostrar Bruto $2.09 e ISR $0.12 pero "Rendimiento del día" $1.96 — 2.09 − 0.12 = 1.97, no 1.96. La causa: `historialDiario` redondeaba el **neto exacto** (bruto − isr sin redondear) para mostrarlo, en vez de restar los dos importes que también muestra, ya redondeados. `centavos` y `acumulado` no tienen ese problema por construcción: lo que se muestra en Bruto/ISR ya es lo que se pagó, así que la resta siempre cuadra.

**Verificación extendida.** Se comparó el estado de cuenta real de Revolut contra los tres modos, día por día, sobre los 188 días entre el primer depósito y el cierre (dos depósitos y un retiro de por medio):

| Modo | Días exactos | Diferencia acumulada (con signo) | Ruido total (suma de \|diferencias\|) |
|---|---|---|---|
| `continuo` | 116/188 | $0.19 | $0.73 |
| `centavos` | 118/188 | $0.20 | $0.72 |
| `acumulado` | 117/188 | $0.20 | $0.76 |

Los tres quedan **estadísticamente empatados** — ninguno le gana claramente a los otros sobre el periodo completo. Si Revolut usara alguno de estos tres esquemas puros, ese modo debería acertar sensiblemente más días que los otros dos, y no pasa. La explicación más plausible es que Revolut calcula internamente con más precisión (o con una convención de redondeo) que no se puede inferir solo del estado de cuenta — el ±1 centavo que queda es esa diferencia entre su representación exacta y la nuestra, no un patrón replicable.

> **Descartado: no es un problema de movimientos.** Se sospechó primero que un aporte/retiro podía estar rindiendo sobre el saldo equivocado (un `movimiento` rinde sobre el saldo VIEJO su propio día de llegada — ver *Modelo de eventos*). Un primer script de verificación pareció confirmarlo: desviaciones de ~$3.90 justo los tres días con depósito/retiro. El error estaba en el script, no en el motor — comparaba la fila de la app contra la fecha real corrida un día de más. Alineando las fechas directo, los tres días de movimiento (12 feb, 21 abr, 4 ago) cuadran exactos; la regla de eventos está bien.

`acumulado` no le gana a `centavos` en aciertos día a día, pero es preferible porque **no degrada con el tiempo** — nunca pierde ni gana un centavo, solo lo reacomoda. El default de `redondeoDiario` sigue siendo `continuo` (no cambia el comportamiento de ninguna cuenta existente); la cuenta Revolut de este caso se configuró manualmente en `acumulado`. A la escala de este caso ($0.20 sobre $25,500 en 6 meses, 0.0008%), la elección entre los tres es casi cosmética.

### Verificación contra instituciones reales

El motor no se da por bueno con un cálculo plausible: cada configuración se contrasta contra un abono real y contra las cifras que publica la institución. Dos casos verificados, deliberadamente opuestos entre sí:

| | Caso A | Caso B |
|---|---|---|
| Aplicación | progresiva | progresiva |
| Interpretación | **nominal** | **efectiva** |
| Base del interés | 360 | 365 |
| Base del ISR | 365 | — |
| ISR en el abono diario | descontado | **no descontado** |

Que dos instituciones del mismo mercado operen de forma tan distinta es la razón de que `modoTasa`, las bases y el ISR sean configurables por cuenta y no constantes del motor.

> **Cuidado con ajustar a un solo dato.** Durante el desarrollo, dos parámetros equivocados a la vez (ISR 0.70% con ambas bases en 365) reprodujeron el abono real al centavo por pura compensación. Un abono aislado no distingue entre combinaciones: hace falta la documentación de la institución, o varios datos independientes, para fijar cada parámetro.

#### Caso A — Revolut MX (2026-08-05)

Configuración: tramos 15% / 7% / 4.5%, `modoTasa: 'nominal'`, `baseAnual: 360`, `isrAnual: 0.90`, `baseIsr: 365`.

| Concepto | Módulo | Revolut |
|---|---|---|
| Interés bruto del día (saldo $25,468.87) | $10.5078 | — |
| Retención ISR | −$0.6280 | — |
| **Interés neto abonado** | **$9.8798 → $9.88** | **$9.88** |
| **Saldo resultante** | **$25,478.7498** | **$25,478.75** |
| **Tasa ponderada** | 14.849679% → **14.84%** | **14.84%** |
| GAT Nominal del tramo 15% | 16.1798% → 16.18% | 16.18% |
| GAT Nominal del tramo 7% (Estándar) | 7.2501% → 7.25% | 7.25% |
| GAT Nominal del tramo 7.50% (Metal, sin costo de plan) | 7.7876% → 7.79% | 7.79% |

> **Convenciones de despliegue** (verificadas, no supuestas):
> - La **tasa ponderada se trunca**: 14.849679% se muestra como `14.84%`, no `14.85%`. Se descartó el redondeo por eliminación — ningún saldo cercano al real redondea a 14.84%. Las instituciones no exhiben la tasa por encima de lo que pagan. Configurable por cuenta en `redondeoTasa` para instituciones que sí redondeen.
> - El **GAT se redondea**: 16.1798% → `16.18%` y 7.7876% → `7.79%`, tal como aparecen en los pies de página de Revolut (truncados darían 16.17% y 7.78%). No es configurable — es una cifra regulada con convención uniforme.
>
> Por eso el módulo usa dos formateadores: `pctTrunc` y `pct`. La tasa ponderada elige uno según `redondeoTasa`; el resto siempre usa `pct`.

> Los GAT del folleto que incluyen el costo anual del Plan (Metal −0.57%, Premium 9.03%) quedan fuera de alcance: el módulo no modela comisiones de plan.

> **Tasas de retención de Revolut MX:** 0.90% clientes nacionales · 4.90% extranjeros. Para otras instituciones hay que consultar la tasa vigente de la LIF.

#### Caso B — Mercado Pago MX (2026-08-06)

Configuración: tramos `$25,000 @ 12%` y el resto `@ 5.3%` (así lo publica la app), `modoTasa: 'efectiva'`, `baseAnual: 365`, `isrAnual: 0`.

| Concepto | Módulo | Mercado Pago |
|---|---|---|
| Interés del día (saldo $25,249.70) | **$7.798782 → $7.79** | **$7.79** |
| Saldo resultante | **$25,257.4988** | **$25,257.49** |

Se enumeraron las 32 combinaciones de *interpretación × base × modo de ISR × redondeo*, y **una sola** reproduce el abono: tasa **efectiva**, base 365, **sin ISR descontado del abono diario** y truncando a centavos. Con la interpretación nominal el cálculo se iba ~8% arriba.

> **Pendiente:** el abono diario llega bruto, pero la institución sí retiene ISR. Lo más probable es que lo cobre por separado (mensual) en lugar de por abono. Mientras eso no se confirme contra un estado de cuenta, la cuenta va con `isrAnual: 0` — el diario coincide con lo que se ve, a costa de que la proyección anual quede optimista por el monto de la retención.

### Modelo de eventos (anclas, movimientos y ajustes)

El motor no calcula solo a partir de dos puntos observados: cada cuenta es una lista de **eventos** ordenados que `eventosCuenta(cuenta)` arma a partir de tres fuentes distintas y `recorrer()` (interno) aplica día a día:

| Evento | De dónde sale | Qué hace |
|---|---|---|
| **Ancla** | `montoInvertido`/`fechaActualizacion` + `historial[]` (vía `timelineCuenta`) | Un saldo real observado. Lo observado manda: reemplaza el saldo proyectado y absorbe en silencio cualquier residuo, salvo que ese residuo ya tenga un ajuste explícito ese día |
| **Movimiento** | `movimientos[]` | Un aporte o retiro. Su propio día de llegada rinde sobre el saldo **viejo** (el que había antes de sumarlo) — el saldo nuevo recién empieza a componer desde el día siguiente, igual que en la realidad: el dinero que entra a mediodía no generó interés esa madrugada |
| **Ajuste** | `ajustes[]` | Una corrección al rendimiento que el modelo no supo predecir. A diferencia del movimiento, sí compone ese mismo día sobre el saldo ya con la corrección incluida |

Dentro de una misma fecha el orden de aplicación es siempre **movimiento → ajuste → ancla** (`ORDEN_EVENTO`): la ancla cierra el día porque es el dato observado, y debe ganarle a cualquier proyección previa.

Se cumple siempre:

```
saldoFinal = saldoInicial + rendimiento + movimientos + ajustes
```

**Conciliación.** Capturar un ajuste no le pide al usuario que calcule nada: `conciliar(cuenta, saldoReal, fecha, cfg)` compara el saldo real contra lo que el motor proyectaba desde la ancla anterior y devuelve el `residuo`. El modal de **Ajuste** clasifica ese residuo como *deriva del cálculo* (ajuste tipo `saldo`, ver [`inversiones/{id}`](#inversionesid)) o *aportación/retiro no registrado* (redirige a Movimientos), y calcula además una `derivaAnual` — el residuo anualizado sobre el capital — que sirve para detectar una configuración equivocada (base, interpretación de la tasa, redondeo) cuando se repite captura tras captura con el mismo signo.

**Recálculo en cascada.** Un ajuste marcado `derivado: true` absorbe *todo* el residuo de la ancla en la que vive, así que si algo anterior cambia (se edita el monto o la fecha de una ancla previa, o se registra retroactivamente un movimiento) ese residuo ya no es el mismo. `recalcularAjustes(cuenta, cfg)` recalcula el importe de cada ajuste derivado dejando intacto el motivo y sin tocar los que el usuario dimensionó a mano (`derivado: false`, o sueltos sin ancla ese día). La UI (`ajustesTrasEditar`) nunca aplica esto en silencio: si algún importe cambia, pide confirmación mostrando el antes/después de cada uno.

**Corrección de la raíz.** Editar `fechaActualizacion` a una fecha más vieja que capturas que ya había en `historial` deja esas capturas "en el futuro" respecto a la nueva raíz — dejan de poder representarse como su historial. `capturasDescartadas`/`historialConsistente` detectan y limpian ese caso; la UI (`historialTrasCorregirRaiz`) siempre pide confirmación explícita antes de descartar nada — es la forma de arrancar una cuenta vieja desde otro punto de partida sin reconstruir todo el camino intermedio.

**Transferencias.** Un traspaso entre dos cuentas del módulo se guarda como dos movimientos espejo unidos por `transferenciaId` (ver [`inversiones/{id}`](#inversionesid)) — cada cuenta se sigue calculando sola. Para el motor no son nada especial: cada pata es un movimiento común, así que ninguna de las dos cuentas la cuenta como rendimiento, y el dinero en tránsito (si `fechaDestino` es posterior a la salida) no genera interés en ninguna de las dos mientras viaja.

### Calendario de abono

Devengar y abonar no son lo mismo, aunque en la mayoría de las cuentas coincidan. El dinero **trabaja** todos los días naturales; lo que cambia entre instituciones es cuándo el interés ganado se **acredita** al saldo — y hasta que no se acredita, no compone. Lo controla `calendarioAbono` en el documento de la cuenta:

| Valor | Devenga | Abona | Quién opera así |
|---|---|---|---|
| `natural` (default) | todos los días | el mismo día | Fintech (Revolut, Nu, Mercado Pago). Idéntico, peso a peso, al comportamiento previo a este campo |
| `habilAcumula` | todos los días | el acumulado, el siguiente día hábil | Bancos y pagarés que no mueven dinero en fin de semana ni festivo |
| `habilSolo` | solo días hábiles | ese día | Fondos de inversión, que solo tienen precio los días que abre el mercado |

La regla que lo ordena todo es una sola:

```
fecha de abono del devengo del día D = siguiente día hábil desde D
```

Va sobre el propio día `D`, no sobre `D+1`, porque así presenta la app el dato en todos lados: el renglón de `historialDiario` de un día es lo que la institución movió **ese** día (de ahí el corte de las 7am de `hoyISO`, que espera a que la madrugada haya abonado antes de contar el día como propio). Bajo esa convención un sábado muestra `$0` de abono y el lunes el acumulado del puente — literalmente lo que se ve en la app del banco.

Lo devengado y todavía sin acreditar vive en **`pendiente`**, fuera del saldo, que es exactamente donde lo tiene la institución. Es lo que arregla el residuo espurio de fin de semana: antes, conciliar un domingo comparaba el saldo real (congelado desde el viernes) contra un saldo proyectado que ya había compuesto sábado y domingo, y la diferencia se reportaba como deriva del cálculo. Ahora `saldoEsperado` excluye lo pendiente y `conciliar` lo devuelve por separado.

Distinguir `habilAcumula` de `habilSolo` importa porque el costo de confundirlas es de órdenes distintos: la primera solo retrasa la composición un par de días (centavos al año, verificado en las pruebas), la segunda quita ~104 días de devengo — cerca de **28% menos** de rendimiento anual.

**De dónde salen los días inhábiles.** Los fines de semana son gratis (se derivan de la fecha) y los festivos vienen de la colección `festivosMX`, la misma que ya usa el ciclo de las tarjetas. Como son una propiedad del país y no de la cuenta, y llegan de Firestore de forma asíncrona mientras que las entradas del motor (`resumenCuenta`, `historialDiario`) son síncronas, viven en un **registro de módulo**: la vista los carga una vez con `registrarInhabiles(festivosMX)` antes de calcular nada, y `configCuenta` los fotografía dentro de la `cfg` para que el cálculo en sí siga dependiendo solo de sus argumentos. Los llaman `js/modules/rendimientos.js` y `js/modules/dashboard.js`. Sin festivos registrados el cálculo degrada a solo fines de semana, que es la mayor parte del efecto — el formulario avisa cuando ese es el caso.

**En la tabla no hay renglones inhábiles.** El motor sí devuelve un renglón por día natural —lo necesita para componer—, pero `plegarDiasInhabiles` los quita antes de pintar: un sábado no aporta nada que mirar (mismo saldo que el viernes, interés sin acreditar) y como fila propia parte en tres cifras un rendimiento que la institución reporta como **un solo abono**, que además es la única cantidad contra la que se puede corregir. El día del abono se queda con el acumulado y con el detalle en el tooltip. El botón *corregir* opera sobre esa cifra única.

**Encadenar la bolsa.** `recorrer()` y `componer()` aceptan un `pendienteInicial` y lo devuelven al cerrar. No es opcional para quien avanza de a un día: `historialDiario` llama `recorrer()` con tramos de un solo día, y si cada tramo arrancara la bolsa en cero, el interés del sábado se perdería en el corte entre un renglón y el siguiente.

**El saldo de la tabla es siempre cents-precise.** `bruto`, `isr` y `neto` son la fórmula tal cual la calcula el motor — exactos, sin redondear, útiles para las columnas "(exacto)" del reporte. Pero `abonado`, `pendiente` y `saldoFinal` representan dinero que ya se movió (o que ya se sabe cuánto vale, esperando abonarse), y el dinero real nunca tiene fracción de centavo: `historialDiario` los redondea a centavos antes de encadenarlos al siguiente renglón (`const r2 = n => Math.round(n * 100) / 100`, independiente del `redondeoDiario` de la cuenta, que sigue gobernando solo la composición interna de `interesDiario`/`isrDiario`). El resultado es un invariante fuerte: sumar lo que la tabla **muestra** (capital + cada `abonado` + cada `movimiento` + cada `ajuste`) da exactamente el `saldoFinal` que la tabla **muestra** en el último renglón — no una cifra un centavo distinta por haber compuesto internamente con precisión de punto flotante y redondeado solo al final.

Un detalle que importa para no reintroducir deriva: la bolsa `pendiente` NO se redondea mientras sigue pendiente — solo cuando se convierte en `abonado` al acreditarse. Redondearla en cada día que queda en el limbo (un puente largo) compone el error de redondeo una vez por día en vez de una sola vez, y ese fue exactamente el bug que motivó esta nota (una cuenta con capital + ajuste + varios días de interés mostraba el `saldoFinal` un par de centavos corrido de lo que daba sumar a mano las cifras de la tabla). `historialDiario` mantiene por eso dos variables por separado: `cierreSaldo` (encadenado ya redondeado, porque es dinero que se movió) y `cierrePendienteExacta` (encadenado sin redondear, porque todavía no es dinero acreditado — el campo `pendiente` que se *devuelve* en cada fila sí va redondeado, solo para mostrar).

`componer()` (usado por `mensual`/`anual`/`gat`/`proyBruta`, que proyectan hacia adelante desde un `saldoActual` ya congelado) no cambió: sigue exacto o redondeado según `cfg.redondeo`, sin este ajuste — por eso `historialDiario(...).saldoFinal` y `componer(capital, dias, cfg).saldoFinal` ya no son exactamente iguales para una cuenta `continuo` (divergen por un par de centavos sobre periodos largos, un ruido acotado que no crece linealmente — verificado hasta 2 años de simulación). Es la diferencia correcta: uno es "lo que ya pasó, en centavos reales"; el otro, "una proyección matemática hacia un periodo que todavía no ocurrió".

### Vigencias de tasa

Las instituciones cambian la tasa que publican de vez en cuando. El saldo que ya estaba invertido siguió ganando la tasa **vieja** hasta el día del cambio — recalcular todo el historial con la tasa nueva falsearía lo ganado antes. Por eso una cuenta no tiene una sola tasa: tiene una línea de tiempo de **vigencias**, cada una con sus propios tramos, `modoTramos` y `modoTasa` (ver [`inversiones/{id}`](#inversionesid)).

`tramos`/`modoTramos`/`modoTasa` en la raíz de la cuenta son la vigencia **actual** — mismo patrón que `montoInvertido`/`fechaActualizacion` para el saldo, pero para la tasa — y `tasaDesde` es desde cuándo aplica. Las vigencias superadas viven en `historialTasas`, cada una con su propio `desde`. `desde: null` significa "vigente desde el origen de la cuenta": así se comportan todas las cuentas que nunca registraron un cambio de tasa (la inmensa mayoría), y así queda la vigencia más antigua de cualquier cuenta que sí los registra.

`vigenciasTasa(cuenta)` arma la línea de tiempo completa (pasadas + actual, ascendente) y `configCuenta` la fotografía en `cfg.vigencias` — igual que hace con `cfg.inhabiles` para el calendario de abono, para que el cálculo en sí siga dependiendo solo de su `cfg`. `cfg.tramos`/`cfg.modo`/`cfg.modoTasa` siguen siendo la vigencia actual (lo que usa toda la UI que no depende de una fecha: la tarjeta, el desglose de "hoy", el GAT); solo el compuesto diario consulta `cfg.vigencias`.

**Dónde entra al cálculo.** `pasoCalendario(saldo, pendiente, cfg, fecha)` —el mismo choke point que ya resolvía el calendario de abono— resuelve con `vigenciaEnFecha(cfg.vigencias, fecha)` cuál vigencia le toca a **ese día en particular** antes de llamar a `pasoDiario`. Con una sola vigencia (el caso normal) esto es un no-op: `cfg.vigencias.length > 1` es falso y se usa `cfg` tal cual, cero costo extra. Con varias, cada día del historial, cada tramo de `recorrer()` (movimientos, ajustes, `rendimientoEntre`, `conciliar`) y cada renglón de `historialDiario` usa la tasa correcta para su propia fecha — el cambio se refleja automáticamente en "Calcular periodo" y en el historial diario sin ningún camino aparte.

Sin `fecha` (las proyecciones abstractas de `componer()` cuando se les omite `desde`) se usa siempre `cfg.tramos`, la vigencia actual — correcto, porque una proyección hacia adelante nunca puede caer en un periodo ya superado.

**Editar una vigencia vs. abrir una nueva.** Igual que con `montoInvertido`: si `tasaDesde` no cambia, editar los tramos corrige la vigencia actual en su sitio (una captura mal tecleada, no un cambio real). Si `tasaDesde` cambia, los tramos que había pasan a `historialTasas` tal como estaban (`pushHistorialTasa`, en `js/modules/rendimientos.js`) y los nuevos se vuelven la vigencia actual. Si la nueva `tasaDesde` es anterior a vigencias que ya había en el historial, esas quedan "en el futuro" respecto a ella y se descartan con confirmación explícita (`historialTasasTrasCorregirRaiz`) — mismo resguardo que `historialTrasCorregirRaiz` para el saldo.

**Consultar y corregir el historial.** El modal **Historial de tasas** (menú ⋮ de la cuenta) lista todas las vigencias —periodo, aplicación/interpretación y tasa— con borrado para las que ya quedaron atrás; la actual no se borra ahí, se cambia editando la cuenta. Borrar un periodo mueve el rendimiento de los días que cubría, así que pasa por el mismo resguardo de `ajustesTrasEditar` que cualquier otro cambio a la raíz del cálculo.

### API pública de `rendimiento.js`

```javascript
// Fechas
isoDay(dateOStringISO) → 'YYYY-MM-DD'
hoyISO()               → 'YYYY-MM-DD'   // hora CDMX (UTC-6 fijo); el día rueda a las 7am, no a medianoche
diasEntre(inicio, fin) → number     // días calendario completos, negativo si fin < inicio
sumarDias(iso, n)      → 'YYYY-MM-DD'

// Días inhábiles — ver Calendario de abono arriba. Registro de módulo: la vista
// lo llena una vez y configCuenta lo fotografía en la cfg.
registrarInhabiles(festivosMX)   → Set   // acepta docs {fecha} o ISO sueltos
inhabilesRegistrados()           → Set
esInhabil(fecha, inhabiles?)     → boolean   // fin de semana o festivo registrado
siguienteHabil(fecha, inhabiles?)→ 'YYYY-MM-DD'   // el primer hábil en o después de `fecha`
fechaAbono(fecha, cfg)           → 'YYYY-MM-DD'   // cuándo se acredita lo devengado ese día

// Tramos — deriva el `desde` de cada tramo, ordena, elimina solapes
// y garantiza un tramo abierto final
normalizarTramos(tramos)          → [{ desde, hasta, tasa }]
tramoActivo(tramosNorm, saldo)    → index | -1

// Constantes de modo
MODO_PROGRESIVO 'progresivo' · MODO_UNICO 'unico'
ISR_CAPITAL     'capital'    · ISR_INTERES 'interes'
TASA_NOMINAL    'nominal'    · TASA_EFECTIVA 'efectiva'
REDONDEO_CONTINUO 'continuo' · REDONDEO_CENTAVOS 'centavos' · REDONDEO_ACUMULADO 'acumulado'
ABONO_NATURAL 'natural' · ABONO_HABIL_ACUMULA 'habilAcumula' · ABONO_HABIL_SOLO 'habilSolo'

// Tipo de evento y dirección de un movimiento — ver Modelo de eventos arriba
EVENTO_ANCLA 'ancla' · EVENTO_MOVIMIENTO 'movimiento' · EVENTO_AJUSTE 'ajuste'
MOV_APORTE   'aporte' · MOV_RETIRO 'retiro'

// Valores por omisión
BASE_ANUAL_DEFAULT  365          // base del interés y del ISR
TRAMOS_DEFAULT      [{ hasta: 25000, tasa: 15 }, { hasta: 100000, tasa: 7 }, { hasta: null, tasa: 5 }]
                                 // precargados al crear una cuenta nueva

// Vigencias de tasa — ver Vigencias de tasa arriba
vigenciasTasa(cuenta) → [{ desde, tramos, modo, modoTasa }]   // ascendente; desde:null = origen
vigenciaEnFecha(vigencias, fecha) → { desde, tramos, modo, modoTasa }   // la que aplica ese día

// Configuración de cálculo — todas las funciones la reciben en lugar de una
// lista larga de parámetros posicionales. Normaliza y aplica defaults.
// tramos/modo/modoTasa son la vigencia ACTUAL; `vigencias` es la línea de
// tiempo completa, y solo la consulta el compuesto diario (pasoCalendario).
configCuenta(cuenta, inhabiles?) → { tramos, modo, modoTasa, vigencias, base, isrAnual, isrSobre,
                                     baseIsr, redondeo, abono, devengaInhabil, abonaSoloHabil, inhabiles }
                                  // `inhabiles` default: el registro de módulo

// Composición
tasaDiaria(tasaAnual, cfg)                → number   // según cfg.modoTasa
interesDiario(saldo, cfg)                 → number   // bruto, según cfg.modo
isrDiario(saldo, cfg, interesBruto?)      → number   // según cfg.isrSobre; el 3er arg
                                                     // solo se usa en modo 'interes'
componer(saldoInicial, dias, cfg, desde?, pendienteInicial?, remanenteInicial?)
  → { saldoFinal, rendimiento, bruto, isr, dias, pendiente, remanente, ultimo }
                            // rendimiento = lo DEVENGADO (incluye lo pendiente de abono);
                            // saldoFinal  = lo acreditado, que es lo que muestra la institución
                            // `desde` solo hace falta con calendario de abono; sin ella compone
                            // como `natural`, que es lo que quieren las proyecciones abstractas
                            // remanenteInicial/remanente = { bruto, isr } de `modo acumulado`
                            // (ver Redondeo diario); en cualquier otro modo se ignora/queda en 0
                            // ultimo = { bruto, isr, neto, abonado } del último día
tasaNominal(saldo, cfg)            → number   // % anual ponderado, sobre las tasas configuradas

// Reparto del saldo entre los tramos — la suma de `aporte` es interesDiario()
desgloseTramos(saldo, cfg) → [{ desde, hasta, tasa, monto, aporte, pct, marginal }]

// Línea de tiempo de una cuenta — solo anclas, compatible con datos previos al
// modelo de eventos
timelineCuenta(cuenta)  → [{ fecha, monto }]  // ascendente, sin fechas repetidas

// Corrección de la raíz — ver Modelo de eventos arriba
capturasDescartadas(historial, nuevaFecha)  → historial[]   // lo que quedaría en el futuro
historialConsistente(historial, nuevaFecha) → historial[]   // solo lo estrictamente anterior

// Modelo de eventos — ver descripción arriba
eventosCuenta(cuenta) → [{ fecha, tipo, monto, nota?, motivo? }]   // ordenado, retiros con signo
saldoEnFecha(eventos, fecha, cfg)             → number | null     // saldo al INICIO de `fecha`
estadoEnFecha(eventos, fecha, cfg)            → { saldo, pendiente, remanente } | null   // ídem + la bolsa y el remanente de `modo acumulado`
rendimientoEntre(eventos, fIni, fFin, cfg)
  → { rendimiento, bruto, isr, saldoInicial, saldoFinal, pendiente, aportaciones, desde, hasta, dias, recortado } | null

// Transferencias entre cuentas propias — ver Modelo de eventos arriba
validarTransferencia({ origenId, destinoId, monto, fecha, fechaDestino }) → string | null   // motivo de error, o null si es válida
movimientosTransferencia(spec)   → { transferenciaId, origen, destino }   // throws si no es válida — validar antes
esTransferencia(movimiento)      → boolean   // si trae transferenciaId
sinTransferencia(movimientos, transferenciaId) → movimientos[]  // sin esa pata
conTransferencia(movimientos, pata)            → movimientos[]  // inserta, reemplazando si ya existía

// Conciliación y recálculo en cascada — ver Modelo de eventos arriba
conciliar(cuenta, saldoReal, fecha?, cfg?)
  → { desde, hasta, dias, saldoAnterior, rendimientoProyectado, movimientos, ajustes,
      saldoEsperado, saldoReal, residuo, pendiente, derivaAnual, cuadra } | null
                            // saldoEsperado NO incluye `pendiente`: la institución tampoco lo
                            // tiene en el saldo, y sumarlo dejaría un residuo negativo cada finde
recalcularAjustes(cuenta, cfg?) → [{ fecha, monto, motivo, derivado, cambio }]   // cambio = nuevo − anterior

// Rendimiento día por día desde la PRIMERA ancla de la cuenta hasta hoy inclusive
// (no solo desde la más reciente — ver el modal Historial diario). Cada entrada
// es el día que GENERÓ el interés; se abona a la madrugada siguiente. El último
// renglón es el de hoy mismo, aunque sea una proyección todavía no "cobrada".
// Con calendario de abono, `neto` sigue siendo lo que ese día DEVENGÓ y `abonado`
// lo que de verdad entró al saldo: 0 en inhábil, el acumulado del puente el día
// que abre. La bolsa se encadena de un renglón al siguiente, sin redondear
// mientras sigue pendiente — solo `abonado`/`saldoFinal` (dinero que ya se
// movió) se redondean a centavos antes de encadenarse. `bruto`/`isr`/`neto`
// dependen de `cfg.redondeo` (ver Redondeo diario): exactos en `continuo` —
// donde el reporte los redondea aparte para mostrarlos, así que Bruto−ISR
// puede diferir un centavo del Rendimiento mostrado, ambos ya redondeados—
// o ya redondeados/pagados en `centavos` y `acumulado`, donde `bruto`/`isr`
// SON lo que se pagó y `neto` es su resta tal cual, sin ese problema.
historialDiario(cuenta, hoy?, maxDias = 400, cfg?)
  → [{ fecha, saldoInicial, bruto, isr, neto, abonado, pendiente,
       saldoFinal, movimiento, ajuste }]   // ascendente — saldoFinal cents-precise

// Vista de tabla: quita los días inhábiles y pliega su interés (y su bruto/ISR)
// sobre el día que los abona. Sin calendario devuelve las filas tal cual.
// Un inhábil con movimiento o ajuste se conserva, con bruto/isr en cero.
plegarDiasInhabiles(filas, cfg)
  → { filas: [{ ...fila, acumulados: [] }], pendientes: [] }   // sin abono todavía

// Resumen completo de una cuenta a una fecha de corte
resumenCuenta(cuenta, hoy?) → {
  ...configCuenta(cuenta),      // tramos, modo, modoTasa, base, isrAnual, isrSobre, baseIsr, abono…
  timeline, fechaBase, dias,
  capital, saldoActual,         // saldoActual = lo ACREDITADO, sin lo pendiente
  pendiente, proximoAbono,      // devengado sin abonar + la fecha en que se acredita
  rendimientoHastaHoy,          // = rendimientoDesdeBase, siempre por proyección (historialDiario)
  brutoHastaHoy, isrHastaHoy,
  rendimientoHistorico,         // desde el primer registro, sin aportaciones
  aportacionesHistoricas, diasHistoricos,
  diario, mensual, anual,       // NETOS, sobre el saldo YA actualizado a hoy
  diarioBruto, isrDiario,
  ayer,                         // neto del día consultado (+ ajuste ese día, si hay) — lo abonado esa madrugada
  desglose,                     // = desgloseTramos(saldoActual, cfg)
  tasaNominal,                  // % anual ponderado bruto
  gat,                          // GAT Nominal: antes de impuestos, `base` capitalizaciones
  idxTramo
}

// Acumulado de varias cuentas para el encabezado del módulo y del dashboard
totalizarResumenes(resumenes) → { capital, saldoActual, rendimientoHastaHoy,
                                  rendimientoHistorico, diario, mensual, anual,
                                  isrHastaHoy, pendiente, gat, cuentas }
```

**Orden del cálculo** (el punto clave del módulo): primero se actualiza el monto invertido desde su última fecha de actualización hasta hoy —recorriendo movimientos y ajustes posteriores como cualquier otro tramo del calendario— y **sobre ese saldo ya actualizado** se calculan los rendimientos diario, mensual y anual.

`rendimientoEntre` devuelve `null` si el rango completo es previo al primer saldo registrado o si las fechas están invertidas. Si solo el inicio es previo, recorta al primer registro y marca `recortado: true`.

`saldoEnFecha(eventos, fecha, cfg)` da el saldo al **inicio** de `fecha` (antes del rendimiento propio de ese día) — por eso el cierre del renglón `fecha` de `historialDiario` coincide con `saldoEnFecha(eventos, sumarDias(fecha, 1), cfg)`, no con `saldoEnFecha(eventos, fecha, cfg)`.

> **Hallazgo (sin corregir):** `historialDiario(cuenta, hoy, maxDias)` recorta mal cuando `maxDias` deja como primer renglón mostrado uno que NO es el día de la primera ancla — el caso extremo es `maxDias=1`. El renglón `i===0` da por hecho que parte de un saldo ya "cerrado hasta el día anterior" y le aplica `pasoDiario` encima, pero `cierreSaldo` para ese caso sale de `recorrer(eventos, primero.fecha, cierreFecha, ...)` con `cierreFecha` ya en el propio día a mostrar — así que ese día se compone dos veces (una dentro del `recorrer`, otra en el `pasoDiario` explícito) y además no revisa `porFecha`, así que pierde cualquier movimiento/ajuste fechado ese mismo día. Verificado en Node comparando `historialDiario(cuenta, hoy)` completo contra `historialDiario(cuenta, hoy, 1)` con un ajuste fechado hoy: el saldo final difiere y el ajuste desaparece. Hoy nada en la app dispara esta ruta (el modal llama `historialDiario(cuenta, hoy)` sin límite, y el default de `maxDias` es 400), pero sí puede morder a una cuenta con más de 400 días de historial, o cualquier llamado nuevo que pase un `maxDias` chico.

---

## Cálculo de Nómina

Los depósitos de nómina ocurren los días **15 y 30** de cada mes (en febrero se usa el último día del mes). Si el día nominal cae en fin de semana o festivo, se recorre al **día hábil anterior**.

La función `anteriorNomina(date, festivosMX)` devuelve el depósito de nómina más reciente anterior o igual a `date`. Se usa en el módulo MSI para mostrar con qué nómina se cubriría cada pago:

**Ejemplo:** Si el primer pago calculado es el 09/07/2026, se muestra **30/06/2026** (el depósito de nómina de fin de junio es el que precede a ese pago).

---

## Tema Claro / Oscuro

Tres estados, conmutables con el botón del footer del sidebar: **Sistema** (por defecto) · **Claro** · **Oscuro**.

### Cómo se aplica

Un script en línea en `index.html`, **antes de las hojas de estilo**, resuelve el modo y lo estampa en `<html>`. Va en línea a propósito: si se resolviera desde un módulo, habría un parpadeo claro en cada carga.

| Atributo | Para qué |
|---|---|
| `data-theme` | El CSS propio (`css/app.css`) |
| `data-bs-theme` | El modo oscuro nativo de Bootstrap 5.3 — modales, formularios, dropdowns |
| `data-tema-pref` | La preferencia cruda, por si se quiere estilar el conmutador |

El script expone `window.TEMA` con `leer()` / `aplicar(pref)` / `guardar(pref)`. La lógica del botón vive en `setupTema()` (`js/app.js`), que además escucha `matchMedia` para que el estado *Sistema* siga al sistema operativo en vivo.

### Persistencia

`localStorage['impactos-tema']`. El estado *Sistema* **borra** la llave en vez de guardar un valor, así que un usuario que nunca toque el botón se comporta igual que antes de existir la función. No se guarda en Firestore a propósito: es preferencia por dispositivo y esperar a Firebase reintroduciría el parpadeo.

### Tokens

Todo el color vive en `:root` como tokens semánticos (superficies, texto, bordes, tintes, chips de institución); el bloque `:root[data-theme="dark"]` solo los redefine. Fuera del bloque de variables no debe haber literales de color.

**Lo que NO cambia con el tema:**

- **El azul de marca** — login, sidebar, barra superior en móvil, header de las data cards, chip de filtro activo y FAB. `--primary`, `--primary-light` y `--sidebar-bg` no se redefinen en oscuro. Para el azul usado como *texto* existen `--accent` y `--accent-strong`, que sí se aclaran porque `#1a237e` sobre fondo oscuro es ilegible.
- **Los colores de institución** (`inst.color`, `BANK_COLORS`) y el plástico de las tarjetas: son dato, no tema.

> Las variantes contextuales de fila de Bootstrap (`.table-success`, `.table-warning`, `.table-secondary`) **no** responden a `data-bs-theme` — se generan con hexes claros fijos. `app.css` las remapea a los tintes propios bajo `[data-theme="dark"]`.

### Densidad en móvil

Bajo 576 px hay una pasada de densidad que reduce la altura de las vistas ~10 % (Rendimientos −36 %): sube el suelo tipográfico a ~11 px, tempera los tamaños grandes con `clamp()` y recorta padding. Los tamaños diminutos que viajan en atributos `style` usan los tokens `--fs-micro` · `--fs-nano` · `--fs-tiny` · `--fs-mini` · `--fs-small`, cuyo valor de escritorio es el original y que solo suben en móvil.

---

## Ejecución Local

La app usa módulos ES6 (`type="module"`) y requiere un servidor HTTP.

**VS Code — Live Server (recomendado):**
1. Instalar extensión **Live Server** de Ritwick Dey
2. Abrir la carpeta `impactos/` en VS Code
3. Click derecho en `index.html` → **Open with Live Server**
4. Se abre en `http://127.0.0.1:5500`

**Python (alternativa):**
```bash
cd C:\Users\gabito\impactos
python -m http.server 8080
# Abrir: http://localhost:8080
```

---

## Entorno de Pruebas (Modo Pruebas)

Un modo que corre **el front real** (`index.html`, todos los módulos, tal como están en el
working tree) contra un espejo de Firestore guardado en archivo, para poder probar cambios sin
riesgo de tocar datos financieros reales — sin levantar un backend propio ni depender de una
segunda cuenta/proyecto de Firebase.

### Cómo se activa

`?modoPruebas=1` en la URL (una vez; queda memorizado en `localStorage['impactos_modo_pruebas']`)
· `?modoPruebas=0` lo apaga. Un `<script>` inline en `<head>` de `index.html`, colocado **antes**
de cualquier carga de módulos, inyecta con `document.write` un import map que redirige
`./js/utils/db.js` → `./test/file-store.js` — ningún módulo de la app se entera del cambio, y
`db.js` real queda sin tocar. La pantalla de login real (Google + verificación contra
`_config/owner`) sigue intacta: el modo pruebas solo cambia la capa de datos.

Con el modo activo aparece una píldora fija en la esquina superior derecha (`test/banner.js`),
visible desde antes de iniciar sesión, con un botón **Sincronizar** y un enlace **Salir**.

### Servir la app en modo pruebas

`test/serve.py` es un servidor de desarrollo (sin dependencias externas) pensado para este modo:

```bash
python test/serve.py [puerto]   # default 8080
# Abrir: http://localhost:8080/index.html?modoPruebas=1
```

Se diferencia de `python -m http.server` en dos cosas: manda `Cache-Control: no-store` en cada
respuesta (para no quedarse con un `.js` viejo mientras se itera) y expone `POST /api/fixture`,
el endpoint donde escribe `test/file-store.js`.

### Los archivos de datos

| Archivo | Git | Contenido |
|---|---|---|
| `test/fixtures/seed.json` | commiteado | Semilla ficticia inicial, coherente con el motor real: `instituciones` + `inversiones` calculadas con `rendimiento.js`, dos `tarjetas` de crédito, cinco `notificaciones` que cubren los casos de esa vista (contado, a plazos, sin match en el diccionario, sin tarjeta identificable y una ya procesada) y ocho compras de `contado` —seis en la misma tarjeta, para ver el corte en las 5 más recientes de "Acumular compra"—. Las tarjetas están porque el modal exige una: sin ellas la bandeja de notificaciones se ve pero no se puede probar de punta a punta. El resto de las colecciones, arrays vacíos |
| `test/fixtures/firestore.json` | **ignorado** (`.gitignore`) | Snapshot real que descarga **Sincronizar**; datos financieros reales, uno por dispositivo, nunca debe llegar al historial del repo |

`test/file-store.js` implementa la misma superficie que `js/utils/db.js` (`getAll, getById,
create, update, remove, upsert, batchCreate, batchUpdate, recentWhere, clearCache, orderBy,
where`), incluyendo el filtrado real de `recentWhere` — así el dashboard y los demás módulos se
comportan igual que contra Firestore real, no distinto por estar en pruebas. Al cargar intenta
`firestore.json` primero y cae a `seed.json` si no existe todavía en ese dispositivo (primer uso).
**Toda** mutación en modo pruebas —no solo lo que trae Sincronizar— se persiste de inmediato con
un `POST /api/fixture` (encolado para evitar carreras de escritura), así que el archivo sigue
siendo verdad incluso después de cerrar la pestaña, entrar en incógnito o cambiar de dispositivo
en la misma red.

**Sincronizar** (`test/banner.js` → `test/sync.js`, carga perezosa) hace una lectura real y
autenticada de Firestore —iterando `test/collections.js`, la lista única de colecciones
compartida con `file-store.js`— y sobrescribe `test/fixtures/firestore.json` por completo. Importa
`js/firebase.js` directo, sin pasar por el import map, para no terminar leyéndose a sí mismo.

> Si se agrega una colección nueva a la app, hay que sumarla también a `test/collections.js` — el
> SDK de Firestore para navegador no puede listar colecciones (eso solo existe del lado servidor),
> así que esta lista es necesariamente manual.

### Que viaje por git pero no se publique

`test/` sí se commitea a `main` (para tener el entorno de pruebas disponible en varios
dispositivos vía `git pull`), pero **no debe** aparecer en el sitio publicado de GitHub Pages.
`_config.yml` en la raíz declara un `exclude:` de Jekyll con `test/` (y de paso los `.md` internos
de desarrollo, que sin este archivo también se publicaban como páginas por el comportamiento
default de Jekyll). Es la separación correcta porque el objetivo es *sí* commitear el código de
pruebas y *no* commitear datos reales — cosa distinta, resuelta aparte, en `.gitignore` (ver
tabla arriba). `test/` tampoco se precachea: el `SHELL` de `sw.js` es una lista explícita de
archivos que no lo incluye, y los archivos locales usan network-first.

> Excluir de Pages no es lo mismo que ocultar del repositorio: si el repo de GitHub es público,
> cualquiera que lo navegue ahí (no el sitio publicado) puede seguir viendo `test/` completo. Por
> eso los datos reales viven aparte, en el archivo ignorado por git.

---

## Despliegue en GitHub Pages

### Primera vez

```bash
git init
git add .
git commit -m "Initial commit — IMPACTOS app"
git remote add origin https://github.com/TU_USUARIO/impactos.git
git branch -M main
git push -u origin main
```

En GitHub: **Settings → Pages → Branch: main → / (root) → Save**

### Agregar dominio a Firebase Auth

```
Firebase Console → Authentication → Settings → Authorized domains
→ Add domain → TU_USUARIO.github.io
```

### Actualizaciones posteriores

```bash
git add .
git commit -m "Descripción del cambio"
git push
```

### Versionado — deploys de prueba vs. oficiales

Un deploy no siempre es la versión final de lo que trae — a veces se publica a `main` solo para
probarlo en el teléfono real (login con Google, Firestore de verdad) antes de darlo por bueno.
Para eso, `APP_VERSION` admite un sufijo `-Tn`:

- **Deploy de prueba:** se agrega/incrementa el sufijo sobre la ÚLTIMA versión oficial, sin tocar
  el número base. Ej. con `1.9.3` ya oficial, el primer deploy de prueba sobre esos cambios es
  `1.9.3-T1`; si hace falta otra vuelta antes de confirmarlo, `1.9.3-T2`, `1.9.3-T3`, etc.
- **Deploy oficial:** cuando se confirma que un `-Tn` quedó bien, se sube el número base
  (`1.9.3-T1` → `1.9.4`) y se **quita el sufijo**. El contador `-Tn` vuelve a arrancar en `T1` la
  próxima vez que haga falta probar algo antes de publicarlo oficialmente.

Esto evita quemar números de versión por cada iteración de prueba — el número base solo avanza
cuando algo ya se dio por bueno. El contador de caché de `sw.js` sí se sube en **todos** los
deploys (de prueba u oficiales) para que el navegador siempre sirva los archivos nuevos.

---

## Mantenimiento de Datos — Firestore

Con el tiempo pueden acumularse campos obsoletos en los documentos de Firestore (residuos de rediseños anteriores). Los scripts siguientes se ejecutan desde la **consola del navegador (DevTools)** mientras la app está abierta y autenticada — no se necesitan credenciales adicionales.

### Inspeccionar campos activos en una colección

```javascript
// Sustituir 'gastosFijos' por la colección a inspeccionar
const uid  = firebase.auth().currentUser.uid;
const snap = await firebase.firestore()
  .collection(`users/${uid}/gastosFijos`).get();

const campos = new Set();
snap.forEach(d => Object.keys(d.data()).forEach(k => campos.add(k)));
console.log('Campos encontrados:', [...campos].sort());
console.log('Documentos:', snap.size);
```

### Eliminar un campo obsoleto de todos los documentos

```javascript
const uid    = firebase.auth().currentUser.uid;
const colRef = firebase.firestore().collection(`users/${uid}/gastosFijos`);
const snap   = await colRef.get();
const del    = firebase.firestore.FieldValue.delete();

// Procesar en lotes de 500 (límite de Firestore)
const chunks = [];
const docs   = snap.docs;
for (let i = 0; i < docs.length; i += 500) chunks.push(docs.slice(i, i + 500));

for (const chunk of chunks) {
  const batch = firebase.firestore().batch();
  chunk.forEach(d => batch.update(d.ref, { campoObsoleto: del }));
  await batch.commit();
}
console.log('Listo — campo eliminado de', snap.size, 'documentos');
```

### Campos que pueden existir como obsoletos

Los siguientes campos existieron en versiones anteriores y pueden estar presentes en documentos antiguos:

| Colección | Campo obsoleto | Reemplazado por |
|---|---|---|
| `msi` | `primerPago` | Calculado dinámicamente desde `fechaCompra` + ciclo |
| `msi` | `ultimoPago` | Calculado dinámicamente desde `fechaCompra` + ciclo |
| `gastosFijos` | `tarjetaNombre` | `tarjetaId` + `numeroTarjeta` |
| `impactoMensual` | colección completa | Reemplazada por colección `impacto` |
| `inversiones` | `referencia` | — (se retiró de la UI, no tiene reemplazo) |
| `inversiones` | `notas` | — (ídem) |

> Las colecciones `contado` y `gastos` son nuevas — no tienen campos obsoletos.

> `favorita` y `oculta` en `tarjetas/{id}` son campos opcionales — **no son obsoletos**. Pueden estar ausentes en tarjetas existentes (se tratan como `false`). Son mutuamente excluyentes: no puede ser `favorita: true` y `oculta: true` al mismo tiempo.

---

## Instituciones Bancarias Soportadas

La app incluye colores predefinidos para las siguientes instituciones. Se puede agregar cualquier otra desde `#/admin` con color personalizable.

| Institución | Color |
|---|---|
| Banamex | `#e31837` |
| Banorte | `#da1c2b` |
| BBVA | `#004481` |
| Mercado Pago | `#009ee3` |
| NU | `#820ad1` |
| Rappi | `#ff441f` |
| Revolut | `#0075eb` |
| Santander | `#ec0000` |

---

*Última actualización: 2026-08-08 (v1.9.3) — Rendimientos: el motor de cálculo (`js/utils/rendimiento.js`) pasa de proyectar solo entre puntos observados a un modelo de eventos (anclas, movimientos, ajustes) que permite registrar aportes, retiros y traspasos entre cuentas propias (modal **Movimientos**), conciliar el saldo real contra lo proyectado clasificando la diferencia, y recalcular en cascada los ajustes derivados cuando cambia algo anterior — siempre con confirmación explícita antes de correr una cifra ya registrada. El modal de Ajuste unifica la antigua captura separada de monto y de rendimiento en un solo paso, con la lista de ajustes filtrable por tipo (saldo / diario). El historial diario ahora recorre la cuenta completa desde su primera ancla hasta **hoy inclusive** (antes se ocultaba todo lo previo a la última captura), muestra el saldo de cierre de cada día, resalta en naranja los días con una corrección puntual, marca con una insignia los días con una corrección de saldo, permite corregir el rendimiento de un día concreto desde su propia fila, y exporta un reporte a CSV con columnas exactas y la fórmula usada. Se agrega un entorno de pruebas (`test/`, activable con `?modoPruebas=1`) que corre el front real contra un espejo de Firestore en archivo sin arriesgar datos reales — viaja por git para estar disponible en varios dispositivos, pero queda excluido del sitio publicado en Pages. Corrige además una condición de carrera en el Service Worker (`Response body is already used`) al refrescar assets en segundo plano.
Incluye lo enviado en v1.9.2 — Pre-registro de compra vía parámetros de URL (`#/compras?desc=...&total=...`): el router pasa el query string a los módulos, y en Compras un enlace abre el modal de Registro Rápido (De Contado o A Plazos según traiga `meses`) ya precargado con descripción, total, fecha, hora, tarjeta por terminación y la mensualidad real cuando aplica; detección de duplicados por `msgId` en ambas colecciones y botón para cambiar de tipo sin recapturar los datos. El texto de la tarjeta seleccionada en todos los dropdowns del proyecto ahora siempre incluye la institución, no solo en el grupo Favoritas.
Incluye lo enviado en v1.9.1 — texto legible calculado sobre el color de cada institución (tarjetas, wallet, cabeceras admin) en vez de blanco fijo, y redondeo diario configurable en cuentas de rendimiento.
Incluye lo enviado en v1.9.0 — Tema claro/oscuro con tres estados y color de marca preservado; pasada de densidad en móvil (−10 % de altura, Rendimientos −36 %) con tokens tipográficos; calculadora entre 2 fechas movida a modal; fila de subpago de A Plazos ahora muestra su fecha; sección de gastos pendientes normalizada para móvil; y lo pendiente de v1.8.2 — Rendimientos: interpretación de la tasa configurable por cuenta (nominal o efectiva), desglose del saldo por tramos con barra de reparto, historial día por día, Detalle en modal, ayuda contextual por campo y tarjetas reestructuradas; motor verificado contra abonos reales de dos instituciones con convenciones opuestas*
