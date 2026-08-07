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
9. [Ciclo de Facturación](#ciclo-de-facturación)
10. [Cálculo de Saldo Disponible](#cálculo-de-saldo-disponible)
11. [Cálculo de Impacto Mensual](#cálculo-de-impacto-mensual)
12. [Cálculo de Rendimientos](#cálculo-de-rendimientos)
13. [Cálculo de Nómina](#cálculo-de-nómina)
14. [Tema Claro / Oscuro](#tema-claro--oscuro)
15. [Ejecución Local](#ejecución-local)
16. [Despliegue en GitHub Pages](#despliegue-en-github-pages)
17. [Instituciones Bancarias Soportadas](#instituciones-bancarias-soportadas)

---

## Descripción General

IMPACTOS es una Single Page Application (SPA) que reemplaza un archivo Excel de gestión financiera personal. Permite administrar:

- Cuentas y tarjetas bancarias de múltiples instituciones
- Compras a Meses Sin Intereses (MSI) con seguimiento de progreso y cálculo automático de fechas de pago
- Gastos fijos mensuales recurrentes
- Estado mensual de todas las tarjetas (impacto)
- Planeación y comparación de compras en eventos de ofertas (Hot Sale, Buen Fin, etc.)
- Catálogo de días festivos oficiales de México

**Características principales:**
- Interfaz responsiva: sidebar en desktop, bottom navigation en móvil; en móvil las tarjetas se muestran en stack con efecto de superposición
- Autenticación exclusiva con Google (usuario único)
- Datos almacenados en Firebase Firestore (en la nube, accesibles desde cualquier dispositivo)
- Sin build step — se sirve directamente como archivos estáticos desde GitHub Pages
- Instalable como PWA (Progressive Web App) en Android, iOS y desktop; funciona offline con Service Worker
- Versión de la app visible en el footer del sidebar (`v1.9.1`)
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
│   ├── icon-192.png            # Ícono PWA 192×192 (banco estilizado)
│   └── icon-512.png            # Ícono PWA 512×512
│
├── css/
│   └── app.css                 # Todos los estilos (variables, layout, componentes)
│
└── js/
    ├── app.js                  # Punto de entrada — auth, nav, router bootstrap, SW registration
    ├── auth.js                 # Google Sign-In + verificación de acceso por UID
    ├── firebase.js             # Inicialización Firebase (config + exports db/auth)
    ├── router.js               # Hash router con lazy loading de módulos
    │
    ├── modules/
    │   ├── dashboard.js        # Vista principal — métricas, impacto del mes, últimas compras, gastos
    │   ├── tarjetas.js         # Vista de tarjetas en formato wallet (flip cards)
    │   ├── admin-tarjetas.js   # CRUD de instituciones y tarjetas
    │   ├── msi.js              # Módulo "Compras y Gastos": De Contado + A Plazos + Gastos
    │   ├── fijos.js            # CRUD de gastos fijos mensuales
    │   ├── impacto.js          # Impacto mensual rediseñado — confirmación, pago, cierre
    │   ├── rendimientos.js     # Cuentas de inversión y cálculo de rendimientos compuestos
    │   ├── eventos.js          # Lista de eventos de ofertas
    │   ├── evento-detalle.js   # Detalle de evento: planeación, realizadas, promos
    │   ├── festivos.js         # CRUD de días festivos oficiales MX
    │   ├── exportar.js         # Exportación de datos a Excel o JSON + mantenimiento de caché
    │   └── quick-add.js        # Registro rápido de compras y gastos (FAB)
    │
    └── utils/
        ├── db.js               # CRUD genérico para Firestore
        ├── formatters.js       # Formateo de moneda, fechas, seriales Excel, etc.
        ├── ciclo.js            # Cálculo de ciclos de facturación y nómina
        ├── saldo.js            # Cálculo de saldo disponible/usado con ajuste por compras
        ├── impacto-calc.js     # Cálculos del Impacto mensual (filtrado, estimados, proyección)
        ├── rendimiento.js      # Motor de rendimientos compuestos con tramos progresivos
        └── ui.js               # Toast, modals, confirmaciones reutilizables
```

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
| `montoInvertido` | number | Último saldo **real observado** de la cuenta |
| `fechaActualizacion` | string | Fecha (`YYYY-MM-DD`) en que ese monto era el saldo real |
| `rendimientoObtenido` | number? | Último rendimiento **real observado** (ej. del estado de cuenta). `0`/ausente = no hay captura, se usa solo la proyección |
| `fechaActualizacionRendimiento` | string? | Fecha (`YYYY-MM-DD`) en que ese rendimiento era el real. Ausente = se usa `fechaActualizacion` |
| `tramos` | array | Límites de rendimiento (ver estructura abajo) |
| `modoTramos` | string? | Cómo se aplican los tramos: `progresivo` (default) o `unico` |
| `modoTasa` | string? | Cómo se interpreta la tasa publicada: `nominal` (default) o `efectiva` |
| `baseAnual` | number? | Días del año para el **interés**: `365` (default) o `360` |
| `isrAnual` | number? | Retención en %. `0` o ausente = cálculo bruto. Su significado depende de `isrSobre` |
| `isrSobre` | string? | Base de la retención: `capital` (default, tasa anual) o `interes` (% directo de lo ganado) |
| `baseIsr` | number? | Días del año para la **retención**: `365` (default) o `360`. Solo aplica con `isrSobre: 'capital'` |
| `redondeoTasa` | string? | Cómo mostrar la tasa ponderada: `truncar` (default) o `redondear` |
| `historial` | array? | Capturas anteriores de `montoInvertido`: `{ fecha, monto }`, máximo 60, ascendente |
| `historialRendimiento` | array? | Capturas anteriores de `rendimientoObtenido`: `{ fecha, monto }`, máximo 60, ascendente |
| ~~`referencia`~~ | string? | **Obsoleto** — ya no se captura ni se muestra. Puede seguir presente en documentos antiguos |
| ~~`notas`~~ | string? | **Obsoleto** — ídem |

**Estructura de cada elemento en `tramos`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `hasta` | number\|null | Límite superior del tramo; `null` en el último tramo (*en adelante*) |
| `tasa` | number | Tasa anual del tramo en porcentaje (ej. `15`). Si es nominal o efectiva lo decide `modoTasa` |

> El `desde` de cada tramo **no se almacena**: se deriva del `hasta` del tramo anterior. Esto elimina huecos y solapes por captura. El array se normaliza al leerlo (`normalizarTramos`), que además ordena los tramos y garantiza que siempre exista un tramo abierto final.

> `montoInvertido` + `fechaActualizacion` son el punto observado más reciente; las capturas anteriores viven en `historial[]`. Entre dos puntos observados el saldo se proyecta; al llegar a un punto observado el saldo se reemplaza por el valor real y la diferencia se reporta como **aportación** (o retiro), nunca como rendimiento.

> `rendimientoObtenido` + `fechaActualizacionRendimiento` funcionan igual que `montoInvertido` + `fechaActualizacion`, pero para el rendimiento: es la última cifra real capturada (ej. del estado de cuenta), y `"Hasta hoy"` se calcula como esa captura **más** lo generado desde esa fecha hasta hoy (proyectado con la tasa de la cuenta). Sin captura (`0`/ausente), el resultado es idéntico a proyectar únicamente el capital — no cambia el comportamiento de cuentas existentes hasta que se actualice el rendimiento.

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

### Administración (`#/admin`)
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

> Las tarjetas marcadas como favoritas aparecen en un grupo `⭐ Favoritas` al inicio de todos los selectores del proyecto (Compras, Gastos Fijos, Registro Rápido). En ese grupo, cada opción muestra el nombre de la institución como prefijo (`Institución — Tarjeta ···4118`) para identificarlas sin el contexto del optgroup de institución. Las tarjetas del grupo Favoritas no se duplican en los grupos de institución del mismo selector.

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

### Gastos Fijos (`#/fijos`)
Registro de gastos recurrentes (módulo en la sección **Ajustes** del nav):
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
| Encabezado | Color de la institución, institución arriba y alias abajo (si no hay alias, la institución ocupa la línea principal) y las 4 acciones |
| Saldo | **Saldo actual estimado**, el importe protagonista |
| Tasa | **Rendimiento anual** con la tasa del saldo actual, y una **ⓘ** que abre el desglose por tramos |
| Ganado | Línea descriptiva `Hasta hoy $X · Último $Y` con un botón 🕐 que abre el historial diario |
| Rendimientos | **Diario · Mensual (30 d) · Anual (365 d)**, netos de ISR, en una fila con divisores |
| Pie | Botón **Ver detalle** |

- Acciones del encabezado: **Actualizar monto** (🔄), **Actualizar rendimiento** (📈), **Editar** (✏️), **Eliminar** (🗑️)
- La **ⓘ** de la tasa aparece **solo si más de un tramo tiene dinero**. Con un único tramo aportando, la tasa no es un promedio y no hay nada que desglosar, así que el botón se omite

**Modal Detalle** — se abre desde la tarjeta, en tres secciones:
1. **Cómo sale el rendimiento de hoy** — la aritmética renglón por renglón: la porción de cada tramo con su fórmula, el bruto, la retención y el neto
2. **Tramos** — barra de reparto y desglose (ver abajo)
3. **Configuración** — resumen de solo lectura de todos los campos, cada uno con su **ⓘ**

Al pie, botones para saltar al **Historial diario** o a **Editar**. Como los tres comparten `#modal-container`, el salto espera al evento `hidden.bs.modal` antes de abrir el siguiente.

**Modal Historial diario** — un renglón por día desde la última captura del monto, del más reciente al más antiguo, con el más reciente marcado como *último*. Columnas: día, saldo inicial, bruto e ISR (solo si hay retención) y rendimiento. Encabezado y totales fijos al hacer scroll.

**Bloque de tramos** — sustituye al resaltado del "tramo activo", que sugería que solo esa tasa aplicaba cuando en modo progresivo todos los tramos con dinero aportan a la vez:
- Barra apilada con el reparto del saldo, coloreada por tramo, con leyenda de porcentajes
- Tabla `Tramo · Tasa · En el tramo · Aporte/día` con totales; los tramos sin dinero se atenúan y el que recibiría el siguiente peso lleva la etiqueta *marginal*

**Modal de cuenta:** institución, nombre (opcional), monto invertido y su fecha, rendimiento obtenido y su fecha, **Aplicación** e **Interpretación de la tasa**, editor de tramos y sección *Avanzado*.
- El editor de tramos muestra el **Desde** derivado en tiempo real y el último tramo siempre es *En adelante*
- Validación: todo tramo salvo el último requiere límite superior, y los límites deben ir en aumento
- Al cambiar la fecha de actualización (monto o rendimiento), la captura anterior pasa automáticamente al `historial`/`historialRendimiento` correspondiente

*Avanzado* agrupa lo que varía entre instituciones:

| Bloque | Campos |
|---|---|
| Retención de ISR | Tasa · Se calcula sobre (capital / interés) |
| Convenciones de cálculo | Base anual del interés · Base anual del ISR · Tasa ponderada (truncar / redondear) |

La etiqueta de la tasa de retención cambia según `isrSobre`, y *Base anual — ISR* se oculta cuando la retención es sobre el interés (ahí no se anualiza).

### Ayuda contextual

Ningún campo lleva texto de ayuda inline: cada uno tiene un botón **ⓘ** que abre un modal breve con el concepto y un apartado *Cómo afecta al cálculo*, casi siempre con un ejemplo numérico. Hay diez, uno por campo, y viven en el diccionario `AYUDA` de `rendimientos.js`.

> Los ejemplos usan cifras inventadas a propósito. La ayuda explica el concepto, no la configuración de ninguna institución en particular.

Detalles de implementación que conviene conocer antes de tocarlos:
- La ayuda **no usa `openModal`**: monta su propio modal en `<body>` para poder apilarse sobre el formulario de la cuenta sin destruirlo. Al cerrarse restaura la clase `modal-open` del body si todavía hay un modal abierto detrás
- Un solo listener delegado atiende todos los botones, presentes y futuros. Ignora los que no traen `data-ayuda`, porque el botón del desglose de tramos reusa el estilo sin ser ayuda de un campo

**Modal Actualizar monto:** muestra el saldo estimado a hoy con botón *Usar este valor*, precarga ese valor y reporta en vivo la diferencia contra lo capturado (aportación, retiro o ajuste de tasa). Guarda la captura anterior en el `historial`.

**Modal Actualizar rendimiento:** funciona igual que el de monto, pero para `rendimientoObtenido` — muestra el rendimiento estimado a hoy (`"Hasta hoy"` actual) con botón *Usar este valor*, precarga ese valor y reporta en vivo la diferencia contra lo capturado. Guarda la captura anterior en el `historialRendimiento`.

> **Qué capturar (monto):** el saldo que muestra la app del banco en ese momento, tal cual. Ese saldo **ya incluye** el interés abonado esa madrugada, así que al capturarlo con la fecha de hoy la tarjeta mostrará `Hasta hoy $0.00` — **siempre y cuando no haya un `rendimientoObtenido` capturado por separado** (ver abajo). Al día siguiente, `Hasta hoy` ya reflejará ese abono.

> **Qué capturar (rendimiento):** el rendimiento acumulado real que muestra el estado de cuenta o resumen del banco (no el saldo total). Mientras no se capture, `Hasta hoy` se calcula únicamente proyectando el capital, igual que antes de tener este campo. En cuanto se captura una vez, `Hasta hoy` pasa a ser esa cifra real **más** lo generado desde su fecha — y deja de reiniciarse solo por actualizar el monto invertido; hay que actualizar el rendimiento por separado para mantenerlo sincronizado.

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

### Exportar Datos (`#/exportar`)
Exportación completa de los datos del usuario:
- **Excel:** un archivo `.xlsx` con una hoja por colección (Instituciones, Tarjetas, MSI, Gastos Fijos, Eventos, Festivos MX)
- **JSON:** archivo `.json` con todas las colecciones en un solo objeto
- El nombre del archivo incluye la fecha actual (`IMPACTOS_YYYY-MM-DD`)

**Sección Mantenimiento:**
- **Limpiar caché de datos:** limpia el caché en memoria de Firestore (IndexedDB local). Útil si los datos se ven desactualizados sin recargar.
- **Limpiar caché del SW:** elimina todas las entradas del Cache Storage del Service Worker y fuerza una recarga del SW. No afecta la base de datos en Firebase.

### Botón de Registro Rápido (FAB)
Botón flotante (`+`) disponible en todos los módulos después de iniciar sesión:
- Posición: esquina inferior derecha (encima del bottom nav en móvil)
- Al pulsar: despliega 3 opciones — **Gasto** · **A Plazos** · **De Contado**
- Cada opción abre un modal auto-contenido que carga datos frescos de Firestore
- **Preview en tiempo real**: al seleccionar tarjeta, fecha y monto muestra fechas del ciclo (corte, límite pago, nómina anterior), Disponible y Usado con cálculo aplicado, e impacto en el mes relacionado (tarjeta + global, incluyendo proyecciones)
- Guarda directamente sin requerir navegar al módulo correspondiente
- La Descripción/Nombre va al final del formulario para no bloquear el preview

---

## Navegación y Routing

La app usa **hash routing** (`#/ruta`) para compatibilidad con GitHub Pages sin configuración adicional de servidor.

| Ruta | Módulo | Descripción |
|---|---|---|
| `#/` | dashboard.js | Dashboard principal |
| `#/tarjetas` | tarjetas.js | Vista wallet de tarjetas |
| `#/compras` | msi.js | Compras y Gastos (De Contado + A Plazos + Gastos); `#/compras/gastos` abre directamente la pestaña Gastos |
| `#/msi` | — | Redirige a `#/compras` (compatibilidad) |
| `#/fijos` | fijos.js | Gastos fijos |
| `#/impacto` | impacto.js | Mes actual |
| `#/impacto/2026-05` | impacto.js | Mes específico |
| `#/rendimientos` | rendimientos.js | Cuentas de inversión y sus rendimientos |
| `#/eventos` | eventos.js | Lista de eventos |
| `#/eventos/{id}` | evento-detalle.js | Detalle de evento |
| `#/admin` | admin-tarjetas.js | CRUD instituciones y tarjetas |
| `#/festivos` | festivos.js | Catálogo de festivos MX |
| `#/exportar` | exportar.js | Exportación de datos |

Los módulos se cargan de forma **lazy** (`import()` dinámico).

**Navegación (sidebar desktop / bottom nav móvil):**
- **Principal:** Dashboard, Tarjetas, Compras y Gastos, Impacto Mensual, Rendimientos
- **Eventos:** Eventos de Ofertas
- **Ajustes:** Administración, Gastos Fijos, Días Festivos
- **Footer sidebar:** Exportar Datos, Cerrar Sesión
- En móvil, los ítems duplicados en bottom nav se ocultan del sidebar (`data-hide-mobile`)

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

### Línea de tiempo y aportaciones

`montoInvertido` + `fechaActualizacion` son el saldo real observado más reciente; las capturas anteriores viven en `historial[]`. Entre dos puntos observados el saldo se proyecta; al llegar a un punto observado el saldo se **reemplaza** por el valor real y la diferencia se reporta como aportación (o retiro), nunca como rendimiento. Se cumple siempre:

```
saldoFinal = saldoInicial + rendimiento + aportaciones
```

`rendimientoObtenido` + `fechaActualizacionRendimiento` siguen el mismo patrón pero para el rendimiento: es la última cifra real capturada, y `rendimientoHastaHoy` se calcula como `rendimientoObtenido + rendimientoEntre(timeline, fechaActualizacionRendimiento, hoy, cfg).rendimiento`. Sin captura, `fechaActualizacionRendimiento` cae de vuelta en `fechaActualizacion`, y el resultado es matemáticamente idéntico a `componer(montoInvertido, dias, cfg).rendimiento` — el comportamiento previo a este campo.

### API pública de `rendimiento.js`

```javascript
// Fechas
isoDay(dateOStringISO) → 'YYYY-MM-DD'
hoyISO()               → 'YYYY-MM-DD'
diasEntre(inicio, fin) → number     // días calendario completos, negativo si fin < inicio
sumarDias(iso, n)      → 'YYYY-MM-DD'

// Tramos — deriva el `desde` de cada tramo, ordena, elimina solapes
// y garantiza un tramo abierto final
normalizarTramos(tramos)          → [{ desde, hasta, tasa }]
tramoActivo(tramosNorm, saldo)    → index | -1

// Constantes de modo
MODO_PROGRESIVO 'progresivo' · MODO_UNICO 'unico'
ISR_CAPITAL     'capital'    · ISR_INTERES 'interes'
TASA_NOMINAL    'nominal'    · TASA_EFECTIVA 'efectiva'

// Valores por omisión
BASE_ANUAL_DEFAULT  365          // base del interés y del ISR
TRAMOS_DEFAULT      [{ hasta: 25000, tasa: 15 }, { hasta: 100000, tasa: 7 }, { hasta: null, tasa: 5 }]
                                 // precargados al crear una cuenta nueva

// Configuración de cálculo — todas las funciones la reciben en lugar de una
// lista larga de parámetros posicionales. Normaliza y aplica defaults.
configCuenta(cuenta) → { tramos, modo, modoTasa, base, isrAnual, isrSobre, baseIsr }

// Composición
tasaDiaria(tasaAnual, cfg)                → number   // según cfg.modoTasa
interesDiario(saldo, cfg)                 → number   // bruto, según cfg.modo
isrDiario(saldo, cfg, interesBruto?)      → number   // según cfg.isrSobre; el 3er arg
                                                     // solo se usa en modo 'interes'
componer(saldoInicial, dias, cfg)
  → { saldoFinal, rendimiento, bruto, isr, dias, ultimo }   // rendimiento = bruto − isr
                                                            // ultimo = { bruto, isr, neto } del último día
tasaNominal(saldo, cfg)            → number   // % anual ponderado, sobre las tasas configuradas

// Reparto del saldo entre los tramos — la suma de `aporte` es interesDiario()
desgloseTramos(saldo, cfg) → [{ desde, hasta, tasa, monto, aporte, pct, marginal }]

// Línea de tiempo de una cuenta
timelineCuenta(cuenta)                        → [{ fecha, monto }]  // ascendente, sin fechas repetidas
saldoEnFecha(timeline, fecha, cfg)            → number | null
rendimientoEntre(timeline, fIni, fFin, cfg)
  → { rendimiento, bruto, isr, saldoInicial, saldoFinal, aportaciones, desde, hasta, dias, recortado } | null

// Rendimiento día por día desde la última captura del monto. Cada entrada es el
// día que GENERÓ el interés; se abona a la madrugada siguiente.
historialDiario(cuenta, hoy?, maxDias = 400)
  → [{ fecha, saldoInicial, bruto, isr, neto, saldoFinal }]   // ascendente

// Resumen completo de una cuenta a una fecha de corte
resumenCuenta(cuenta, hoy?) → {
  ...configCuenta(cuenta),      // tramos, modo, modoTasa, base, isrAnual, isrSobre, baseIsr
  timeline, fechaBase, dias,
  capital, saldoActual,
  rendimientoObtenido, fechaRendimiento, diasRendimiento,  // última captura real + proyección
  rendimientoHastaHoy,          // = rendimientoObtenido + lo generado desde fechaRendimiento
  brutoHastaHoy, isrHastaHoy,
  rendimientoHistorico,         // desde el primer registro, sin aportaciones
  aportacionesHistoricas, diasHistoricos,
  diario, mensual, anual,       // NETOS, sobre el saldo YA actualizado a hoy
  diarioBruto, isrDiario,
  ayer,                         // neto del último día completo — lo abonado hoy
  desglose,                     // = desgloseTramos(saldoActual, cfg)
  tasaNominal,                  // % anual ponderado bruto
  gat,                          // GAT Nominal: antes de impuestos, `base` capitalizaciones
  idxTramo
}

// Acumulado de varias cuentas para el encabezado del módulo y del dashboard
totalizarResumenes(resumenes) → { capital, saldoActual, rendimientoHastaHoy,
                                  rendimientoHistorico, diario, mensual, anual,
                                  isrHastaHoy, gat, cuentas }
```

**Orden del cálculo** (el punto clave del módulo): primero se actualiza el monto invertido desde su última fecha de actualización hasta hoy, y **sobre ese saldo ya actualizado** se calculan los rendimientos diario, mensual y anual.

`rendimientoEntre` devuelve `null` si el rango completo es previo al primer saldo registrado o si las fechas están invertidas. Si solo el inicio es previo, recorta al primer registro y marca `recortado: true`.

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

*Última actualización: 2026-08-06 (v1.9.0) — Tema claro/oscuro con tres estados y color de marca preservado; pasada de densidad en móvil (−10 % de altura, Rendimientos −36 %) con tokens tipográficos; calculadora entre 2 fechas movida a modal; fila de subpago de A Plazos ahora muestra su fecha; sección de gastos pendientes normalizada para móvil. Incluye lo pendiente de v1.8.2 — Rendimientos: interpretación de la tasa configurable por cuenta (nominal o efectiva), desglose del saldo por tramos con barra de reparto, historial día por día, Detalle en modal, ayuda contextual por campo y tarjetas reestructuradas; motor verificado contra abonos reales de dos instituciones con convenciones opuestas*
