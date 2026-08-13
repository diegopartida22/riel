/**
 * Las notificaciones de la sección 7 del spec: solo para tareas con hora, a la hora exacta.
 *
 * `tauri-plugin-notification` no sabe programar en escritorio — `schedule` es de móvil — así
 * que la hora la pone esta capa. La forma la fija el spec: nada de un `setTimeout` por tarea
 * corriendo indefinidamente, sino un recálculo periódico sobre una ventana de 24 h.
 *
 * Cómo funciona: cada pasada borra todos los temporizadores, consulta lo que vence en las
 * próximas 24 h y arma uno por tarea. Volver a armar cada pocos minutos no es desperdicio —
 * es lo que hace que el plan sobreviva a que la tarea cambie de hora, se complete o se borre,
 * y a que el portátil duerma en medio y los temporizadores lleguen tarde.
 */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import { localIso, tasksWithTimeBetween, type Project, type Task } from "../data";

const MINUTE = 60 * 1000;

/** La ventana del spec. */
const WINDOW_MS = 24 * 60 * MINUTE;

/** Cada cuánto se rehace el plan. */
const RESCAN_MS = 10 * MINUTE;

/**
 * Cuánto se tolera llegar tarde. Si el equipo durmió tres horas, el temporizador de una tarea
 * de las 14:00 dispara a las 17:00: avisar entonces no informa de nada y además miente sobre
 * la hora. Por debajo de este margen —un aviso que llega con dos minutos de retraso— sí sirve.
 */
const GRACE_MS = 5 * MINUTE;

let timers: number[] = [];
let ticker: number | null = null;

/** Lo ya avisado en esta sesión, para que rearmar cada 10 minutos no repita el aviso. */
const notified = new Set<string>();

/** El último mapa con el que se armó el plan, para poder rearmarlo desde fuera del ciclo. */
let context: Map<string, Project> = new Map();

/**
 * Pide el permiso, si hace falta. Se llama la primera vez que alguien le pone hora a una
 * tarea y no en el primer arranque, como pide el spec: el permiso se entiende cuando ya se
 * sabe para qué es.
 *
 * `keepOpen` existe porque el diálogo del sistema le quita el foco a la ventana, y sin
 * levantar la bandera el panel se cerraría justo debajo de la pregunta (spec 4).
 */
export async function ensurePermission(keepOpen: (value: boolean) => Promise<void>): Promise<boolean> {
  if (await isPermissionGranted()) return true;

  await keepOpen(true);
  let granted = false;
  try {
    granted = (await requestPermission()) === "granted";
  } finally {
    await keepOpen(false);
  }

  // Conceder el permiso no vuelve a pasar por el efecto que arma el plan: la tarea que provocó
  // la pregunta ya se guardó antes de preguntar, y esa pasada de `schedule` se fue en vacío
  // porque todavía no había permiso. Sin este rearme el aviso esperaría al repaso de los diez
  // minutos, que es justo lo que rompe el caso de «ponle hora dentro de cinco».
  if (granted) await schedule(context);
  return granted;
}

/** Para la nota de Ajustes: si se denegó, ahí va el enlace a Preferencias del Sistema. */
export const permissionGranted = () => isPermissionGranted();

const body = (task: Task, projectsById: Map<string, Project>): string | undefined => {
  const project = task.projectId ? projectsById.get(task.projectId) : undefined;
  return project?.name;
};

function clear() {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
}

/**
 * Rehace el plan. Idempotente: llamarla de más solo reemplaza temporizadores por otros
 * iguales.
 */
export async function schedule(projectsById: Map<string, Project>): Promise<void> {
  context = projectsById;
  clear();
  if (!(await isPermissionGranted())) return;

  const now = new Date();
  const upcoming = await tasksWithTimeBetween(
    localIso(new Date(now.getTime() - GRACE_MS)),
    localIso(new Date(now.getTime() + WINDOW_MS)),
  );

  for (const task of upcoming) {
    if (notified.has(task.id)) continue;
    // El `T` del ISO local no lleva zona, y `new Date` lo interpreta en la del equipo, que es
    // exactamente lo que significa la fecha guardada.
    const delay = new Date(task.dueAt!).getTime() - Date.now();
    if (delay < -GRACE_MS) continue;

    timers.push(
      window.setTimeout(
        () => {
          notified.add(task.id);
          sendNotification({ title: task.title, body: body(task, projectsById) });
        },
        Math.max(0, delay),
      ),
    );
  }
}

/**
 * Arranca el ciclo. Devuelve la función que lo para, para dársela tal cual a `useEffect`.
 */
export function start(projectsById: Map<string, Project>): () => void {
  void schedule(projectsById);
  ticker = window.setInterval(() => void schedule(projectsById), RESCAN_MS);

  return () => {
    clear();
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
  };
}
