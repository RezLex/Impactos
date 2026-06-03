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
11. [Cálculo de Nómina](#cálculo-de-nómina)
12. [Ejecución Local](#ejecución-local)
13. [Despliegue en GitHub Pages](#despliegue-en-github-pages)
14. [Instituciones Bancarias Soportadas](#instituciones-bancarias-soportadas)

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
├── DOCUMENTACION.md            # Este archivo
│
├── css/
│   └── app.css                 # Todos los estilos (variables, layout, componentes)
│
└── js/
    ├── app.js                  # Punto de entrada — auth, nav, router bootstrap
    ├── auth.js                 # Google Sign-In + verificación de acceso por UID
    ├── firebase.js             # Inicialización Firebase (config + exports db/auth)
    ├── router.js               # Hash router con lazy loading de módulos
    │
    ├── modules/
    │   ├── dashboard.js        # Vista principal — métricas, impacto del mes, A Plazos, gastos
    │   ├── tarjetas.js         # Vista de tarjetas en formato wallet (flip cards)
    │   ├── admin-tarjetas.js   # CRUD de instituciones y tarjetas
    │   ├── msi.js              # Módulo "Compras y Gastos": De Contado + A Plazos + Gastos
    │   ├── fijos.js            # CRUD de gastos fijos mensuales
    │   ├── impacto.js          # Impacto mensual rediseñado — confirmación, pago, cierre
    │   ├── eventos.js          # Lista de eventos de ofertas
    │   ├── evento-detalle.js   # Detalle de evento: planeación, realizadas, promos
    │   ├── festivos.js         # CRUD de días festivos oficiales MX
    │   ├── exportar.js         # Exportación de datos a Excel o JSON
    │   └── quick-add.js        # Registro rápido de compras y gastos (FAB)
    │
    └── utils/
        ├── db.js               # CRUD genérico para Firestore
        ├── formatters.js       # Formateo de moneda, fechas, seriales Excel, etc.
        ├── ciclo.js            # Cálculo de ciclos de facturación y nómina
        ├── saldo.js            # Cálculo de saldo disponible/usado con ajuste por compras
        ├── impacto-calc.js     # Cálculos del Impacto mensual (filtrado, estimados, proyección)
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
| `tarjetas` | array | Un registro por cada tarjeta de crédito/préstamo (ver abajo) |
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
- **2 metric cards:** Total a pagar (con desglose Contado/Plazos/Gastos) · Restante y Esperado (divisor vertical)
- **Barra de crédito:** Crédito total, Disponible y Deuda con barra de progreso visual
- **Compras De Contado recientes** — últimas 7 compras ordenadas por fecha
- **Gastos Fijos del mes** — lista con estado (Registrado/Pendiente/Sin registrar) y montos
- **Tarjetas del mes** — estado de cada tarjeta de crédito (pagada/pendiente/espera corte) con badge 1Q/2Q
- **A Plazos este mes** — mensualidades que vencen este mes con barra de progreso
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
- Tarjetas con botón ⭐ para marcar/desmarcar favoritas

> Las tarjetas marcadas como favoritas aparecen en un grupo `⭐ Favoritas` al inicio de todos los selectores del proyecto (Compras, Gastos Fijos, Registro Rápido). En ese grupo, cada opción muestra el nombre de la institución como prefijo (`Institución — Tarjeta ···4118`) para identificarlas sin el contexto del optgroup de institución.

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
- Datos confirmables individualmente por campo (✓ verde al confirmar)
- **Registrar pago**: habilitado después del corte; actualiza `saldoDisponible` y avanza `mesesPagados` de A Plazos
- **Cerrar mes**: requiere todas las tarjetas pagadas; guarda snapshot + totales
- Auto-creación del impacto al abrir el módulo si no existe para el mes actual
- Estimados se recalculan al reabrir (nuevas compras quedan reflejadas)

**Meses pasados (cerrados):** solo lectura

**Meses futuros (proyección):** estimados calculados al vuelo con pago progresivo simulado de A Plazos y gastos fijos; no muestra columnas de Límite/Disponible

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
| `#/eventos` | eventos.js | Lista de eventos |
| `#/eventos/{id}` | evento-detalle.js | Detalle de evento |
| `#/admin` | admin-tarjetas.js | CRUD instituciones y tarjetas |
| `#/festivos` | festivos.js | Catálogo de festivos MX |
| `#/exportar` | exportar.js | Exportación de datos |

Los módulos se cargan de forma **lazy** (`import()` dinámico).

**Navegación (sidebar desktop / bottom nav móvil):**
- **Principal:** Dashboard, Tarjetas, Compras y Gastos, Impacto Mensual
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
   - `fechaCompra` / `fechaPago` > `tarjeta.fechaActualizacionSaldo`
3. `disponible = max(0, saldoDisponible - gastoPosterior)`
4. `usado = limiteTotal - disponible`
5. `ajustado = gastoPosterior > 0`

**Usos:**
- `admin-tarjetas.js`: columnas Saldo disponible (verde/negro) y Saldo usado en la tabla
- `tarjetas.js`: chip "Usado" en el frente del plástico; chips "Límite" y "Disponible" en la franja del reverso
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
recalcTotalesImpacto(impacto, gastosDebitoLive, nominaOverride?) → totales

// Proyección de un mes futuro con pago progresivo simulado
proyectarMes(mes, currentMes, msi, contado, gastos, tarjetasCredito, nominaAprox, festivosMX, gastosFijos?, todasTarjetas?) → impactoData
```

**Criterio clave de asignación al mes**: una compra/gasto pertenece al Impacto del mes `M` si `anteriorNomina(fechaPago_del_ciclo_que_contiene_la_fecha_de_compra)` cae dentro del mes `M`.

---

## Cálculo de Nómina

Los depósitos de nómina ocurren los días **15 y 30** de cada mes (en febrero se usa el último día del mes). Si el día nominal cae en fin de semana o festivo, se recorre al **día hábil anterior**.

La función `anteriorNomina(date, festivosMX)` devuelve el depósito de nómina más reciente anterior o igual a `date`. Se usa en el módulo MSI para mostrar con qué nómina se cubriría cada pago:

**Ejemplo:** Si el primer pago calculado es el 09/07/2026, se muestra **30/06/2026** (el depósito de nómina de fin de junio es el que precede a ese pago).

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

> Las colecciones `contado` y `gastos` son nuevas — no tienen campos obsoletos.

> `favorita` en `tarjetas/{id}` es un campo nuevo opcional — **no es obsoleto**. Puede estar ausente en tarjetas existentes (se trata como `false`).

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

*Última actualización: 2026-06-03 — Bonificación/cashback en compras, IVA en bonificaciones por institución, tarjetas favoritas con institución en selects, columna Total en A Plazos, rayas alternadas en tablas, solo íconos en bottom nav móvil*
