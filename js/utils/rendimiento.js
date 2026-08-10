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
 * Calendario de abono
 * ───────────────────
 * Devengar y abonar no son lo mismo, aunque en la mayoría de las cuentas
 * coincidan. El dinero TRABAJA todos los días naturales; lo que cambia entre
 * instituciones es cuándo el interés ganado se acredita al saldo — y hasta que
 * no se acredita, no compone.
 *
 *   `natural` (default)  Devenga y abona todos los días. Es como operan las
 *                        fintech (Revolut, Nu, Mercado Pago) y es idéntico,
 *                        peso a peso, al comportamiento previo a este campo.
 *
 *   `habilAcumula`       Devenga todos los días, pero solo mueve dinero en días
 *                        hábiles: lo generado en fin de semana o festivo se
 *                        guarda y se abona junto el siguiente día hábil.
 *
 *   `habilSolo`          Ni siquiera devenga en día inhábil. Es como operan los
 *                        fondos de inversión, que solo tienen precio los días
 *                        que abre el mercado.
 *
 * La regla que ordena todo es una sola:
 *
 *   fecha de abono del devengo del día D = siguiente día hábil desde D
 *
 * Va sobre el propio día D, no sobre D+1, porque así es como la app presenta el
 * dato en todos lados: el renglón de `historialDiario` de un día es lo que la
 * institución movió ESE día (de ahí el corte de las 7am de `hoyISO`, que espera
 * a que la madrugada haya abonado antes de contar el día como propio). Bajo esa
 * convención, un sábado tiene que mostrar $0 de abono y el lunes el acumulado
 * del puente — que es literalmente lo que se ve en la app del banco.
 *
 * Lo devengado y todavía no acreditado vive en `pendiente`, fuera del saldo, que
 * es exactamente donde lo tiene la institución. Por eso el saldo proyectado de
 * un domingo vuelve a coincidir con el del estado de cuenta, en vez de ir
 * inflándose cada fin de semana y dejar un residuo espurio al conciliar.
 *
 * Distinguir `habilAcumula` de `habilSolo` importa porque el costo de
 * confundirlas es de órdenes distintos: la primera solo retrasa la composición
 * un par de días (centavos al año), la segunda quita ~110 días de devengo.
 *
 * Qué días son inhábiles sale de `registrarInhabiles()` — los fines de semana
 * son gratis y los festivos vienen de la colección `festivosMX`, la misma que
 * ya usa el ciclo de las tarjetas. Sin festivos registrados el cálculo degrada
 * a solo fines de semana, que es la mayor parte del efecto.
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

/** Qué días devenga y qué días abona la cuenta. Ver la nota de calendario arriba. */
export const ABONO_NATURAL      = 'natural';
export const ABONO_HABIL_ACUMULA = 'habilAcumula';
export const ABONO_HABIL_SOLO    = 'habilSolo';

/** Por qué cambió el saldo. Ver la nota de eventos en la cabecera. */
export const EVENTO_ANCLA      = 'ancla';
export const EVENTO_MOVIMIENTO = 'movimiento';
export const EVENTO_AJUSTE     = 'ajuste';

/** Dirección de un movimiento de efectivo. */
export const MOV_APORTE = 'aporte';
export const MOV_RETIRO = 'retiro';

/** Diferencia por debajo de la cual dos importes se consideran el mismo. */
const EPS = 0.005; // medio centavo

/** Redondea a centavos. Dinero real nunca tiene fracción de centavo. */
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

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

// ── Días inhábiles ────────────────────────────────────────────────────────────

/**
 * Los festivos son una propiedad del país, no de la cuenta: el mismo calendario
 * aplica a todas y llega de Firestore (`festivosMX`) de forma asíncrona, mientras
 * que las entradas del motor —`resumenCuenta`, `historialDiario`— son síncronas y
 * reciben solo el documento de la cuenta. De ahí este registro de módulo: la app
 * lo llena una vez al cargar la vista y `configCuenta` lo fotografía dentro de la
 * `cfg`, así el cálculo en sí sigue dependiendo únicamente de sus argumentos.
 */
let _inhabiles = new Set();

/**
 * Registra los días festivos que usarán las cuentas con calendario hábil.
 * @param {Array<string|{fecha:string}>} fechas - documentos de `festivosMX` o ISO sueltos
 */
export function registrarInhabiles(fechas) {
  _inhabiles = new Set(
    (Array.isArray(fechas) ? fechas : [])
      .map(f => isoDay(typeof f === 'string' ? f : f?.fecha))
      .filter(Boolean));
  return _inhabiles;
}

/** Los festivos registrados. */
export const inhabilesRegistrados = () => _inhabiles;

/** Si una fecha cae en fin de semana o en un festivo registrado. */
export function esInhabil(fecha, inhabiles = _inhabiles) {
  const iso = isoDay(fecha);
  if (!iso) return false;
  const dow = new Date(utcMs(iso)).getUTCDay();
  return dow === 0 || dow === 6 || !!inhabiles?.has?.(iso);
}

/** Primer día hábil en o después de `fecha`. */
export function siguienteHabil(fecha, inhabiles = _inhabiles) {
  let f = isoDay(fecha);
  // Un puente jamás llega a 10 días; el tope solo evita un bucle infinito si
  // alguien registrara medio calendario como festivo.
  for (let i = 0; i < 10 && esInhabil(f, inhabiles); i++) f = sumarDias(f, 1);
  return f;
}

/**
 * Cuándo se acredita el interés devengado el día `fecha`: ese mismo día si la
 * institución opera, y si no, el siguiente hábil. Ver la nota de calendario.
 */
export function fechaAbono(fecha, cfg) {
  const dia = isoDay(fecha);
  return cfg?.abonaSoloHabil ? siguienteHabil(dia, cfg.inhabiles) : dia;
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

// ── Vigencias de tasa ─────────────────────────────────────────────────────────

/**
 * Las instituciones cambian la tasa que publican de vez en cuando, y el saldo
 * que ya estaba invertido siguió ganando la tasa VIEJA hasta el día del
 * cambio — recalcular todo el historial con la tasa nueva falsearía lo
 * ganado antes del cambio. Por eso una cuenta no tiene una sola tasa: tiene
 * una línea de tiempo de vigencias, cada una con sus propios tramos.
 *
 * `tramos`/`modoTramos`/`modoTasa` en la raíz de la cuenta son la vigencia
 * ACTUAL — mismo patrón que `montoInvertido`/`fechaActualizacion` para el
 * saldo — y `tasaDesde` es desde cuándo aplica. Las vigencias superadas viven
 * en `historialTasas`, cada una con su propio `desde`.
 *
 * `desde: null` significa "vigente desde el origen de la cuenta" — así se
 * comportan todas las cuentas que nunca registraron un cambio de tasa, y así
 * queda la vigencia más antigua de cualquier cuenta que sí los registra.
 *
 * @param {object} cuenta
 * @returns {Array<{desde:string|null, tramos:Array, modo:string, modoTasa:string}>} ascendente
 */
export function vigenciasTasa(cuenta = {}) {
  const normaliza = v => ({
    desde:    v.desde == null ? null : isoDay(v.desde),
    tramos:   normalizarTramos(v.tramos),
    modo:     v.modoTramos === MODO_UNICO ? MODO_UNICO : MODO_PROGRESIVO,
    modoTasa: v.modoTasa === TASA_EFECTIVA ? TASA_EFECTIVA : TASA_NOMINAL,
  });

  const pasadas = (Array.isArray(cuenta.historialTasas) ? cuenta.historialTasas : [])
    .filter(Boolean)
    .map(normaliza);

  const actual = normaliza({
    desde: cuenta.tasaDesde ?? null,
    tramos: cuenta.tramos, modoTramos: cuenta.modoTramos, modoTasa: cuenta.modoTasa,
  });

  return [...pasadas, actual].sort((a, b) => (a.desde ?? '').localeCompare(b.desde ?? ''));
}

/**
 * La vigencia que aplica en una fecha: la de `desde` más reciente que no sea
 * posterior a ella. Una fecha anterior a toda vigencia con `desde` explícito
 * cae en la primera (que es la que tiene `desde: null`, si la cuenta está bien
 * formada) — no puede quedar sin ninguna.
 */
export function vigenciaEnFecha(vigencias, fecha) {
  const dia = isoDay(fecha);
  let v = vigencias[0];
  for (const x of vigencias) {
    if (x.desde == null || (dia && x.desde <= dia)) v = x; else break;
  }
  return v;
}

// ── Configuración de cálculo ──────────────────────────────────────────────────

/**
 * Traduce un documento de `inversiones` a la configuración que consumen las
 * funciones de cálculo. Todas ellas reciben este objeto en lugar de una lista
 * larga de parámetros posicionales.
 *
 * `inhabiles` se fotografía aquí (por defecto, del registro de módulo) para que
 * las funciones de cálculo no lean nada de fuera de su `cfg`.
 *
 * @param {object} cuenta
 * @param {Set<string>|Array} [inhabiles] - festivos a usar; default, los registrados
 * @returns {{tramos:Array, modo:string, base:number, isrAnual:number, baseIsr:number}}
 */
export function configCuenta(cuenta = {}, inhabiles) {
  const abono = cuenta.calendarioAbono === ABONO_HABIL_ACUMULA ? ABONO_HABIL_ACUMULA
              : cuenta.calendarioAbono === ABONO_HABIL_SOLO    ? ABONO_HABIL_SOLO
              : ABONO_NATURAL;
  return {
    abono,
    // Derivadas del modo para que el bucle diario no vuelva a compararlo cada día
    devengaInhabil: abono !== ABONO_HABIL_SOLO,
    abonaSoloHabil: abono !== ABONO_NATURAL,
    inhabiles: inhabiles instanceof Set ? inhabiles
             : Array.isArray(inhabiles)
               ? new Set(inhabiles.map(f => isoDay(typeof f === 'string' ? f : f?.fecha)).filter(Boolean))
               : _inhabiles,
    // tramos/modo/modoTasa son la vigencia ACTUAL — lo que muestra toda la UI
    // que no depende de una fecha (tarjeta, desglose de hoy, GAT). `vigencias`
    // es la línea de tiempo completa; solo el compuesto diario la consulta,
    // para usar la tasa que corresponda a cada día en vez de la de hoy.
    tramos:   normalizarTramos(cuenta.tramos),
    modo:     cuenta.modoTramos === MODO_UNICO ? MODO_UNICO : MODO_PROGRESIVO,
    modoTasa: cuenta.modoTasa === TASA_EFECTIVA ? TASA_EFECTIVA : TASA_NOMINAL,
    vigencias: vigenciasTasa(cuenta),
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
    return { bruto: r2(bruto), isr: r2(isr) };
  }
  return { bruto, isr };
}

/**
 * Un día completo: lo que devenga y si eso se acredita al saldo o engrosa la
 * bolsa de pendientes. Es el único lugar donde el calendario entra al cálculo
 * — y, si la cuenta registró más de una vigencia de tasa, también el único
 * lugar donde se decide cuál tramo/tasa le toca a ESTE día en particular.
 *
 * `fecha` puede omitirse — sin ella no hay calendario que aplicar (el día se
 * resuelve como `natural`) ni vigencia que resolver (se usa la actual,
 * `cfg.tramos`). Es el caso de las proyecciones abstractas ("¿cuánto en 30
 * días?") que no arrancan de una fecha concreta.
 *
 * @returns {{bruto, isr, neto, abonado, pendiente, saldo}} `neto` es lo devengado
 *          hoy; `abonado`, lo que efectivamente entró al saldo (puede incluir
 *          días anteriores); `pendiente` y `saldo`, cómo queda todo al cierre.
 */
function pasoCalendario(saldo, pendiente, cfg, fecha) {
  const conCalendario = !!fecha && (cfg.abonaSoloHabil || !cfg.devengaInhabil);

  // Con una sola vigencia (el caso normal) esto es cfg tal cual — no hay nada
  // que resolver día a día. Con varias, cada día usa la tasa que estaba
  // vigente ESE día, no la de hoy: lo ya ganado con la tasa vieja no se
  // recalcula con la nueva.
  const cfgDia = (fecha && cfg.vigencias?.length > 1)
    ? { ...cfg, ...vigenciaEnFecha(cfg.vigencias, fecha) }
    : cfg;

  const paso = (conCalendario && !cfg.devengaInhabil && esInhabil(fecha, cfg.inhabiles))
    ? { bruto: 0, isr: 0 }
    : pasoDiario(saldo, cfgDia);
  const neto = paso.bruto - paso.isr;

  // En día inhábil la institución no mueve dinero: lo devengado engorda la bolsa
  // y no compone hasta que se acredite. El primer día hábil la vacía junto con
  // lo suyo propio.
  if (conCalendario && cfg.abonaSoloHabil && esInhabil(fecha, cfg.inhabiles)) {
    return { ...paso, neto, abonado: 0, pendiente: pendiente + neto, saldo };
  }

  const abonado = pendiente + neto;
  return { ...paso, neto, abonado, pendiente: 0, saldo: Math.max(0, saldo + abonado) };
}

/**
 * Capitaliza un saldo día a día, descontando la retención antes de reinvertir
 * (lo que se capitaliza es el interés neto).
 *
 * `desde` solo hace falta cuando la cuenta tiene calendario de abono; sin ella
 * se compone como `natural`, que es lo que quieren las proyecciones abstractas.
 *
 * `rendimiento` es lo DEVENGADO en el tramo —incluye lo que quedó pendiente de
 * abono— mientras que `saldoFinal` es lo efectivamente acreditado, que es lo que
 * muestra la institución. En una cuenta `natural` nunca hay pendiente y las dos
 * cifras vuelven a ser la misma resta de siempre.
 *
 * @returns {{saldoFinal, rendimiento, bruto, isr, dias, pendiente, ultimo}}
 */
export function componer(saldoInicial, dias, cfg, desde = null, pendienteInicial = 0) {
  const inicial = Number(saldoInicial) || 0;
  const pend0   = Number(pendienteInicial) || 0;
  const n = Math.max(0, Math.min(Math.floor(Number(dias) || 0), MAX_DIAS));
  let saldo = inicial, pendiente = pend0, bruto = 0, isr = 0, ultimo = null;
  let fecha = desde ? isoDay(desde) : null;
  for (let i = 0; i < n; i++) {
    const p = pasoCalendario(saldo, pendiente, cfg, fecha);
    bruto += p.bruto;
    isr   += p.isr;
    ultimo = { bruto: p.bruto, isr: p.isr, neto: p.neto, abonado: p.abonado };
    saldo     = p.saldo;
    pendiente = p.pendiente;
    if (fecha) fecha = sumarDias(fecha, 1);
  }
  // `ultimo` es el último día compuesto — sirve para reportar "ayer" sin recorrer de nuevo
  return {
    saldoFinal: saldo,
    rendimiento: (saldo + pendiente) - (inicial + pend0),
    bruto, isr, dias: n, pendiente, ultimo,
  };
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
 *
 * `pendienteInicial` es el interés ya devengado y todavía sin abonar al arrancar
 * (ver el calendario de abono). Quien encadena tramos —`historialDiario`, que
 * llama de a un día— tiene que pasarlo, o el interés del fin de semana se
 * perdería en el corte entre un tramo y el siguiente.
 */
function recorrer(eventos, desde, hasta, saldoInicial, cfg, pendienteInicial = 0) {
  const acc = {
    saldo: Number(saldoInicial) || 0,
    pendiente: Number(pendienteInicial) || 0,
    rendimiento: 0, bruto: 0, isr: 0,
    movimientos: 0, ajustes: 0, residuo: 0,
    ultimo: null,
  };
  let cursor = desde;

  // `cursor` es el CIERRE del día ya resuelto, así que el primer día que este
  // tramo devenga es el siguiente — de ahí el +1 en la fecha que se le pasa a
  // `componer`. Pasarle `cursor` a secas corría el calendario un día entero.
  const avanzar = fin => {
    const paso = componer(acc.saldo, diasEntre(cursor, fin), cfg, sumarDias(cursor, 1), acc.pendiente);
    acc.rendimiento += paso.rendimiento;
    acc.bruto       += paso.bruto;
    acc.isr         += paso.isr;
    acc.saldo        = paso.saldoFinal;
    acc.pendiente    = paso.pendiente;
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
    const dia = sumarDias(cursor, 1);
    const p = pasoCalendario(acc.saldo, acc.pendiente, cfg, dia);
    acc.bruto       += p.bruto;
    acc.isr         += p.isr;
    acc.rendimiento += p.neto;
    acc.ultimo       = { bruto: p.bruto, isr: p.isr, neto: p.neto, abonado: p.abonado };
    acc.saldo        = p.saldo;
    acc.pendiente    = p.pendiente;
    cursor = dia;
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

/**
 * Igual que `recorrer()`, pero para cuando `desde` es una fecha de CAPTURA
 * (una ancla, o cualquier saldo que se conoce con certeza a esa fecha) —
 * compone primero el propio día de la captura antes de recorrer lo demás.
 *
 * `recorrer()` a solas trata `saldoInicial` como ya vigente al CIERRE de
 * `desde` (así lo dice su docstring), pero `saldoEnFecha()` — y por lo tanto
 * `historialDiario()`, que arranca su primer renglón ahí — lo trata como el
 * saldo al INICIO de `desde`, todavía sin su propio día de interés. Un
 * recorrer(desde,hasta,...) de un solo tramo llamado directo sobre una
 * captura queda entonces un día de interés por debajo de lo que muestra el
 * historial. Ver DOCUMENTACION.md § Cálculo de Rendimientos.
 *
 * Solo se usa donde `desde` es sin duda una captura (`resumenCuenta`) — NO
 * reemplaza a `recorrer()`/`rendimientoEntre()` en general: "Calcular
 * periodo" y el reporte Excel aceptan fechas arbitrarias elegidas por el
 * usuario que no son necesariamente una captura, y ahí no se verificó si
 * aplica la misma corrección.
 */
function recorrerDesdeCaptura(eventos, desde, hasta, saldoCapturado, cfg, pendienteInicial = 0) {
  const p     = pasoCalendario(saldoCapturado, Number(pendienteInicial) || 0, cfg, desde);
  const resto = recorrer(eventos, desde, hasta, p.saldo, cfg, p.pendiente);
  const { bruto, isr, neto } = p;
  return {
    ...resto,
    bruto:        resto.bruto + bruto,
    isr:          resto.isr + isr,
    rendimiento:  resto.rendimiento + neto,
    aportaciones: resto.movimientos + resto.residuo,
    dias:         diasEntre(desde, hasta),
    // Si nada compuso después (ej. `desde === hasta`), el propio día de la
    // captura ES el último — igual que el primer renglón de historialDiario.
    ultimo:       resto.ultimo || { bruto, isr, neto, abonado: p.abonado },
  };
}

/**
 * Saldo acreditado y devengo pendiente de abono al cierre de una fecha.
 * `null` si es anterior a la primera ancla.
 * @returns {{saldo:number, pendiente:number}|null}
 */
export function estadoEnFecha(eventos, fecha, cfg) {
  const evs = ordenarEventos(eventos);
  const dia = isoDay(fecha);
  let ancla = null;
  for (const e of evs) {
    if (e.tipo !== EVENTO_ANCLA) continue;
    if (e.fecha <= dia) ancla = e; else break;
  }
  if (!ancla) return null;
  const t = recorrer(evs, ancla.fecha, dia, ancla.monto, cfg);
  return { saldo: t.saldo, pendiente: t.pendiente };
}

/** Saldo proyectado al cierre de una fecha; `null` si es anterior a la primera ancla. */
export function saldoEnFecha(eventos, fecha, cfg) {
  return estadoEnFecha(eventos, fecha, cfg)?.saldo ?? null;
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

  const desde  = ini < primera ? primera : ini;
  const estado = estadoEnFecha(evs, desde, cfg);
  if (estado == null) return null;
  const saldoInicial = estado.saldo;

  const t = recorrer(evs, desde, fin, saldoInicial, cfg, estado.pendiente);

  return {
    rendimiento: t.rendimiento, bruto: t.bruto, isr: t.isr,
    saldoInicial, saldoFinal: t.saldo, pendiente: t.pendiente,
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
 * El saldo esperado NO incluye lo devengado y todavía sin abonar (`pendiente`):
 * la institución tampoco lo tiene en el saldo, así que sumarlo generaría un
 * residuo negativo cada fin de semana en las cuentas con calendario hábil.
 *
 * @returns {{desde, hasta, dias, saldoAnterior, rendimientoProyectado, movimientos,
 *            ajustes, saldoEsperado, saldoReal, residuo, pendiente, derivaAnual, cuadra}|null}
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
    pendiente: t.pendiente,
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
 * En una cuenta con calendario de abono, `neto` sigue siendo lo que ese día
 * DEVENGÓ, y `abonado` es lo que de verdad entró al saldo — cero en fin de
 * semana, y el acumulado de todo el puente el día que abre. La bolsa se encadena
 * de un renglón al siguiente (`cierrePendiente`): sin eso, cada tramo de un día
 * arrancaría en cero y el interés del sábado se perdería en el corte.
 *
 * `saldoFinal` se encadena sumando `abonado` (y `pendiente`) ya redondeados a
 * centavos, no el float exacto que produce el motor internamente — dinero real
 * nunca tiene fracción de centavo, así que sumar lo que la tabla ya muestra
 * (redondeado) debe dar exactamente el saldo que la tabla muestra. `bruto`,
 * `isr` y `neto` sí quedan exactos: son la fórmula, útiles para el detalle
 * auditable ("(exacto)" del reporte), no dinero que ya se movió.
 *
 * @param {object} cuenta
 * @param {string} [hoy]
 * @param {number} [maxDias] - tope de renglones devueltos
 * @param {object} [cfg] - configuración ya resuelta, para no rehacerla en cada llamada
 * @returns {Array<{fecha, saldoInicial, bruto, isr, neto, abonado, pendiente,
 *                  saldoFinal, movimiento, ajuste}>} ascendente
 */
export function historialDiario(cuenta, hoy = hoyISO(), maxDias = 400, cfg = configCuenta(cuenta)) {
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
  const arranque  = saltados > 0
    ? recorrer(eventos, primero.fecha, cierreFecha, primero.monto, cfg)
    : { saldo: primero.monto, pendiente: 0 };
  // El saldo (dinero que ya se movió) arranca cents-precise, mismo motivo que
  // el saldoFinal del bucle. La bolsa pendiente NO: todavía no es dinero
  // acreditado, así que se redondea recién cuando se abona — redondearla en
  // cada tramo compondría el error una vez por día en vez de una sola vez.
  let cierreSaldo          = r2(arranque.saldo);
  let cierrePendienteExacta = Number(arranque.pendiente) || 0;

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
    let fecha, bruto, isr, saldoFinal, pendiente, abonado, movimiento = 0, ajuste = 0;

    if (i === 0) {
      // El primer renglón mostrado —sea el día de la primerísima ancla, o el
      // borde donde arranca un recorte por `maxDias`— parte de un saldo que ya
      // es "inicio de ese día", así que compone directo sobre `cierreFecha` en
      // vez de sumarle un día: si también le sumara uno, todo el recorte
      // quedaría corrido una fecha de más (el bug que esto reemplaza).
      fecha = cierreFecha;
      const p = pasoCalendario(cierreSaldo, cierrePendienteExacta, cfg, fecha);
      bruto = p.bruto; isr = p.isr;
      abonado = r2(p.abonado);
      saldoFinal = r2(p.saldo);
      pendiente = r2(p.pendiente);           // solo para mostrar
      cierrePendienteExacta = p.pendiente;   // lo que se encadena, sin redondear
    } else {
      fecha = sumarDias(cierreFecha, 1);
      const paso = recorrer(eventos, cierreFecha, fecha, cierreSaldo, cfg, cierrePendienteExacta);
      bruto = paso.bruto; isr = paso.isr;
      // `recorrer` ya sabe manejar ancla (resetea), movimiento y ajuste
      // (suman) — no se reconstruye a mano; solo se redondea su resultado.
      // Como `cierreSaldo` que recibió ya venía cents-precise, lo único que
      // puede traer fracción de centavo es el interés del propio día.
      abonado    = paso.ultimo ? r2(paso.ultimo.abonado) : 0;
      saldoFinal = r2(paso.saldo);
      pendiente  = r2(paso.pendiente);         // solo para mostrar
      cierrePendienteExacta = paso.pendiente;  // lo que se encadena, sin redondear
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
        abonado, pendiente, saldoFinal, movimiento, ajuste,
      });
    }
    cierreFecha = fecha;
    cierreSaldo = saldoFinal;
    // cierrePendienteExacta ya se actualizó arriba, sin redondear
  }
  return out;
}

/**
 * Pliega los días inhábiles de un `historialDiario` sobre el día que los abona.
 *
 * En una cuenta que solo mueve dinero en días hábiles, un sábado no tiene nada
 * que contar: su saldo es el del viernes y su interés todavía no se acreditó.
 * Como renglón propio solo estorba — parte el rendimiento del puente en tres
 * cifras que además no se pueden corregir por separado, porque la institución
 * reporta UN abono el lunes. Aquí desaparecen y su interés viaja al día que sí
 * lo abona, junto con el detalle de qué días lo componen.
 *
 * Un día inhábil con un movimiento o un ajuste sí se conserva: eso no es
 * interés y no se puede plegar en otro renglón sin perderlo de vista. Su
 * interés, en cambio, viaja igual al día del abono, y por eso el renglón queda
 * con `bruto`/`isr` en cero — que es exactamente lo que la institución movió
 * ese día en concepto de rendimiento.
 *
 * Invariante: la suma de `abonado` sobre las filas devueltas más lo que quede
 * en `pendientes` es igual al devengo total de la tabla original. No se pierde
 * ni se duplica un centavo — está probado.
 *
 * @param {Array} filas - ascendentes, tal como las devuelve `historialDiario`
 * @param {object} cfg  - de `configCuenta`; sin calendario devuelve las filas tal cual
 * @returns {{filas:Array, pendientes:Array}} cada fila gana `acumulados` (los
 *          días plegados en ella); `pendientes` son los devengados que al cierre
 *          de la tabla todavía no tienen día de abono.
 */
export function plegarDiasInhabiles(filas, cfg) {
  const src = Array.isArray(filas) ? filas : [];
  if (!cfg?.abonaSoloHabil) return { filas: src, pendientes: [] };

  const out = [];
  let bolsa = [];   // inhábiles esperando el día que los acredite

  src.forEach(f => {
    if (esInhabil(f.fecha, cfg.inhabiles)) {
      bolsa.push(f);
      if (f.movimiento || f.ajuste) out.push({ ...f, bruto: 0, isr: 0, acumulados: [] });
      return;
    }
    out.push({
      ...f,
      bruto:      bolsa.reduce((s, b) => s + b.bruto, f.bruto),
      isr:        bolsa.reduce((s, b) => s + b.isr,   f.isr),
      acumulados: bolsa,
    });
    bolsa = [];
  });

  return { filas: out, pendientes: bolsa };
}

// ── Resumen de una cuenta ─────────────────────────────────────────────────────

/**
 * Todos los indicadores de una cuenta a una fecha dada.
 *
 * El saldo actual se obtiene proyectando `montoInvertido` desde su
 * `fechaActualizacion` hasta hoy; los rendimientos diario / mensual / anual se
 * calculan sobre ese saldo ya actualizado y se reportan **netos** de ISR.
 *
 * `saldoActual` es lo ACREDITADO — sin lo que la cuenta ya devengó pero todavía
 * no abona (`pendiente`), que es justo el criterio con el que la institución
 * muestra el saldo. Las proyecciones arrancan en `hoy` para que el calendario de
 * abono cuente: con `habilSolo`, el anual y el GAT bajan de verdad.
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

  // El saldo/rendimiento "hasta hoy" sale de la MISMA tabla día-por-día que ve
  // el usuario en el historial (historialDiario), no de un recorrer() aparte
  // de un solo tramo: un recorrer(fechaBase,hoy,...) ancho y la cadena de
  // recorrer() de un día a la vez de historialDiario NO dan siempre el mismo
  // resultado en cuanto hay un movimiento de por medio — el paso `unDia()`
  // que le da al movimiento su propio día sobre el saldo viejo termina en una
  // posición distinta del calendario según qué tan lejos esté `hasta`
  // (verificado con datos sintéticos). Reusar historialDiario evita mantener
  // dos caminos que se desincronizan; el costo es recorrer la cuenta entera
  // en cada resumen (~35ms hasta para una cuenta de 10+ años, aceptable para
  // el puñado de cuentas de esta app). Se le pasa MAX_DIAS explícito: el
  // default de historialDiario (400 días) recortaría cuentas viejas y
  // dispararía el bug de recorte documentado en DOCUMENTACION.md — aquí no
  // hace falta el límite, que existe solo para no pintar una tabla gigante.
  const filasHastaHoy = timeline.length ? historialDiario(cuenta, hoy, MAX_DIAS, cfg) : [];
  const filaHoy        = filasHastaHoy[filasHastaHoy.length - 1] || null;
  const saldoActual    = filaHoy ? filaHoy.saldoFinal : capital;
  const pendiente      = filaHoy ? (filaHoy.pendiente || 0) : 0;
  const brutoHastaHoy  = filasHastaHoy.reduce((s, f) => s + f.bruto, 0);
  const isrHastaHoy    = filasHastaHoy.reduce((s, f) => s + f.isr,   0);
  // Suma lo ABONADO (ya redondeado a centavos y encadenado), no el `neto`
  // exacto: es el mismo criterio con el que se arma `saldoFinal` y con el que
  // suma la tabla del historial — deben coincidir centavo a centavo.
  const rendimientoDesdeBase = filasHastaHoy.reduce((s, f) => s + f.abonado + (f.ajuste || 0), 0);

  // El devengo del día se calcula sobre el saldo acreditado, no sobre el saldo
  // más lo pendiente: hasta que la institución no lo abona, no genera interés.
  const { bruto: diarioBruto, isr: isrDia } = cfg.devengaInhabil || !esInhabil(hoy, cfg.inhabiles)
    ? pasoDiario(saldoActual, cfg)
    : { bruto: 0, isr: 0 };
  // Las proyecciones arrancan mañana: `saldoActual` ya es el cierre de `hoy`.
  const manana      = sumarDias(hoy, 1);
  const proyMensual = componer(saldoActual, 30,  cfg, manana, pendiente);
  const proyAnual   = componer(saldoActual, 365, cfg, manana, pendiente);
  // GAT Nominal: como lo publican las instituciones — ANTES de impuestos y con
  // tantas capitalizaciones como días tenga la base del producto, no 365 reales.
  // Revolut MX (base 360): 15% → 16.18%, 7% → 7.25%, 7.50% → 7.79%.
  const proyBruta = componer(saldoActual, cfg.base, { ...cfg, isrAnual: 0 }, manana);

  // Acumulado desde el primer saldo observado, descontando aportaciones —
  // timeline[0] también es una captura, mismo motivo que fechaBase arriba.
  const historico = timeline.length
    ? recorrerDesdeCaptura(eventos, timeline[0].fecha, hoy, timeline[0].monto, cfg)
    : null;

  // Rendimiento obtenido: captura real del usuario (ej. estado de cuenta) +
  // lo generado desde esa fecha hasta hoy. Sin captura, usa `rendimientoDesdeBase`
  // (la misma tabla día-por-día del historial) tal cual.
  const rendimientoObtenido = Number(cuenta.rendimientoObtenido) || 0;
  const tieneCaptura        = !!isoDay(cuenta.fechaActualizacionRendimiento);
  const fechaRendimiento    = isoDay(cuenta.fechaActualizacionRendimiento) || fechaBase;
  const diasRendimiento     = Math.max(0, diasEntre(fechaRendimiento, hoy));
  // También una captura: `fechaActualizacionRendimiento` es "la última cifra
  // real capturada" (ver docstring de rendimientoObtenido más abajo), así que
  // el saldo que la acompaña sale de saldoEnFecha (saldo al INICIO de esa
  // fecha) y se le aplica la misma corrección de recorrerDesdeCaptura. Sin
  // captura NO hay que pasar por aquí: `recorrerDesdeCaptura` recorre el
  // periodo en un solo tramo con `recorrer()`, que da un resultado distinto
  // de la cadena día-por-día de `historialDiario` en cuanto hay un movimiento
  // de por medio (mismo motivo documentado arriba, en `filasHastaHoy`) — sin
  // esta condición, toda cuenta con un aporte/retiro mostraba en la tarjeta
  // un total distinto al de su propia tabla de historial.
  const estadoRendimiento = tieneCaptura ? estadoEnFecha(eventos, fechaRendimiento, cfg) : null;
  const proyRendimiento   = estadoRendimiento
    ? recorrerDesdeCaptura(eventos, fechaRendimiento, hoy, estadoRendimiento.saldo, cfg,
                           estadoRendimiento.pendiente)
    : null;
  const rendimientoHastaHoy = rendimientoObtenido + (proyRendimiento ? proyRendimiento.rendimiento : rendimientoDesdeBase);

  return {
    ...cfg, timeline, eventos, fechaBase, dias,
    capital,
    saldoActual,
    // Devengado y todavía sin abonar, con la fecha en que la institución lo
    // acredita. En una cuenta `natural` siempre es 0 y `proximoAbono` es mañana.
    pendiente,
    proximoAbono: fechaAbono(hoy, cfg),
    rendimientoObtenido, fechaRendimiento, diasRendimiento,
    rendimientoHastaHoy,
    brutoHastaHoy, isrHastaHoy,
    rendimientoHistorico: historico ? historico.rendimiento : rendimientoDesdeBase,
    aportacionesHistoricas: historico ? historico.aportaciones : 0,
    diasHistoricos: historico ? historico.dias : dias,
    // Los montos mostrados son netos: es lo que realmente se abona y se capitaliza
    diario:  diarioBruto - isrDia,
    mensual: proyMensual.rendimiento,
    anual:   proyAnual.rendimiento,
    diarioBruto, isrDiario: isrDia,
    // Lo generado el día consultado (`hoy` ya trae el corte de las 7am CDMX
    // aplicado) — es lo que la institución abonó esa madrugada. Viene del
    // mismo renglón que pinta el historial (neto + ajuste de ese día), así
    // nunca puede desalinearse de lo que ahí se ve.
    ayer: filaHoy ? filaHoy.neto + (filaHoy.ajuste || 0) : 0,
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
    diario: 0, mensual: 0, anual: 0, isrHastaHoy: 0, pendiente: 0,
    cuentas: resumenes.length,
  };
  resumenes.forEach(r => {
    t.capital              += r.capital;
    t.saldoActual          += r.saldoActual;
    t.pendiente            += r.pendiente || 0;
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
