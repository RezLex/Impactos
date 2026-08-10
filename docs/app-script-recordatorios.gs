/**
 * Recordatorios push — corte de tarjeta, gasto fijo por confirmar y cierre de
 * mes. Extiende el sistema de notificaciones (`docs/NOTIFICACIONES-PUSH.md`)
 * con `tipo: 'corte' | 'gastoFijo' | 'rendimiento'` en la misma colección
 * `notificaciones` que ya usa `app-script.gs` para `tipo: 'compra'`.
 *
 * Archivo separado a propósito, dentro del mismo proyecto de Apps Script: los
 * archivos `.gs` de un proyecto comparten un solo scope global, así que este
 * reutiliza sin duplicar `PROJECT_ID`, `UID`, `FS_DOCS`, `FS_API`, `FCM_SEND`,
 * `fsFetch`, `fsVal`, `fsMap`, `fsMapa`, `idDeRuta`, `pesos`, `escapar`, `fmt`
 * y `listarTokens`/`listarNotificaciones` de `app-script.gs`. **No se
 * modifica `app-script.gs`.**
 *
 * Ver `docs/IMPACTO-MES-ACTIVO.md`: con mes activo único, `revisarCortes` ya
 * no puede toparse con más de un `impacto` en `estado: 'activo'` en el flujo
 * normal — pero se deja igual como respaldo defensivo (dato heredado, o un
 * mes que nadie visitó en mucho tiempo).
 *
 * Trigger:
 *   procesarRecordatorios() — una vez al día, trigger de tiempo propio
 *   (independiente de los dos de `app-script.gs`, para que un bug acá no
 *   afecte la detección de compras). Corre las tres rutinas de abajo y manda
 *   UN solo push agrupando lo que se haya creado/reenviado en la corrida.
 *
 * Requiere: los mismos scopes y la misma propiedad de script `UID` que ya
 * pide `app-script.gs` — no se agrega ninguno nuevo.
 */

// ---------- Configuración ----------

const FS_IMPACTO     = FS_DOCS + '/users/' + UID + '/impacto';
const FS_GASTOSFIJOS = FS_DOCS + '/users/' + UID + '/gastosFijos';
const FS_GASTOS      = FS_DOCS + '/users/' + UID + '/gastos';
const FS_FESTIVOS    = FS_DOCS + '/users/' + UID + '/festivosMX';
const DIAS_REINTENTO = 2;   // cadencia de reintento de corte/impacto faltante

// ---------- Trigger diario único ----------

function procesarRecordatorios() {
  const hoy       = fmt(new Date(), 'yyyy-MM-dd');
  const mesActual = hoy.slice(0, 7);

  let creados = [];
  try {
    creados = creados.concat(revisarCortes(mesActual, hoy));
  } catch (e) { console.log('CORTES — ' + e.message); }
  try {
    creados = creados.concat(revisarGastosFijos(mesActual, hoy));
  } catch (e) { console.log('GASTOS FIJOS — ' + e.message); }
  try {
    creados = creados.concat(revisarCierreMes(mesActual, hoy));
  } catch (e) { console.log('CIERRE MES — ' + e.message); }

  // Mismo patrón que `procesarCompras`: el push va al final y en su propio
  // try — si falla, los documentos ya están en Firestore y se ven al abrir
  // la app, así que no debe tumbar la corrida ni provocar un reintento.
  if (creados.length) {
    try {
      enviarPushRecordatorios(creados, mesActual);
    } catch (e) { console.log('PUSH — ' + e.message); }
  }

  console.log('Recordatorios: ' + creados.length);
}

// ---------- 1. Corte de tarjeta ----------

/**
 * `impacto/{YYYY-MM}` es un doc por mes calendario, independiente de los
 * demás — la app no obliga a cerrar un mes antes de abrir el siguiente. Por
 * eso no se pide un mes puntual: se listan todos los `impacto` (colección
 * chica, un doc por mes) y se revisa cada uno.
 *
 * Tres subtipos posibles, marcados en `datos.subtipo`:
 *   - faltaImpacto — mes calendario actual sin doc.
 *   - sinConfirmar — por cada `impacto` activo, por cada tarjeta con
 *     `fechaCorte` y `confirmado !== true`.
 *   - sinCerrar — por cada `impacto` activo con `mes < mesActual` (un mes ya
 *     terminado que se quedó abierto).
 *
 * Cadencia de reintento (los tres subtipos, mismo mecanismo): un solo doc
 * `notificaciones` por clave natural (el propio id del documento), con
 * `ultimoAviso`. Se recalculan los candidatos vigentes en cada corrida y se
 * comparan contra los `pendiente` que ya existen:
 *   - Clave vigente sin doc pendiente → si ya pasó al menos 1 día desde la
 *     fecha que dispara la condición, se crea y entra al push.
 *   - Clave vigente con doc pendiente → si ya pasaron `DIAS_REINTENTO` días
 *     desde `ultimoAviso`, se actualiza (mismo doc) y entra al push.
 *   - Doc pendiente cuya clave ya no es vigente → la condición se cumplió
 *     (confirmó, se creó el impacto, o se cerró el mes): pasa a
 *     `estatus: 'procesada'`, sin que el usuario tenga que tocarlo.
 */
function revisarCortes(mesActual, hoy, soloLectura) {
  const candidatos = {};

  const impactos = listarColeccion(FS_IMPACTO);
  const existeMesActual = impactos.some(function (d) { return d._id === mesActual; });
  if (!existeMesActual) {
    candidatos['faltaImpacto-' + mesActual] = {
      datos: { subtipo: 'faltaImpacto', mes: mesActual },
      fechaDisparo: mesActual + '-01',
    };
  }

  impactos.filter(function (d) { return d.estado === 'activo'; }).forEach(function (imp) {
    const mes = imp._id;

    (imp.tarjetas || []).forEach(function (t) {
      if (!t.fechaCorte || t.confirmado === true) return;
      candidatos['sinConfirmar-' + t.tarjetaId + '-' + mes] = {
        datos: {
          subtipo: 'sinConfirmar', tarjetaId: t.tarjetaId, nombre: t.nombre, mes: mes,
          fechaCorte: t.fechaCorte, monto: t.montoAPagar != null ? t.montoAPagar : t.estimadoTotal,
        },
        fechaDisparo: t.fechaCorte,
      };
    });

    if (mes < mesActual) {
      candidatos['sinCerrar-' + mes] = {
        datos: { subtipo: 'sinCerrar', mes: mes },
        fechaDisparo: _nextMonthStr(mes) + '-01',
      };
    }
  });

  const pendientes = listarNotificaciones().filter(function (n) {
    return n.tipo === 'corte' && n.estatus === 'pendiente';
  });

  return _procesarCandidatosCorte(candidatos, pendientes, hoy, soloLectura);
}

function _procesarCandidatosCorte(candidatos, pendientes, hoy, soloLectura) {
  const resultado = [];
  const vistos = {};

  pendientes.forEach(function (n) {
    const key = idDeRuta(n._nombre);
    vistos[key] = true;
    const c = candidatos[key];

    if (!c) {
      // La condición ya no es vigente: se autorresuelve.
      if (!soloLectura) _fsPatch(FS_API + n._nombre, { estatus: fsVal('procesada') }, ['estatus']);
      return;
    }

    const dias = _diasDesde(n.ultimoAviso, hoy);
    if (dias >= DIAS_REINTENTO) {
      if (!soloLectura) {
        _fsPatch(FS_API + n._nombre, {
          datos: fsMap(c.datos),
          ultimoAviso: { timestampValue: new Date().toISOString() },
        }, ['datos', 'ultimoAviso']);
      }
      resultado.push({ notifId: key, tipo: 'corte', datos: c.datos });
    }
  });

  Object.keys(candidatos).forEach(function (key) {
    if (vistos[key]) return;
    const c = candidatos[key];
    if (_diasDesde(c.fechaDisparo, hoy) < 1) return;

    if (!soloLectura) {
      fsFetch(FS_NOTIS + '/' + key, 'patch', {
        fields: {
          tipo: fsVal('corte'), estatus: fsVal('pendiente'),
          datos: fsMap(c.datos), creado: { timestampValue: new Date().toISOString() },
          ultimoAviso: { timestampValue: new Date().toISOString() },
        },
      });
    }
    resultado.push({ notifId: key, tipo: 'corte', datos: c.datos });
  });

  return resultado;
}

// ---------- 2. Gasto fijo por confirmar ----------

/**
 * `gastos` (los "por confirmar") se crea de forma perezosa solo al abrir
 * `#/compras` (`js/modules/msi.js:161-210`) — acá sí hace falta calcular la
 * fecha de forma independiente. Se portan `calcularFechaGastoMes` y
 * `_sigHabil` (`js/modules/msi.js:2080-2131`) a este archivo.
 *
 * Sin reintento: es un evento puntual (una vez confirmado o descartado desde
 * la pestaña Gastos, no vuelve a aparecer). El gate de idempotencia es la
 * propia existencia del doc `gastos` de ese `gastaFijoId` en el mes.
 */
function revisarGastosFijos(mesActual, hoy, soloLectura) {
  const gastosFijos = listarColeccion(FS_GASTOSFIJOS);
  const festivosMX  = listarColeccion(FS_FESTIVOS);
  const gastos      = listarColeccion(FS_GASTOS);

  const partes = mesActual.split('-');
  const year   = Number(partes[0]);
  const month  = Number(partes[1]) - 1;   // 0-indexado, como Date de JS

  const existentes = {};
  gastos.forEach(function (g) {
    if (g.mes === mesActual && g.gastaFijoId) existentes[g.gastaFijoId] = true;
  });

  const resultado = [];

  gastosFijos.forEach(function (gasto) {
    if (existentes[gasto._id]) return;

    const fecha = _calcularFechaGastoMes(gasto, year, month, festivosMX);
    if (!fecha) return;
    const fechaISO = fmt(fecha, 'yyyy-MM-dd');
    if (fechaISO !== hoy) return;

    const datosGasto = {
      tipo: 'gastaFijo', estado: 'pendiente', mes: mesActual,
      gastaFijoId: gasto._id, nombre: gasto.nombre,
      tarjetaId: gasto.tarjetaId || '',
      formaPago: gasto.formaPago || '',
      fechaPago: fechaISO,
      importe: Number(gasto.importe) || 0,
    };
    if (gasto.numeroTarjeta) datosGasto.numeroTarjeta = gasto.numeroTarjeta;

    const datosNoti = {
      gastaFijoId: gasto._id, nombre: gasto.nombre,
      importe: datosGasto.importe, fechaPago: fechaISO,
    };
    const notifId = 'gastoFijo-' + gasto._id + '-' + mesActual;

    if (!soloLectura) {
      fsFetch(FS_GASTOS, 'post', { fields: _fsCampos(datosGasto) });
      fsFetch(FS_NOTIS + '/' + notifId, 'patch', {
        fields: {
          tipo: fsVal('gastoFijo'), estatus: fsVal('pendiente'),
          datos: fsMap(datosNoti), creado: { timestampValue: new Date().toISOString() },
        },
      });
    }

    resultado.push({ notifId: notifId, tipo: 'gastoFijo', datos: datosNoti });
  });

  return resultado;
}

/** Portado de `js/modules/msi.js:_sigHabil` — mismo criterio de día hábil. */
function _sigHabilRecordatorio(date, festivosMX) {
  const festSet = {};
  festivosMX.forEach(function (f) { festSet[f.fecha] = true; });
  const d = new Date(date);
  while (d.getDay() === 0 || d.getDay() === 6 || festSet[fmt(d, 'yyyy-MM-dd')]) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/** Portado de `js/modules/msi.js:calcularFechaGastoMes`, sin cambios de lógica. */
function _calcularFechaGastoMes(gasto, year, month, festivosMX) {
  if (gasto.semanaDelMes && gasto.diaSemana) {
    const jsDay = gasto.diaSemana === 7 ? 0 : gasto.diaSemana;
    if (gasto.semanaDelMes === -1) {
      const d = new Date(year, month + 1, 0);
      while (d.getDay() !== jsDay) d.setDate(d.getDate() - 1);
      return _sigHabilRecordatorio(d, festivosMX);
    }
    let count = 0;
    const d = new Date(year, month, 1);
    while (d.getMonth() === month) {
      if (d.getDay() === jsDay) {
        count++;
        if (count === gasto.semanaDelMes) return _sigHabilRecordatorio(new Date(d), festivosMX);
      }
      d.setDate(d.getDate() + 1);
    }
    return null;
  }

  if (gasto.diasIntervalo && gasto.fechaInicio) {
    const inicio     = new Date(gasto.fechaInicio + 'T12:00:00');
    const monthStart = new Date(year, month, 1);
    const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59);
    const diffDays   = Math.ceil((monthStart - inicio) / 86400000);
    const n          = Math.ceil(diffDays / gasto.diasIntervalo);
    for (let i = Math.max(0, n - 1); i <= n + 2; i++) {
      const d = new Date(inicio);
      d.setDate(d.getDate() + i * gasto.diasIntervalo);
      if (d >= monthStart && d <= monthEnd) return _sigHabilRecordatorio(d, festivosMX);
    }
    return null;
  }

  if (gasto.diaCobro) {
    const day = parseInt(gasto.diaCobro, 10);
    if (!isNaN(day) && day >= 1 && day <= 31) {
      const maxDay = new Date(year, month + 1, 0).getDate();
      return new Date(year, month, Math.min(day, maxDay));
    }
  }

  return null;
}

// ---------- 3. Cierre de mes ----------

/** Si hoy es el último día del mes, crea una sola notificación (dedupe por mes, sin reintento). */
function revisarCierreMes(mesActual, hoy, soloLectura) {
  const hoyDate   = new Date(hoy + 'T12:00:00');
  const ultimoDia = new Date(hoyDate.getFullYear(), hoyDate.getMonth() + 1, 0).getDate();
  if (hoyDate.getDate() !== ultimoDia) return [];

  const notifId   = 'rendimiento-' + mesActual;
  const existente = _fsGetOrNull(FS_NOTIS + '/' + notifId);
  if (existente) return [];

  const datos = { mes: mesActual };
  if (!soloLectura) {
    fsFetch(FS_NOTIS + '/' + notifId, 'patch', {
      fields: {
        tipo: fsVal('rendimiento'), estatus: fsVal('pendiente'),
        datos: fsMap(datos), creado: { timestampValue: new Date().toISOString() },
      },
    });
  }
  return [{ notifId: notifId, tipo: 'rendimiento', datos: datos }];
}

// ---------- Web Push (FCM) ----------

/**
 * Texto de un recordatorio solo — el detalle, que es lo útil cuando es uno.
 * Mismos textos acordados en `docs/RECORDATORIOS-PUSH.md`.
 */
function _textoRecordatorioUno(item, mesActual) {
  const d = item.datos;

  if (item.tipo === 'corte') {
    if (d.subtipo === 'faltaImpacto') {
      return { titulo: 'Genera el Impacto de ' + d.mes, cuerpo: 'toca para generarlo' };
    }
    if (d.subtipo === 'sinConfirmar') {
      const sufijo = d.mes === mesActual ? '' : ' (de ' + d.mes + ')';
      return {
        titulo: 'Cortó tu tarjeta ' + d.nombre,
        cuerpo: pesos(d.monto) + ' por confirmar — toca para revisarlo' + sufijo,
      };
    }
    if (d.subtipo === 'sinCerrar') {
      return { titulo: 'Impacto de ' + d.mes + ' sin cerrar', cuerpo: 'toca para revisarlo y cerrarlo' };
    }
  }

  if (item.tipo === 'gastoFijo') {
    return { titulo: d.nombre + ' — gasto fijo por confirmar', cuerpo: pesos(d.importe) };
  }

  if (item.tipo === 'rendimiento') {
    return { titulo: 'Fin de mes', cuerpo: 'revisa los rendimientos de tus cuentas' };
  }

  return { titulo: 'Recordatorio', cuerpo: 'toca para revisarlo' };
}

/** Texto de varios recordatorios mezclados: el detalle no cabe, la lista sí lo tiene. */
function _textoRecordatorioVarios(items) {
  return {
    titulo: items.length + ' recordatorios pendientes',
    cuerpo: 'toca para revisarlos en Notificaciones',
    // Único por corrida, mismo motivo que `textoResumen` en app-script.gs.
    tag: 'recordatorios-' + Date.now(),
  };
}

/**
 * Manda **un solo** aviso por corrida a todos los dispositivos registrados —
 * mismo mecanismo data-only que `enviarPush` en `app-script.gs`, adaptado a
 * los tres tipos de recordatorio en vez de compras.
 */
function enviarPushRecordatorios(items, mesActual) {
  if (!items || !items.length) return 0;

  const tokens = listarTokens();
  if (!tokens.length) return 0;

  let msg;
  if (items.length === 1) {
    const t = _textoRecordatorioUno(items[0], mesActual);
    msg = { titulo: t.titulo, cuerpo: t.cuerpo, tag: String(items[0].notifId) };
  } else {
    msg = _textoRecordatorioVarios(items);
  }

  let enviados = 0;

  tokens.forEach(function (t) {
    const res = UrlFetchApp.fetch(FCM_SEND, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        message: {
          token: t.token,
          data: { titulo: msg.titulo, cuerpo: msg.cuerpo, notifId: msg.tag },
          webpush: { headers: { Urgency: 'high', TTL: '86400' } },
        },
      }),
    });

    const codigo = res.getResponseCode();
    if (codigo >= 200 && codigo < 300) { enviados++; return; }

    const texto = res.getContentText();
    if (codigo === 404 || texto.indexOf('UNREGISTERED') !== -1 || texto.indexOf('INVALID_ARGUMENT') !== -1) {
      fsFetch(FS_API + t._nombre, 'delete');
      console.log('PUSH — token muerto borrado: ' + t.token.slice(0, 16) + '…');
    } else {
      console.log('PUSH — FCM ' + codigo + ': ' + texto.slice(0, 200));
    }
  });

  return enviados;
}

// ---------- Firestore: utilidades propias de este archivo ----------

/** Todos los documentos de una colección, decodificados, con `_id` (último segmento de la ruta). */
function listarColeccion(url) {
  const out = [];
  let token = '';

  do {
    const res = fsFetch(url + '?pageSize=300' + (token ? '&pageToken=' + token : ''), 'get');
    ((res && res.documents) || []).forEach(function (doc) {
      const d = fsMapa(doc.fields || {});
      d._id = idDeRuta(doc.name);
      out.push(d);
    });
    token = (res && res.nextPageToken) || '';
  } while (token);

  return out;
}

/** Mismo tipado que `fsMap`, pero para un objeto de campos planos (no anidado bajo `datos`). */
function _fsCampos(obj) {
  const fields = {};
  Object.keys(obj).forEach(function (k) { fields[k] = fsVal(obj[k]); });
  return fields;
}

/** `PATCH` parcial: solo toca los campos de `mask`, a diferencia de un `PATCH` sin `updateMask`. */
function _fsPatch(url, fields, mask) {
  const qs = mask.map(function (f) { return 'updateMask.fieldPaths=' + encodeURIComponent(f); }).join('&');
  return fsFetch(url + '?' + qs, 'patch', { fields: fields });
}

/** Como `fsFetch('get')`, pero devuelve `null` en vez de lanzar cuando el documento no existe. */
function _fsGetOrNull(url) {
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  const codigo = res.getResponseCode();
  if (codigo === 404) return null;
  if (codigo < 200 || codigo >= 300) {
    throw new Error('Firestore ' + codigo + ': ' + res.getContentText().slice(0, 300));
  }
  const texto = res.getContentText();
  return texto ? JSON.parse(texto) : null;
}

/** Días completos entre dos fechas (ISO `YYYY-MM-DD` o timestamp completo) — >= 0, o Infinity si falta. */
function _diasDesde(fecha, hoy) {
  if (!fecha) return Infinity;
  const f = new Date(String(fecha).length === 10 ? fecha + 'T00:00:00' : fecha);
  const h = new Date(hoy + 'T00:00:00');
  return Math.floor((h - f) / 86400000);
}

/** `YYYY-MM` del mes siguiente — mismo cálculo que `nextMonth` en `js/utils/formatters.js`. */
function _nextMonthStr(yyyymm) {
  const partes = yyyymm.split('-');
  const d = new Date(Number(partes[0]), Number(partes[1]), 1);
  const mm = d.getMonth() + 1;
  return d.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm;
}

// ---------- Funciones de prueba ----------

/**
 * Corre las tres rutinas en modo lectura/log, sin escribir nada en Firestore
 * ni mandar push — mismo patrón que `pruebaFirestore`/`diagnostico` en
 * `app-script.gs`. Correrlo desde el editor antes de activar el trigger.
 */
function pruebaRecordatorios() {
  const hoy       = fmt(new Date(), 'yyyy-MM-dd');
  const mesActual = hoy.slice(0, 7);
  console.log('Mes actual: ' + mesActual + ' | Hoy: ' + hoy);

  const cortes = revisarCortes(mesActual, hoy, true);
  console.log('Cortes (' + cortes.length + '):');
  cortes.forEach(function (it) { console.log('  ' + JSON.stringify(it)); });

  const gastos = revisarGastosFijos(mesActual, hoy, true);
  console.log('Gastos fijos (' + gastos.length + '):');
  gastos.forEach(function (it) { console.log('  ' + JSON.stringify(it)); });

  const cierre = revisarCierreMes(mesActual, hoy, true);
  console.log('Cierre de mes (' + cierre.length + '):');
  cierre.forEach(function (it) { console.log('  ' + JSON.stringify(it)); });

  const todos = cortes.concat(gastos, cierre);
  if (!todos.length) { console.log('Push que se mandaría → ninguno'); return; }

  const msg = todos.length === 1 ? _textoRecordatorioUno(todos[0], mesActual) : _textoRecordatorioVarios(todos);
  console.log('Push que se mandaría → título: ' + msg.titulo + ' | cuerpo: ' + msg.cuerpo);
}
