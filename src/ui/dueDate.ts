import { dayOf, localDay } from "../data";

/**
 * El formato corto en español de la sección 3.5. Escrito a mano y no con `Intl`: la
 * abreviatura que devuelve `Intl` cambia entre versiones de ICU — a veces con punto, a veces
 * capitalizada — y aquí las columnas tienen que quedar siempre del mismo ancho.
 */
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Vencida, hoy o futura: es lo que decide el color de la fecha. */
export type DueTone = "overdue" | "today" | "future";

export interface FormattedDue {
  text: string;
  tone: DueTone;
}

/**
 * `14:30` si vence hoy y tiene hora, `mié 12` dentro del mismo mes, `12 ago` fuera de él. El
 * año solo aparece cuando no es el corriente, que si no una fecha a doce meses vista se lee
 * igual que una de hace un mes.
 */
export function formatDue(dueAt: string, hasTime: boolean, today: string = localDay()): FormattedDue {
  const day = dayOf(dueAt);
  const tone: DueTone = day < today ? "overdue" : day === today ? "today" : "future";
  const date = parseLocal(dueAt);

  if (tone === "today" && hasTime) {
    return { text: `${pad(date.getHours())}:${pad(date.getMinutes())}`, tone };
  }

  const [year, month] = today.split("-").map(Number);
  const sameMonth = date.getFullYear() === year && date.getMonth() === month - 1;
  if (sameMonth) {
    return { text: `${DIAS[date.getDay()]} ${date.getDate()}`, tone };
  }

  const suffix = date.getFullYear() === year ? "" : ` ${date.getFullYear()}`;
  return { text: `${date.getDate()} ${MESES[date.getMonth()]}${suffix}`, tone };
}

const MESES_LARGOS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const DIAS_LARGOS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

/**
 * La fecha escrita entera, para el detalle: «jueves 13 de agosto, 14:30».
 *
 * El formato corto de la lista existe para que las fechas queden alineadas en columna, y para
 * eso tiene que tirar información — `14:30` no dice qué día es. En el detalle no hay columna
 * que cuadrar y sí una sola fecha que leer, así que aquí se dice completa.
 */
export function formatDueLong(dueAt: string, hasTime: boolean, today: string = localDay()): string {
  const date = parseLocal(dueAt);
  const [year] = today.split("-").map(Number);

  const suffix = date.getFullYear() === year ? "" : ` de ${date.getFullYear()}`;
  const day = `${DIAS_LARGOS[date.getDay()]} ${date.getDate()} de ${MESES_LARGOS[date.getMonth()]}${suffix}`;

  return hasTime ? `${day}, ${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

/**
 * Las fechas se guardan en ISO local sin zona, y `new Date` trata distinto `2026-08-12`
 * (UTC) que `2026-08-12T09:00` (local). Partirlo a mano evita que una tarea sin hora se
 * corra un día según el huso.
 */
function parseLocal(iso: string): Date {
  const [date, time = "00:00:00"] = iso.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

const pad = (value: number) => String(value).padStart(2, "0");
