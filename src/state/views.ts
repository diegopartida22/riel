import {
  completedTasks,
  dayOf,
  nextDay,
  pendingTasks,
  tasksDueAfter,
  tasksDueBy,
  tasksInProject,
  type NewTask,
  type Task,
  type TaskPatch,
} from "../data";

/** Las cuatro vistas del sistema más la de un proyecto (spec 1). */
export type View =
  | { kind: "hoy" }
  | { kind: "proximas" }
  | { kind: "todas" }
  | { kind: "completadas" }
  | { kind: "proyecto"; id: string };

export type SystemKind = Exclude<View["kind"], "proyecto">;

/** En el orden en que aparecen arriba del riel, que es el de ⌘1..⌘4 (spec 5). */
export const SYSTEM_VIEWS: { kind: SystemKind; label: string }[] = [
  { kind: "hoy", label: "Hoy" },
  { kind: "proximas", label: "Próximas" },
  { kind: "todas", label: "Todas" },
  { kind: "completadas", label: "Completadas" },
];

const LABELS: Record<SystemKind, string> = {
  hoy: "Hoy",
  proximas: "Próximas",
  todas: "Todas",
  completadas: "Completadas",
};

/** Identidad estable de una vista, para comparar y para las claves de React. */
export function viewKey(view: View): string {
  return view.kind === "proyecto" ? `proyecto:${view.id}` : view.kind;
}

export const sameView = (a: View, b: View) => viewKey(a) === viewKey(b);

export function loadView(view: View, today: string): Promise<Task[]> {
  switch (view.kind) {
    case "hoy":
      return tasksDueBy(today);
    case "proximas":
      return tasksDueAfter(today);
    case "todas":
      return pendingTasks();
    case "completadas":
      return completedTasks();
    case "proyecto":
      return tasksInProject(view.id);
  }
}

/**
 * Con qué nace una tarea escrita dentro de cada vista. La regla es que lo que se acaba de
 * escribir tiene que quedar a la vista: en Hoy nace con fecha de hoy y en Próximas con la de
 * mañana, porque sin fecha ninguna de las dos la mostraría. En Todas y en un proyecto no hace
 * falta inventar nada. El parser del paso 7 manda sobre esto cuando detecte una fecha.
 */
export function draftFor(view: View, today: string): Omit<NewTask, "title"> {
  switch (view.kind) {
    case "hoy":
      return { dueAt: `${today}T00:00:00` };
    case "proximas":
      return { dueAt: `${nextDay(today)}T00:00:00` };
    case "proyecto":
      return { projectId: view.id };
    default:
      return {};
  }
}

/** En Completadas no hay nada que escribir: una tarea no puede nacer terminada. */
export const acceptsNew = (view: View) => view.kind !== "completadas";

/**
 * Si una tarea recién creada cabe en la vista donde se escribió. Con el parser de captura deja
 * de ser siempre que sí: escribir «Comprar pan mañana» estando en Hoy crea una tarea que no es
 * de hoy, y dejarla en la lista sería mostrar en Hoy algo que al recargar ya no está.
 *
 * Es el mismo criterio que `loadView`, aplicado a una sola tarea en vez de a una consulta.
 */
export function belongs(view: View, task: Task, today: string): boolean {
  switch (view.kind) {
    case "hoy":
      return task.dueAt !== null && task.dueAt.slice(0, 10) <= today;
    case "proximas":
      return task.dueAt !== null && task.dueAt.slice(0, 10) > today;
    case "todas":
      return true;
    case "completadas":
      return false;
    case "proyecto":
      return task.projectId === view.id;
  }
}

/**
 * Si un cambio saca la tarea de la vista que se está mirando. Cambiarle el proyecto dentro de
 * un proyecto la destierra, y desde que la fecha se edita en el detalle, empujar a la semana
 * que viene algo que estaba en Hoy también: la lista tiene que decir la verdad, y una fila que
 * anuncia «vie 21» bajo el encabezado HOY no la dice.
 *
 * No es `belongs` negado. `belongs` responde por una tarea entera y en Completadas siempre dice
 * que no —una tarea recién escrita no nace terminada— así que ahí desterraría cualquier cambio.
 * Esto mira solo lo que el cambio tocó, y en Todas y Completadas no hay nada que mirar: la
 * primera las trae todas y la segunda ordena por la fecha en que se completaron.
 */
export function exiles(view: View, patch: TaskPatch, today: string): boolean {
  if (view.kind === "proyecto") {
    return patch.projectId !== undefined && patch.projectId !== view.id;
  }
  if (patch.dueAt === undefined) return false;

  const day = patch.dueAt === null ? null : dayOf(patch.dueAt);
  if (view.kind === "hoy") return day === null || day > today;
  if (view.kind === "proximas") return day === null || day <= today;
  return false;
}

export function titleOf(view: View, projectName?: string): string {
  return view.kind === "proyecto" ? (projectName ?? "Proyecto") : LABELS[view.kind];
}

/**
 * El texto del estado vacío. El de Hoy y el de un proyecto están en el spec (3.7); los otros
 * tres siguen la misma regla — decir qué pasa en una línea, sin consolar a nadie.
 */
export function emptyMessage(view: View): string {
  switch (view.kind) {
    case "hoy":
      return "Nada para hoy.";
    case "proximas":
      return "Nada por venir.";
    case "todas":
      return "No hay nada pendiente.";
    case "completadas":
      return "Nada completado todavía.";
    case "proyecto":
      return "Este proyecto está vacío.";
  }
}
