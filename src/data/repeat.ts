/**
 * Las tareas recurrentes.
 *
 * El spec dejaba esto fuera de la v1 (§1) por una razón buena: una regla de repetición mal
 * pensada es una fuente infinita de tareas que nadie pidió. Así que lo que hay aquí es
 * deliberadamente pequeño y del todo predecible — cuatro periodicidades, un intervalo, y una
 * sola decisión más: desde dónde se cuenta.
 *
 * ```
 * diario:2            cada 2 días
 * semanal:1:1,3,5     cada semana los lunes, miércoles y viernes
 * semanal:2:2         cada 2 semanas los martes
 * mensual:1:17        cada mes el día 17
 * mensual:3:ultimo    cada 3 meses el último día
 * anual:1             cada año, el día que diga la fecha
 * ```
 *
 * Se guarda como texto y no como columnas porque es un valor y no una relación: nada lo
 * consulta, nada lo agrupa, y así el export sigue siendo legible sin una tabla más.
 *
 * Lo que **no** hay, y no es un descuido:
 *
 * - **Fecha de fin y número de repeticiones.** Una tarea que deja de repetirse es una tarea a
 *   la que se le quita la repetición, y eso ya se puede hacer. Guardar «hasta el 12 de marzo»
 *   obligaría a explicar en la lista por qué una tarea dejó de volver sola.
 * - **«El primer lunes de cada mes».** Se lee bien y se configura mal: pide un control con dos
 *   selectores para un caso que en la práctica es el día del mes con otro nombre.
 * - **Anidar la regla en una subtarea.** La instancia siguiente se lleva las subtareas enteras
 *   (§2 sigue mandando: un solo nivel), así que una hija con regla propia repetiría dentro de
 *   algo que ya repite.
 */

import { dayOf, localDay } from "./time";

export type RepeatUnit = "diario" | "semanal" | "mensual" | "anual";

/**
 * Desde dónde se cuenta la siguiente.
 *
 * - `fecha`: desde la que tenía puesta. Pagar impuestos el 17 sigue siendo el 17 aunque se
 *   pague el 19.
 * - `completada`: desde el día en que se marcó. Regar las plantas cada 3 días son 3 días desde
 *   que se regaron, no desde que tocaba.
 *
 * Las dos son necesarias y ninguna sirve para lo de la otra: contar un pago desde que se hizo
 * corre la fecha un poco cada mes hasta que ya no es el día que era, y contar un riego desde
 * la fecha ideal amontona tres riegos vencidos en cuanto te vas una semana.
 */
export type RepeatFrom = "fecha" | "completada";

/** El último día del mes, que no es un número porque cambia de mes a mes. */
export const LAST_DAY = "ultimo";

export type MonthDay = number | typeof LAST_DAY;

export type Repeat =
  | { unit: "diario"; every: number }
  /** `weekdays`: 1 lunes … 7 domingo, ordenados, sin repetidos y nunca vacío. */
  | { unit: "semanal"; every: number; weekdays: number[] }
  | { unit: "mensual"; every: number; day: MonthDay }
  | { unit: "anual"; every: number };

/** Tope del intervalo. No es una restricción técnica: es que «cada 400 meses» no es una tarea. */
export const MAX_EVERY = 99;

// ── Días ───────────────────────────────────────────────────────────────────────────────

const parseDay = (day: string): Date => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
};

/** 1 lunes … 7 domingo. `getDay()` cuenta desde el domingo y en español la semana abre el lunes. */
export const weekdayOf = (day: string): number => ((parseDay(day).getDay() + 6) % 7) + 1;

/** El lunes de la semana de un día. Es el ancla con la que se cuentan las semanas salteadas. */
function mondayOf(day: string): string {
  const base = parseDay(day);
  return localDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() - (weekdayOf(day) - 1)));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Cuántas semanas hay entre dos lunes. Sobre lunes a mediodía: marzo y octubre traen días de
 *  23 y 25 horas, y a las 00:00 un redondeo entero podría caer un día corto. */
function weeksBetween(fromMonday: string, toMonday: string): number {
  const a = parseDay(fromMonday);
  const b = parseDay(toMonday);
  a.setHours(12);
  b.setHours(12);
  return Math.round((b.getTime() - a.getTime()) / WEEK_MS);
}

const shiftDays = (day: string, delta: number): string => {
  const base = parseDay(day);
  return localDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta));
};

const lastOfMonth = (year: number, month: number): number =>
  new Date(year, month + 1, 0).getDate();

/**
 * El mismo día del mes que esté `delta` meses adelante, recortado al último si allí no existe.
 *
 * El recorte no se guarda: el día vive en la regla y no en la fecha, así que un «cada mes el
 * 31» pasa por el 28 de febrero y vuelve al 31 en marzo. Derivarlo de la fecha puesta lo
 * dejaría clavado en 28 para siempre, que es el fallo clásico de este cálculo.
 */
function addMonths(day: string, delta: number, dayOfMonth: MonthDay): string {
  const base = parseDay(day);
  const target = new Date(base.getFullYear(), base.getMonth() + delta, 1);
  const last = lastOfMonth(target.getFullYear(), target.getMonth());
  const wanted = dayOfMonth === LAST_DAY ? last : Math.min(dayOfMonth, last);
  return localDay(new Date(target.getFullYear(), target.getMonth(), wanted));
}

/** El mismo día y mes, `delta` años adelante. Solo recorta el 29 de febrero. */
function addYears(day: string, delta: number): string {
  const base = parseDay(day);
  const year = base.getFullYear() + delta;
  const last = lastOfMonth(year, base.getMonth());
  return localDay(new Date(year, base.getMonth(), Math.min(base.getDate(), last)));
}

// ── Texto ──────────────────────────────────────────────────────────────────────────────

const clampEvery = (value: number): number =>
  Math.min(MAX_EVERY, Math.max(1, Math.trunc(value) || 1));

/** Normaliza el juego de días: ordenado, sin repetidos, dentro de rango y nunca vacío. */
function cleanWeekdays(days: number[], fallback: number): number[] {
  const clean = [...new Set(days.filter((each) => Number.isInteger(each) && each >= 1 && each <= 7))];
  return clean.length ? clean.sort((a, b) => a - b) : [fallback];
}

/**
 * Lee la regla guardada. Devuelve nulo para lo que no case, y eso incluye el nulo de una tarea
 * que no se repite: para quien llama es la misma respuesta —esta tarea no vuelve— y no hay
 * ningún caso en que convenga distinguir «sin regla» de «regla ilegible».
 */
export function parseRepeat(text: string | null | undefined): Repeat | null {
  if (!text) return null;

  const [unit, everyText, rest] = text.split(":");
  const every = clampEvery(Number(everyText));

  switch (unit) {
    case "diario":
      return { unit, every };
    case "semanal": {
      const weekdays = cleanWeekdays((rest ?? "").split(",").map(Number), 1);
      return { unit, every, weekdays };
    }
    case "mensual": {
      if (rest === LAST_DAY) return { unit, every, day: LAST_DAY };
      const day = Number(rest);
      if (!Number.isInteger(day) || day < 1 || day > 31) return null;
      return { unit, every, day };
    }
    case "anual":
      return { unit, every };
    default:
      return null;
  }
}

export function formatRepeat(rule: Repeat | null): string | null {
  if (!rule) return null;
  switch (rule.unit) {
    case "diario":
      return `diario:${rule.every}`;
    case "semanal":
      return `semanal:${rule.every}:${rule.weekdays.join(",")}`;
    case "mensual":
      return `mensual:${rule.every}:${rule.day}`;
    case "anual":
      return `anual:${rule.every}`;
  }
}

/** El valor de `repeat_from` que se puede guardar. Lo que no sea `completada` es `fecha`. */
export const parseRepeatFrom = (value: string | null | undefined): RepeatFrom =>
  value === "completada" ? "completada" : "fecha";

// ── Cómo se dice ───────────────────────────────────────────────────────────────────────

/** Lunes primero, que es como se lee una semana en español. */
export const DIAS_SEMANA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** Las iniciales del selector. La del miércoles es X para no chocar con la del martes. */
export const DIAS_CORTOS = ["L", "M", "X", "J", "V", "S", "D"];

/** «lunes, miércoles y viernes». La `y` del final y no una coma: se lee, no se tabula. */
function joinDays(weekdays: number[]): string {
  const names = weekdays.map((each) => DIAS_SEMANA[each - 1]);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/**
 * La regla en una línea, que es lo que se enseña debajo de los controles.
 *
 * Existe porque una fila de botones dice qué está pulsado pero no qué va a pasar: entre «cada
 * 2» y «semanal» y tres días marcados hay una frase, y esa frase es lo único que se puede leer
 * y desmentir de un vistazo.
 */
export function describeRepeat(rule: Repeat, from: RepeatFrom): string {
  const plural = rule.every > 1;
  let text: string;

  switch (rule.unit) {
    case "diario":
      text = plural ? `Cada ${rule.every} días` : "Cada día";
      break;
    case "semanal":
      text = `${plural ? `Cada ${rule.every} semanas` : "Cada semana"} los ${joinDays(rule.weekdays)}`;
      break;
    case "mensual": {
      const cuando = rule.day === LAST_DAY ? "el último día" : `el día ${rule.day}`;
      text = `${plural ? `Cada ${rule.every} meses` : "Cada mes"} ${cuando}`;
      break;
    }
    case "anual":
      text = plural ? `Cada ${rule.every} años` : "Cada año";
      break;
  }

  // Contando desde la fecha no hace falta decirlo: es lo que cualquiera supone al leer «cada
  // mes el día 17». Lo que cambia el significado es la otra, y esa sí se nombra.
  return from === "completada" ? `${text}, contando desde que se completa` : text;
}

/** La versión corta, para el chip de captura y el rótulo del `↻` de la fila. */
export function shortRepeat(rule: Repeat): string {
  const plural = rule.every > 1;
  switch (rule.unit) {
    case "diario":
      return plural ? `Cada ${rule.every} días` : "Cada día";
    case "semanal":
      return plural ? `Cada ${rule.every} semanas` : "Cada semana";
    case "mensual":
      return plural ? `Cada ${rule.every} meses` : "Cada mes";
    case "anual":
      return plural ? `Cada ${rule.every} años` : "Cada año";
  }
}

// ── La siguiente ───────────────────────────────────────────────────────────────────────

/**
 * La regla con la que nace una repetición recién encendida, sacada de la fecha que la tarea ya
 * tiene. Elegir «semanal» sobre una tarea del martes tiene que marcar el martes, no el lunes.
 */
export function defaultRepeat(unit: RepeatUnit, day: string): Repeat {
  switch (unit) {
    case "diario":
      return { unit, every: 1 };
    case "semanal":
      return { unit, every: 1, weekdays: [weekdayOf(day)] };
    case "mensual":
      return { unit, every: 1, day: Number(day.slice(8, 10)) };
    case "anual":
      return { unit, every: 1 };
  }
}

/**
 * Cuántos saltos se dan como mucho antes de rendirse.
 *
 * Solo hace falta cuando se cuenta desde la fecha y la tarea lleva mucho vencida: un «cada día»
 * abandonado hace tres años pide mil y pico saltos para alcanzar hoy. Con el tope, en vez de
 * colgar la app devuelve nulo y la tarea deja de repetirse — que es raro, visible y arreglable,
 * y no un panel congelado.
 */
const MAX_STEPS = 4000;

/**
 * El día siguiente al que salta la regla desde uno dado. Siempre estrictamente posterior.
 */
function step(rule: Repeat, day: string): string {
  switch (rule.unit) {
    case "diario":
      return shiftDays(day, rule.every);
    case "semanal": {
      // El lunes de la semana del día de partida es el ancla de las semanas salteadas. Se
      // recalcula en cada generación y no se guarda, y sigue saliendo lo mismo: la fecha de la
      // instancia nueva cae siempre en una semana válida, así que su lunes también lo es.
      const base = mondayOf(day);
      for (let ahead = 1; ahead <= rule.every * 7 + 7; ahead++) {
        const candidate = shiftDays(day, ahead);
        if (!rule.weekdays.includes(weekdayOf(candidate))) continue;
        if (weeksBetween(base, mondayOf(candidate)) % rule.every === 0) return candidate;
      }
      // Inalcanzable: con `weekdays` no vacío siempre hay un día bueno dentro de la ventana.
      return shiftDays(day, rule.every * 7);
    }
    case "mensual":
      return addMonths(day, rule.every, rule.day);
    case "anual":
      return addYears(day, rule.every);
  }
}

/**
 * La fecha de la instancia siguiente, o nula si no hay ninguna que valga.
 *
 * Sale con la misma hora que traía: la regla mueve el día, no el «14:30». Y siempre cae
 * después del día en que se completó, aunque la tarea llevara meses vencida — encadenando
 * saltos hasta pasarlo. Sin eso, completar en agosto algo que vencía en mayo produce una tarea
 * nueva que nace vencida, y detrás otra, y otra: la repetición se convierte en una máquina de
 * fabricar retraso.
 */
export function nextDue(
  rule: Repeat,
  dueAt: string,
  from: RepeatFrom,
  completedAt: string,
): string | null {
  const done = dayOf(completedAt);
  const clock = dueAt.slice(10);

  let day = from === "completada" ? done : dayOf(dueAt);

  for (let taken = 0; taken < MAX_STEPS; taken++) {
    day = step(rule, day);
    if (day > done) return `${day}${clock}`;
  }

  return null;
}
