/**
 * El vínculo con los Recordatorios de Apple (spec 16), del lado de la base.
 *
 * Aquí vive solo la tabla de vínculos y el empuje de la casilla hacia fuera. Las reglas de la
 * sincronización —qué entra, quién gana cuando los dos lados cambiaron— están en
 * `src/state/reminders.ts`, que es quien puede mirar tareas y recordatorios a la vez.
 *
 * Este archivo no importa nada de `tasks.ts` a propósito: así `tasks.ts` puede importarlo a él
 * sin que quede un ciclo entre los dos.
 */

import { invoke } from "@tauri-apps/api/core";

import { execute, placeholders, select } from "./db";

/**
 * Lo que Riel sabe de un recordatorio que ya pasó por aquí.
 *
 * `taskId` apuntando a una tarea que ya no existe es una **lápida**: ese recordatorio entró una
 * vez y su tarea se eliminó en Riel, así que no tiene que volver a entrar. Por eso la fila
 * sobrevive a la tarea y por eso no hay clave foránea (ver la migración 005).
 */
export interface ReminderLink {
  reminderId: string;
  taskId: string | null;
  /** `lastModifiedDate` del recordatorio la última vez que Riel lo miró, en segundos. */
  changed: number;
}

interface Row {
  reminder_id: string;
  task_id: string | null;
  changed: number;
}

const toLink = (row: Row): ReminderLink => ({
  reminderId: row.reminder_id,
  taskId: row.task_id,
  changed: row.changed,
});

export async function listLinks(): Promise<ReminderLink[]> {
  const rows = await select<Row>(`SELECT reminder_id, task_id, changed FROM reminder_links`);
  return rows.map(toLink);
}

/** Apunta el vínculo, o lo actualiza si ese recordatorio ya había pasado por aquí. */
export async function saveLink(
  reminderId: string,
  taskId: string | null,
  changed: number,
): Promise<void> {
  await execute(
    `INSERT INTO reminder_links (reminder_id, task_id, changed) VALUES ($1, $2, $3)
       ON CONFLICT(reminder_id) DO UPDATE SET task_id = excluded.task_id, changed = excluded.changed`,
    [reminderId, taskId, changed],
  );
}

/** Solo la fecha de modificación: es lo que se apunta después de mirar o de escribir. */
export async function stampLink(reminderId: string, changed: number): Promise<void> {
  await execute(`UPDATE reminder_links SET changed = $1 WHERE reminder_id = $2`, [
    changed,
    reminderId,
  ]);
}

/**
 * Marca fuera los recordatorios de estas tareas. Lo único que Riel escribe en otra app.
 *
 * No lanza nunca. Un empuje que falla —el recordatorio se borró, iCloud no contesta— no puede
 * tumbar el gesto de completar una tarea, que es de esta app y ya está guardado. La pasada
 * siguiente lo vuelve a intentar por su cuenta: mientras la fecha de modificación siga siendo la
 * que Riel apuntó, la diferencia entre los dos lados se lee como que manda Riel.
 *
 * La consulta sale en el gesto más repetido de la app, así que va por el índice de `task_id` y
 * no toca EventKit si no hay ningún vínculo — que es el caso de casi todo el mundo.
 */
export async function pushDone(taskIds: string[], done: boolean): Promise<void> {
  if (!taskIds.length) return;

  const rows = await select<Row>(
    `SELECT reminder_id, task_id, changed FROM reminder_links
      WHERE task_id IN (${placeholders(taskIds.length)})`,
    taskIds,
  );

  for (const row of rows) {
    try {
      const changed = await invoke<number>("set_reminder_done", { id: row.reminder_id, done });
      await stampLink(row.reminder_id, changed);
    } catch (cause) {
      console.error(cause);
    }
  }
}
