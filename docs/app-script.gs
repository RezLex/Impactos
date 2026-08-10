/**
 * Detecta compras en el correo y las deja como notificaciones pendientes en
 * Firestore, para que la app (sección "Notificaciones") las liste y registre.
 *
 * Fuentes: Santander MX, PayPal MX (recibo), PayPal MX (autorización),
 *          Mercado Pago, Mi Saldo
 * Campos:  desc, total, fecha, hora, tarjeta, asunto, msgId [, meses, mensualidad]
 *
 * Triggers:
 *   procesarCompras()   — cada 15 minutos. Escribe una notificación por compra
 *                         y manda UN push por corrida: el detalle si fue una,
 *                         un resumen si fueron varias. De 0:00 a 6:00 (CDMX)
 *                         sale de inmediato sin hacer nada.
 *   resumenPendientes() — una vez al día. Manda UN correo con las pendientes y
 *                         borra las ya procesadas/descartadas que caducaron.
 *
 * Requiere (Configuración del proyecto de Apps Script):
 *   - Scopes `datastore` (Firestore) y `firebase.messaging` (envío de push),
 *     y que la cuenta que autoriza el script tenga acceso a impactos-b4307.
 *     Declararlos a mano en appsscript.json: Apps Script no puede deducirlos
 *     de un UrlFetchApp contra una URL cualquiera. Declarar `oauthScopes`
 *     APAGA la detección automática, así que la lista debe ser completa:
 *       https://mail.google.com/
 *       https://www.googleapis.com/auth/script.send_mail
 *       https://www.googleapis.com/auth/script.external_request
 *       https://www.googleapis.com/auth/userinfo.email
 *       https://www.googleapis.com/auth/datastore
 *       https://www.googleapis.com/auth/firebase.messaging
 *   - Propiedad de script `UID` con el UID del usuario dueño de los datos
 *     (el mismo que está en el documento `_config/owner` de Firestore).
 *
 * Nota: `impactos-b4307` es a la vez el proyecto de Firebase y el de Google
 * Cloud — Firebase corre sobre GCP y comparten id, IAM y APIs. Su número de
 * proyecto es 1087836294078, el mismo valor que el `messagingSenderId` de
 * js/firebase.js; es lo que pide "Cambiar proyecto" si se vincula el script a
 * un proyecto de GCP estándar en vez de dejarlo en el que crea Apps Script.
 */

// ---------- Configuración ----------

const PROJECT_ID  = 'impactos-b4307';
const UID         = PropertiesService.getScriptProperties().getProperty('UID');
const FS_API      = 'https://firestore.googleapis.com/v1/';
const FS_DOCS     = FS_API + 'projects/' + PROJECT_ID + '/databases/(default)/documents';
const FS_NOTIS    = FS_DOCS + '/users/' + UID + '/notificaciones';
const FS_DISPOS   = FS_DOCS + '/users/' + UID + '/dispositivos';
const FCM_SEND    = 'https://fcm.googleapis.com/v1/projects/' + PROJECT_ID + '/messages:send';

const APP_NOTIS   = 'https://rezlex.github.io/Impactos/#/notificaciones';
const DESTINO     = Session.getActiveUser().getEmail();
const VENTANA     = '3d';
const MAX_MEMORIA = 300;
const TARJETA_NA  = 'NA';   // cuando el correo no revela la tarjeta

// Días que sobreviven en Firestore las notificaciones ya procesadas o
// descartadas. Las pendientes nunca se borran solas.
const RETENCION_DIAS = 30;

/**
 * Horario silencioso: dentro de este rango `procesarCompras` sale de inmediato,
 * sin leer correo ni escribir nada. Solo esa función — el correo diario de
 * `resumenPendientes` no se ve afectado.
 *
 * Cortar al inicio es seguro justamente porque no toca nada: los correos de la
 * madrugada **no se marcan como vistos**, así que la primera corrida después de
 * SILENCIO_HASTA los detecta todos. Y como el push es uno por corrida, llegan
 * en un único aviso de resumen en vez de una ráfaga. No se pierde nada, se
 * difiere.
 *
 * La zona va explícita y no se usa `Session.getScriptTimeZone()`: la del
 * proyecto se puede cambiar sin querer desde la configuración, y entonces el
 * silencio se correría de hora sin que nadie lo note.
 */
const ZONA_HORARIA   = 'America/Mexico_City';
const SILENCIO_DESDE = 0;   // inclusive
const SILENCIO_HASTA = 6;   // exclusive: a las 6:00 en punto ya procesa

/**
 * Diccionario de descripciones.
 * La clave se busca como subcadena dentro del comercio en MAYÚSCULAS.
 * El orden importa: gana la primera coincidencia, así que las claves
 * específicas van arriba de las genéricas.
 */
const DICCIONARIO = [
  // Oxxo — la sucursal viene en el nombre
  ['OXXO SANTA MONICA',      'Oxxo Casa'],
  ['OXXO SAN LUCAS',         'Oxxo Trabajo'],
  ['OXXO',                   'Oxxo'],

  // Agregadores: importa el sufijo, no el procesador
  ['MERCADOPAGO *MERCADOL',  'Mercado Libre'],
  ['MERPAGO*MERCADOLIBRE',   'Mercado Libre'],
  ['MERCADOPAGO *VETPOINT',  'Veterinario'],
  ['MERCADOPAGO *ACCESORI',  'Accesorios'],
  ['MERCADOPAGO *PICANASB',  'Picanas'],
  ['MERCADOPAGO *GRUPOSER',  'Grupo Ser'],
  ['CLIP MX*REST TORTAS YE', 'Tortas'],
  ['CLIP MX*REST JAULAS DE', 'Jaulas'],
  ['CLIP MX*REST ZANCA MAR', 'Zanca'],

  // Tiendas y servicios
  ['MI SALDO',               'Mi Saldo'],
  ['AMAZON',                 'Amazon'],
  ['CHEDRAUI',               'Súper'],
  ['LIVERPOOL',              'Liverpool'],
  ['OLIVE GARDN',            'Olive Garden'],
  ['BARBER ROUTE',           'Barbería'],
  ['BARBACOS JUAN GIL',      'Barbacoa'],
  ['TEJUINO',                'Tejuino'],
  ['ILUSION BOWL',           'Boliche'],
  ['UNIVERSAL MUSIC',        'Universal Music'],
  ['API GLOBAL',             'API Global'],

  // PayPal
  ['STEAMPOWERED',           'Steam'],
  ['UBR PAGOS',              'Uber'],
  ['GOOGLE',                 'Google'],
  ['GAMIVO',                 'Gamivo']
];

const FUENTES = [
  {
    nombre: 'santander',
    query: 'from:santander@envio.santander.com.mx subject:"Pago/Compra con Tarjeta Santander"',
    parse: parseSantander
  },
  {
    nombre: 'paypal',
    query: 'from:service@paypal.com.mx subject:"Recibo de su pago"',
    parse: parsePaypal
  },
  {
    // Autorización de pago: llega antes (y a veces en vez) del recibo final.
    // No se deduplica contra 'paypal': si un mismo pago genera las dos
    // notificaciones, la que sobre se descarta desde la app.
    nombre: 'paypal-auth',
    query: 'from:service@paypal.com.mx subject:"Autorizó un pago"',
    parse: parsePaypalAutorizacion
  },
  {
    nombre: 'mercadopago',
    query: 'from:info@mercadopago.com subject:"Pago aprobado en"',
    parse: parseMercadoPago
  },
  {
    nombre: 'misaldo',
    query: 'from:receipt@api-sfinx.com subject:"Has comprado saldo"',
    parse: parseMiSaldo
  }
];

// ---------- Trigger A: cada 15 minutos ----------

/** ¿Estamos dentro del horario silencioso? Soporta rangos que cruzan medianoche. */
function enSilencio(ahora) {
  const h = Number(Utilities.formatDate(ahora || new Date(), ZONA_HORARIA, 'H'));
  return SILENCIO_DESDE <= SILENCIO_HASTA
    ? (h >= SILENCIO_DESDE && h < SILENCIO_HASTA)          // 0 → 6
    : (h >= SILENCIO_DESDE || h < SILENCIO_HASTA);         // 22 → 6, por si se cambia
}

function procesarCompras() {
  if (enSilencio()) {
    console.log('Horario silencioso (' + SILENCIO_DESDE + ':00–' + SILENCIO_HASTA + ':00 ' +
                ZONA_HORARIA + ') — sin procesar. Lo que llegue ahora se detecta en la ' +
                'primera corrida después de las ' + SILENCIO_HASTA + ':00.');
    return;
  }

  const vistos  = cargarVistos();
  const fallos  = [];
  // Las creadas en ESTA corrida, para mandar un solo push al final en vez de
  // uno por compra. Un reproceso puede detectar diez correos de golpe y eso
  // eran diez vibraciones seguidas.
  const creadas = [];

  FUENTES.forEach(function (fuente) {
    GmailApp.search(fuente.query + ' newer_than:' + VENTANA).forEach(function (hilo) {
      hilo.getMessages().forEach(function (msg) {
        const id = msg.getId();
        if (vistos.indexOf(id) !== -1) return;

        try {
          const datos = fuente.parse(msg.getPlainBody(), msg);
          if (!datos) {
            fallos.push(fuente.nombre + ' — sin match — ' + msg.getSubject());
          } else {
            if (!datos.fecha) datos.fecha = fmt(msg.getDate(), 'yyyy-MM-dd');
            if (!datos.hora)  datos.hora  = fmt(msg.getDate(), 'HH:mm');
            datos.msgId = id;
            // El asunto se toma aquí y no en cada parser: la lista de
            // notificaciones lo muestra junto al comercio para dar contexto
            // cuando el diccionario no reconoció la tienda.
            datos.asunto = msg.getSubject();
            creadas.push(crearNotificacion(datos));
          }
          // Marcar visto solo si no hubo excepción. Un fallo de escritura en
          // Firestore antes perdía nada más un aviso; ahora perdería la compra
          // entera, así que se deja sin marcar para reintentarla en 15 min.
          // (Un "sin match" sí se marca: es permanente y ya viaja en el correo
          // de fallos.)
          vistos.push(id);
        } catch (e) {
          fallos.push(fuente.nombre + ' — ' + e.message + ' — ' + msg.getSubject());
        }
      });
    });
  });

  guardarVistos(vistos);

  // Un solo push por corrida, con las notificaciones ya escritas. Va al final y
  // en su propio try: si falla, los documentos ya están en Firestore y se ven
  // al abrir la app — no debe tumbar la detección ni provocar un reintento,
  // que duplicaría todo.
  if (creadas.length) {
    try {
      enviarPush(creadas);
    } catch (e) {
      console.log('PUSH — ' + e.message);
    }
  }

  if (fallos.length) {
    MailApp.sendEmail(DESTINO,
      'Gastos: ' + fallos.length + ' correo(s) sin parsear',
      fallos.join('\n'));
    // También al log: un fallo de escritura en Firestore se diagnostica desde
    // el editor, y salir a la bandeja a leer el motivo es una vuelta de más.
    fallos.forEach(function (f) { console.log('FALLO — ' + f); });
  }

  console.log('Nuevos: ' + creadas.length + ' | Fallos: ' + fallos.length);
}

// ---------- Trigger B: una vez al día ----------

/**
 * Recordatorio diario de lo que quedó sin registrar, más el mantenimiento de
 * la colección. Una sola lectura sirve para las dos cosas.
 */
function resumenPendientes() {
  const todas = listarNotificaciones();

  const pendientes = todas.filter(function (n) {
    return n.tipo === 'compra' && n.estatus === 'pendiente';
  });
  if (pendientes.length) enviarResumen(pendientes);

  const borradas = limpiarCaducadas(todas);

  console.log('Pendientes: ' + pendientes.length +
              ' | Borradas: ' + borradas + ' | Total: ' + todas.length);
}

// ---------- Parsers ----------

function parseSantander(cuerpo) {
  // El cuerpo trae saltos de línea a media frase, de ahí los \s+
  if (!/se ha realizado\s+una compra/.test(cuerpo)) return null;

  const comercio = cuerpo.match(/comercio\s+([\s\S]+?)\s+con tu tarjeta/);
  const monto    = cuerpo.match(/monto de\s*\$\s*([\d.,]+)/);
  const tarjeta  = cuerpo.match(/terminación\s+\*+\s*(\d{4})/);
  const fh       = cuerpo.match(/El\s+(\d{2})\/(\d{2})\/(\d{4})\s+a las\s+(\d{2}:\d{2})/);

  if (!comercio || !monto) return null;

  const d = describir(comercio[1]);

  return {
    tarjeta: tarjeta ? tarjeta[1] : TARJETA_NA,
    total:   normalizarMonto(monto[1]),
    fecha:   fh ? fh[3] + '-' + fh[2] + '-' + fh[1] : '',
    hora:    fh ? fh[4] : '',
    desc:    d.desc,
    match:   d.match
  };
}

function parsePaypal(cuerpo) {
  // "Ha pagado $20.00 MXN a UBR PAGOS MEXICO"
  // "Ha enviado un pago de $70.00 MXN a Google Payment Corporation"
  const pago = cuerpo.match(
    /Ha (?:pagado|enviado un pago de)\s*[$€£]?\s*([\d.,]+)\s*[A-Z]{3}\s+a\s+([\s\S]+?)(?:\s+y ha ahorrado|\s*\n)/
  );
  if (!pago) return null;

  const d = describir(pago[2]);

  return {
    tarjeta: tarjetaPaypal(cuerpo),
    total:   normalizarMonto(pago[1]),
    fecha:   '',   // se toma de la fecha del correo
    hora:    '',
    desc:    d.desc,
    match:   d.match
  };
}

function parsePaypalAutorizacion(cuerpo, msg) {
  // "Ha autorizado un pago de $195.70 MXN a UBR PAGOS MEXICO"
  const monto = cuerpo.match(/Ha autorizado un pago de\s*[$€£]?\s*([\d.,]+)/);
  if (!monto) return null;

  // El comercio sale limpio del asunto: "Autorizó un pago para {comercio}",
  // mismo truco que parseMercadoPago. El cuerpo lo trae también, pero pegado a
  // la moneda y a veces partido en varias líneas.
  const comercio = msg.getSubject().replace(/^\s*Autoriz[óo] un pago para\s*/i, '');

  const d = describir(comercio);

  return {
    tarjeta: tarjetaPaypal(cuerpo),
    // La fecha viene como texto ("8 ago 2026") en vez de DD/MM/YYYY: sale más
    // barato dejarla vacía y que procesarCompras use la fecha del correo.
    total:   normalizarMonto(monto[1]),
    fecha:   '',
    hora:    '',
    desc:    d.desc,
    match:   d.match
  };
}

/** Terminación de la tarjeta en un correo de PayPal: "Visa-2167". */
function tarjetaPaypal(cuerpo) {
  const m = cuerpo.match(
    /\b(?:Visa|Mastercard|American Express|Amex|D[ée]bito|Cr[ée]dito)[\s\-–]*(\d{4})\b/i
  );
  return m ? m[1] : TARJETA_NA;
}

function parseMercadoPago(cuerpo, msg) {
  // "Pagaste $ 1.372,23" — formato europeo: punto de millares, coma decimal
  const monto = cuerpo.match(/Pagaste\s*\$?\s*([\d.,]+)/);
  if (!monto) return null;

  // "Revolut Crédito **** 6734"
  const tarjeta = cuerpo.match(/\*{2,}\s*(\d{4})/);

  // "6 meses de $ 228,71 sin interés"
  const plazos = cuerpo.match(/(\d{1,2})\s*meses\s+de\s*\$?\s*([\d.,]+)/i);

  // El comercio va en el asunto: "Pago aprobado en API GLOBAL"
  const comercio = msg.getSubject().replace(/^\s*Pago aprobado en\s*/i, '');

  const d = describir(comercio);

  const datos = {
    tarjeta: tarjeta ? tarjeta[1] : TARJETA_NA,
    total:   normalizarMonto(monto[1]),
    fecha:   '',
    hora:    '',
    desc:    d.desc,
    match:   d.match
  };

  if (plazos) {
    datos.meses       = plazos[1];
    datos.mensualidad = normalizarMonto(plazos[2]);
  }

  return datos;
}

function parseMiSaldo(cuerpo) {
  // La tabla del recibo: Saldo abonado + Tarifa de servicio = Total
  // El cargo real a la tarjeta es el Total.
  const total = cuerpo.match(/Total\s*\$\s*([\d.,]+)/);
  if (!total) return null;

  // "tu tarjeta MPL-PLATINUM MASTERCARD que termina en 6734."
  const tarjeta = cuerpo.match(/termina en\s+(\d{4})/i);

  const d = describir('MI SALDO');

  return {
    tarjeta: tarjeta ? tarjeta[1] : TARJETA_NA,
    total:   normalizarMonto(total[1]),
    fecha:   '',
    hora:    '',
    desc:    d.desc,
    match:   d.match
  };
}

// ---------- Montos ----------

/**
 * Normaliza a formato con punto decimal y sin separador de millares.
 * Maneja los dos formatos que llegan:
 *   "271.00"    -> "271.00"   (Santander, PayPal)
 *   "1.372,23"  -> "1372.23"  (Mercado Pago)
 * Regla: el último separador es el decimal si le siguen 2 dígitos.
 */
function normalizarMonto(s) {
  const t = String(s).trim();
  const sep = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
  if (sep === -1) return t;

  const decimales = t.length - sep - 1;
  if (decimales === 2) {
    return t.slice(0, sep).replace(/[.,]/g, '') + '.' + t.slice(sep + 1);
  }
  return t.replace(/[.,]/g, '');   // todos eran de millares
}

// ---------- Diccionario ----------

function describir(comercio) {
  const limpio = String(comercio).replace(/\s+/g, ' ').replace(/[.,]+$/, '').trim();
  const clave  = limpio.toUpperCase();

  for (var i = 0; i < DICCIONARIO.length; i++) {
    if (clave.indexOf(DICCIONARIO[i][0]) !== -1) {
      return { desc: DICCIONARIO[i][1], match: true };
    }
  }
  // Sin match: manda el comercio crudo, lo corriges en la web
  return { desc: limpio, match: false };
}

// ---------- Firestore ----------

/**
 * Crea el documento de notificación de una compra detectada.
 *
 * Los nombres de campo dentro de `datos` son los mismos que viajaban en el
 * query string del enlace de correo (desc, total, fecha, hora, tarjeta...):
 * la app ya sabe convertir esa forma en la precarga del modal y así no hay dos
 * traducciones que mantener.
 *
 * Se guarda la TERMINACIÓN de la tarjeta, no el id de Firestore: el mapeo a
 * tarjeta lo hace la app con los datos que ya tiene cargados, y así el
 * documento no queda apuntando a un id que después se edite o se borre.
 */
function crearNotificacion(datos) {
  if (!UID) throw new Error('Falta la propiedad de script UID');

  const CAMPOS = ['desc', 'total', 'fecha', 'hora', 'tarjeta',
                  'meses', 'mensualidad', 'msgId', 'asunto'];
  const NUMEROS = { total: true, meses: true, mensualidad: true };

  const d = {};
  CAMPOS.forEach(function (k) {
    if (datos[k] === '' || datos[k] == null) return;
    d[k] = NUMEROS[k] ? Number(datos[k]) : datos[k];
  });
  d.match = !!datos.match;

  const doc = fsFetch(FS_NOTIS, 'post', {
    fields: {
      tipo:    fsVal('compra'),
      estatus: fsVal('pendiente'),
      datos:   fsMap(d),
      creado:  { timestampValue: new Date().toISOString() }
    }
  });

  // No manda el push: eso lo hace `procesarCompras` una sola vez al final de la
  // corrida, con todas las creadas juntas.
  return { nombre: doc.name, notifId: idDeRuta(doc.name), datos: d };
}

/** Todas las notificaciones, ya decodificadas, con `_nombre` para poder borrarlas. */
function listarNotificaciones() {
  const out = [];
  var token = '';

  do {
    const res = fsFetch(FS_NOTIS + '?pageSize=300' + (token ? '&pageToken=' + token : ''), 'get');
    ((res && res.documents) || []).forEach(function (doc) {
      const n = fsMapa(doc.fields || {});
      n._nombre = doc.name;
      out.push(n);
    });
    token = (res && res.nextPageToken) || '';
  } while (token);

  return out;
}

/** Borra las procesadas/descartadas que ya pasaron RETENCION_DIAS. */
function limpiarCaducadas(todas) {
  const limite = Date.now() - RETENCION_DIAS * 24 * 60 * 60 * 1000;
  var n = 0;

  todas.forEach(function (d) {
    if (d.estatus === 'pendiente') return;
    const creado = d.creado ? new Date(d.creado).getTime() : 0;
    if (!creado || creado > limite) return;
    fsFetch(FS_API + d._nombre, 'delete');
    n++;
  });

  return n;
}

/** Llamada autenticada a la API REST de Firestore. Lanza si la respuesta no es 2xx. */
function fsFetch(url, metodo, body) {
  const opciones = {
    method: metodo,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (body) opciones.payload = JSON.stringify(body);

  const res    = UrlFetchApp.fetch(url, opciones);
  const codigo = res.getResponseCode();
  const texto  = res.getContentText();

  if (codigo < 200 || codigo >= 300) {
    throw new Error('Firestore ' + codigo + ': ' + texto.slice(0, 300));
  }
  return texto ? JSON.parse(texto) : null;
}

// Firestore REST no acepta JSON plano: cada campo va etiquetado con su tipo.

function fsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'number')         return { doubleValue: v };
  if (typeof v === 'boolean')        return { booleanValue: v };
  return { stringValue: String(v) };
}

function fsMap(obj) {
  const fields = {};
  Object.keys(obj).forEach(function (k) { fields[k] = fsVal(obj[k]); });
  return { mapValue: { fields: fields } };
}

function fsLeer(valor) {
  if (!valor)                        return null;
  if ('stringValue'    in valor)     return valor.stringValue;
  if ('doubleValue'    in valor)     return Number(valor.doubleValue);
  if ('integerValue'   in valor)     return Number(valor.integerValue);
  if ('booleanValue'   in valor)     return valor.booleanValue;
  if ('timestampValue' in valor)     return valor.timestampValue;
  if ('mapValue'       in valor)     return fsMapa(valor.mapValue.fields || {});
  return null;   // nullValue y tipos que no usamos
}

function fsMapa(fields) {
  const o = {};
  Object.keys(fields).forEach(function (k) { o[k] = fsLeer(fields[k]); });
  return o;
}

// ---------- Web Push (FCM) ----------

/** "$1,372.23" — el importe llega como number, y `'$' + 195.7` daría "$195.7". */
function pesos(v) {
  const partes = (Number(v) || 0).toFixed(2).split('.');
  return '$' + partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + partes[1];
}

/** Texto de una compra sola: el detalle completo, que es lo útil cuando es una. */
function textoCompra(c) {
  const d = c.datos;
  const aPlazos = d.meses != null && d.meses !== '';
  return {
    titulo: pesos(d.total) + ' — ' + d.desc + (aPlazos ? ' (' + d.meses + ' MSI)' : ''),
    // Con match, la terminación basta de contexto. Sin match, el comercio del
    // título no dice nada y el asunto crudo es lo único que orienta.
    cuerpo: !d.match && d.asunto
      ? d.asunto
      : (d.tarjeta && d.tarjeta !== TARJETA_NA ? '···' + d.tarjeta + ' — ' : '') +
        'toca para registrarla',
    tag: String(c.notifId)
  };
}

/**
 * Texto de varias: cuántas, de dónde y por cuánto. El detalle de cada una no
 * cabe y tampoco hace falta — el aviso lleva a la lista, que sí lo tiene.
 */
function textoResumen(compras) {
  const total = compras.reduce(function (s, c) { return s + (Number(c.datos.total) || 0); }, 0);
  const nombres = compras.map(function (c) { return c.datos.desc; });
  const resto = nombres.length - 2;

  return {
    titulo: compras.length + ' compras detectadas',
    cuerpo: nombres.slice(0, 2).join(', ') + (resto > 0 ? ' y ' + resto + ' más' : '') +
            ' · ' + pesos(total) + ' en total',
    // Único por corrida: dos resúmenes seguidos son avisos distintos y el
    // segundo no debe tapar al primero.
    tag: 'resumen-' + Date.now()
  };
}

/**
 * Manda **un solo** aviso por corrida a todos los dispositivos registrados: el
 * detalle si fue una compra, el resumen si fueron varias.
 *
 * **Data-only, sin bloque `notification`**: así el `push` de `sw.js` decide qué
 * mostrar. Con bloque `notification`, Chrome pinta además la suya y saldrían
 * dos avisos. FCM exige que todos los valores de `data` sean string.
 *
 * @param {Array<{notifId: string, datos: object}>} compras
 */
function enviarPush(compras) {
  if (!compras || !compras.length) return 0;

  const tokens = listarTokens();
  if (!tokens.length) return 0;

  const msg = compras.length === 1 ? textoCompra(compras[0]) : textoResumen(compras);

  var enviados = 0;

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
          webpush: { headers: { Urgency: 'high', TTL: '86400' } }
        }
      })
    });

    const codigo = res.getResponseCode();
    if (codigo >= 200 && codigo < 300) { enviados++; return; }

    const texto = res.getContentText();
    // Token de un navegador que borró sus datos, desinstaló la PWA o revocó el
    // permiso. No se va a recuperar: se borra para no reintentarlo cada 15 min.
    if (codigo === 404 || texto.indexOf('UNREGISTERED') !== -1 || texto.indexOf('INVALID_ARGUMENT') !== -1) {
      fsFetch(FS_API + t._nombre, 'delete');
      console.log('PUSH — token muerto borrado: ' + t.token.slice(0, 16) + '…');
    } else {
      console.log('PUSH — FCM ' + codigo + ': ' + texto.slice(0, 200));
    }
  });

  return enviados;
}

/**
 * Los tokens registrados por la PWA. El id del documento ES el token.
 * Mientras nadie haya activado el permiso, la colección no existe y Firestore
 * responde 200 con el cuerpo vacío — de ahí la doble guarda.
 */
function listarTokens() {
  const res = fsFetch(FS_DISPOS + '?pageSize=100', 'get');
  return ((res && res.documents) || []).map(function (doc) {
    return { token: idDeRuta(doc.name), _nombre: doc.name };
  });
}

/** Último segmento de un nombre de recurso de Firestore. */
function idDeRuta(nombre) {
  const partes = String(nombre).split('/');
  return partes[partes.length - 1];
}

// ---------- Correo del resumen diario ----------

function enviarResumen(pendientes) {
  const FUENTE = "'Segoe UI',system-ui,-apple-system,sans-serif";

  // Más recientes arriba
  const orden = pendientes.slice().sort(function (a, b) {
    return String(b.creado || '').localeCompare(String(a.creado || ''));
  });

  const filas = orden.map(function (n) {
    const d       = n.datos || {};
    const aPlazos = !!d.meses;

    const meta = [
      d.fecha || '',
      d.hora  || '',
      d.tarjeta && d.tarjeta !== TARJETA_NA ? '••••' + d.tarjeta : ''
    ].filter(String).join(' · ');

    return '<tr><td style="padding:14px 0;border-bottom:1px solid #ecebe8;">' +

      '<div style="font-size:22px;font-weight:700;color:#16193d;' +
      'font-variant-numeric:tabular-nums;">$' + escapar(d.total) +
      (aPlazos ? '<span style="font-size:13px;font-weight:600;color:#1565c0;' +
                 'margin-left:8px;">' + escapar(d.meses) + ' MSI</span>' : '') +
      '</div>' +

      '<div style="font-size:15px;font-weight:600;color:#16193d;padding-top:3px;">' +
      escapar(d.desc) + (d.match ? '' :
        '<span style="font-size:11px;font-weight:600;color:#757575;' +
        'background:#e0e0e0;border-radius:20px;padding:2px 8px;margin-left:8px;">' +
        'sin match</span>') +
      '</div>' +

      (d.asunto ? '<div style="font-size:12px;color:#9aa4b2;padding-top:3px;">' +
                  escapar(d.asunto) + '</div>' : '') +

      '<div style="font-size:12.5px;color:#757575;padding-top:4px;">' +
      escapar(meta) + '</div>' +

      '</td></tr>';
  }).join('');

  const html =
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;">' +

      '<tr><td style="background:#1a237e;' +
      'background:linear-gradient(135deg,#1a237e 0%,#1565c0 100%);padding:16px 24px;">' +
      '<span style="font-size:17px;line-height:1;vertical-align:middle;">&#127974;</span>' +
      '<span style="font-family:' + FUENTE + ';font-size:14px;font-weight:700;' +
      'letter-spacing:.08em;color:#ffffff;vertical-align:middle;margin-left:8px;">IMPACTOS</span>' +
      '</td></tr>' +

      '<tr><td style="padding:30px 28px 32px;font-family:' + FUENTE + ';">' +

        '<div style="font-size:12.5px;font-weight:600;letter-spacing:.09em;' +
        'text-transform:uppercase;color:#757575;padding-bottom:4px;">Sin registrar</div>' +

        '<div style="font-size:19px;font-weight:600;color:#16193d;">' +
        pendientes.length + (pendientes.length === 1 ? ' compra pendiente' : ' compras pendientes') +
        '</div>' +

        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
        'style="margin-top:10px;">' + filas + '</table>' +

        '<div style="padding-top:26px;">' +
        '<a href="' + APP_NOTIS + '" style="display:inline-block;background:#1565c0;color:#ffffff;' +
        'font-size:15.5px;font-weight:600;padding:13px 28px;border-radius:8px;' +
        'text-decoration:none;letter-spacing:.01em;">Ver notificaciones &rarr;</a></div>' +

        '<div style="padding-top:22px;border-top:1px solid #ecebe8;margin-top:24px;' +
        'font-size:11.5px;color:#9aa4b2;">Detectadas desde tu correo · ' +
        'se registran o se descartan desde la app</div>' +

      '</td></tr>' +
    '</table>';

  MailApp.sendEmail({
    to: DESTINO,
    subject: 'Impactos: ' + pendientes.length + ' compra(s) sin registrar',
    htmlBody: html
  });
}

// ---------- Utilidades ----------

function fmt(fecha, patron) {
  return Utilities.formatDate(fecha, Session.getScriptTimeZone(), patron);
}

function escapar(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cargarVistos() {
  const raw = PropertiesService.getScriptProperties().getProperty('vistos');
  return raw ? JSON.parse(raw) : [];
}

function guardarVistos(vistos) {
  PropertiesService.getScriptProperties()
    .setProperty('vistos', JSON.stringify(vistos.slice(-MAX_MEMORIA)));
}

// ---------- Diagnóstico ----------

/** Cuántos hilos hay por fuente, en la ventana real y en 60 días. */
function diagnostico() {
  FUENTES.forEach(function (f) {
    const corta = GmailApp.search(f.query + ' newer_than:' + VENTANA).length;
    const larga = GmailApp.search(f.query + ' newer_than:60d').length;
    console.log(f.nombre + ' → ' + VENTANA + ': ' + corta + ' | 60d: ' + larga);
  });
}

/** Qué parsea cada fuente en 60 días. No escribe nada. */
function prueba() {
  FUENTES.forEach(function (fuente) {
    GmailApp.search(fuente.query + ' newer_than:60d').slice(0, 8).forEach(function (hilo) {
      hilo.getMessages().forEach(function (msg) {
        console.log(fuente.nombre, JSON.stringify(fuente.parse(msg.getPlainBody(), msg)));
      });
    });
  });
}

/** Texto plano crudo del correo más reciente de una fuente, para ajustar regex. */
function verTexto(indiceFuente) {
  const f = FUENTES[indiceFuente || 0];
  const hilos = GmailApp.search(f.query + ' newer_than:60d');
  if (!hilos.length) return console.log('sin correos para ' + f.nombre);
  console.log(JSON.stringify(hilos[0].getMessages()[0].getPlainBody()));
}

/**
 * Escribe una notificación de mentira y la borra: valida de una sola vez los
 * scopes, el UID y el formato de valores tipados, sin ensuciar la colección.
 * Correrlo antes de activar el trigger.
 */
function pruebaFirestore() {
  const creada = crearNotificacion({
    desc: 'PRUEBA — borrar', total: '1.23', fecha: '2026-01-01', hora: '00:00',
    tarjeta: TARJETA_NA, msgId: 'prueba', asunto: 'Prueba de conexión', match: false
  });
  console.log('creado: ' + creada.nombre);

  const leido = listarNotificaciones().filter(function (n) { return n._nombre === creada.nombre; })[0];
  console.log('leído: ' + JSON.stringify(leido));

  fsFetch(FS_API + creada.nombre, 'delete');
  console.log('borrado ok');
}

// Compras de mentira para las pruebas de push. No tocan Firestore.
const PRUEBA_COMPRAS = [
  { notifId: 'prueba-1', datos: { total: 195.7,   desc: 'Uber',   tarjeta: '2167', match: true } },
  { notifId: 'prueba-2', datos: { total: 1372.23, desc: 'Amazon', tarjeta: '4321', match: true,
                                  meses: 6, mensualidad: 228.71 } },
  { notifId: 'prueba-3', datos: { total: 87,      desc: 'Oxxo',   tarjeta: '2167', match: true } }
];

/** Push de UNA compra: el formato con detalle. No toca la colección. */
function pruebaPushUna() {
  _probarPush(PRUEBA_COMPRAS.slice(0, 1));
}

/** Push de VARIAS: el formato de resumen. No toca la colección. */
function pruebaPushVarias() {
  _probarPush(PRUEBA_COMPRAS);
}

function _probarPush(compras) {
  const tokens = listarTokens();
  console.log('dispositivos registrados: ' + tokens.length);
  if (!tokens.length) return console.log('Ninguno — activa las notificaciones en la app primero');

  // Se imprime el texto además de mandarlo: así se revisa el formato aunque el
  // aviso no llegue a verse (Windows silenciado, teléfono en No molestar…)
  const msg = compras.length === 1 ? textoCompra(compras[0]) : textoResumen(compras);
  console.log('título: ' + msg.titulo);
  console.log('cuerpo: ' + msg.cuerpo);

  console.log('enviados: ' + enviarPush(compras) + '/' + tokens.length);
}

/** Borra la memoria de procesados. Úsalo solo para reprobar desde cero. */
function reiniciarVistos() {
  PropertiesService.getScriptProperties().deleteProperty('vistos');
  console.log('vistos borrado');
}
