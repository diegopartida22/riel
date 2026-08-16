/**
 * La sincronización con los Recordatorios de Apple (spec 16).
 *
 * Va en un solo sentido y medio, y es a propósito: los recordatorios de las listas elegidas
 * entran en Riel como tareas, y lo único que sale de vuelta es la casilla. Riel no crea
 * recordatorios — lo que se escribe aquí se queda aquí— porque un vínculo que escribiera en las
 * dos direcciones convertiría cualquier error de esta app en una lista de otra app estropeada,
 * y de las dos la que lleva años ahí no es esta.
 *
 * La regla que lo gobierna todo cabe en una línea: **si el recordatorio cambió fuera desde la
 * última vez que Riel lo miró, manda el recordatorio; si no cambió, manda Riel.** El árbitro es
 * `lastModifiedDate`, guardado en el vínculo. Sin él no habría forma de distinguir «lo
 * completaron en el iPhone» de «Riel lo completó y el empuje se quedó a medias», que son el
 * mismo par de estados y piden resultados opuestos.
 *
 * Nada se borra nunca por lo que le falte al otro lado. Un recordatorio que desaparece de
 * Recordatorios no se lleva su tarea, y una tarea eliminada en Riel no borra su recordatorio: se
 * queda como lápida para que no vuelva a entrar en la pasada siguiente.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  completeTask,
  createTask,
  listLinks,
  pushDone,
  saveLink,
  stampLink,
  tasksByIds,
  uncompleteTasks,
  updateTask,
} from "../data";
import type { Permission } from "./notifications";

/** Una lista de Recordatorios. */
export interface ReminderList {
  id: string;
  title: string;
}

/** La fecha de un recordatorio, en piezas. `hour` nula es un día sin hora. */
interface Due {
  year: number;
  month: number;
  day: number;
  hour: number | null;
  minute: number;
}

export interface Reminder {
  id: string;
  list: string;
  title: string;
  notes: string | null;
  due: Due | null;
  priority: 0 | 1 | 2;
  completed: boolean;
  changed: number;
  repeats: boolean;
}

/** Con qué avisa Rust de que el panel se acaba de abrir. Es cuando se vuelve a sincronizar. */
const PANEL_OPENED = "riel://panel-abierto";

/** Si el vínculo está encendido. Es una preferencia de esta máquina, así que no va a SQLite. */
const ON_KEY = "riel:recordatorios";

/** Qué listas se vinculan, por identificador. Tampoco es un dato de las tareas. */
const LISTS_KEY = "riel:recordatorios-listas";

/**
 * Lo menos que puede pasar entre dos pasadas automáticas.
 *
 * El panel se abre decenas de veces al día y a veces dos en el mismo minuto; cada pasada son
 * dos viajes a EventKit y una lectura de la tabla de vínculos. Medio minuto es corto de sobra
 * para que completar algo en el iPhone se vea al abrir el panel, y largo de sobra para que
 * abrirlo y cerrarlo no lo repita. Pedirlo a mano —la hoja al cerrarse— se lo salta.
 */
const FLOOR_MS = 30 * 1000;

export const remindersPermission = () => invoke<Permission>("reminders_permission");
export const reminderLists = () => invoke<ReminderList[]>("reminder_lists");
export const fetchReminders = (lists: string[]) => invoke<Reminder[]>("fetch_reminders", { lists });

/** `lists` no acota la búsqueda: es por dónde barrer si preguntar por identificador no contesta. */
const remindersById = (ids: string[], lists: string[]) =>
  invoke<Reminder[]>("reminders_by_id", { ids, lists });

/** Las listas guardadas. Lo que no sea un arreglo de cadenas se descarta entero. */
export function storedLists(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(LISTS_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * La fecha del recordatorio en el ISO local y sin zona que usa toda la app (`src/data/time.ts`).
 *
 * Se arma con las piezas que da EventKit y no con un `Date`: un recordatorio de un día sin hora
 * es exactamente eso —un día— y pasarlo por un instante para volver a sacarle el día es la forma
 * de que a alguien en un huso negativo se le mueva al anterior.
 */
function dueOf(item: Reminder): string | null {
  if (!item.due) return null;
  const { year, month, day, hour, minute } = item.due;
  const time = hour === null ? "00:00" : `${pad(hour)}:${pad(minute)}`;
  return `${year}-${pad(month)}-${pad(day)}T${time}:00`;
}

const hasTimeOf = (item: Reminder) => item.due !== null && item.due.hour !== null;

/**
 * Lo que Riel copia de un recordatorio. El proyecto **no** está en la lista, y no es un olvido:
 * un recordatorio no tiene proyecto, así que ponerle uno sería inventarlo, y no tocarlo nunca es
 * lo que hace que el que se le dé aquí se quede puesto para siempre.
 */
const fieldsOf = (item: Reminder) => ({
  title: item.title,
  notes: item.notes,
  dueAt: dueOf(item),
  hasTime: hasTimeOf(item),
  priority: item.priority,
});

/**
 * Una pasada. Devuelve cuántas cosas cambiaron en la base, que es lo que decide si la vista de
 * detrás tiene que releerse.
 */
export async function syncReminders(lists: string[]): Promise<number> {
  if (!lists.length) return 0;
  if ((await remindersPermission()) !== "granted") return 0;

  const incoming = await fetchReminders(lists);
  const links = await listLinks();
  const known = new Set(links.map((link) => link.reminderId));
  let touched = 0;

  // ── Lo que todavía no conoce nadie ────────────────────────────────────────────────────
  //
  // Entra sin proyecto, por lo mismo que una tarea que llega por un `riel://` (spec 14): lo que
  // no dice el origen no lo pone la vista que se estuviera mirando.
  for (const item of incoming) {
    if (known.has(item.id)) continue;
    // Los que repiten se quedan fuera. Recordatorios ya los repite por su cuenta, y una vuelta
    // suya y una de Riel (§12) sobre la misma tarea serían dos calendarios discutiendo: al
    // completarla, EventKit la adelanta y Riel además dejaría otra detrás.
    if (item.repeats) continue;

    const task = await createTask(fieldsOf(item));
    await saveLink(item.id, task.id, item.changed);
    touched++;
  }

  // ── Los ya vinculados ─────────────────────────────────────────────────────────────────
  //
  // Se pregunta por ellos uno a uno y no con otro barrido: uno completado en el iPhone deja de
  // salir entre los pendientes, y ahí sería indistinguible de uno borrado.
  const found = await remindersById(
    links.map((link) => link.reminderId),
    lists,
  );
  const alive = new Map(found.map((item) => [item.id, item]));
  const wanted = links.map((link) => link.taskId).filter((id): id is string => id !== null);
  const tasks = new Map((await tasksByIds(wanted)).map((task) => [task.id, task]));

  for (const link of links) {
    // Sin tarea viva es una lápida: el recordatorio pasó por aquí y se eliminó en Riel. No
    // vuelve a entrar, y su recordatorio no se toca — borrar fuera lo que se borró aquí sería
    // hacer con la lista de otra app algo que esta app no promete.
    const task = link.taskId === null ? undefined : tasks.get(link.taskId);
    if (!task) continue;

    // Desapareció de Recordatorios. La tarea se queda tal cual y el vínculo también: si lo que
    // falló fue iCloud y no un borrado, la próxima pasada lo encuentra donde estaba.
    const item = alive.get(link.reminderId);
    if (!item) continue;

    // Su lista ya no está vinculada —se quitó en la hoja, o el recordatorio se movió a otra—, así
    // que deja de escribirse en los dos sentidos: «solo lo vinculado» es literalmente lo que se
    // eligió. El vínculo sí se queda, y no es contradicción: es lo que hace que volver a vincular
    // la lista reconozca la tarea que ya existe en vez de crear una segunda igual.
    if (!lists.includes(item.list)) continue;

    if (item.changed !== link.changed) {
      // Cambió fuera: manda el recordatorio, y eso incluye pisar lo que se hubiera editado aquí.
      // Es lo que significa vincular una tarea a algo que vive en otra app.
      await updateTask(task.id, fieldsOf(item));
      if (item.completed && !task.completedAt) await completeTask(task.id);
      else if (!item.completed && task.completedAt) await uncompleteTasks([task.id]);
      await stampLink(link.reminderId, item.changed);
      touched++;
    } else if (item.completed !== (task.completedAt !== null)) {
      // No cambió fuera, así que la diferencia salió de aquí: o se completó en Riel, o el
      // empuje del momento no llegó. Las dos se arreglan con el mismo empuje.
      await pushDone([task.id], task.completedAt !== null);
      touched++;
    }
  }

  return touched;
}

export interface RemindersSync {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  /** El permiso del sistema. Nulo mientras se consulta, que son milisegundos. */
  permission: Permission | null;
  /** Las listas vinculadas, por identificador. */
  lists: string[];
  setLists: (ids: string[]) => void;
  /** Sincroniza ahora, sin esperar al mínimo entre pasadas. */
  sync: () => void;
}

/**
 * El vínculo, del lado de la UI.
 *
 * Se sincroniza al montar y al abrir el panel, no con un temporizador: con el panel cerrado la
 * webview está estrangulada (§7, §11), y abrir el panel es además el único momento en que el
 * resultado se ve.
 */
export function useReminders(onChanged: () => void): RemindersSync {
  const [enabled, setOn] = useState(() => localStorage.getItem(ON_KEY) === "1");
  const [permission, setPermission] = useState<Permission | null>(null);
  const [lists, setKept] = useState<string[]>(storedLists);

  /** Cuándo terminó la última pasada, y si hay una corriendo. Nadie las dibuja. */
  const last = useRef(0);
  const running = useRef(false);

  /** En una `ref` para que el efecto no se dé de baja y de alta con cada render de App. */
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const run = useCallback(async (forced: boolean) => {
    if (running.current) return;
    if (!forced && Date.now() - last.current < FLOOR_MS) return;

    running.current = true;
    try {
      if (await syncReminders(storedLists())) changed.current();
    } catch (cause) {
      // Un fallo no se enseña, por lo mismo que el del actualizador (§11): la app funciona
      // igual sin el vínculo, y la próxima apertura lo vuelve a intentar.
      console.error(cause);
    } finally {
      last.current = Date.now();
      running.current = false;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let off: Promise<() => void> | null = null;

    // El permiso se vuelve a consultar en cada apertura porque puede haber cambiado fuera:
    // concederlo en Ajustes del Sistema y volver a Riel tiene que quitar la nota sin reiniciar.
    const ask = () =>
      void remindersPermission().then(
        (state) => alive && setPermission(state),
        (cause) => console.error(cause),
      );

    ask();

    if (enabled) {
      void run(true);
      off = listen(PANEL_OPENED, () => {
        ask();
        void run(false);
      });
    }

    return () => {
      alive = false;
      void off?.then((stop) => stop()).catch((cause) => console.error(cause));
    };
    // `lists` no está en las dependencias: la pasada lee las guardadas en el momento de correr,
    // así que elegir otra lista en la hoja no tiene que rehacer el oyente — y la hoja pide la
    // pasada a mano al cerrarse, que es cuando de verdad hay algo nuevo que traer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run]);

  /**
   * Encenderlo es lo que pide el permiso, igual que la agenda (§15). Queda encendido aunque lo
   * denieguen: lo que dice el interruptor es que se quiere el vínculo, y apagarlo solo porque el
   * sistema dijo que no borraría la petición y dejaría la nota de Ajustes hablando de algo que
   * ya nadie pidió.
   */
  const setEnabled = useCallback((value: boolean) => {
    localStorage.setItem(ON_KEY, value ? "1" : "0");
    setOn(value);
    if (!value) return;

    void (async () => {
      const state = await remindersPermission();
      if (state !== "default") {
        setPermission(state);
        return;
      }

      // La pregunta del sistema es una ventana aparte y se lleva el foco: sin la bandera, el
      // panel se cerraría por debajo justo mientras se contesta (spec 4).
      await invoke("set_keep_open", { value: true }).catch((cause) => console.error(cause));
      try {
        await invoke<boolean>("request_reminders_permission");
      } finally {
        await invoke("set_keep_open", { value: false }).catch((cause) => console.error(cause));
      }
      setPermission(await remindersPermission());
    })().catch((cause) => console.error(cause));
  }, []);

  const setLists = useCallback((ids: string[]) => {
    localStorage.setItem(LISTS_KEY, JSON.stringify(ids));
    setKept(ids);
  }, []);

  const sync = useCallback(() => void run(true), [run]);

  return { enabled, setEnabled, permission, lists, setLists, sync };
}
