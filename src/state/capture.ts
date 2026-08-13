/**
 * El parser del campo de captura (spec 6). Escrito a mano y no con `chrono-node`: el dominio
 * son seis formas de escribir una fecha en español, y una librería que adivina acierta más
 * casos raros a cambio de que nadie pueda predecir cuándo va a morder un título. Aquí la
 * regla es al revés — si no está en esta lista, es título.
 *
 * Lo que reconoce, y nada más:
 *
 * ```
 * hoy · mañana            → día
 * lun … dom, lunes … domingo → el próximo, nunca hoy
 * 12 ago, 12 agosto       → día y mes, rodando al año que viene si ya pasó
 * 14:30                   → hora (y entonces `has_time`)
 * #proyecto               → proyecto, solo si el nombre está completo
 * ! / !!                  → prioridad media / alta
 * ```
 *
 * Nada de esto se aplica a la fuerza: cada token sale como un chip y quitarlo devuelve su
 * texto literal al título.
 */

import { localDay, nextDay, type NewTask, type Priority, type Project } from "../data";
import { formatDue } from "../ui/dueDate";

export type TokenKind = "dia" | "hora" | "proyecto" | "prioridad";

export interface CaptureToken {
  kind: TokenKind;
  /** El trozo literal del texto que lo produjo. Es lo que vuelve al título al quitar el chip. */
  source: string;
  /** Dónde empieza en el texto crudo. */
  at: number;
  /** Lo que se lee en el chip: la interpretación, no lo tecleado. Un `mañana` que se entendió
   *  mal se ve antes si el chip dice `vie 14` que si repite `mañana`. */
  label: string;
  /** Solo en el chip de proyecto. */
  color?: string;
}

export interface Capture {
  /** El texto sin los tokens aceptados, con los espacios que dejaron ya cerrados. */
  title: string;
  tokens: CaptureToken[];
  /** Solo las claves que el texto determinó de verdad; el resto lo pone la vista en curso. */
  draft: Omit<NewTask, "title">;
}

/**
 * Cómo se recuerda un chip quitado. Por tipo y texto, no por posición: el índice se mueve con
 * cada tecla y el descarte tiene que sobrevivir a que sigas escribiendo delante.
 */
export const dismissKey = (token: CaptureToken) => `${token.kind}:${token.source.toLowerCase()}`;

const DIACRITICOS = /[\u0300-\u036f]/g;

/**
 * Minúsculas y sin acentos, **carácter a carácter**, para que el resultado tenga exactamente
 * la misma longitud que la entrada. Es la condición para poder buscar sobre el texto plegado
 * y luego cortar el original por los mismos índices.
 *
 * Aquí la ñ sí se pliega a n — al revés que en la búsqueda. Buscando, confundirlas haría que
 * `ano` encontrara «año»; escribiendo, `manana` es solo alguien que no puso la tilde.
 */
function fold(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const lower = text[i].toLowerCase();
    const one = lower.length === 1 ? lower : text[i];
    const stripped = one.normalize("NFD").replace(DIACRITICOS, "");
    out += stripped.length === 1 ? stripped : one;
  }
  return out;
}

const SEMANA: Record<string, number> = {
  domingo: 0,
  dom: 0,
  lunes: 1,
  lun: 1,
  martes: 2,
  mar: 2,
  miercoles: 3,
  mie: 3,
  jueves: 4,
  jue: 4,
  viernes: 5,
  vie: 5,
  sabado: 6,
  sab: 6,
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const RE_HORA = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g;
const RE_DIA_MES = /\b(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\b/g;
const RE_RELATIVO = /\b(hoy|manana)\b/g;
const RE_SEMANA = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|lun|mar|mie|jue|vie|sab|dom)\b/g;
/** El `!` tiene que ir suelto: si no, «¡Urgente!» saldría con prioridad media. */
const RE_PRIORIDAD = /(^|\s)(!{1,2})(?=\s|$)/g;

interface Candidate extends CaptureToken {
  end: number;
  /** Lo que este token aporta al borrador si acaba aceptado. */
  apply: (draft: Draft) => void;
}

interface Draft {
  day: string | null;
  time: string | null;
  projectId: string | null;
  priority: Priority | null;
}

const pad = (value: number) => String(value).padStart(2, "0");

const parseDay = (day: string): Date => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
};

/**
 * El próximo día de la semana, **nunca hoy**. Si hoy es lunes y escribes `lun`, quieres el
 * lunes que viene; para hoy ya está `hoy`, que es más corto de escribir.
 */
function nextWeekday(today: string, weekday: number): string {
  const base = parseDay(today);
  const delta = (weekday - base.getDay() + 7) % 7 || 7;
  return localDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta));
}

/**
 * `12 ago`. Si la fecha de este año ya pasó, se va al que viene: una tarea nueva con fecha
 * vencida nace tachada en rojo, y nadie escribe una fecha pasada a propósito.
 *
 * Devuelve nulo si el día no existe en ese mes — `31 feb` no es una fecha, es un título.
 */
function fromDayMonth(today: string, day: number, month: number): string | null {
  const [year] = today.split("-").map(Number);
  const build = (y: number) => {
    const date = new Date(y, month, day);
    return date.getMonth() === month && date.getDate() === day ? localDay(date) : null;
  };

  const thisYear = build(year);
  if (thisYear === null) return null;
  return thisYear < today ? build(year + 1) : thisYear;
}

/** «hoy», «mañana» o la fecha corta. El chip confirma en el vocabulario de la app. */
function dayLabel(day: string, today: string): string {
  if (day === today) return "hoy";
  if (day === nextDay(today)) return "mañana";
  return formatDue(`${day}T00:00:00`, false, today).text;
}

/**
 * El proyecto de un `#`. Pide el nombre **completo** — `#inf` no es «Infra». Es lo que hace
 * que el autocompletado tenga sentido: mientras el nombre esté a medias no hay chip, y en
 * cuanto se completa aparece. Adivinar por prefijo asignaría proyectos a media palabra.
 */
function projectAt(folded: string, hash: number, projects: Project[]): Project | null {
  let best: Project | null = null;
  let bestLength = 0;

  for (const project of projects) {
    const name = fold(project.name);
    if (!name || !folded.startsWith(name, hash + 1)) continue;

    // «#casa» no puede valer por «Casa nueva»: el nombre tiene que terminar donde termina la
    // palabra escrita.
    const after = folded[hash + 1 + name.length];
    if (after !== undefined && /[a-z0-9]/.test(after)) continue;

    if (name.length > bestLength) {
      best = project;
      bestLength = name.length;
    }
  }

  return best;
}

export function parse(
  text: string,
  projects: Project[],
  today: string,
  dismissed: ReadonlySet<string> = new Set(),
): Capture {
  const folded = fold(text);
  const candidates: Candidate[] = [];

  const push = (
    kind: TokenKind,
    at: number,
    end: number,
    label: string,
    apply: (draft: Draft) => void,
    color?: string,
  ) => {
    candidates.push({ kind, at, end, source: text.slice(at, end), label, color, apply });
  };

  for (const match of folded.matchAll(RE_HORA)) {
    const at = match.index;
    const time = `${pad(Number(match[1]))}:${match[2]}`;
    push("hora", at, at + match[0].length, time, (draft) => {
      draft.time ??= time;
    });
  }

  for (const match of folded.matchAll(RE_DIA_MES)) {
    const day = fromDayMonth(today, Number(match[1]), MESES.indexOf(match[2]));
    if (day === null) continue;
    const at = match.index;
    push("dia", at, at + match[0].length, dayLabel(day, today), (draft) => {
      draft.day ??= day;
    });
  }

  for (const match of folded.matchAll(RE_RELATIVO)) {
    const day = match[1] === "hoy" ? today : nextDay(today);
    const at = match.index;
    push("dia", at, at + match[0].length, dayLabel(day, today), (draft) => {
      draft.day ??= day;
    });
  }

  for (const match of folded.matchAll(RE_SEMANA)) {
    const day = nextWeekday(today, SEMANA[match[1]]);
    const at = match.index;
    push("dia", at, at + match[0].length, dayLabel(day, today), (draft) => {
      draft.day ??= day;
    });
  }

  for (const match of folded.matchAll(RE_PRIORIDAD)) {
    const at = match.index + match[1].length;
    const priority: Priority = match[2].length === 2 ? 2 : 1;
    push("prioridad", at, at + match[2].length, priority === 2 ? "Prioridad alta" : "Prioridad media", (draft) => {
      draft.priority ??= priority;
    });
  }

  for (let hash = folded.indexOf("#"); hash >= 0; hash = folded.indexOf("#", hash + 1)) {
    // Un `#` pegado a una palabra es parte de ella, no una etiqueta.
    if (hash > 0 && /[a-z0-9]/.test(folded[hash - 1])) continue;
    const project = projectAt(folded, hash, projects);
    if (!project) continue;
    push(
      "proyecto",
      hash,
      hash + 1 + fold(project.name).length,
      project.name,
      (draft) => {
        draft.projectId ??= project.id;
      },
      project.color,
    );
  }

  // El más temprano gana, y a igualdad de arranque el más largo: así `12 ago` se lleva el
  // `mar` de «12 mar» antes de que el día de la semana pueda reclamarlo.
  candidates.sort((a, b) => a.at - b.at || b.end - b.at - (a.end - a.at));

  const draft: Draft = { day: null, time: null, projectId: null, priority: null };
  const accepted: Candidate[] = [];
  let reach = 0;

  for (const candidate of candidates) {
    if (candidate.at < reach) continue;
    if (accepted.some((other) => other.kind === candidate.kind)) continue;
    if (dismissed.has(dismissKey(candidate))) continue;
    candidate.apply(draft);
    accepted.push(candidate);
    reach = candidate.end;
  }

  let title = "";
  let cut = 0;
  for (const token of accepted) {
    title += text.slice(cut, token.at);
    cut = token.end;
  }
  title += text.slice(cut);

  return {
    title: title.replace(/\s+/g, " ").trim(),
    tokens: accepted.map(({ kind, source, at, label, color }) => ({ kind, source, at, label, color })),
    draft: toDraft(draft, today),
  };
}

/**
 * Solo van las claves que el texto fijó. Un `dueAt: null` explícito pisaría la fecha que la
 * vista le pone por omisión a una tarea nueva — en Hoy, precisamente, hoy.
 */
function toDraft(draft: Draft, today: string): Omit<NewTask, "title"> {
  const out: Omit<NewTask, "title"> = {};

  // Una hora suelta es hoy a esa hora: es lo que significa escribir «Llamar 14:30». El «hoy»
  // es el de la app y no el del reloj: si el panel lleva abierto desde ayer, el chip y lo que
  // se guarda tienen que decir el mismo día.
  if (draft.day !== null || draft.time !== null) {
    const day = draft.day ?? today;
    out.dueAt = `${day}T${draft.time ?? "00:00"}:00`;
    out.hasTime = draft.time !== null;
  }
  if (draft.projectId !== null) out.projectId = draft.projectId;
  if (draft.priority !== null) out.priority = draft.priority;

  return out;
}

/**
 * El `#` a medio escribir bajo el cursor, si lo hay. Es lo que dispara el autocompletado.
 * Devuelve nulo en cuanto el fragmento tiene un espacio: ahí el `#` ya quedó atrás.
 */
export function hashAt(text: string, caret: number): { at: number; fragment: string } | null {
  const before = text.slice(0, caret);
  const hash = before.lastIndexOf("#");
  if (hash < 0) return null;
  if (hash > 0 && !/\s/.test(text[hash - 1])) return null;

  const fragment = before.slice(hash + 1);
  if (/\s/.test(fragment)) return null;

  return { at: hash, fragment };
}

/** Los proyectos que empiezan por lo escrito tras el `#`. Sin nada escrito, todos. */
export function completions(fragment: string, projects: Project[]): Project[] {
  const needle = fold(fragment);
  return projects.filter((project) => fold(project.name).startsWith(needle));
}

/** Cierto cuando lo escrito ya nombra un proyecto entero. Ahí el menú sobra: el chip ya está. */
export function isComplete(fragment: string, projects: Project[]): boolean {
  const needle = fold(fragment);
  return needle.length > 0 && projects.some((project) => fold(project.name) === needle);
}
