# Impacto Mensual — mes activo único (plan)

> Modificación a `js/modules/impacto.js`: hoy nada impide que haya más de un mes
> `activo` a la vez. Este archivo es el plan acordado, todavía sin implementar.

## Contexto

`impacto/{YYYY-MM}` es un doc por mes calendario, totalmente independiente de
los demás: `_crearImpacto` se dispara para cualquier mes que no tenga doc
mientras `!isPast` (calculado contra `currentYYYYMM()`), sin revisar si otro
mes ya está `activo`. Eso permite el escenario que motivó
`docs/RECORDATORIOS-PUSH.md`: julio se queda `activo` sin cerrar, llega
agosto, y el usuario puede terminar viendo/editando dos meses activos a la
vez, o navegando a un mes futuro con las flechas y creándolo sin querer.

## Reglas a implementar

1. No se puede generar (persistir) un impacto `activo` para un mes si ya
   existe otro `activo` en cualquier otro mes — hay que cerrar el vigente
   primero.
2. Al cerrar un mes (`estado: 'cerrado'`), se crea automáticamente el
   siguiente como `activo` (ejemplo: cerrar agosto 2026 el día 30 activa
   septiembre 2026 de inmediato, sin esperar a que el usuario lo visite).
3. `#/impacto` (sin mes en la URL) siempre redirige al mes activo real —
   nunca al mes calendario actual ni a uno arbitrario.
4. Si no hay ningún mes activo, se genera como activo el mes siguiente al
   último cerrado (o el mes calendario actual si nunca hubo ningún impacto —
   instalación nueva).

Toda la lógica es del lado del cliente, igual que el resto de las reglas de
negocio de la app (no hay reglas de seguridad de Firestore que las respalden).

## Diseño

### Nuevo: `_resolverMesActivo()`
```js
async function _resolverMesActivo() {
  const activos = await getAll('impacto', where('estado', '==', 'activo'));
  if (activos.length) return activos.map(a => a.mes).sort()[0];
  const cerrados = await getAll('impacto', where('estado', '==', 'cerrado'));
  if (cerrados.length) return nextMonth(cerrados.map(c => c.mes).sort().at(-1));
  return currentYYYYMM();   // instalación nueva: nunca hubo ningún impacto
}
```
- `where` ya está reexportado por `js/utils/db.js:160`; `nextMonth`/
  `currentYYYYMM` ya existen en `js/utils/formatters.js:69-84`.
- **Dato heredado (más de un `activo` a la vez):** si por el hueco actual ya
  quedaron dos meses activos, se elige el **más antiguo** — fuerza a cerrarlos
  en orden, sin necesidad de una migración aparte: el sistema se autocorrige
  en cuanto el usuario cierra el más viejo (al cerrarlo, la regla 2 activa el
  siguiente, y `_resolverMesActivo` ya no lo vuelve a encontrar entre los
  `activo`).

### `render(container, mesParam)` — redirección al activo
```js
export async function render(container, mesParam) {
  if (mesParam) return renderView(container, mesParam);
  const mesActivo = await _resolverMesActivo();
  navigate('/impacto/' + mesActivo);   // dispara hashchange → vuelve a entrar con mesParam
}
```
`navigate` ya está importado de `js/router.js` — mismo mecanismo que usan hoy
los botones `imp-prev`/`imp-next` (`js/modules/impacto.js:258-259`).

### `renderView` — restringir la creación al mes activo
Sustituir el `isFuture`/`isPast` calculado contra `currentYYYYMM()`
(`js/modules/impacto.js:23-25`) por una comparación contra `mesActivo`:
```js
const mesActivo = await _resolverMesActivo();
const isFuture  = mes > mesActivo;   // solo vista previa, nunca se persiste
const isPast    = mes < mesActivo;   // histórico; si no existe doc, vacío
```
Y la rama de creación (`js/modules/impacto.js:47-126`):
```js
let impacto;
if (impactoExistente) {
  impacto = impactoExistente;
  // ... recálculo sin cambios cuando impacto.estado === 'activo'
} else if (mes === mesActivo) {
  impacto = await _crearImpacto(mes, tarjetasCredito, contado, msi, gastos, festivosMX, nominaAprox, instMap, pagosDiferidos);
} else if (isFuture) {
  impacto = proyectarMes(mes, mesActivo, msi, contado, gastos, tarjetasCredito, nominaAprox, festivosMX, gastosFijos, tarjetas, pagosDiferidos);
  impacto.tarjetas = impacto.tarjetas.map(/* enriquecido con institución, sin cambios */);
} else {
  impacto = null;   // mes pasado que nunca se generó
}
```
`proyectarMes(mes, currentMes, ...)` (`js/utils/impacto-calc.js:350`) recibe
`currentMes` como segundo parámetro pero **no lo usa en ningún punto del
cuerpo** (única aparición del nombre en todo el archivo) — pasar `mesActivo`
en vez del mes calendario no cambia el cálculo de la proyección.

Con esto, navegar con las flechas `imp-prev`/`imp-next` a un mes futuro
respecto al activo sigue mostrando la vista previa (igual que hoy), pero
**ya no crea un doc `activo` nuevo** — la única puerta de creación es
`mes === mesActivo`, y esa siempre pasa por `_resolverMesActivo()`.

### `_cerrarMes()` — cascada al siguiente mes
Después de marcar `estado: 'cerrado'` (`js/modules/impacto.js:911-917`),
generar el siguiente mes como activo si no existe ya:
```js
const proximoMes = nextMonth(impacto.mes);
if (!(await getById('impacto', proximoMes))) {
  await _crearImpacto(proximoMes, ctx.tarjetasCredito, ctx.contado, ctx.msi, ctx.gastos, ctx.festivosMX, ctx.nominaAprox, ctx.instMap, ctx.pagosDiferidos);
}
```
Todo lo que `_crearImpacto` necesita ya viaja en `ctx`
(`js/modules/impacto.js:132-136`), no hay que pedir nada nuevo.

**Detalle de UX a confirmar:** tras cerrar, la vista se queda en el mes recién
cerrado (`renderView(ctx.container, ctx.mes)`, sin cambios) — septiembre ya
quedó `activo` en Firestore, pero solo se ve al navegar con la flecha o al
volver a `#/impacto`. Si en cambio se prefiere saltar automáticamente al mes
nuevo apenas se cierra el anterior, es cambiar esa llamada final por
`navigate('/impacto/' + proximoMes)` — un ajuste de una línea.

## Qué NO cambia
- `_showModalPagar`, `_registrarPago`, edición de campos confirmados, gastos
  de débito, totales — sin tocar.
- `docs/RECORDATORIOS-PUSH.md` sigue funcionando tal cual: `revisarCortes()`
  sigue recorriendo *todos* los `impacto` con `estado === 'activo'` como
  respaldo defensivo (dato heredado, o un mes que nadie visitó en mucho
  tiempo), pero en el flujo normal, de aquí en adelante, nunca debería
  encontrar más de uno.

## Verificación
- `node --check js/modules/impacto.js`.
- Manual (según `docs/CLAUDE.md`, sin Playwright salvo pedido explícito):
  abrir `#/impacto` y confirmar que aterriza en el mes activo; navegar
  adelante con la flecha a un mes futuro y confirmar en Firestore que **no**
  se crea un doc nuevo mientras se ve como "Proyección"; cerrar el mes activo
  (con todas las tarjetas pagadas) y confirmar que el mes siguiente aparece
  ya `activo` en Firestore.
