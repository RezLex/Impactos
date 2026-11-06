# Deseos multiusuario — Plan

**Estado:** en planeación, sin implementar. Hay 5 decisiones pendientes (ver [abajo](#decisiones-pendientes)).
**Última actualización:** 2026-11-06.

## Objetivo

Abrir el módulo Deseos (Lista y Planes) a un **grupo cerrado de máximo 3 personas conocidas**, con
catálogos globales administrados solo por el dueño. La app privada también consume esos catálogos,
de modo que haya una sola fuente de datos.

Es un piloto para comprobar si el catálogo se puede mantener a mano. No es una apertura al público.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Alcance | Máximo 3 invitados, con acceso por lista de correos |
| Proyecto de Firebase | El mismo de la app privada (`impactos-b4307`), porque la app privada debe leer el catálogo |
| Catálogos globales | Instituciones, bonificaciones, cupones y tiendas. Solo lectura para invitados |
| Administración | Solo desde la app privada, con sus pantallas actuales más una nueva de Tiendas |
| Qué se comparte | Todo el catálogo del dueño; se revisa una vez antes de migrar |
| Deseos | Lista y Planes son de cada usuario, y cada uno los administra por completo |
| Cupones de invitados | No pueden agregar propios |
| Tarjetas de invitados | Institución, crédito o débito, y alias opcional. Sin números, CLABE ni datos de corte |
| Débito | Obliga a Contado |
| Bonificaciones y cupones | Se configuran para crédito, débito o ambas |
| Bonificaciones | Se configuran las tiendas participantes |
| Tiendas | Catálogo global con marca de popular; las populares se ofrecen primero en Deseos |
| Costo | Plan gratuito de Firebase; 4 personas caben en la cuota |

## Arquitectura

```
impactos.rez-lex.com (GitHub Pages)      *.web.app (Firebase Hosting)
App privada completa, administra         Entrada solo con Deseos, para invitados
              \                              /
               impactos-b4307 (Firestore)
               ├── catalogo/...              lectura: dueño e invitados; escritura: dueño
               └── users/{uid}/...           cada usuario, solo lo suyo
```

- **Dominio aparte para invitados:** en el mismo dominio, ambas apps compartirían `localStorage`
  (la caché `impactos_c_*`) y el Service Worker.
- **Sin build step:** la entrada de invitados reutiliza los módulos actuales. Falta definir cómo se
  empaqueta para Firebase Hosting.
- **Acceso a la app privada:** se mantiene la verificación de `auth.js` contra `_config/owner`, así
  que los invitados no entran a ella.

## Modelo de datos

### Rutas nuevas

| Ruta | Contenido |
|---|---|
| `catalogo/instituciones/items/{id}` | Instituciones, sin `numeroCliente` |
| `catalogo/bonificaciones/items/{id}` | Bonificaciones, sin `aplicada` |
| `catalogo/cuponesPlan/items/{id}` | Cupones |
| `catalogo/tiendas/items/{id}` | Tiendas |
| `catalogo/_estado` | Marca de que la migración ya se hizo |
| `users/{uid}/personal_instituciones/{id}` | `numeroCliente` de cada usuario |
| `users/{uid}/personal_bonificaciones/{id}` | `aplicada` de cada usuario |
| `_config/invitados` | `correos: [...]`. Se edita desde la consola de Firebase |

Los IDs de instituciones, bonificaciones y cupones se conservan, para que `tarjeta.institucionId`,
`compra.bonificacionId` y `plan.cupones` sigan siendo válidos.

### Campos nuevos

| Colección | Campo | Valores | Si no existe |
|---|---|---|---|
| `tiendas` | `nombre` | string | — |
| `tiendas` | `popular` | boolean | `false` |
| `bonificaciones` | `aplicaTarjeta` | `credito`, `debito`, `ambas` | `ambas` |
| `bonificaciones` | `tiendaIds` | IDs del catálogo; vacío = todas | Todas |
| `cuponesPlan` | `aplicaTarjeta` | `credito`, `debito`, `ambas` | `ambas` |
| `cuponesPlan` | `tiendaId` | Reemplaza el texto `tienda`; vacío = cualquiera | Cualquiera |
| Todas las del catálogo | `baja`, `fechaBaja` | Baja lógica | Activa |

Los artículos de Deseos guardan la tienda como texto. Se comparan contra el nombre del catálogo sin
distinguir mayúsculas ni espacios.

Los invitados usan la colección `tarjetas` de siempre, limitada a `institucionId`, `tipo` y `nombre`.

## Capa de datos (`js/utils/db.js`)

Fuera de pruebas, los módulos solo llegan a Firestore mediante `db.js`; los únicos otros accesos son
`auth.js`, `firebase.js` y `test/sync.js`. Por eso los 15 archivos que leen `instituciones` no
necesitan cambiar su forma de leer.

- **Lecturas:** para las colecciones del catálogo se lee `catalogo/{col}/items`, se combina con los
  datos personales y se devuelve el resultado como hoy. Incluye las dadas de baja, para seguir
  resolviendo nombres en registros viejos.
- **Escrituras:** se separan los campos. `numeroCliente` y `aplicada` van al espacio del usuario y
  el resto al catálogo. Marcar una bonificación como aplicada no toca el catálogo.
- **Antes de migrar:** mientras no exista `catalogo/_estado`, todo sigue usando las rutas actuales.
- **Sin conexión:** la decisión se recuerda en `localStorage`, para que la vista offline de Tarjetas
  siga funcionando.
- **Modo pruebas:** `test/file-store.js` debe exponer las mismas funciones, y `test/sync.js` debe
  leer del catálogo, porque hoy lee directo de `users/{uid}`.

## Reglas de Firestore (borrador)

Antes de publicarlas hay que compararlas con las de la consola, porque las publicadas no están en el
repo, y confirmar qué documentos existen en `_config`. Quedarían versionadas en `firestore.rules`.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function autenticado() { return request.auth != null; }
    function esDueno()     { return autenticado() && request.auth.uid == '<UID_DEL_DUENO>'; }
    function rutaInvitados() { return /databases/$(database)/documents/_config/invitados; }
    function esInvitado() {
      return autenticado()
        && request.auth.token.email_verified == true
        && exists(rutaInvitados())
        && request.auth.token.email in get(rutaInvitados()).data.correos;
    }
    function tieneAcceso() { return esDueno() || esInvitado(); }

    // auth.js lo lee antes de decidir si deja entrar a la app privada.
    match /_config/owner     { allow read: if autenticado(); allow write: if false; }
    // Las reglas sí pueden leerlo; ningún usuario puede ver la lista de correos.
    match /_config/invitados { allow read, write: if false; }

    match /catalogo/{document=**} {
      allow read:  if tieneAcceso();
      allow write: if esDueno();
    }

    match /users/{userId}/{document=**} {
      allow read, write: if tieneAcceso() && request.auth.uid == userId;
    }
  }
}
```

Esto también cierra un hueco actual: según las reglas documentadas, cualquier cuenta de Google puede
escribir en su propio espacio del proyecto y consumir la cuota. La restricción de `auth.js` solo
existe en el navegador.

El UID del dueño va fijo para que su acceso no dependa de leer otro documento.

## Migración

Orden de publicación:

1. **Publicar las reglas**, ya probadas en el emulador. La versión actual de la app sigue funcionando.
2. **Publicar la app como versión `-Tn`**, que sigue usando las rutas actuales.
3. **Actualizar todos tus dispositivos.** Uno con una versión anterior seguiría escribiendo en la
   ruta vieja, y esos cambios no llegarían al catálogo.
4. **Ejecutar la migración** con un botón en Ajustes, que:
   - Muestra una vista previa con cantidades y la lista de instituciones, para revisar qué se comparte.
   - Copia conservando IDs y separa los datos personales.
   - Precarga `tiendas` con los nombres usados en deseos, planes y cupones, sin duplicar.
   - Convierte `cupon.tienda` en `tiendaId`.
   - Crea `catalogo/_estado` al final.
5. **Confirmar en el teléfono** antes de capturar más datos en el catálogo.

Las variantes como "Amazon" y "Amazon MX" se precargan como dos tiendas, y se depuran a mano.

### Marcha atrás

Ajustes solo exporta a Excel y JSON; no hay restauración. La marcha atrás consiste en conservar los
datos originales de `users/{uid}` y volver a publicar la versión anterior. Lo capturado en el
catálogo después de migrar no está en la ruta vieja, y se perdería. Los datos originales se conservan
hasta confirmar que todo funciona.

## Comportamiento

### Tiendas

- Pantalla nueva en Administración, solo en la app privada: alta, edición, marca de popular, baja y
  reactivación.
- En los campos de tienda de Deseos se ofrecen primero las populares, luego el resto del catálogo y
  al final las que haya escrito el usuario.

### Bonificaciones y cupones

- El formulario de bonificaciones agrega el tipo de tarjeta y las tiendas participantes.
- El formulario de cupones agrega el tipo de tarjeta, y su tienda se elige del catálogo.
- Al ligar una compra, `bonif-form.js` también filtra por el tipo de la tarjeta, porque ya la conoce.
- Las compras no guardan tienda, así que las tiendas participantes no se pueden validar ahí sin
  agregar ese dato (decisión 3).
- En Planes, una tarjeta de débito fija el Pago en Contado.

### Baja lógica en el catálogo

Sustituye a `remove`, porque un borrado afectaría registros de usuarios cuyos datos el dueño no ve:

- **Instituciones** (`admin-tarjetas.js`): hoy el bloqueo por tarjetas asociadas solo ve las del dueño.
- **Bonificaciones** (`bonificaciones.js`): hoy eliminar desliga las compras; con la baja conservan
  su vínculo y su cálculo.
- **Cupones** (`deseos.js`): hoy eliminar limpia los planes del dueño, pero no podría limpiar los de
  otros. Un cupón dado de baja debe dejar de aplicarse.

Las dadas de baja se ocultan en los selectores, salvo la que ya tenga el registro en edición. Esto
incluye Admin, Bonificaciones, Cupones y los tres de `evento-detalle.js`.

### Versión de invitados

- Solo navega por Lista y Planes.
- Agrega y da de baja sus tarjetas simplificadas.
- Ve los cupones en modo de solo lectura.
- `aplicada` y las pantallas de administración no aparecen.

## Fases

| Fase | Alcance | Tamaño aproximado |
|---|---|---|
| 1. Reglas y capa de datos | Reglas probadas, `db.js`, datos personales, migración, baja lógica, modo pruebas | 4–5 días |
| 2. Catálogo y reglas nuevas | Tiendas, crédito/débito, tiendas participantes, formularios | 3 días |
| 3. Versión del grupo | Entrada solo con Deseos en `*.web.app`, tarjeta simplificada, cupones de solo lectura | 3–4 días |

Son estimaciones de trabajo efectivo, de **2 a 2.5 semanas** en total, sin contar la depuración del
catálogo. La fase 1 se publica y se confirma en el teléfono antes de seguir.

Si se agrega un archivo JS nuevo o el módulo de Tiendas, aplica el checklist de
[CLAUDE.md](CLAUDE.md): `SHELL` en `sw.js`, ruta en `js/app.js`, título en `js/router.js`, nav en
`index.html`, y `COLLECTIONS` en `ajustes.js` y `test/collections.js`.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Una falla en la migración o las reglas deja a la app financiera sin nombres de institución | Copia sin borrar, publicación `-Tn`, prueba en el teléfono |
| Datos financieros e invitados comparten proyecto | Reglas probadas en el emulador antes de publicarlas |
| Lo que captures en el catálogo lo ve el grupo, incluidas promociones dirigidas solo a ti | Revisión antes de migrar; tenerlo presente al capturar |
| El catálogo queda desactualizado y se pierde la confianza en los cálculos | Es el punto que el piloto debe evaluar; ver decisión 5 |
| Cambios en `instituciones` tardan en verse en otros dispositivos | La caché local dura hasta 1 día; es aceptable en el piloto |
| Datos insertados sin escapar en el HTML | Pendiente para antes de abrir a más gente; ver abajo |

## Por verificar

- **Apps Script:** usan OAuth de Google y solo tocan colecciones de `users/{UID}` que no pasan al
  catálogo. Se espera que las reglas no los afecten, porque ese tipo de acceso no pasa por ellas.
  Confirmar con su prueba de diagnóstico después de publicarlas.
- **Emulador:** hay Java 17 y Node 22, pero no Firebase CLI. Falta comprobar si la versión actual
  del emulador acepta Java 17. Se instalaría sin agregarlo como dependencia del proyecto.
- **Sugerencias de tienda:** el orden de un `datalist` puede variar en navegadores móviles. Hay que
  probarlo en el teléfono.
- **Empaquetado:** definir cómo se publica la entrada de invitados en Firebase Hosting.
- **`js/modules/migracion.js`:** solo aparece en `SHELL`; ningún módulo ni ruta lo usa. Al parecer es
  código sin uso, y no bloquea el plan.

## Decisiones pendientes

| # | Decisión | Recomendación | Alternativa |
|---|---|---|---|
| 1 | Cómo se elige la tienda en Deseos | Texto con sugerencias, para capturar tiendas fuera del catálogo | Lista cerrada: evita variantes, pero los invitados dependen del dueño |
| 2 | Qué pasa en Planes si la tienda o el tipo de tarjeta no aplican | Calcular igual y mostrar ⚠, como con el mínimo y "Aplica a" | No ofrecer esa bonificación |
| 3 | Validar tiendas participantes en Compras | Solo mostrarlas como información al ligar | Agregar y capturar la tienda en cada compra |
| 4 | Orden de las tiendas populares | Alfabético, con una sola marca | Orden manual |
| 5 | Vigencia de cupones | Fecha máxima opcional; al vencer dejan de ofrecerse | Sin fecha: se ofrecen hasta darlos de baja |

## Antes de abrir a más personas

Fuera del alcance del piloto:

- Escapar el HTML en `deseos.js`, que inserta nombres, tiendas y enlaces sin escapar, incluidos
  posibles enlaces `javascript:`.
- Aviso de privacidad formal y aclaración de que los montos son estimados. Conviene consultar a un
  abogado, también sobre el uso de nombres y colores de bancos.
- App Check y límites contra abuso.
- Pantalla de invitaciones.
- Catálogo en un solo documento, para reducir lecturas.
- Revisar el plan de Firebase si se supera la cuota gratuita.
- Cupones propios de cada usuario, porque muchos códigos son personales o de un solo uso.
