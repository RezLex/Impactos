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
10. [Cálculo de Nómina](#cálculo-de-nómina)
11. [Ejecución Local](#ejecución-local)
12. [Despliegue en GitHub Pages](#despliegue-en-github-pages)
13. [Instituciones Bancarias Soportadas](#instituciones-bancarias-soportadas)

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
    │   ├── dashboard.js        # Vista principal con métricas y resumen
    │   ├── tarjetas.js         # Vista de tarjetas en formato wallet (flip cards)
    │   ├── admin-tarjetas.js   # CRUD de instituciones y tarjetas
    │   ├── msi.js              # Módulo "Compras y Gastos": De Contado + A Plazos + Gastos
    │   ├── fijos.js            # CRUD de gastos fijos mensuales
    │   ├── impacto.js          # Estado mensual por tarjeta + nómina
    │   ├── eventos.js          # Lista de eventos de ofertas
    │   ├── evento-detalle.js   # Detalle de evento: planeación, realizadas, promos
    │   ├── festivos.js         # CRUD de días festivos oficiales MX
    │   └── exportar.js         # Exportación de datos a Excel o JSON
    │
    └── utils/
        ├── db.js               # CRUD genérico para Firestore
        ├── formatters.js       # Formateo de moneda, fechas, seriales Excel, etc.
        ├── ciclo.js            # Cálculo de ciclos de facturación y nómina
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

### `instituciones/{id}`

| Campo | Tipo | Descripción |
|---|---|---|
| `nombre` | string | Nombre de la institución (ej. Banamex) |
| `numeroCliente` | string? | Número de cliente en la institución |
| `color` | string | Color hex para la UI (ej. `#e31837`) |

### `tarjetas/{id}`

**Campos comunes:**

| Campo | Tipo | Descripción |
|---|---|---|
| `institucionId` | string | ID de la institución padre |
| `nombre` | string | Alias de la tarjeta (ej. Clásica, Oro) |
| `tipo` | string | `credito`, `debito` o `prestamo` |
| `clabe` | string? | CLABE interbancaria (18 dígitos) |
| `numeros` | array | Números de tarjeta (ver estructura abajo) |

**Campos de `credito` y `prestamo`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `limiteTotal` | number? | Límite de crédito o monto del préstamo |
| `ciclo` | object? | Configuración del ciclo de facturación (ver sección [Ciclo de Facturación](#ciclo-de-facturación)) |

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
| `fechaCompra` | string | Fecha ISO de la compra (`YYYY-MM-DD`) |
| `total` | number | Monto total de la compra |
| `enlaceCompra` | string? | URL al comprobante o página de la compra |

> La **fecha de pago** no se almacena — para tarjetas de crédito se calcula dinámicamente a partir del ciclo configurado en la tarjeta.

### `gastos/{id}`
Gastos registrados por mes. Incluye dos orígenes: gastos fijos confirmados (tarjetas de crédito) y entradas manuales de retiro/transferencia (tarjetas de débito).

| Campo | Tipo | Descripción |
|---|---|---|
| `tipo` | string | `gastaFijo` (confirmado desde Gastos Fijos) o `manual` (entrada directa) |
| `mes` | string | Mes al que pertenece el gasto (`YYYY-MM`) |
| `nombre` | string | Descripción del gasto |
| `tarjetaId` | string | ID de la tarjeta usada |
| `numeroTarjeta` | string? | Número específico de tarjeta (física o digital) |
| `formaPago` | string | `automatico`, `retiro` o `transferencia` |
| `fechaPago` | string | Fecha ISO en que se realizó el pago (`YYYY-MM-DD`) |
| `importe` | number | Monto del gasto |
| `gastaFijoId` | string? | ID del gasto fijo origen (solo cuando `tipo = 'gastaFijo'`) |

> Los gastos fijos pendientes de confirmar **no se almacenan** — se calculan dinámicamente cada vez que se abre el tab Gastos. Solo al confirmar se crea un documento en esta colección.

### `msi/{id}`
Compras a plazos (meses sin intereses). Las fechas de primer y último pago **no se almacenan** — se calculan dinámicamente a partir del ciclo de la tarjeta y la fecha de compra.

| Campo | Tipo | Descripción |
|---|---|---|
| `tarjetaId` | string | ID de la tarjeta de crédito usada |
| `numeroTarjeta` | string | Número específico de tarjeta usado (física o digital) |
| `compra` | string | Descripción de la compra |
| `fechaCompra` | string | Fecha ISO de la compra (`YYYY-MM-DD`) |
| `total` | number | Monto total de la compra |
| `mensualidad` | number | Monto mensual a pagar |
| `mesesTotal` | number | Total de meses del plan |
| `mesesPagados` | number | Meses ya pagados |
| `restante` | number | Monto pendiente (`total - mensualidad × mesesPagados`) |
| `enlaceCompra` | string? | URL al comprobante o página de la compra |
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

### `impactoMensual/{YYYY-MM}`
Estado mensual. El ID del documento es el mes en formato `YYYY-MM`.

| Campo | Tipo | Descripción |
|---|---|---|
| `nomina` | number | Ingreso de nómina del mes |
| `registros` | array | Lista de registros por tarjeta |
| `pagosDebito` | array | Pagos realizados desde cuentas débito |
| `total` | number | Suma total a pagar |
| `restante` | number | `nomina - total` |

**Estructura de cada elemento en `registros`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `entidad` | string | Nombre visible de la tarjeta |
| `tipo` | string | `credito` o `debito` |
| `limite` | number | Límite de crédito |
| `usado` | number | Monto utilizado en el período |
| `disponible` | number | Límite disponible |
| `corte` | string | Fecha ISO de corte |
| `limitePago` | string | Fecha ISO límite para pagar |
| `aPagar` | number | Monto a pagar este mes |
| `pagado` | boolean | Si ya se realizó el pago |

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
Vista de inicio con:
- **4 métricas:** total a pagar este mes, crédito disponible total, mensualidad MSI combinada, total de gastos fijos
- **Próximos pagos:** tarjetas pendientes del mes actual con indicador de días restantes
- **MSI activos:** compras vigentes con barra de progreso y fecha de término

### Tarjetas (`#/tarjetas`)
Vista de cartera (wallet) de todas las tarjetas registradas:
- Tarjetas visuales con gradiente del color institucional y volteo 3D para ver datos al reverso
- **En desktop:** cuadrícula de tarjetas (flip al hacer clic)
- **En móvil:** stack vertical con efecto de superposición — la tarjeta activa se expande, las demás se colapsan mostrando institución y alias en una línea
- Filtros por tipo (Todas / Débito / Crédito / Préstamo) y por institución
- Ordenamiento: institución → tipo (Débito → Crédito → Préstamo) → alias
- Reverso de cada tarjeta muestra: CLABE, números (físico/digital con últimos 4 dígitos enmascarados) y botones de copiado
- Para crédito y préstamo: chips con límite total y fechas de corte/pago del ciclo activo

### Administración (`#/admin`)
CRUD completo de instituciones y tarjetas:
- Tabla agrupada por institución con encabezado coloreado
- Número de cliente de la institución visible y copiable
- Por tarjeta: tipo, red (Visa/Mastercard/etc.), números (F/D), CLABE, límite y ciclo
- Detección automática de red al pegar número de tarjeta (IIN/BIN)
- Modal de tarjeta con secciones dinámicas según tipo: límite para crédito y préstamo, ciclo de facturación para crédito y préstamo, número de pago para préstamo

### Compras y Gastos (`#/compras`)
Gestión de compras y gastos, organizada en tres pestañas:

**Pestaña De Contado** (colección `contado`)
- Vista en acordeón agrupada por institución
- Tabla: descripción + enlace, tarjeta (alias + últimos 4 dígitos), fecha de compra, fecha de pago, total
- **Fecha de pago:** muestra dos líneas — nómina anterior (icono billetera) y límite de pago del ciclo (icono tarjeta)
- Para tarjetas de débito: columna de fecha de pago vacía

**Pestaña A Plazos** (colección `msi`)
- Vista en acordeón **agrupada por institución**
- Filtros: **En curso** (default) / **Liquidados** / **Todos**
- Por compra: descripción + enlace, tarjeta (alias + últimos 4 dígitos), meses pagados/total, mensualidad, restante/total, primer pago y último pago
- **Primer y último pago:** dos líneas — nómina anterior (icono billetera) y límite de pago del ciclo (icono tarjeta)
- Calculados dinámicamente a partir de la fecha de compra y el ciclo de la tarjeta (ver [Ciclo de Facturación](#ciclo-de-facturación))
- Cálculo automático de mensualidad al ingresar total y número de meses
- **Acción Liquidar:** marca la compra como saldada, registra `fechaLiquidacion`, ajusta `mesesPagados` al total
- Al guardar con `mesesPagados = mesesTotal` se ofrece liquidar automáticamente
- Vista "En curso": métricas de deuda total + mensualidad combinada
- Vista "Liquidados"/"Todos": métricas de total de compras + cantidad

**Pestaña Gastos** (colección `gastos`)
- **Sección "Pendientes de confirmar":** gastos fijos con tarjeta de crédito que aún no se han registrado este mes. Se calculan dinámicamente (no se persisten). La fecha de cobro se muestra en rojo si ya venció.
- Al pulsar **Confirmar**: abre modal pre-cargado con nombre, tarjeta (solo lectura), forma de pago, fecha calculada e importe — todos ajustables para ese mes. Al guardar crea un registro en `gastos` con `tipo = 'gastaFijo'`.
- **Sección "Gastos registrados":** tabla del mes actual con todos los gastos confirmados y manuales.
- **Nueva entrada manual:** solo tarjetas de débito; forma de pago limitada a Retiro o Transferencia. Crea registro con `tipo = 'manual'`.

> **Regla de tipos:** los registros de tarjeta de crédito en `gastos` solo provienen de confirmar un gasto fijo. Las entradas manuales usan únicamente tarjetas de débito.

### Gastos Fijos (`#/fijos`)
Registro de gastos recurrentes (módulo en la sección **Ajustes** del nav):
- Tabla ordenada por institución → nombre del gasto, con totalizador al pie
- Asociación a tarjeta y número específico (física o digital)
- Tres modos de configuración de cobro (se muestra como texto en tabla):
  - **Texto libre:** campo `diaCobro` (ej. "15", "1ra Quincena")
  - **Intervalo fijo:** "Cada N días desde [fecha]" — se ajusta a siguiente día hábil
  - **Día de semana del mes:** "1er Martes de cada mes" — se ajusta a siguiente día hábil
- Los gastos fijos con tarjeta de crédito se precargan automáticamente en el tab Gastos cada mes
- Los gastos fijos con `diaCobro` de texto no parseable como número no se precargan automáticamente

### Impacto Mensual (`#/impacto` o `#/impacto/YYYY-MM`)
Estado financiero mensual:
- Navegación entre meses con flechas anterior/siguiente
- Tabla completa de todas las tarjetas con sus fechas y montos
- Indicador visual de estado: pagado (verde), pendiente (amarillo), vencido (rojo)
- Registro de pagos desde cuentas débito (nómina)
- Cálculo de restante: `nómina - total a pagar`
- Editor modal completo con filas dinámicas para agregar/editar/eliminar registros

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

---

## Navegación y Routing

La app usa **hash routing** (`#/ruta`) para compatibilidad con GitHub Pages sin configuración adicional de servidor.

| Ruta | Módulo | Descripción |
|---|---|---|
| `#/` | dashboard.js | Dashboard principal |
| `#/tarjetas` | tarjetas.js | Vista wallet de tarjetas |
| `#/compras` | msi.js | Compras y Gastos (De Contado + A Plazos + Gastos) |
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

> Las colecciones `contado` y `gastos` son nuevas — no tienen campos obsoletos.

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

*Última actualización: 2026-05-28 — Módulo Compras y Gastos: nueva tab Gastos, colección `gastos`, Gastos Fijos movido a Ajustes*
