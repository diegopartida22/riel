/**
 * Hasta dónde llega la lista antes de plegar lo que viene después (spec 19).
 *
 * No es un filtro y esa es la diferencia entera: lo que pasa del horizonte no desaparece, se
 * junta al final bajo un encabezado que lo cuenta. Existe por las tareas recurrentes (spec
 * 12), que al completarse dejan enseguida la vuelta siguiente en la lista: pagar los impuestos
 * el 10 de septiembre pone «17 de octubre» en Todas ese mismo día, y Todas es justo donde hay
 * que mirar porque es la única vista donde vive lo que no tiene fecha.
 *
 * No es un dato, es una preferencia de esta máquina: va a `localStorage` con el riel y la
 * vista de arranque, y no a SQLite con la retención.
 */

import { dayOf, localDay, type Task } from "../data";

import type { View } from "./views";

export type Horizonte = "mes" | "30" | "90" | "todo";

export const HORIZONTES: { value: Horizonte; label: string; short: string }[] = [
  { value: "mes", label: "Este mes", short: "Mes" },
  { value: "30", label: "30 días", short: "30 d" },
  { value: "90", label: "90 días", short: "90 d" },
  { value: "todo", label: "Todo", short: "Todo" },
];

/**
 * Fin de mes de fábrica, y no 30 días, aunque midan casi lo mismo.
 *
 * Lo que se pregunta al mirar la lista es «qué me queda de este mes», que es una frontera que
 * la gente ya tiene en la cabeza y que además no se mueve durante treinta días. «30 días» el
 * 25 de septiembre alcanza al 25 de octubre y vuelve a colar la vuelta siguiente de lo mensual,
 * que es exactamente el ruido del que esto viene a librar.
 */
export const DEFAULT_HORIZONTE: Horizonte = "mes";

const KEY = "riel:horizonte";

/** Lo guardado, o fin de mes. Un valor que no reconozcamos cae en el de omisión. */
export function storedHorizonte(): Horizonte {
  const saved = localStorage.getItem(KEY);
  return HORIZONTES.some((option) => option.value === saved)
    ? (saved as Horizonte)
    : DEFAULT_HORIZONTE;
}

export function storeHorizonte(value: Horizonte): void {
  localStorage.setItem(KEY, value);
}

/**
 * El último día que se queda en la lista, o `null` cuando no se pliega nada.
 */
export function horizonEnd(horizonte: Horizonte, today: string): string | null {
  if (horizonte === "todo") return null;
  const [year, month, day] = today.split("-").map(Number);
  // El día 0 del mes que viene es el último de este, que es la única cuenta que acierta en
  // febrero sin una tabla de días por mes. Y los plazos pasan por `Date` por lo mismo que
  // `nextDay`: sumarle días al número se rompe a fin de mes.
  return horizonte === "mes"
    ? localDay(new Date(year, month, 0))
    : localDay(new Date(year, month - 1, day + Number(horizonte)));
}

/**
 * Qué vistas recortan.
 *
 * Todas y las de proyecto, que son las dos que traen la lista entera de una vez. Próximas se
 * queda como está: es la vista a la que se entra a propósito a ver lo que viene, y plegarle lo
 * de más adelante sería quitarle lo único que enseña. En Hoy no hay nada que plegar y en
 * Completadas el orden lo da la fecha en que se terminó cada tarea, no la de vencimiento.
 */
export const usesHorizon = (view: View) => view.kind === "todas" || view.kind === "proyecto";

/**
 * Si una tarea cae más allá del horizonte.
 *
 * Sin fecha, nunca. Lo que no tiene fecha no está «más adelante», está sin decidir — y es
 * precisamente lo que se viene a ver a Todas.
 */
export function beyond(task: Task, end: string | null): boolean {
  return end !== null && task.dueAt !== null && dayOf(task.dueAt) > end;
}
