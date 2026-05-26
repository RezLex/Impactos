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
9. [Ejecución Local](#ejecución-local)
10. [Despliegue en GitHub Pages](#despliegue-en-github-pages)
11. [Importación de Datos desde Excel](#importación-de-datos-desde-excel)
12. [Instituciones Bancarias Soportadas](#instituciones-bancarias-soportadas)

---

## Descripción General

IMPACTOS es una Single Page Application (SPA) que reemplaza un archivo Excel de gestión financiera personal. Permite administrar:

- Cuentas y tarjetas bancarias de múltiples instituciones
- Compras a Meses Sin Intereses (MSI) con seguimiento de progreso
- Gastos fijos mensuales recurrentes
- Estado mensual de todas las tarjetas (impacto)
- Planeación y comparación de compras en eventos de ofertas (Hot Sale, Buen Fin, etc.)

**Características principales:**
- Interfaz responsiva: sidebar en desktop, bottom navigation en móvil
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
| Parseo Excel | SheetJS (XLSX) | 0.18.5 |
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
    │   ├── tarjetas.js         # CRUD de instituciones y tarjetas
    │   ├── msi.js              # CRUD de compras a meses sin intereses
    │   ├── fijos.js            # CRUD de gastos fijos mensuales
    │   ├── impacto.js          # Estado mensual por tarjeta + nómina
    │   ├── eventos.js          # Lista de eventos de ofertas
    │   ├── evento-detalle.js   # Detalle de evento: planeación, realizadas, promos
    │   └── migracion.js        # Importación de IMPACTOS.xlsx a Firestore
    │
    └── utils/
        ├── db.js               # CRUD genérico para Firestore
        ├── formatters.js       # Formateo de moneda, fechas, seriales Excel, etc.
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
Instituciones financieras registradas.

| Campo | Tipo | Descripción |
|---|---|---|
| `nombre` | string | Nombre de la institución (ej. Banamex) |
| `numeroCliente` | string? | Número de cliente en la institución (opcional) |
| `color` | string | Color hex para la UI (ej. `#e31837`) |

### `tarjetas/{id}`
Tarjetas asociadas a cada institución. Cada tarjeta tiene un tipo y puede tener uno o más números físicos o digitales.

**Campos comunes a todos los tipos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `institucionId` | string | ID de la institución padre |
| `nombre` | string | Nombre de la tarjeta (ej. Clásica, Oro) |
| `tipo` | string | `credito`, `debito` o `prestamo` |
| `clabe` | string? | CLABE interbancaria (18 dígitos), opcional |
| `numeros` | array | Números de tarjeta (ver estructura abajo) |

**Campos exclusivos de `credito`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `limiteTotal` | number? | Límite total de crédito |
| `diaCorte` | number? | Día del mes de corte (1-31) |
| `diaPago` | number? | Día del mes límite de pago (1-31) |

**Campos exclusivos de `prestamo`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `limite` | number? | Monto del préstamo |
| `numeroPago` | string? | Referencia de pago (opcional) |
| `diaCorte` | number? | Día del mes de corte (1-31) |
| `diaPago` | number? | Día del mes límite de pago (1-31) |

**Estructura de cada elemento en `numeros`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `formato` | string | `fisica` o `digital` |
| `numero` | string? | 4 dígitos (últimos) o número completo de 16 dígitos |
| `fechaVencimiento` | string? | Fecha de vencimiento en formato `MM/AA` |

> Los préstamos no tienen `numeros`. El array se guarda vacío (`[]`) para este tipo.

### `msi/{id}`
Compras a meses sin intereses.

| Campo | Tipo | Descripción |
|---|---|---|
| `tarjetaId` | string | ID de la tarjeta usada |
| `compra` | string | Descripción de la compra |
| `total` | number | Monto total de la compra |
| `mensualidad` | number | Monto mensual a pagar |
| `mesesTotal` | number | Total de meses del plan |
| `mesesPagados` | number | Meses ya pagados |
| `restante` | number | Monto pendiente por pagar |
| `primerPago` | string | Fecha ISO del primer pago |
| `ultimoPago` | string | Fecha ISO del último pago |

### `gastosFijos/{id}`
Gastos recurrentes mensuales.

| Campo | Tipo | Descripción |
|---|---|---|
| `nombre` | string | Nombre del gasto (ej. Netflix) |
| `tarjetaId` | string | ID de la tarjeta de cobro |
| `diaCobro` | string | Día del mes o descripción (ej. `8`, `1er Martes`) |
| `importe` | number | Monto mensual |

### `impactoMensual/{YYYY-MM}`
Estado mensual de todas las tarjetas. El ID del documento es el mes en formato `YYYY-MM` (ej. `2026-05`).

| Campo | Tipo | Descripción |
|---|---|---|
| `nomina` | number | Ingreso de nómina del mes |
| `registros` | array | Lista de registros por tarjeta (ver abajo) |
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

**Estructura de cada elemento en `pagosDebito`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `banco` | string | Nombre del banco débito |
| `importe` | number | Monto pagado desde esa cuenta |

### `eventos/{id}`
Eventos de ofertas (Hot Sale, Buen Fin, etc.).

| Campo | Tipo | Descripción |
|---|---|---|
| `nombre` | string | Nombre del evento |
| `tipo` | string | `Hot Sale`, `Buen Fin`, `Cyber Monday`, etc. |
| `fechaInicio` | string | Fecha ISO de inicio |
| `fechaFin` | string | Fecha ISO de fin |
| `planCompras` | array | Productos planeados (ver abajo) |
| `comprasRealizadas` | array | Compras ya realizadas |
| `promociones` | array | Promociones por institución |

**Estructura de cada elemento en `planCompras`:**

```json
{
  "producto": "ROG Destrier Ergo",
  "opcionSeleccionada": 2,
  "opciones": [
    {
      "tienda": "DDTech",
      "enlace": "https://...",
      "precio": 11499,
      "descuento": 0.15,
      "banco": "Banamex",
      "msi": 18
    }
  ]
}
```

**Estructura de cada elemento en `comprasRealizadas`:**

```json
{
  "producto": "ROG Destrier Ergo",
  "tienda": "DDTech",
  "precioCompra": 11499,
  "descuento": 0.15,
  "precioFinal": 9774.15,
  "banco": "Banamex",
  "msi": 18,
  "rastreo": "8055898550781780705642",
  "seguimientoUrl": "https://...",
  "promodescuentosUrl": "https://..."
}
```

**Estructura de cada elemento en `promociones`:**

```json
{
  "institucion": "Banamex",
  "url": "https://..."
}
```

### `_config/owner` *(fuera del namespace de usuario)*
Documento de control de acceso.

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
Administración del catálogo de cuentas bancarias:
- Instituciones ordenadas alfabéticamente; dentro de cada una, tarjetas ordenadas: Débito → Crédito → Préstamo
- CRUD completo para instituciones (nombre, número de cliente, color)
- CRUD completo para tarjetas con tres tipos: **Crédito**, **Débito**, **Préstamo**
- Cada tarjeta agrupa uno o más números (físico/digital), cada uno con su propio vencimiento
- Los préstamos no tienen números de tarjeta; usan CLABE y/o número de pago como referencia
- Los números se muestran como **tarjetas visuales** con gradiente del color institucional: chip dorado para físicas, ícono wifi para digitales
- Botón de copiar en hover sobre cada tile; también copiable: CLABE, número de cliente
- Al pegar un número de tarjeta se eliminan automáticamente los espacios

### MSI (`#/msi`)
Gestión de compras a meses sin intereses:
- Vista en acordeón agrupada por tarjeta de crédito
- Barra de progreso visual por compra (meses pagados / meses totales)
- Cálculo automático de mensualidad al ingresar total y número de meses
- Cálculo automático de restante = `total - (mensualidad × mesesPagados)`
- Totales de deuda global y mensualidad combinada

### Gastos Fijos (`#/fijos`)
Registro de gastos recurrentes:
- Tabla con totalizador al pie
- Asociación a tarjeta específica
- Campo de día de cobro libre (número, texto o descripción)

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
- Columnas calculadas automáticamente: precio con descuento, mensualidad con MSI
- Resaltado automático de la **mejor opción** (menor mensualidad o menor precio)
- Botón "Elegir" para marcar la opción seleccionada

**Compras Realizadas:**
- Registro de lo que ya se compró
- Campos: tienda, precio, descuento, banco, MSI, número de rastreo, URL de seguimiento, URL de Promodescuentos
- Tabla con totales: precio de lista vs. precio final pagado

**Promociones:**
- Tabla de enlaces a las publicaciones de cada institución para el evento

### Importar Datos (`#/migracion`)
Herramienta de migración desde Excel:
- Zona de carga con drag & drop o selección de archivo
- Vista previa de datos detectados antes de importar
- Log en tiempo real del proceso de importación
- Importa: instituciones, tarjetas, MSI, gastos fijos, impacto mensual (todos los meses), eventos

---

## Navegación y Routing

La app usa **hash routing** (`#/ruta`) para compatibilidad con GitHub Pages sin configuración adicional de servidor.

| Ruta | Módulo | Descripción |
|---|---|---|
| `#/` | dashboard.js | Dashboard principal |
| `#/tarjetas` | tarjetas.js | Gestión de tarjetas |
| `#/msi` | msi.js | Compras MSI |
| `#/fijos` | fijos.js | Gastos fijos |
| `#/impacto` | impacto.js | Mes actual |
| `#/impacto/2026-05` | impacto.js | Mes específico |
| `#/eventos` | eventos.js | Lista de eventos |
| `#/eventos/{id}` | evento-detalle.js | Detalle de evento |
| `#/migracion` | migracion.js | Importación Excel |

Los módulos se cargan de forma **lazy** (`import()` dinámico) — solo se descarga el código del módulo cuando se navega a él.

---

## Ejecución Local

La app usa módulos ES6 (`type="module"`) y requiere un servidor HTTP. No se puede abrir `index.html` directamente desde el explorador de archivos.

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
cd C:\Users\gabito\impactos

# Inicializar repositorio
git init
git add .
git commit -m "Initial commit — IMPACTOS app"

# Crear repo en GitHub y conectar
git remote add origin https://github.com/TU_USUARIO/impactos.git
git branch -M main
git push -u origin main
```

En GitHub: **Settings → Pages → Branch: main → / (root) → Save**

La app quedará disponible en `https://TU_USUARIO.github.io/impactos/`

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

GitHub Pages se actualiza automáticamente en ~1 minuto.

---

## Importación de Datos desde Excel

El módulo de migración (`#/migracion`) lee el archivo `IMPACTOS.xlsx` y lo importa a Firestore. El archivo debe tener la estructura original con las siguientes hojas:

| Hoja | Datos importados |
|---|---|
| `Tarjetas` | Instituciones y tarjetas (columnas B-G) |
| `MSI` | Compras MSI agrupadas por tarjeta |
| `Fijos` | Gastos fijos mensuales |
| `Impacto MES-AÑO` | Estado mensual (todas las hojas que inicien con "Impacto") |
| `Hot Sale YYYY` / `Buen Fin YYYY` | Productos planeados del evento |

**Proceso:**
1. Ir a `#/migracion`
2. Arrastrar el archivo `.xlsx` o usar el botón de selección
3. Revisar la vista previa de datos detectados
4. Confirmar con **"Importar a Firebase"**
5. Esperar el log de progreso — el proceso es por lotes para respetar los límites de Firestore

> **Nota:** Los registros de impacto mensual se sobreescriben si ya existen (upsert). El resto de los datos se agregan sin duplicar (cada importación crea registros nuevos, por lo que se recomienda importar solo una vez o limpiar primero las colecciones desde Firebase Console).

---

## Instituciones Bancarias Soportadas

La app incluye estilos y colores predefinidos para las siguientes instituciones:

| Institución | Color | Clase CSS |
|---|---|---|
| Banamex | `#e31837` | `bank-banamex` |
| Banorte | `#da1c2b` | `bank-banorte` |
| BBVA | `#004481` | `bank-bbva` |
| Mercado Pago | `#009ee3` | `bank-mercadopago` |
| NU | `#820ad1` | `bank-nu` |
| Rappi | `#ff441f` | `bank-rappi` |
| Revolut | `#0075eb` | `bank-revolut` |
| Santander | `#ec0000` | `bank-santander` |

Se puede agregar cualquier otra institución desde el módulo Tarjetas — el color es configurable por el usuario.

---

*Generado el 2026-05-26 · Última actualización: 2026-05-26*
