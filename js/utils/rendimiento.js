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
 * La tasa anual del tramo es NOMINAL y se capitaliza diario (estándar de las
 * cuentas mexicanas): tasaDiaria = tasaAnual / base. Al capitalizar diario el
 * rendimiento efectivo (GAT) queda por encima del nominal.
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
 */

export const BASE_ANUAL_DEFAULT = 365;

/** Cómo se aplican los tramos al saldo. */
export const MODO_PROGRESIVO = 'progresivo';
export const MODO_UNICO      = 'unico';

/** Sobre qué se calcula la retención. */
export const ISR_CAPITAL = 'capital';
export const ISR_INTERES = 'interes';

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

export const hoyISO = () => isoDay(new Date());

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
    base:     Number(cuenta.baseAnual) || BASE_ANUAL_DEFAULT,
    isrAnual: Number(cuenta.isrAnual)  || 0,
    isrSobre: cuenta.isrSobre === ISR_INTERES ? ISR_INTERES : ISR_CAPITAL,
    baseIsr:  Number(cuenta.baseIsr)   || BASE_ANUAL_DEFAULT,
  };
}

// ── Composición ───────────────────────────────────────────────────────────────

/** Interés bruto de un solo día, según el modo de aplicación de los tramos. */
export function interesDiario(saldo, cfg) {
  const s = Number(saldo) || 0;
  if (s <= 0) return 0;

  if (cfg.modo === MODO_UNICO) {
    const i = tramoActivo(cfg.tramos, s);
    return i < 0 ? 0 : s * (cfg.tramos[i].tasa / 100) / cfg.base;
  }

  let interes = 0;
  for (const t of cfg.tramos) {
    if (s <= t.desde) break;
    const tope    = t.hasta == null ? s : Math.min(s, t.hasta);
    const porcion = tope - t.desde;
    if (porcion > 0) interes += porcion * (t.tasa / 100) / cfg.base;
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
 * Capitaliza un saldo día a día, descontando la retención antes de reinvertir
 * (lo que se capitaliza es el interés neto).
 * @returns {{saldoFinal:number, rendimiento:number, bruto:number, isr:number, dias:number}}
 */
export function componer(saldoInicial, dias, cfg) {
  const inicial = Number(saldoInicial) || 0;
  const n = Math.max(0, Math.min(Math.floor(Number(dias) || 0), MAX_DIAS));
  let saldo = inicial, bruto = 0, isr = 0;
  for (let i = 0; i < n; i++) {
    const b = interesDiario(saldo, cfg);
    const r = isrDiario(saldo, cfg, b);
    bruto += b;
    isr   += r;
    saldo = Math.max(0, saldo + b - r);
  }
  return { saldoFinal: saldo, rendimiento: saldo - inicial, bruto, isr, dias: n };
}

/** Tasa anual bruta ponderada que corresponde a un saldo dado (%). */
export function tasaNominal(saldo, cfg) {
  const s = Number(saldo) || 0;
  if (s <= 0) return 0;
  return (interesDiario(s, cfg) * cfg.base / s) * 100;
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

/** Saldo proyectado a una fecha; `null` si es anterior al primer punto observado. */
export function saldoEnFecha(timeline, fecha, cfg) {
  const dia = isoDay(fecha);
  let punto = null;
  for (const p of timeline) {
    if (p.fecha <= dia) punto = p;
    else break;
  }
  if (!punto) return null;
  return componer(punto.monto, diasEntre(punto.fecha, dia), cfg).saldoFinal;
}

/**
 * Rendimiento generado entre dos fechas, atravesando las actualizaciones de
 * saldo del periodo. Las aportaciones/retiros se separan del rendimiento.
 *
 * Si `fInicio` es anterior al primer punto observado se recorta a esa fecha y
 * se marca `recortado: true` — no hay dato del que partir antes de eso.
 *
 * @returns {{rendimiento, bruto, isr, saldoInicial, saldoFinal, aportaciones, desde, hasta, dias, recortado}|null}
 */
export function rendimientoEntre(timeline, fInicio, fFin, cfg) {
  if (!timeline.length) return null;
  const ini = isoDay(fInicio), fin = isoDay(fFin);
  if (!ini || !fin || diasEntre(ini, fin) < 0) return null;

  const primera = timeline[0].fecha;
  if (diasEntre(primera, fin) < 0) return null; // todo el rango es previo al primer dato
  const desde = ini < primera ? primera : ini;

  const saldoInicial = saldoEnFecha(timeline, desde, cfg);
  if (saldoInicial == null) return null;

  const cortes = [
    desde,
    ...timeline.filter(p => p.fecha > desde && p.fecha < fin).map(p => p.fecha),
    fin,
  ];

  let saldo = saldoInicial, rendimiento = 0, aportaciones = 0, bruto = 0, isr = 0;
  for (let i = 0; i < cortes.length - 1; i++) {
    if (i > 0) {
      const punto = timeline.find(p => p.fecha === cortes[i]);
      if (punto) { aportaciones += punto.monto - saldo; saldo = punto.monto; }
    }
    const paso = componer(saldo, diasEntre(cortes[i], cortes[i + 1]), cfg);
    rendimiento += paso.rendimiento;
    bruto       += paso.bruto;
    isr         += paso.isr;
    saldo = paso.saldoFinal;
  }

  return {
    rendimiento, bruto, isr, saldoInicial, saldoFinal: saldo, aportaciones,
    desde, hasta: fin, dias: diasEntre(desde, fin), recortado: desde !== ini,
  };
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
  const capital  = Number(cuenta.montoInvertido) || 0;

  const fechaBase = timeline.length ? timeline[timeline.length - 1].fecha : hoy;
  const dias      = Math.max(0, diasEntre(fechaBase, hoy));

  const hastaHoy    = componer(capital, dias, cfg);
  const saldoActual = hastaHoy.saldoFinal;

  const diarioBruto = interesDiario(saldoActual, cfg);
  const isrDia      = isrDiario(saldoActual, cfg, diarioBruto);
  const proyMensual = componer(saldoActual, 30,  cfg);
  const proyAnual   = componer(saldoActual, 365, cfg);
  // GAT Nominal: como lo publican las instituciones — ANTES de impuestos y con
  // tantas capitalizaciones como días tenga la base del producto, no 365 reales.
  // Revolut MX (base 360): 15% → 16.18%, 7% → 7.25%, 7.50% → 7.79%.
  const proyBruta = componer(saldoActual, cfg.base, { ...cfg, isrAnual: 0 });

  // Acumulado desde el primer saldo observado, descontando aportaciones
  const historico = timeline.length
    ? rendimientoEntre(timeline, timeline[0].fecha, hoy, cfg)
    : null;

  // Rendimiento obtenido: captura real del usuario (ej. estado de cuenta) +
  // lo generado desde esa fecha hasta hoy. Sin captura, equivale exactamente
  // a proyectar el capital (mismo resultado que antes de este campo).
  const rendimientoObtenido = Number(cuenta.rendimientoObtenido) || 0;
  const fechaRendimiento    = isoDay(cuenta.fechaActualizacionRendimiento) || fechaBase;
  const diasRendimiento     = Math.max(0, diasEntre(fechaRendimiento, hoy));
  const proyRendimiento     = timeline.length ? rendimientoEntre(timeline, fechaRendimiento, hoy, cfg) : null;
  const rendimientoHastaHoy = rendimientoObtenido + (proyRendimiento ? proyRendimiento.rendimiento : hastaHoy.rendimiento);

  return {
    ...cfg, timeline, fechaBase, dias,
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
