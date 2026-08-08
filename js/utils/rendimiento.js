/**
 * Motor de cálculo de rendimientos compuestos con tramos progresivos.
 *
 * Modelo de tasa
 * ──────────────
 * Cada cuenta define tramos ordenados por saldo y elige cómo se aplican.
 *
 * `progresivo` (default) — cada porción del saldo gana la tasa de su propio
 * tramo, como el ISR. Con tramos 0–25k @15%, 25k–100k @7%, 100k+ @5% y un saldo
 * de $150,000:
 *
 *   $25,000 × 15%  +  $75,000 × 7%  +  $50,000 × 5%  =  $11,500 anual
 *
 * `unico` — todo el saldo gana la tasa del único tramo en el que cae; los
 * mismos $150,000 rinden $150,000 × 5% = $7,500. Produce escalones (con
 * $100,000 se ganaría más que con $100,001), pero hay productos que operan así.
 *
 * Interpretación de la tasa — `modoTasa`, configurable por cuenta porque las
 * instituciones no publican lo mismo bajo el mismo número:
 *
 *   `nominal` (default)  tasaDiaria = tasa / base
 *                        Al capitalizar diario el GAT queda POR ENCIMA del
 *                        número publicado. Revolut: 15% → GAT 16.18%.
 *
 *   `efectiva`           tasaDiaria = (1 + tasa)^(1/base) − 1
 *                        La tasa publicada YA es el rendimiento anual; el GAT
 *                        coincide con ella. Mercado Pago: 12% → GAT 12%.
 *
 * Confundirlas desvía el cálculo ~8% del rendimiento diario, así que el modo se
 * verifica contra un abono real de la institución, no se supone.
 *
 * Como la tasa depende del saldo y el saldo crece cada día, la composición se
 * resuelve iterando día a día — no hay fórmula cerrada.
 *
 * Retención de ISR
 * ────────────────
 * `capital` (default) — así opera México: la retención se aplica sobre el
 * capital, no sobre lo ganado, y `isrAnual` es una tasa anual.
 *
 *   isrDiario = saldo × (isrAnual/100) / baseIsr
 *
 * `interes` — para productos que retienen un porcentaje de lo ganado. Aquí
 * `isrAnual` NO se anualiza ni usa `baseIsr`: es un porcentaje directo.
 *
 *   isrDiario = interesBruto × (isrAnual/100)
 *
 * En ambos casos se descuenta cada día antes de capitalizar, porque lo que se
 * reinvierte es el interés neto. `isrAnual = 0` (default) deja el cálculo bruto.
 *
 * La base del interés y la del ISR se configuran por separado porque no siempre
 * coinciden — Revolut MX paga intereses sobre 360 días y retiene sobre 365.
 *
 * Redondeo diario
 * ────────────────
 * `continuo` (default) — el interés y el ISR de cada día se capitalizan con su
 * valor exacto, sin redondear. Es lo correcto cuando la institución solo
 * publica un neto ya limpio y no hay nada contra qué comparar centavo a
 * centavo.
 *
 * `centavos` — bruto y retención se redondean a centavos *antes* de sumarse al
 * saldo, replicando que el dinero real se liquida en unidades discretas. Úsalo
 * en cuentas donde ves el abono y la retención como movimientos separados en
 * el estado de cuenta: si no se redondea aquí, el "neto" mostrado puede diferir
 * en un centavo del que resulta de restar esos dos movimientos ya redondeados,
 * y el saldo compuesto se va desviando del real con el tiempo.
 *
 * Eventos de la cuenta
 * ────────────────────
 * El saldo cambia por tres razones distintas, y confundirlas es lo que hace que
 * el rendimiento reportado deje de cuadrar con el estado de cuenta:
 *
 *   `ancla`       Un saldo REAL capturado por el usuario. Reancla la proyección:
 *                 el saldo pasa a valer lo observado, sin importar lo que decía
 *                 el modelo. No es rendimiento — es una medición.
 *
 *   `movimiento`  Dinero que entró o salió (aporte/retiro). Mueve el saldo pero
 *                 NO es rendimiento: se reporta aparte para no inflar lo ganado.
 *                 Si va de una cuenta del módulo a otra, es una transferencia y
 *                 se guarda como dos movimientos espejo — ver más abajo.
 *                 Su propio día de llegada rinde sobre el saldo VIEJO, no sobre
 *                 el nuevo — el saldo ya actualizado recién empieza a generar
 *                 interés desde el día siguiente (`recorrer` compone ese día con
 *                 lo que había antes de sumar el movimiento).
 *
 *   `ajuste`      Deriva del cálculo que el usuario reconoce al conciliar. SÍ es
 *                 rendimiento: si la institución pagó más de lo que el modelo
 *                 predijo, ese dinero se ganó aunque el modelo no lo viera venir.
 *
 * En una misma fecha se aplican en ese orden inverso — primero los movimientos,
 * luego los ajustes y al final el ancla — porque el saldo observado ya incluye
 * todo lo que pasó ese día y debe ganar siempre la última palabra.
 *
 * Lo que sobra al llegar a un ancla (`residuo`) es lo que ningún movimiento ni
 * ajuste alcanzó a explicar. Se reporta por separado en vez de disolverse en las
 * aportaciones, que es como se perdía antes de existir este modelo.
 *
 * La deriva no se acumula entre anclas: cada captura reinicia el error a cero,
 * así que solo puede crecer dentro del tramo que va de una captura a la
 * siguiente.
 */

export const BASE_ANUAL_DEFAULT = 365;

/** Cómo se aplican los tramos al saldo. */
export const MODO_PROGRESIVO = 'progresivo';
export const MODO_UNICO      = 'unico';

/** Sobre qué se calcula la retención. */
export const ISR_CAPITAL = 'capital';
export const ISR_INTERES = 'interes';

/** Cómo se interpreta la tasa anual publicada por la institución. */
export const TASA_NOMINAL  = 'nominal';
export const TASA_EFECTIVA = 'efectiva';

/** Si el interés y el ISR de cada día se redondean a centavos antes de capitalizar. */
export const REDONDEO_CONTINUO = 'continuo';
export const REDONDEO_CENTAVOS = 'centavos';

/** Por qué cambió el saldo. Ver la nota de eventos en la cabecera. */
export const EVENTO_ANCLA      = 'ancla';
export const EVENTO_MOVIMIENTO = 'movimiento';
export const EVENTO_AJUSTE     = 'ajuste';

/** Dirección de un movimiento de efectivo. */
export const MOV_APORTE = 'aporte';
export const MOV_RETIRO = 'retiro';

/** Diferencia por debajo de la cual dos importes se consideran el mismo. */
const EPS = 0.005; // medio centavo

/** Tramos precargados al crear una cuenta nueva. */
export const TRAMOS_DEFAULT = [
  { hasta: 25000,  tasa: 15 },
  { hasta: 100000, tasa: 7  },
  { hasta: null,   tasa: 5  },
];

/** Tope de iteración diaria — evita bucles largos por fechas capturadas mal. */
const MAX_DIAS = 36500; // 100 años

// ── Fechas ────────────────────────────────────────────────────────────────────

/** Normaliza un Date o string ISO (con o sin hora) a 'YYYY-MM-DD'. */
export function isoDay(v) {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

const CDMX_OFFSET_MS   = -6 * 60 * 60000; // CDMX es UTC-6 fijo: México quitó el horario de verano en 2022
const CORTE_RENDIMIENTOS = 7;             // hora CDMX en la que "hoy" empieza a contar

/**
 * "Hoy" para efectos de rendimientos: hora de Ciudad de México, pero el día
 * natural rueda a las 7am en vez de a medianoche. Antes de esa hora ya se
 * sabe qué generaron/abonaron las instituciones la madrugada anterior (ver
 * `historialDiario`) — contarlo como "hoy" desde las 00:00 mostraría un día
 * de más que todavía nadie abonó. No depende de la zona horaria del
 * dispositivo: se calcula la hora CDMX explícitamente.
 */
export function hoyISO() {
  const cdmx = new Date(Date.now() + CDMX_OFFSET_MS);
  if (cdmx.getUTCHours() < CORTE_RENDIMIENTOS) cdmx.setUTCDate(cdmx.getUTCDate() - 1);
  return `${cdmx.getUTCFullYear()}-${String(cdmx.getUTCMonth() + 1).padStart(2, '0')}-${String(cdmx.getUTCDate()).padStart(2, '0')}`;
}

function utcMs(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** Días calendario completos entre dos fechas 'YYYY-MM-DD' (negativo si fin < inicio). */
export function diasEntre(inicio, fin) {
  if (!inicio || !fin) return 0;
  return Math.round((utcMs(fin) - utcMs(inicio)) / 86400000);
}

/** Suma (o resta) días a una fecha 'YYYY-MM-DD'. */
export function sumarDias(iso, n) {
  const d = new Date(utcMs(iso) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// ── Tramos ────────────────────────────────────────────────────────────────────

/**
 * Ordena los tramos, deriva el `desde` de cada uno a partir del `hasta` del
 * anterior (elimina huecos y solapes) y garantiza un tramo abierto final.
 *
 * @param {Array<{hasta:number|null, tasa:number}>} tramos
 * @returns {Array<{desde:number, hasta:number|null, tasa:number}>}
 */
export function normalizarTramos(tramos) {
  const src = (Array.isArray(tramos) && tramos.length ? tramos : TRAMOS_DEFAULT)
    .map(t => ({
      hasta: (t.hasta == null || t.hasta === '') ? null : Number(t.hasta),
      tasa:  Number(t.tasa) || 0,
    }))
    .filter(t => t.hasta === null || (isFinite(t.hasta) && t.hasta > 0));

  const acotados = src.filter(t => t.hasta !== null).sort((a, b) => a.hasta - b.hasta);
  const abierto  = src.find(t => t.hasta === null);

  const out = [];
  let desde = 0;
  for (const t of acotados) {
    if (t.hasta <= desde) continue; // solape — se descarta
    out.push({ desde, hasta: t.hasta, tasa: t.tasa });
    desde = t.hasta;
  }
  out.push({
    desde,
    hasta: null,
    tasa: abierto ? abierto.tasa : (acotados.length ? acotados[acotados.length - 1].tasa : 0),
  });
  return out;
}

/** Índice del tramo en el que cae un saldo (-1 si el saldo es 0 o negativo). */
export function tramoActivo(tramos, saldo) {
  if (!(saldo > 0)) return -1;
  return tramos.findIndex(t => saldo > t.desde && (t.hasta == null || saldo <= t.hasta));
}

// ── Configuración de cálculo ──────────────────────────────────────────────────

/**
 * Traduce un documento de `inversiones` a la configuración que consumen las
 * funciones de cálculo. Todas ellas reciben este objeto en lugar de una lista
 * larga de parámetros posicionales.
 *
 * @param {object} cuenta
 * @returns {{tramos:Array, modo:string, base:number, isrAnual:number, baseIsr:number}}
 */
export function configCuenta(cuenta = {}) {
  return {
    tramos:   normalizarTramos(cuenta.tramos),
    modo:     cuenta.modoTramos === MODO_UNICO ? MODO_UNICO : MODO_PROGRESIVO,
    modoTasa: cuenta.modoTasa === TASA_EFECTIVA ? TASA_EFECTIVA : TASA_NOMINAL,
    base:     Number(cuenta.baseAnual) || BASE_ANUAL_DEFAULT,
    isrAnual: Number(cuenta.isrAnual)  || 0,
    isrSobre: cuenta.isrSobre === ISR_INTERES ? ISR_INTERES : ISR_CAPITAL,
    baseIsr:  Number(cuenta.baseIsr)   || BASE_ANUAL_DEFAULT,
    redondeo: cuenta.redondeoDiario === REDONDEO_CENTAVOS ? REDONDEO_CENTAVOS : REDONDEO_CONTINUO,
  };
}

// ── Composición ───────────────────────────────────────────────────────────────

/** Tasa diaria que corresponde a una tasa anual publicada, según `modoTasa`. */
export function tasaDiaria(tasaAnual, cfg) {
  const r = (Number(tasaAnual) || 0) / 100;
  if (r <= 0) return 0;
  return cfg.modoTasa === TASA_EFECTIVA
    ? Math.pow(1 + r, 1 / cfg.base) - 1
    : r / cfg.base;
}

/** Interés bruto de un solo día, según el modo de aplicación de los tramos. */
export function interesDiario(saldo, cfg) {
  const s = Number(saldo) || 0;
  if (s <= 0) return 0;

  if (cfg.modo === MODO_UNICO) {
    const i = tramoActivo(cfg.tramos, s);
    return i < 0 ? 0 : s * tasaDiaria(cfg.tramos[i].tasa, cfg);
  }

  let interes = 0;
  for (const t of cfg.tramos) {
    if (s <= t.desde) break;
    const tope    = t.hasta == null ? s : Math.min(s, t.hasta);
    const porcion = tope - t.desde;
    if (porcion > 0) interes += porcion * tasaDiaria(t.tasa, cfg);
  }
  return interes;
}

/**
 * Retención de ISR de un día.
 * @param {number} [interesBruto] - interés del día; solo se usa en modo `interes`.
 *                                  Si se omite se recalcula.
 */
export function isrDiario(saldo, cfg, interesBruto) {
  if (!(cfg.isrAnual > 0)) return 0;

  if (cfg.isrSobre === ISR_INTERES) {
    const i = interesBruto == null ? interesDiario(saldo, cfg) : (Number(interesBruto) || 0);
    return i > 0 ? i * (cfg.isrAnual / 100) : 0;
  }

  const s = Number(saldo) || 0;
  return s > 0 ? s * (cfg.isrAnual / 100) / cfg.baseIsr : 0;
}

/**
 * Interés bruto y retención de un día, redondeados a centavos antes de
 * capitalizar cuando `cfg.redondeo === REDONDEO_CENTAVOS` — así el neto que se
 * capitaliza coincide con el de dos movimientos ya redondeados, en vez de con
 * la resta de sus valores exactos.
 */
function pasoDiario(saldo, cfg) {
  const bruto = interesDiario(saldo, cfg);
  const isr   = isrDiario(saldo, cfg, bruto);
  if (cfg.redondeo === REDONDEO_CENTAVOS) {
    return { bruto: Math.round(bruto * 100) / 100, isr: Math.round(isr * 100) / 100 };
  }
  return { bruto, isr };
}

/**
 * Capitaliza un saldo día a día, descontando la retención antes de reinvertir
 * (lo que se capitaliza es el interés neto).
 * @returns {{saldoFinal:number, rendimiento:number, bruto:number, isr:number, dias:number}}
 */
export function componer(saldoInicial, dias, cfg) {
  const inicial = Number(saldoInicial) || 0;
  const n = Math.max(0, Math.min(Math.floor(Number(dias) || 0), MAX_DIAS));
  let saldo = inicial, bruto = 0, isr = 0, ultimo = null;
  for (let i = 0; i < n; i++) {
    const { bruto: b, isr: r } = pasoDiario(saldo, cfg);
    bruto += b;
    isr   += r;
    ultimo = { bruto: b, isr: r, neto: b - r };
    saldo = Math.max(0, saldo + b - r);
  }
  // `ultimo` es el último día compuesto — sirve para reportar "ayer" sin recorrer de nuevo
  return { saldoFinal: saldo, rendimiento: saldo - inicial, bruto, isr, dias: n, ultimo };
}

/**
 * Tasa anual ponderada de los tramos para un saldo (%), en el mismo espacio en
 * que la publica la institución. Se calcula sobre las tasas configuradas, no a
 * partir del interés diario: así no depende de `base` ni de `modoTasa` y sigue
 * siendo comparable con lo que muestra la app del banco.
 */
export function tasaNominal(saldo, cfg) {
  const s = Number(saldo) || 0;
  if (s <= 0) return 0;

  if (cfg.modo === MODO_UNICO) {
    const i = tramoActivo(cfg.tramos, s);
    return i < 0 ? 0 : cfg.tramos[i].tasa;
  }

  let acc = 0;
  for (const t of cfg.tramos) {
    if (s <= t.desde) break;
    const tope    = t.hasta == null ? s : Math.min(s, t.hasta);
    const porcion = tope - t.desde;
    if (porcion > 0) acc += porcion * t.tasa;
  }
  return acc / s;
}

/**
 * Cuánto del saldo vive en cada tramo y cuánto aporta al interés del día.
 *
 * Resuelve la ambigüedad de resaltar "el tramo activo": en modo progresivo
 * varios tramos aportan a la vez, así que lo informativo es el reparto, no un
 * resaltado. `marginal` marca el tramo donde caería el siguiente peso.
 *
 * La suma de los `aporte` es exactamente `interesDiario(saldo, cfg)`.
 *
 * @returns {Array<{desde, hasta, tasa, monto, aporte, pct, marginal}>}
 */
export function desgloseTramos(saldo, cfg) {
  const s   = Number(saldo) || 0;
  const idx = tramoActivo(cfg.tramos, s);

  return cfg.tramos.map((t, i) => {
    let monto;
    if (cfg.modo === MODO_UNICO) {
      monto = i === idx ? s : 0;
    } else {
      const tope = t.hasta == null ? s : Math.min(s, t.hasta);
      monto = Math.max(0, tope - t.desde);
    }
    return {
      ...t,
      monto,
      aporte:   monto > 0 ? monto * tasaDiaria(t.tasa, cfg) : 0,
      pct:      s > 0 ? (monto / s) * 100 : 0,
      marginal: i === idx,
    };
  });
}

// ── Línea de tiempo de la cuenta ──────────────────────────────────────────────

/**
 * Puntos de saldo observado de una cuenta, ascendentes y sin fechas repetidas
 * (si hay dos capturas el mismo día gana la última).
 * @returns {Array<{fecha:string, monto:number}>}
 */
export function timelineCuenta(cuenta) {
  const items = [];
  const push = (fecha, monto) => {
    const f = isoDay(fecha);
    if (f && monto != null && isFinite(Number(monto))) items.push({ fecha: f, monto: Number(monto) });
  };

  (Array.isArray(cuenta.historial) ? cuenta.historial : []).forEach(h => h && push(h.fecha, h.monto));
  push(cuenta.fechaActualizacion, cuenta.montoInvertido);

  const map = new Map();
  items.sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(i => map.set(i.fecha, i));
  return [...map.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// ── Corrección de la raíz ──────────────────────────────────────────────────────

/**
 * `historial` solo tiene sentido si cada captura es estrictamente anterior a la
 * raíz vigente (`montoInvertido`/`fechaActualizacion`) — es justamente lo que la
 * distingue de una ancla cualquiera. Editar la raíz a una fecha más vieja que
 * capturas que ya existían (por ejemplo, para arrancar una cuenta vieja desde un
 * punto de partida distinto sin reconstruir todo el camino intermedio) deja esas
 * capturas "en el futuro" respecto a la nueva raíz — dejan de poder representarse
 * como historial de ESA raíz.
 *
 * Estas dos funciones son las dos mitades de esa corrección: qué se descarta
 * (para poder avisar antes de aplicarla) y qué queda (el resultado ya limpio).
 * Es una operación explícita del usuario, no algo que deba pasar en silencio —
 * quien la dispara decide si de verdad quiere "reiniciar" la cuenta desde ahí.
 */

/** Capturas de `historial` que quedarían en el futuro respecto a `nuevaFecha`. */
export function capturasDescartadas(historial, nuevaFecha) {
  const corte = isoDay(nuevaFecha);
  return (Array.isArray(historial) ? historial : [])
    .filter(h => h && isoDay(h.fecha) && corte && isoDay(h.fecha) >= corte)
    .sort((a, b) => isoDay(a.fecha).localeCompare(isoDay(b.fecha)));
}

/** `historial` sin las capturas que quedarían en el futuro respecto a `nuevaFecha`. */
export function historialConsistente(historial, nuevaFecha) {
  const corte = isoDay(nuevaFecha);
  return (Array.isArray(historial) ? historial : [])
    .filter(h => h && isoDay(h.fecha) && corte && isoDay(h.fecha) < corte);
}

/** Orden de aplicación dentro de una misma fecha — el ancla siempre cierra. */
const ORDEN_EVENTO = {
  [EVENTO_MOVIMIENTO]: 0,
  [EVENTO_AJUSTE]:     1,
  [EVENTO_ANCLA]:      2,
};

/**
 * Todos los eventos de una cuenta —anclas, movimientos y ajustes— en el orden en
 * que deben aplicarse.
 *
 * Los retiros se guardan con `tipo: 'retiro'` y monto positivo; aquí salen ya con
 * el signo puesto, para que el recorrido solo tenga que sumar.
 *
 * @returns {Array<{fecha:string, tipo:string, monto:number}>}
 */
export function eventosCuenta(cuenta = {}) {
  const ev = timelineCuenta(cuenta)
    .map(p => ({ fecha: p.fecha, tipo: EVENTO_ANCLA, monto: p.monto }));

  (Array.isArray(cuenta.movimientos) ? cuenta.movimientos : []).forEach(m => {
    const f = isoDay(m?.fecha);
    const v = Number(m?.monto);
    if (!f || !isFinite(v) || v === 0) return;
    const signo = m.tipo === MOV_RETIRO ? -1 : 1;
    ev.push({ fecha: f, tipo: EVENTO_MOVIMIENTO, monto: Math.abs(v) * signo, nota: m.nota || '' });
  });

  (Array.isArray(cuenta.ajustes) ? cuenta.ajustes : []).forEach(a => {
    const f = isoDay(a?.fecha);
    const v = Number(a?.monto);
    if (!f || !isFinite(v)) return;
    ev.push({ fecha: f, tipo: EVENTO_AJUSTE, monto: v, motivo: a.motivo || '' });
  });

  return ordenarEventos(ev);
}

/**
 * Acepta tanto una lista de eventos como un `timeline` plano de `{fecha, monto}`
 * — sin `tipo` se asume ancla, que es lo que ese formato siempre significó.
 */
function ordenarEventos(eventos) {
  return (Array.isArray(eventos) ? eventos : [])
    .map(e => ({ ...e, tipo: e.tipo || EVENTO_ANCLA }))
    .sort((a, b) =>
      a.fecha.localeCompare(b.fecha) || ORDEN_EVENTO[a.tipo] - ORDEN_EVENTO[b.tipo]);
}

/**
 * Avanza desde `desde` (con `saldoInicial` ya vigente al cierre de ese día) hasta
 * `hasta`, componiendo entre eventos y aplicando cada uno según su tipo.
 *
 * Los eventos exactamente en `desde` quedan fuera —ya están incorporados al saldo
 * de partida— y los de `hasta` sí entran: todo saldo es de cierre del día.
 */
function recorrer(eventos, desde, hasta, saldoInicial, cfg) {
  const acc = {
    saldo: Number(saldoInicial) || 0,
    rendimiento: 0, bruto: 0, isr: 0,
    movimientos: 0, ajustes: 0, residuo: 0,
    ultimo: null,
  };
  let cursor = desde;

  const avanzar = fin => {
    const paso = componer(acc.saldo, diasEntre(cursor, fin), cfg);
    acc.rendimiento += paso.rendimiento;
    acc.bruto       += paso.bruto;
    acc.isr         += paso.isr;
    acc.saldo        = paso.saldoFinal;
    if (paso.ultimo) acc.ultimo = paso.ultimo;
    cursor = fin;
  };

  // Compone exactamente el día que apunta `cursor`, sobre el saldo actual — lo
  // usa un movimiento para que su propio día de llegada rinda sobre el saldo
  // VIEJO antes de sumarse, en vez de sobre el nuevo. No avanza más allá de
  // `hasta`: si el movimiento cae hoy, ese día todavía no compone (mismo
  // criterio que el resto del cálculo — se abona a la madrugada siguiente).
  const unDia = () => {
    if (cursor >= hasta) return;
    const { bruto, isr } = pasoDiario(acc.saldo, cfg);
    const neto = bruto - isr;
    acc.bruto       += bruto;
    acc.isr         += isr;
    acc.rendimiento += neto;
    acc.ultimo       = { bruto, isr, neto };
    acc.saldo        = Math.max(0, acc.saldo + neto);
    cursor = sumarDias(cursor, 1);
  };

  for (const e of eventos) {
    if (e.fecha <= desde || e.fecha > hasta) continue;
    if (e.fecha > cursor) avanzar(e.fecha);

    if (e.tipo === EVENTO_MOVIMIENTO) {
      // El día de la llegada rinde sobre el saldo VIEJO — el movimiento entra
      // recién después, así que el saldo nuevo empieza a generar mañana.
      unDia();
      acc.saldo       += e.monto;
      acc.movimientos += e.monto;
    } else if (e.tipo === EVENTO_AJUSTE) {
      // Un ajuste es rendimiento que el modelo no supo predecir
      acc.saldo       += e.monto;
      acc.ajustes     += e.monto;
      acc.rendimiento += e.monto;
    } else {
      // Ancla: lo observado manda, y lo que nadie explicó queda a la vista
      acc.residuo += e.monto - acc.saldo;
      acc.saldo    = e.monto;
    }
    acc.saldo = Math.max(0, acc.saldo);
  }

  if (diasEntre(cursor, hasta) > 0) avanzar(hasta);
  return acc;
}

/** Saldo proyectado al cierre de una fecha; `null` si es anterior a la primera ancla. */
export function saldoEnFecha(eventos, fecha, cfg) {
  const evs = ordenarEventos(eventos);
  const dia = isoDay(fecha);
  let ancla = null;
  for (const e of evs) {
    if (e.tipo !== EVENTO_ANCLA) continue;
    if (e.fecha <= dia) ancla = e; else break;
  }
  if (!ancla) return null;
  return recorrer(evs, ancla.fecha, dia, ancla.monto, cfg).saldo;
}

/**
 * Rendimiento generado entre dos fechas, atravesando los eventos del periodo.
 *
 * Acepta la lista de `eventosCuenta()` o un `timeline` plano; en ese caso todos
 * los puntos se leen como anclas, que es como se comportaba antes de existir los
 * movimientos y los ajustes.
 *
 * Si `fInicio` es anterior a la primera ancla se recorta a esa fecha y se marca
 * `recortado: true` — no hay dato del que partir antes de eso.
 *
 * `aportaciones` conserva su significado histórico: todo lo que movió el saldo
 * sin ser rendimiento. `movimientos` y `residuo` son su desglose — lo declarado
 * por el usuario y lo que quedó sin explicar.
 *
 * @returns {{rendimiento, bruto, isr, saldoInicial, saldoFinal, aportaciones,
 *            movimientos, ajustes, residuo, desde, hasta, dias, recortado}|null}
 */
export function rendimientoEntre(eventos, fInicio, fFin, cfg) {
  const evs = ordenarEventos(eventos);
  const primera = evs.find(e => e.tipo === EVENTO_ANCLA)?.fecha;
  if (!primera) return null;

  const ini = isoDay(fInicio), fin = isoDay(fFin);
  if (!ini || !fin || diasEntre(ini, fin) < 0) return null;
  if (diasEntre(primera, fin) < 0) return null; // todo el rango es previo al primer dato

  const desde = ini < primera ? primera : ini;
  const saldoInicial = saldoEnFecha(evs, desde, cfg);
  if (saldoInicial == null) return null;

  const t = recorrer(evs, desde, fin, saldoInicial, cfg);

  return {
    rendimiento: t.rendimiento, bruto: t.bruto, isr: t.isr,
    saldoInicial, saldoFinal: t.saldo,
    aportaciones: t.movimientos + t.residuo,
    movimientos: t.movimientos, ajustes: t.ajustes, residuo: t.residuo,
    desde, hasta: fin, dias: diasEntre(desde, fin), recortado: desde !== ini,
  };
}

// ── Transferencias entre cuentas del módulo ───────────────────────────────────

/**
 * Un traspaso entre dos cuentas propias se guarda como DOS movimientos espejo
 * —un retiro en el origen y un aporte en el destino— unidos por el mismo
 * `transferenciaId`. El usuario lo captura una sola vez.
 *
 * Se duplica a propósito en lugar de guardarse en un solo lado: así el documento
 * de cada cuenta se sigue bastando solo y el motor puede calcularla sin cargar la
 * cuenta contraria. El precio es que ambas patas deben escribirse juntas.
 *
 * Para el cálculo no son nada especial: cada pata es un movimiento común, así que
 * ninguna de las dos cuentas la cuenta como rendimiento. En el portafolio se
 * anulan entre sí.
 */

/** Motivo por el que una transferencia no se puede registrar, o `null` si está bien. */
export function validarTransferencia({ origenId, destinoId, monto, fecha, fechaDestino } = {}) {
  if (!origenId || !destinoId) return 'Falta la cuenta de origen o la de destino';
  if (origenId === destinoId)  return 'El origen y el destino deben ser cuentas distintas';
  const v = Number(monto);
  if (!isFinite(v) || v <= 0)  return 'El monto debe ser mayor que cero';
  if (!isoDay(fecha))          return 'Falta la fecha de salida';
  if (fechaDestino && diasEntre(isoDay(fecha), isoDay(fechaDestino)) < 0)
    return 'El dinero no puede llegar antes de salir';
  return null;
}

/**
 * Arma las dos patas de una transferencia.
 *
 * `fechaDestino` es opcional: entre instituciones el dinero puede tardar en
 * llegar, y esos días no generan interés en ninguna de las dos cuentas — que es
 * exactamente lo que pasa en la realidad. Omitida, se asume que llega el mismo
 * día.
 *
 * @returns {{transferenciaId:string, origen:object, destino:object}}
 * @throws si la transferencia no es válida — validar antes con `validarTransferencia`
 */
export function movimientosTransferencia(spec = {}) {
  const error = validarTransferencia(spec);
  if (error) throw new Error(error);

  const { origenId, destinoId, monto, fecha, fechaDestino, nota = '' } = spec;
  const id = spec.id || globalThis.crypto?.randomUUID?.()
    || `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const salida  = isoDay(fecha);
  const llegada = isoDay(fechaDestino) || salida;
  const v       = Math.abs(Number(monto));

  return {
    transferenciaId: id,
    origen:  { fecha: salida,  tipo: MOV_RETIRO, monto: v, transferenciaId: id, contraparteId: destinoId, nota },
    destino: { fecha: llegada, tipo: MOV_APORTE, monto: v, transferenciaId: id, contraparteId: origenId,  nota },
  };
}

/** Si un movimiento es una pata de transferencia y no un aporte/retiro suelto. */
export const esTransferencia = m => !!m?.transferenciaId;

/** Los movimientos de una cuenta sin la pata de una transferencia dada. */
export function sinTransferencia(movimientos, transferenciaId) {
  return (Array.isArray(movimientos) ? movimientos : [])
    .filter(m => m?.transferenciaId !== transferenciaId);
}

/**
 * Inserta la pata en la lista de una cuenta, reemplazando la que ya hubiera de
 * esa misma transferencia — editarla no debe duplicarla.
 */
export function conTransferencia(movimientos, pata) {
  return [...sinTransferencia(movimientos, pata.transferenciaId), pata]
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

// ── Conciliación contra el saldo real ─────────────────────────────────────────

/**
 * Compara el saldo real de un estado de cuenta contra lo que el modelo proyecta,
 * y desglosa la diferencia.
 *
 *   saldoEsperado = saldoAnterior + rendimientoProyectado + movimientos + ajustes
 *   residuo       = saldoReal − saldoEsperado
 *
 * El residuo es lo que el usuario tiene que clasificar: deriva del cálculo, un
 * movimiento que olvidó registrar, o un error en la captura anterior. Nunca se
 * le pide que lo calcule — solo que diga qué es.
 *
 * Se concilia contra la última ancla ESTRICTAMENTE anterior a `fecha`: una
 * captura no se compara consigo misma, y si ya había uno ese día es porque se
 * está corrigiendo.
 *
 * @returns {{desde, hasta, dias, saldoAnterior, rendimientoProyectado, movimientos,
 *            ajustes, saldoEsperado, saldoReal, residuo, derivaAnual, cuadra}|null}
 */
export function conciliar(cuenta, saldoReal, fecha = hoyISO(), cfg = configCuenta(cuenta)) {
  const dia  = isoDay(fecha);
  const real = Number(saldoReal);
  if (!dia || !isFinite(real)) return null;

  // Las anclas de `dia` en adelante son la captura que se está conciliando o
  // capturas futuras: ninguna puede participar de su propia proyección.
  const evs = eventosCuenta(cuenta).filter(e => e.tipo !== EVENTO_ANCLA || e.fecha < dia);

  let ancla = null;
  for (const e of evs) {
    if (e.tipo === EVENTO_ANCLA && e.fecha < dia) ancla = e;
  }
  if (!ancla) return null;

  const t    = recorrer(evs, ancla.fecha, dia, ancla.monto, cfg);
  const dias = diasEntre(ancla.fecha, dia);
  const residuo = real - t.saldo;

  return {
    desde: ancla.fecha, hasta: dia, dias,
    saldoAnterior: ancla.monto,
    rendimientoProyectado: t.rendimiento - t.ajustes, // los ajustes se listan aparte
    movimientos: t.movimientos,
    ajustes: t.ajustes,
    saldoEsperado: t.saldo,
    saldoReal: real,
    residuo,
    // Deriva anualizada — sirve para detectar config equivocada, no para cobrar
    derivaAnual: (dias > 0 && ancla.monto > 0)
      ? (residuo / ancla.monto) * (cfg.base / dias) * 100
      : 0,
    cuadra: Math.abs(residuo) < EPS,
  };
}

/**
 * Recalcula el importe de cada ajuste dejando intacta su clasificación.
 *
 * Un ajuste colocado sobre un ancla es un valor DERIVADO: explica el residuo de
 * esa captura. Si se edita la raíz —el monto o la fecha de un ancla anterior—
 * ese residuo cambia y el importe guardado queda viejo. El motivo, en cambio, es
 * criterio del usuario y se respeta siempre.
 *
 * Los ajustes sueltos (sin ancla ese día) no se derivan de nada y pasan tal cual,
 * igual que los marcados `derivado: false` — esos son importes que el usuario
 * dimensionó a mano al clasificar solo una parte del residuo, y corregirlos sería
 * pisarle el criterio.
 *
 * Cada tramo arranca en un ancla, que es un valor observado, así que los ajustes
 * no dependen entre sí: recalcularlos en cualquier orden da el mismo resultado.
 * Se asume un solo ajuste derivado por fecha.
 *
 * @returns {Array<{fecha, monto, motivo, derivado:boolean, cambio:number}>}
 */
export function recalcularAjustes(cuenta, cfg = configCuenta(cuenta)) {
  const ajustes = Array.isArray(cuenta.ajustes) ? cuenta.ajustes : [];
  const anclas  = new Map(
    eventosCuenta(cuenta).filter(e => e.tipo === EVENTO_ANCLA).map(e => [e.fecha, e.monto]));

  return ajustes.map(a => {
    const f     = isoDay(a?.fecha);
    const antes = Number(a?.monto) || 0;
    const igual = { ...a, fecha: f, monto: antes, derivado: false, cambio: 0 };
    if (!f || a?.derivado === false || !anclas.has(f)) return igual;

    // Sin este ajuste en juego, el residuo del ancla es justo lo que debe valer
    const sinEste = { ...cuenta, ajustes: ajustes.filter(x => isoDay(x?.fecha) !== f) };
    const c = conciliar(sinEste, anclas.get(f), f, cfg);
    if (!c) return igual;

    const monto = Math.round(c.residuo * 100) / 100;
    return { ...a, fecha: f, monto, derivado: true, cambio: Math.round((monto - antes) * 100) / 100 };
  });
}

/**
 * Rendimiento día por día desde la última actualización del monto invertido.
 *
 * Cada entrada es el día que **generó** el interés; las instituciones lo abonan
 * a la madrugada siguiente. Por eso el último renglón es "ayer": lo que se
 * depositó hoy en la mañana.
 *
 * Recorre el timeline **completo**, no solo desde la última ancla: cada vez que
 * se captura un saldo nuevo (con "Ajuste" o "Editar cuenta"), esa ancla pasa a
 * ser la más reciente, y si la tabla solo mirara desde ahí, capturar un dato
 * borraría de la vista todo el historial de antes — exactamente lo que no debe
 * pasar, porque `historialDiario` es donde se audita y se corrige el pasado, no
 * solo dónde se ve "cómo va hoy" (eso lo resuelve `resumenCuenta`, que sí solo
 * necesita la última captura).
 *
 * Cada día se resuelve con `recorrer()` sobre un tramo de un solo día — así una
 * ancla intermedia (la cuenta se recapturó a medio camino) se atraviesa con la
 * misma regla que usa el resto de la app: lo observado manda y absorbe el
 * residuo en silencio, salvo que haya un ajuste explícito ese día.
 *
 * Los movimientos y ajustes del periodo se aplican al inicio de su día. Un
 * ajuste ya compone ese mismo día sobre el saldo con la corrección incluida; un
 * movimiento en cambio rinde ese día sobre el saldo VIEJO —el que había antes de
 * sumarlo— y recién compone sobre el saldo nuevo desde el día siguiente.
 *
 * El último renglón es el del propio `hoy` — aunque su interés todavía no se
 * haya "cobrado" de verdad (es una proyección, igual que el rendimiento diario
 * que ya muestra el resumen de la cuenta), sin ese renglón un movimiento o
 * ajuste registrado hoy mismo no aparecería en la tabla en absoluto.
 *
 * @param {object} cuenta
 * @param {string} [hoy]
 * @param {number} [maxDias] - tope de renglones devueltos
 * @returns {Array<{fecha, saldoInicial, bruto, isr, neto, saldoFinal, movimiento, ajuste}>} ascendente
 */
export function historialDiario(cuenta, hoy = hoyISO(), maxDias = 400) {
  const cfg      = configCuenta(cuenta);
  const eventos  = eventosCuenta(cuenta);
  const timeline = timelineCuenta(cuenta);
  const primero  = timeline[0];
  if (!primero) return [];

  // +1 porque `diasEntre` da la diferencia entre fechas — el propio día de la
  // primera ancla y el propio `hoy` son ambos renglones, no solo lo que hay
  // estrictamente entre medio.
  const total    = Math.max(0, diasEntre(primero.fecha, hoy)) + 1;
  const n        = Math.min(total, Math.max(0, maxDias));
  const saltados = total - n; // si se recorta, se arranca ya compuesto

  // Si no hay recorte, la tabla arranca justo en la primera ancla — su propio
  // día se resuelve aparte (abajo) porque no hay "ayer" del que partir. Si hay
  // recorte, el punto de arranque es un borde cualquiera y `recorrer()` ya sabe
  // atravesar tantas anclas intermedias como haga falta para llegar ahí de un
  // solo tirón.
  let cierreFecha = saltados > 0 ? sumarDias(primero.fecha, saltados) : primero.fecha;
  let cierreSaldo = saltados > 0
    ? recorrer(eventos, primero.fecha, cierreFecha, primero.monto, cfg).saldo
    : primero.monto;

  // Movimientos y ajustes dentro de la ventana mostrada, para las etiquetas de
  // cada renglón — las anclas no llevan etiqueta propia, ya se ven en el salto
  // de saldo del día.
  const porFecha = new Map();
  eventos.forEach(e => {
    if (e.tipo === EVENTO_ANCLA || e.fecha <= cierreFecha || e.fecha > hoy) return;
    porFecha.set(e.fecha, [...(porFecha.get(e.fecha) || []), e]);
  });

  const out = [];
  for (let i = 0; i < n; i++) {
    let fecha, bruto, isr, saldoFinal, movimiento = 0, ajuste = 0;

    if (i === 0) {
      // El primer renglón mostrado —sea el día de la primerísima ancla, o el
      // borde donde arranca un recorte por `maxDias`— parte de un saldo que ya
      // es "inicio de ese día", así que compone directo sobre `cierreFecha` en
      // vez de sumarle un día: si también le sumara uno, todo el recorte
      // quedaría corrido una fecha de más (el bug que esto reemplaza).
      fecha = cierreFecha;
      ({ bruto, isr } = pasoDiario(cierreSaldo, cfg));
      saldoFinal = Math.max(0, cierreSaldo + bruto - isr);
    } else {
      fecha = sumarDias(cierreFecha, 1);
      const paso = recorrer(eventos, cierreFecha, fecha, cierreSaldo, cfg);
      bruto = paso.bruto; isr = paso.isr; saldoFinal = paso.saldo;
      (porFecha.get(fecha) || []).forEach(e => {
        if (e.tipo === EVENTO_MOVIMIENTO) movimiento += e.monto;
        else                              ajuste     += e.monto;
      });
    }

    // Sin nada que mostrar (saldo en $0 y ningún evento) el renglón no aporta —
    // se salta en vez de llenar la tabla de ceros hasta el primer movimiento
    if (cierreSaldo > 0 || saldoFinal > 0 || movimiento || ajuste) {
      out.push({
        fecha, saldoInicial: cierreSaldo, bruto, isr, neto: bruto - isr,
        saldoFinal, movimiento, ajuste,
      });
    }
    cierreFecha = fecha;
    cierreSaldo = saldoFinal;
  }
  return out;
}

// ── Resumen de una cuenta ─────────────────────────────────────────────────────

/**
 * Todos los indicadores de una cuenta a una fecha dada.
 *
 * El saldo actual se obtiene proyectando `montoInvertido` desde su
 * `fechaActualizacion` hasta hoy; los rendimientos diario / mensual / anual se
 * calculan sobre ese saldo ya actualizado y se reportan **netos** de ISR.
 *
 * @param {object} cuenta - documento de `inversiones`
 * @param {string} [hoy]  - fecha de corte 'YYYY-MM-DD'
 */
export function resumenCuenta(cuenta, hoy = hoyISO()) {
  const cfg      = configCuenta(cuenta);
  const timeline = timelineCuenta(cuenta);
  const eventos  = eventosCuenta(cuenta);

  // `capital` sale del mismo timeline que `fechaBase`, no del campo crudo
  // `montoInvertido` por separado — deben referirse siempre al mismo punto. Si se
  // leyeran de fuentes distintas, una raíz corregida a una fecha más vieja que el
  // historial (o cualquier dato importado con el orden roto) desalinearía capital
  // y fecha sin que nada lo note, componiendo desde el monto equivocado.
  const ultimo    = timeline[timeline.length - 1];
  const fechaBase = ultimo ? ultimo.fecha : hoy;
  const capital   = ultimo ? ultimo.monto : 0;
  const dias      = Math.max(0, diasEntre(fechaBase, hoy));

  // Se proyecta desde la última ancla recorriendo los eventos posteriores: un
  // aporte de ayer ya cuenta aunque todavía no se haya capturado el saldo real
  const hastaHoy    = recorrer(eventos, fechaBase, hoy, capital, cfg);
  const saldoActual = hastaHoy.saldo;

  const { bruto: diarioBruto, isr: isrDia } = pasoDiario(saldoActual, cfg);
  const proyMensual = componer(saldoActual, 30,  cfg);
  const proyAnual   = componer(saldoActual, 365, cfg);
  // GAT Nominal: como lo publican las instituciones — ANTES de impuestos y con
  // tantas capitalizaciones como días tenga la base del producto, no 365 reales.
  // Revolut MX (base 360): 15% → 16.18%, 7% → 7.25%, 7.50% → 7.79%.
  const proyBruta = componer(saldoActual, cfg.base, { ...cfg, isrAnual: 0 });

  // Acumulado desde el primer saldo observado, descontando aportaciones
  const historico = timeline.length
    ? rendimientoEntre(eventos, timeline[0].fecha, hoy, cfg)
    : null;

  // Rendimiento obtenido: captura real del usuario (ej. estado de cuenta) +
  // lo generado desde esa fecha hasta hoy. Sin captura, equivale exactamente
  // a proyectar el capital (mismo resultado que antes de este campo).
  const rendimientoObtenido = Number(cuenta.rendimientoObtenido) || 0;
  const fechaRendimiento    = isoDay(cuenta.fechaActualizacionRendimiento) || fechaBase;
  const diasRendimiento     = Math.max(0, diasEntre(fechaRendimiento, hoy));
  const proyRendimiento     = timeline.length ? rendimientoEntre(eventos, fechaRendimiento, hoy, cfg) : null;
  const rendimientoHastaHoy = rendimientoObtenido + (proyRendimiento ? proyRendimiento.rendimiento : hastaHoy.rendimiento);

  return {
    ...cfg, timeline, eventos, fechaBase, dias,
    capital,
    saldoActual,
    rendimientoObtenido, fechaRendimiento, diasRendimiento,
    rendimientoHastaHoy,
    brutoHastaHoy:        hastaHoy.bruto,
    isrHastaHoy:          hastaHoy.isr,
    rendimientoHistorico: historico ? historico.rendimiento : hastaHoy.rendimiento,
    aportacionesHistoricas: historico ? historico.aportaciones : 0,
    diasHistoricos: historico ? historico.dias : dias,
    // Los montos mostrados son netos: es lo que realmente se abona y se capitaliza
    diario:  diarioBruto - isrDia,
    mensual: proyMensual.rendimiento,
    anual:   proyAnual.rendimiento,
    diarioBruto, isrDiario: isrDia,
    // Lo generado el día consultado (`hoy` ya trae el corte de las 7am CDMX
    // aplicado) — es lo que la institución abonó esa madrugada. `hastaHoy.ultimo`
    // es solo el paso de interés puro: un EVENTO_AJUSTE no lo toca (`recorrer`
    // lo suma directo al saldo/rendimiento acumulado, no al paso del día), así
    // que un ajuste registrado ese mismo día se suma aparte.
    ayer: (hastaHoy.ultimo ? hastaHoy.ultimo.neto : 0)
        + eventos.reduce((s, e) => e.tipo === EVENTO_AJUSTE && e.fecha === hoy ? s + e.monto : s, 0),
    desglose: desgloseTramos(saldoActual, cfg),
    // La tasa ponderada y el GAT son brutos — es como los publica la institución
    tasaNominal: tasaNominal(saldoActual, cfg),
    gat: saldoActual > 0 ? (proyBruta.rendimiento / saldoActual) * 100 : 0,
    idxTramo: tramoActivo(cfg.tramos, saldoActual),
  };
}

/** Suma los indicadores de varias cuentas para los totales del encabezado. */
export function totalizarResumenes(resumenes) {
  const t = {
    capital: 0, saldoActual: 0, rendimientoHastaHoy: 0, rendimientoHistorico: 0,
    diario: 0, mensual: 0, anual: 0, isrHastaHoy: 0, cuentas: resumenes.length,
  };
  resumenes.forEach(r => {
    t.capital              += r.capital;
    t.saldoActual          += r.saldoActual;
    t.rendimientoHastaHoy  += r.rendimientoHastaHoy;
    t.rendimientoHistorico += r.rendimientoHistorico;
    t.diario               += r.diario;
    t.mensual              += r.mensual;
    t.anual                += r.anual;
    t.isrHastaHoy          += r.isrHastaHoy || 0;
  });
  t.gat = t.saldoActual > 0 ? (t.anual / t.saldoActual) * 100 : 0;
  return t;
}
