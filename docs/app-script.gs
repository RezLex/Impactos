/**
 * Detecta correos de compra y envía un correo con un link
 * hacia Impactos con los datos precargados.
 *
 * Fuentes: Santander MX, PayPal MX, Mercado Pago, Mi Saldo
 * Campos: tarjeta, total, fecha, hora, desc [, meses, mensualidad]
 * Trigger: cada 15 minutos sobre procesarCompras.
 */

// ---------- Configuración ----------

const BASE_URL    = 'https://rezlex.github.io/Impactos/#/compras';
const DESTINO     = Session.getActiveUser().getEmail();
const VENTANA     = '3d';
const MAX_MEMORIA = 300;
const TARJETA_NA  = 'NA';   // cuando el correo no revela la tarjeta

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

// ---------- Entrada principal ----------

function procesarCompras() {
  const vistos = cargarVistos();
  const fallos = [];
  let nuevos = 0;

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
            enviarLink(datos);
            nuevos++;
          }
        } catch (e) {
          fallos.push(fuente.nombre + ' — ' + e.message + ' — ' + msg.getSubject());
        }

        vistos.push(id);
      });
    });
  });

  guardarVistos(vistos);

  if (fallos.length) {
    MailApp.sendEmail(DESTINO,
      'Gastos: ' + fallos.length + ' correo(s) sin parsear',
      fallos.join('\n'));
  }

  console.log('Nuevos: ' + nuevos + ' | Fallos: ' + fallos.length);
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

  // "Pagó a X con  Visa-2167  $20.00 MXN"
  const tarjeta = cuerpo.match(
    /\b(?:Visa|Mastercard|American Express|Amex|D[ée]bito|Cr[ée]dito)[\s\-–]*(\d{4})\b/i
  );

  const d = describir(pago[2]);

  return {
    tarjeta: tarjeta ? tarjeta[1] : TARJETA_NA,
    total:   normalizarMonto(pago[1]),
    fecha:   '',   // se toma de la fecha del correo
    hora:    '',
    desc:    d.desc,
    match:   d.match
  };
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

// ---------- Envío ----------

function enviarLink(datos) {
  const campos = ['desc', 'total', 'fecha', 'hora', 'tarjeta', 'meses', 'mensualidad', 'msgId'];

  const qs = campos
    .filter(function (k) { return datos[k] !== '' && datos[k] != null; })
    .map(function (k) { return k + '=' + encodeURIComponent(datos[k]); })
    .join('&');

  const url    = BASE_URL + '?' + qs;
  const href   = url.replace(/&/g, '&amp;');   // & válido dentro de un href
  const aPlazos = !!datos.meses;

  const titulo = '$' + datos.total + ' \u2014 ' + datos.desc +
                 (aPlazos ? ' (' + datos.meses + ' MSI)' : '');

  const FUENTE = "'Segoe UI',system-ui,-apple-system,sans-serif";

  const plazos = !aPlazos ? '' :
    '<div style="margin-top:18px;background:#e8f0fe;border-left:3px solid #1565c0;' +
    'padding:12px 16px;border-radius:0 6px 6px 0;">' +
    '<div style="font-size:12px;font-weight:600;letter-spacing:.07em;' +
    'text-transform:uppercase;color:#1565c0;">A plazos</div>' +
    '<div style="font-size:16px;font-weight:600;color:#16193d;padding-top:3px;">' +
    escapar(datos.meses) + ' meses de $' + escapar(datos.mensualidad) + '</div>' +
    '</div>';

  const badge = datos.match ? '' :
    '<div style="padding-top:14px;">' +
    '<span style="display:inline-block;background:#e0e0e0;color:#424242;font-size:11.5px;' +
    'font-weight:600;letter-spacing:.03em;padding:4px 10px;border-radius:20px;">' +
    'Sin match en diccionario \u00b7 revisa la descripci\u00f3n</span></div>';

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
        'text-transform:uppercase;color:#757575;padding-bottom:12px;">Compra detectada</div>' +

        '<div style="font-size:42px;line-height:1;font-weight:700;color:#16193d;' +
        'letter-spacing:-.02em;font-variant-numeric:tabular-nums;">$' +
        escapar(datos.total) + '</div>' +

        '<div style="font-size:19px;font-weight:600;color:#16193d;padding-top:12px;">' +
        escapar(datos.desc) + '</div>' +

        '<div style="font-size:13.5px;color:#757575;padding-top:6px;">' +
        escapar(datos.fecha) + ' &nbsp;&#183;&nbsp; ' + escapar(datos.hora) +
        ' &nbsp;&#183;&nbsp; <span style="font-family:\'Courier New\',monospace;' +
        'letter-spacing:1px;color:#555555;">&#8226;&#8226;&#8226;&#8226;' +
        escapar(datos.tarjeta) + '</span></div>' +

        plazos + badge +

        '<div style="padding-top:26px;">' +
        '<a href="' + href + '" style="display:inline-block;background:#1565c0;color:#ffffff;' +
        'font-size:15.5px;font-weight:600;padding:13px 28px;border-radius:8px;' +
        'text-decoration:none;letter-spacing:.01em;">Registrar &rarr;</a></div>' +

        '<div style="padding-top:22px;border-top:1px solid #ecebe8;margin-top:24px;' +
        'font-size:11.5px;color:#9aa4b2;">Detectado desde tu correo \u00b7 ' +
        'el enlace precarga el formulario, no crea nada solo</div>' +

      '</td></tr>' +
    '</table>';

  MailApp.sendEmail({
    to: DESTINO,
    subject: 'Registrar gasto: ' + titulo,
    htmlBody: html
  });
}

// ---------- Utilidades ----------

function fmt(fecha, patron) {
  return Utilities.formatDate(fecha, Session.getScriptTimeZone(), patron);
}

function escapar(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

/** Qué parsea cada fuente en 60 días. No manda correos. */
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

/** Borra la memoria de procesados. Úsalo solo para reprobar desde cero. */
function reiniciarVistos() {
  PropertiesService.getScriptProperties().deleteProperty('vistos');
  console.log('vistos borrado');
}
