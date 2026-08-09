# Auditoría móvil — hallazgos y plan

> Medición de las 12 vistas a 390 px con Playwright y datos mock. 2026-08-06.
> Ninguna corrección de este documento está aplicada todavía.

## Cómo se midió

Se montó un harness temporal que renderiza **los módulos reales** (no maquetas): un import map
sustituye `utils/db.js`, `utils/ui.js` y `router.js` por stubs, y `db.js` sirve un juego de datos
mock exigente — nombres largos, importes de 5 cifras, 4 instituciones, 4 tarjetas, compras
diferidas, gastos pendientes y registrados, 2 cuentas de inversión y 2 eventos. El resto de
`utils/` son cálculos puros y corrieron sin tocar.

Cada vista se cargó en un iframe de 390×844 y se midió:

1. **Fugas**: elementos que no caben y que *nadie* scrollea (se descartan los que tienen un
   ancestro con `overflow-x:auto`, porque ahí el scroll es el mecanismo previsto).
2. **Tablas**: cuántas pantallas de ancho hay que recorrer.
3. **Texto truncado** por `text-overflow: ellipsis`.
4. **Objetivos táctiles** por debajo de 32 px.

Las 12 vistas renderizaron **sin errores** y **ninguna produce scroll horizontal de página**:
el `overflow-x: hidden` del `body` más los `.table-wrapper` contienen todo. El layout es
**idéntico en tema claro y oscuro** (misma altura, mismas fugas, mismas tablas).

## Resultados por vista

| Vista | Fugas reales | Tablas que exigen scroll | Toques < 32 px |
|---|---|---|---|
| Dashboard | 0 | — | 1 |
| Tarjetas | 0 | — | 12 |
| Compras · De Contado | 0 (falso positivo `.row`) | — | 4 |
| Compras · Gastos | 0 (falso positivo `.row`) | 7 cols → **2.22×** | 3 |
| Gastos Fijos | 0 | 6 cols → **1.60×** | 1 |
| Impacto | 0 | 7 cols → **2.45×** · 5 cols → 1.17× | 3 |
| Rendimientos | 0 (truncado por diseño) | — | 16 |
| Eventos | 0 | — | 3 |
| Detalle de Evento | 0 | 8 cols → **1.94×** | 4 |
| **Administración** | **5 reales** | — | 10 |
| Días Festivos | 0 | — | 1 |
| Exportar | 0 | — | 0 |

> El `div.row` de Compras aparece 8 px más ancho que su contenedor: son los márgenes negativos
> normales de una `.row` de Bootstrap fuera de un `.container`, compensados por el padding de
> las columnas. No se recorta nada — descartado tras revisarlo en captura.

---

## P1 — Botón inalcanzable en Administración

**Lo medido:** `.admin-inst-header` pide 372 px sobre 358 disponibles. El bloque de acciones
termina en x=388 y, como el `body` tiene `overflow-x: hidden`, el excedente se **recorta**.

**El efecto:** en las instituciones **con número de cliente** (el chip mide 124 px), el botón de
eliminar queda fuera de la pantalla y no hay forma de alcanzarlo — no hay scroll que lo rescate.
Las instituciones sin número de cliente caben y funcionan. Además "Agregar" se parte en dos
líneas. Es el único hallazgo que **impide completar una acción**.

**Plan:** media query `≤575.98px` sobre `.admin-inst-header`: permitir `flex-wrap`, mandar el
chip del número de cliente a su propio renglón y dejar las acciones alineadas a la derecha del
primero. Mismo patrón que se usó para `.gasto-pend` — ganchos de clase ya existen.

## P2 — Importes truncados en Compras ✅ RESUELTO

Corregido como efecto colateral de la pasada de densidad (ver más abajo): al reducir el icono
de la metric card y su padding, y al bajar `.metric-value` con `clamp()`, el ancho disponible
subió de **91 px a 107 px**. Reprobado en vivo: ahora entran incluso importes de 7 cifras
(`$1,115,580.74`). No hizo falta cambiar la rejilla de `msi.js`.

## P2 (original) — Importes truncados en Compras

**Lo medido:** las 8 metric cards de `msi.js` usan `col-6`, lo que a 390 px deja **91 px** para
`.metric-value`, que es `white-space: nowrap` + `ellipsis`. Probando valores en vivo:

| Importe | Necesita | ¿Se corta? |
|---|---|---|
| `$5,580.74` | 91 px | justo al límite |
| `$15,580.74` | 103 px | **sí** |
| `$115,580.74` | 114 px | **sí** |

**El efecto:** cualquier total de 5 cifras se muestra como `$15,58…`. En una app de finanzas el
importe es el dato principal, y los totales de A Plazos y de gastos superan los $10,000 con
normalidad. Se ve como `$5,580....` en cuanto aparece la barra de scroll vertical.

**Plan:** pasar esas cards a `col-12 col-sm-6` (el patrón que ya usan Dashboard y Rendimientos,
que no truncan). Alternativa si se quiere conservar dos por renglón: reducir `.metric-value` a
`1.05rem` bajo 576 px y permitir que el importe use dos líneas.

## P3 — Tablas anchas

Cuatro tablas exigen recorrer entre 1.6 y 2.45 pantallas. Funcionan (el `.table-wrapper` da
scroll y se ve la barra), pero en Impacto las columnas de Corte, Pago y acciones quedan fuera
del primer golpe de vista, que es justo lo que se va a consultar en el teléfono.

| Vista | Columnas | Ancho |
|---|---|---|
| Impacto — tarjetas del mes | 7 | 2.45× |
| Compras · Gastos — registrados | 7 | 2.22× |
| Detalle de Evento — comparativa | 8 | 1.94× |
| Gastos Fijos | 6 | 1.60× |

**Plan, por orden de coste:**

1. **Ocultar columnas secundarias bajo 576 px** con `display:none` por índice — la más barata,
   sin tocar JS. En Impacto: Límite y Disponible; en Gastos: Forma de Pago y Fecha Gasto.
2. **Reordenar** para que las columnas accionables queden a la izquierda.
3. **Convertir a tarjetas apiladas** en móvil (patrón "tabla → lista"). Es lo correcto a largo
   plazo pero implica reescribir el markup de cada tabla; no vale la pena hasta cerrar 1 y 2.

## P4 — Objetivos táctiles pequeños

Botones por debajo de 32 px: Rendimientos 16, Tarjetas 12, Administración 10. Los culpables son
`.btn-ayuda` (18 px), `.inv-hist-btn` y `.btn-copy-data` (22 px) y `.btn-inv-act` (28 px). La
recomendación de accesibilidad es 44 px; `.btn-icon` ya cumple con 32.

**Plan:** subir a 32–36 px solo bajo 576 px, sin tocar el escritorio, donde el ratón no sufre.
Es cosmética acumulada, no bloquea nada.

---

## Fuera de alcance, detectado de paso

`_renderTotalesSection()` en `js/modules/impacto.js:565` **no se invoca desde ningún sitio**.
Son las tres metric cards `col-4` (Crédito total · Disponible · Deuda total) que a 390 px
quedarían en ~50 px de ancho. Como es código muerto no afecta a móvil, pero conviene borrarlo o
reconectarlo antes de que alguien lo reviva sin ver el problema de ancho.

## Orden sugerido

P1 primero: es el único que rompe una función. ~~P2 después~~ (ya resuelto). P3 en su
variante 1 (ocultar columnas), y P4 al final como pasada de pulido.

---

# Pasada de densidad móvil ✅ APLICADA

> Objetivo: menos scroll sin perder legibilidad.

## Lo que cambió la premisa

La petición era reducir font-size para que las vistas ocuparan menos. La medición dijo otra cosa:

- **El texto pequeño ya estaba por debajo del umbral legible.** Rendimientos tenía nodos a
  **8.6, 9.6, 9.9 y 10.2 px**; Dashboard a 9.3–10.9 px. Encogerlo más habría empeorado la
  lectura sin ganar casi nada de alto.
- **El alto estaba en el aire, no en el texto.** En Rendimientos, **752 px de 1483 eran padding
  y margen** — la mitad de la página. `.inv-saldo` gastaba 153 px para mostrar un número.

Así que la pasada hace tres cosas distintas en lugar de una:

| | Qué | Por qué |
|---|---|---|
| **1. Sube el suelo** | Nada por debajo de ~11 px | Lo que no se lee no informa, y subirlo cuesta ~2 px por línea |
| **2. Baja el techo** | `clamp()` fluido entre 320 y 576 px | 28 px de titular es desproporcionado en pantalla chica |
| **3. Recorta el aire** | Padding y márgenes | De aquí sale la reducción de verdad |

## Tokens de tipografía

16 tamaños diminutos vivían en atributos `style` dentro del HTML de los módulos, donde una media
query no los alcanza. Se convirtieron en tokens (`--fs-micro` · `--fs-nano` · `--fs-tiny` ·
`--fs-mini` · `--fs-small`) con el valor de escritorio **idéntico al original** y suelo de
0.70 rem en móvil. Ese es el "font-size dinámico": una escala que responde al ancho, no un
número escrito a mano en cada plantilla.

Los tamaños grandes usan `clamp()` real: `.page-header-text h2`, `.metric-value`,
`.inv-saldo-val`, `.inv-calc-val` y `.inv-upd-est-val`.

## Resultados medidos a 390 px

| Vista | Antes | Después | Reducción | Pantallas |
|---|---|---|---|---|
| Rendimientos | 1483 px | 1197 px | **−19 %** | 1.76 → 1.42 |
| Exportar | 1004 px | 899 px | −10 % | 1.19 → 1.07 |
| Festivos | 795 px | 732 px | −8 % | 0.94 → 0.87 |
| Dashboard | 1425 px | 1336 px | −6 % | 1.69 → 1.58 |
| Impacto | 825 px | 781 px | −5 % | 0.98 → 0.93 |
| Compras · Gastos | 1049 px | 1007 px | −4 % | 1.24 → 1.19 |

**Reducción global: 10 %.** El resto de vistas ya cabían en una pantalla y no cambian de altura.

En Rendimientos, además del recorte de aire, las 4 metric cards pasaron a **dos por renglón**
(`col-12` → `col-6` en `rendimientos.js`), que sola vale 171 px. Se comprobó antes de aplicarla
que los importes de 6 cifras siguen cabiendo; los de 7 no. **No se hizo en Dashboard ni en
Impacto**: sus metric cards son partidas con `.metric-divider` y a media anchura cada mitad
quedaría en ~50 px.

## Cambio posterior: la calculadora de Rendimientos pasó a un modal

*Calcular entre 2 fechas* era una `data-card` permanente entre las metric cards y las cuentas.
Es una consulta puntual, así que ahora vive en un modal que se abre desde un botón **Calcular
periodo** junto a *Nueva Cuenta*, en la cabecera.

Eso baja Rendimientos de **1197 px a 951 px** (otro −21 %), dejando el total de la vista en
**951 px frente a los 1483 px originales: −36 %**, de 1.76 pantallas a 1.13.

## Compensaciones aceptadas

- `.metric-sub` pasa a **dos líneas en vez de elipsis** en móvil. Cuesta ~14 px por fila pero
  evita perder el texto ("Desde la última actualización" se leía como "Desde la última ac…").
  El importe sigue en una línea: un número partido no se lee.
- Etiquetas como "RENDIMIENTO DIARIO" ocupan dos renglones a media anchura. Aceptable.

## Excluido a propósito

El **plástico de las tarjetas** (`.wcard-*` en Tarjetas, `.bct-*` en Administración) conserva sus
tamaños de 9.3–10.4 px. Vive en un lienzo de 280×176 (y 240×110) fijo y subirle la fuente rompe
la composición, no la mejora. Son las únicas fuentes bajo 11 px que quedan, más dos residuos de
`.badge` de Bootstrap a 10.5–10.8 px.

## Verificación

- Perfilado con Playwright y datos mock sobre los módulos reales, antes y después.
- **Escritorio intacto por construcción**: todo vive en `@media (max-width: 575.98px)`; a 1280 px
  se comprobó que los cinco tokens resuelven a su valor original y que `.metric-value` sigue en
  20 px y `.content-area` en `28px 28px 40px`.
- Altura **idéntica en tema claro y oscuro** en las 12 vistas.
- `node --check` en los 6 módulos tocados; CSS con llaves balanceadas y 0 variables sin definir.

Sin revisión visual humana: conviene mirar Dashboard y Compras en el teléfono real antes de
publicar.
