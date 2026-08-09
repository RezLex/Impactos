# Modo Oscuro — Progreso

> Estado del trabajo de tema claro/oscuro. Se actualiza conforme avanzan las fases.
> Última actualización: 2026-08-06 — **fases 0 a 4 completas; pendiente la revisión visual (fase 5)**

## Estrategia

Tokens CSS propios + modo oscuro nativo de Bootstrap 5.3 (`data-bs-theme`). La preferencia
vive en `localStorage`, **no** en Firestore: es una preferencia por dispositivo y guardarla
en la nube obligaría a esperar a que cargue Firebase, provocando parpadeo en cada arranque.

Tres estados: **Sistema** (default) · **Claro** · **Oscuro**.

Hallazgos que condicionaron el plan:

- Bootstrap 5.3.2 ya está cargado → modales, tablas, `form-control` (140 usos en JS),
  `form-select` (43) e `input-group-text` (35) se oscurecen solos con `data-bs-theme="dark"`.
- **No hay** `bg-white` / `bg-light` / `table-light` / `table-striped` en el JS. El estilo es
  CSS propio, no utilidades de Bootstrap — por eso el grueso del trabajo está en `app.css`.
- **Chart.js no se usa** en ningún módulo (solo está cargado en `index.html`). No hay
  tematizado de gráficas pendiente.
- Los colores de institución (`inst?.color`, `BANK_COLORS` en `js/modules/tarjetas.js`) son
  **datos, no tema**: se conservan idénticos en ambos modos. Solo hay que revisar el
  contraste del texto encima.

---

## Fase 0 — Base del tema ✅ HECHO

`index.html`: script inline **antes** de las hojas de estilo que expone `window.TEMA`
(`leer` / `aplicar` / `guardar`) y resuelve el modo antes del primer pintado. Sin esto hay
flash claro en cada recarga.

Estampa en `<html>`:

| Atributo | Para qué |
|---|---|
| `data-theme` | El CSS propio — es lo que consumirá la fase 1 |
| `data-bs-theme` | Activa el modo oscuro nativo de Bootstrap 5.3 |
| `data-tema-pref` | La preferencia cruda (`sistema` / `claro` / `oscuro`) |

También actualiza `<meta name="theme-color">` para la barra de estado en PWA.

Llave: `localStorage['impactos-tema']`. El estado *Sistema* **borra** la llave en vez de
guardar un valor, así que quien nunca toque el botón se comporta igual que antes del cambio.

## Fase 4 — Control de UI ✅ HECHO

Botón `#btn-tema` en el footer del sidebar (`index.html`), arriba de *Exportar Datos*.
Lógica en `setupTema()` de `js/app.js`, invocada desde `onLogin()`:

- Cicla Sistema → Claro → Oscuro con iconos `bi-circle-half` / `bi-sun` / `bi-moon-stars`.
- Listener de `matchMedia` para que el estado *Sistema* siga al SO en vivo, sin recargar.
- Reusa el patrón de persistencia que ya existía para `localStorage['sidebar-collapsed']`.

### Verificación de las fases 0 y 4

`node --check` pasa en `app.js` (como ESM) y en el script inline. La resolución del tema se
probó en Node con un DOM simulado:

```
null (primer arranque), SO claro     → pref=sistema theme=light meta=#0d6efd
null (primer arranque), SO oscuro    → pref=sistema theme=dark  meta=#12151c
claro guardado, SO oscuro            → pref=claro   theme=light meta=#0d6efd
oscuro guardado, SO claro            → pref=oscuro  theme=dark  meta=#12151c
valor basura, SO oscuro              → pref=sistema theme=dark  meta=#12151c
```

El ciclo del botón también quedó correcto, incluyendo que `sistema` limpia la llave.

**Sin verificar visualmente** (no se levantó navegador): cómo queda el botón con el sidebar
colapsado. La regla `app.css:216-217` oculta los `span` del footer, así que debería quedar
solo el icono centrado como los demás ítems, pero no está confirmado en pantalla.

---

## Fase 1 — Tokens en `:root` ✅ HECHO

`css/app.css` pasó de 8 variables de color a **68 tokens semánticos**, agrupados en el bloque
`:root` por familia (marca · superficies · texto · bordes y estados · navegación · plástico ·
tintes · chips de institución). El bloque `:root[data-theme="dark"]` redefine **61** de ellos;
los 7 restantes son medidas (`--sidebar-w`, `--radius`…) más `--sidebar-active-bd`, que
funciona igual sobre ambos fondos de sidebar.

Tres decisiones que conviene recordar:

- **El azul de marca es el mismo en ambos temas.** `--primary`, `--primary-light`,
  `--sidebar-bg` y `--sidebar-active-bd` **no se redefinen** en el bloque oscuro. Por eso
  conservan su color el login, el sidebar, la barra superior en móvil, el header de las data
  cards, el chip de filtro activo y el FAB: son la identidad de la página, no una superficie
  que deba responder al tema.
- **Se separó el azul de superficie del azul de texto.** Como consecuencia de lo anterior hacía
  falta un segundo azul: `--primary` sigue siendo el relleno, y `--accent` / `--accent-strong`
  cubren todo lo que es texto o borde interactivo (tabs activos, bottom nav, acordeón abierto).
  Esos dos sí se aclaran en oscuro, porque `#1a237e` como texto sobre fondo oscuro es
  ilegible. En claro conservan los hexes originales, así que no hubo cambio visual.
- **Los tintes pastel se escribieron como hexes explícitos, no con `color-mix`.** El plan
  proponía `color-mix`, pero eso habría alterado los pasteles del tema claro. Con pares
  `--tint-*` / `--on-tint-*` fijos, el tema claro queda byte a byte como estaba.

Por la misma razón, `<meta name="theme-color">` quedó **estático**: la barra superior es azul
en ambos temas, así que la barra de estado del sistema debe acompañarla. El script inline ya
no lo modifica.

Tokens idénticos en ambos temas: las 6 medidas, el azul de marca (`--primary`,
`--primary-light`, `--primary-dark`, `--sidebar-bg`, `--sidebar-active-bd`) y el plástico de
las tarjetas (`--wcard-back-bg`, `--stripe`).

## Fase 2 — Sustituir literales en `app.css` ✅ HECHO

Sustituidos los ~86 literales por tokens en todas las secciones: navegación, metric/data
cards, tablas, badges, bank chips, formularios, botones, acordeón, tabs, alerts, eventos,
tabla comparativa, Tarjetas UX, filtros, wallet cards, Rendimientos y FAB.

La flecha del `.filter-select` va embebida como SVG con el color en la URL, así que no puede
tomar una variable: lleva una regla `:root[data-theme="dark"] .filter-select` aparte que
reemplaza la imagen por la versión aclarada.

**Literales que quedaron a propósito** — la regla es que *un color sobre una superficie que no
cambia con el tema tampoco debe cambiar*:

| Dónde | Qué | Por qué |
|---|---|---|
| `.auth-overlay`, `.sidebar`, `.mobile-header`, `.data-card-header`, `#fab-btn` | el azul `--primary` / `--primary-light` | Identidad de la página: igual en ambos temas |
| `.btn-google` | `#3c4043`, `#f8f8f8`, blanco | Botón de marca de Google |
| `.filter-chip[data-tipo=…].active` | `#2e7d32` · `#1565c0` · `#e65100` | Colores de categoría sólidos con texto blanco; legibles en ambos temas |
| `.bct-copy.copied` | `#a5d6a7` | Va sobre el plástico coloreado de la tarjeta |
| `color: white` / `#fff` varios | — | Texto sobre sidebar, header de card, FAB y plástico |

### Corrección posterior: tablas

Detectado revisando capturas del modo oscuro — filas que seguían claras con texto negro.
Dos causas, ambas en el CSS de Bootstrap y no en el nuestro:

1. **`.table` pinta cada celda con `--bs-table-bg`, que por defecto es `--bs-body-bg`.**
   Solución: `.table { --bs-table-bg: transparent }`, así el fondo lo aporta la card que
   contiene la tabla, que ya responde al tema. En claro es idéntico (card blanca sobre fondo
   blanco). De paso la tabla toma `--bs-table-color: var(--text)` y
   `--bs-table-border-color: var(--border-soft)`.

2. **Las variantes contextuales de fila no responden a `data-bs-theme`.** Bootstrap 5.3 las
   genera con hexes claros fijos (a diferencia de `.alert-*`, que sí usa los tokens
   `-bg-subtle` / `-text-emphasis` y se adapta solo). Hay reglas
   `:root[data-theme="dark"] .table-…` que las remapean a nuestros tintes:

   | Clase | Dónde se usa | Tinte en oscuro |
   |---|---|---|
   | `.table-success` | Tarjeta pagada (dashboard, impacto) y compra liquidada (msi) | `--tint-success` |
   | `.table-warning` | Fila padre de una compra diferida (msi, 2 tablas) | `--tint-warn-alt` |
   | `.table-secondary` | Pie de la tabla de gastos débito del Impacto | `--surface-2` |
   | `.table-danger`, `.table-info`, `.table-light`, `.table-active` | sin uso hoy | previstas |

> Si tras desplegar se siguen viendo filas claras, es caché del Service Worker: usar
> **Exportar → Limpiar caché del SW** o recargar con Ctrl+Shift+R.

## Fase 3 — Estilos inline en JS ✅ HECHO

Los `metric-icon` pasaron a clases de tinte (`.tint-info`, `.tint-success`, `.tint-warn`,
`.tint-warn-alt`, `.tint-danger`, `.tint-purple`, `.tint-indigo`, `.tint-neutral`). El fondo va
en el contenedor y **el `<i>` hereda el color**, así que se eliminó también el
`style="color:#…"` de cada icono. Además:

- `.metric-divider` (+ modificador `.tight` para el divisor de 8 px de `impacto.js`)
- `.row-highlight` para las filas `#fffde7`
- `<strong style="color:#c62828|#2e7d32">` → las utilidades `.text-danger` / `.text-success`,
  que ya eran variables
- Casos sueltos (caja de vista previa del registro rápido, botones de `msi.js`, grises `#999`
  / `#555` / `#aaa`) resueltos con `var(--…)` **dentro del propio atributo `style`**, sin
  inventar clases de un solo uso

> **Corrección posterior:** el barrido inicial usaba un patrón de 6 dígitos y se saltó 11
> grises escritos con hex de 3 (`#555`, `#666`, `#888`, `#aaa`) en `msi.js`, `dashboard.js`,
> `eventos.js`, `impacto.js` y `migracion.js` — entre ellos el de las filas de subpago, que en
> oscuro quedaban casi ilegibles. Mapeados a `--text-soft` / `--text-muted` / `--text-faint`.

**Excepciones deliberadas**, por la misma regla de la fase 2 — quedan 4 hex inline en JS:

| Archivo | Color | Por qué se queda |
|---|---|---|
| `js/auth.js:61` | `#ff6b6b` | Mensaje de error sobre el degradado del login, oscuro en ambos temas |
| `js/modules/tarjetas.js:310` | `#4caf50` | Chip de saldo sobre el plástico de la tarjeta |
| `js/modules/evento-detalle.js:216` | `#37474f` | Cabecera pizarra de la card de producto |
| `js/modules/dashboard.js:351` | `#607d8b` | *Fallback* del color de institución — es dato |

## Fase 5 — Verificación ⚠️ PARCIAL

Hecho:

- `node --check` (como ESM) sobre los 9 módulos tocados: **todos parsean**.
- Auditoría del CSS por script: llaves balanceadas, **0 `var(--x)` sin definir**, ningún token
  definido y no usado, y el diff de tokens entre `:root` y el bloque oscuro revisado uno a uno.
- Barrido final de literales: los que quedan son exactamente los de las dos tablas de
  excepciones de arriba.

**Sin verificar visualmente** — no se levantó navegador, según `CLAUDE.md`. Pendiente de
revisión manual en ambos temas:

- Dashboard · Tarjetas (flip en desktop y stack en móvil) · las 3 pestañas de Compras ·
  Impacto (activo, cerrado y proyección) · Rendimientos (tarjetas de cuenta, modales de
  detalle e historial) · Admin · Gastos Fijos · Festivos · Eventos · Exportar
- Modales, FAB y pantalla de login
- El botón de tema con el sidebar colapsado
- Contraste de los tintes oscuros elegidos (`--tint-*` / `--on-tint-*`) — son una propuesta
  razonada, no medida contra WCAG

## Pendiente al desplegar ⬜

- Subir `APP_VERSION` a 1.9.0 en `js/app.js`
- Subir el contador de caché del Service Worker en `sw.js`
- Agregar la sección de tema claro/oscuro en `DOCUMENTACION.md`

Nada de esto debe hacerse por iteración sin publicar — solo una vez, en el despliegue.
