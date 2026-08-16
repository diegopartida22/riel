import { execute, placeholders, select } from "./db";
import { STEP, between, needsRenumber } from "./position";
import { formatRepeat, nextDue, parseRepeat, parseRepeatFrom } from "./repeat";
import { dayOf, localIso } from "./time";
import type { Between, Completion, NewTask, Priority, Task, TaskPatch, TaskTree } from "./types";

interface Row {
  id: string;
  title: string;
  notes: string | null;
  project_id: string | null;
  parent_id: string | null;
  due_at: string | null;
  has_time: number;
  priority: number;
  completed_at: string | null;
  position: number;
  created_at: string;
  repeat: string | null;
  repeat_from: string | null;
}

const COLUMNS =
  "id, title, notes, project_id, parent_id, due_at, has_time, priority, completed_at, position, created_at, repeat, repeat_from";

const toTask = (row: Row): Task => ({
  id: row.id,
  title: row.title,
  notes: row.notes,
  projectId: row.project_id,
  parentId: row.parent_id,
  dueAt: row.due_at,
  hasTime: row.has_time !== 0,
  priority: row.priority as Priority,
  completedAt: row.completed_at,
  position: row.position,
  createdAt: row.created_at,
  repeat: parseRepeat(row.repeat),
  repeatFrom: parseRepeatFrom(row.repeat_from),
});

/** Orden natural de una lista: la posición manda, y el empate lo rompe la antigüedad. */
const ORDER = "ORDER BY position, created_at, id";

// ── Lectura ────────────────────────────────────────────────────────────────────────────

async function query(where: string, params: unknown[] = [], order = ORDER): Promise<Task[]> {
  const rows = await select<Row>(`SELECT ${COLUMNS} FROM tasks WHERE ${where} ${order}`, params);
  return rows.map(toTask);
}

export async function getTask(id: string): Promise<Task | null> {
  const found = await query("id = $1", [id]);
  return found[0] ?? null;
}

/**
 * Hoy: lo que vence hoy y lo que ya venció. Lo vencido no se esconde en otra vista — si algo
 * se pasó de fecha, el lugar donde tiene que aparecer es el de hoy.
 *
 * Las tareas sin fecha no entran: viven en Todas y en su proyecto.
 */
export function tasksDueBy(day: string): Promise<Task[]> {
  return query(
    "completed_at IS NULL AND parent_id IS NULL AND due_at IS NOT NULL AND substr(due_at, 1, 10) <= $1",
    [day],
  );
}

/** Próximas: todo lo que tiene fecha posterior al día que se pase. */
export function tasksDueAfter(day: string): Promise<Task[]> {
  return query(
    "completed_at IS NULL AND parent_id IS NULL AND due_at IS NOT NULL AND substr(due_at, 1, 10) > $1",
    [day],
  );
}

/** Todas: lo pendiente, con o sin fecha. */
export function pendingTasks(): Promise<Task[]> {
  return query("completed_at IS NULL AND parent_id IS NULL");
}

/** Completadas, lo último primero. */
export function completedTasks(): Promise<Task[]> {
  return query(
    "completed_at IS NOT NULL AND parent_id IS NULL",
    [],
    "ORDER BY completed_at DESC, created_at DESC",
  );
}

export function tasksInProject(projectId: string): Promise<Task[]> {
  return query("completed_at IS NULL AND parent_id IS NULL AND project_id = $1", [projectId]);
}

export async function subtasksOf(parentIds: string[]): Promise<Task[]> {
  if (!parentIds.length) return [];
  return query(`parent_id IN (${placeholders(parentIds.length)})`, parentIds);
}

/**
 * Cuelga de cada tarea sus subtareas. Dos consultas y no una por fila: son dos niveles, así
 * que con un `IN` alcanza y no hay forma de que esto crezca.
 */
export async function withSubtasks(tasks: Task[]): Promise<TaskTree[]> {
  const children = await subtasksOf(tasks.map((task) => task.id));
  const byParent = new Map<string, Task[]>();
  for (const child of children) {
    const siblings = byParent.get(child.parentId!) ?? [];
    siblings.push(child);
    byParent.set(child.parentId!, siblings);
  }
  return tasks.map((task) => ({ ...task, subtasks: byParent.get(task.id) ?? [] }));
}

/**
 * Todo lo que hay, para la búsqueda. A diferencia de las vistas, esta sí trae las completadas
 * y las subtareas: buscar algo y que no aparezca porque ya lo terminaste —o porque es la
 * subtarea de otra cosa— es lo que hace que un buscador deje de servir.
 *
 * Se lee entero y se filtra en memoria. `LIKE` no sabe hacer coincidencia difusa, y una base
 * local con unos miles de filas cabe de sobra.
 */
export function allTasks(): Promise<Task[]> {
  return query("1 = 1");
}

/**
 * Cuántas tareas hay en total, completadas incluidas. Sirve para una sola cosa: distinguir el
 * primer arranque, que trae su propio texto en el campo de captura (spec 3.7).
 */
export async function countTasks(): Promise<number> {
  const rows = await select<{ total: number }>(`SELECT COUNT(*) AS total FROM tasks`);
  return rows[0]?.total ?? 0;
}

/**
 * Pendientes por proyecto, para el conteo del tooltip del riel (spec 3.4). Cuenta tareas
 * raíz: las subtareas ya están representadas por la suya.
 */
export async function pendingCountByProject(): Promise<Map<string | null, number>> {
  const rows = await select<{ project_id: string | null; total: number }>(
    `SELECT project_id, COUNT(*) AS total
       FROM tasks
      WHERE completed_at IS NULL AND parent_id IS NULL
      GROUP BY project_id`,
  );
  return new Map(rows.map((row) => [row.project_id, row.total]));
}

/**
 * Lo que hace falta notificar en una ventana (spec 7): solo lo que tiene hora, sin completar,
 * y en el tramo pedido.
 *
 * Las subtareas quedan fuera. No dibujan fecha propia en la lista (spec 3.5), así que una
 * notificación suya avisaría de algo que en la app no se ve por ningún lado.
 */
export function tasksWithTimeBetween(from: string, to: string): Promise<Task[]> {
  return query(
    "completed_at IS NULL AND parent_id IS NULL AND has_time = 1 AND due_at >= $1 AND due_at <= $2",
    [from, to],
    "ORDER BY due_at",
  );
}

/**
 * Si hay algo vencido, que es lo que decide el peso del glifo de la barra (spec 4).
 *
 * Los dos casos no se miden igual: con hora, vencido es que haya pasado el instante; sin
 * hora, `due_at` representa el día entero, así que no vence hasta que el día queda atrás.
 * Medirlos con la misma vara pondría en rojo a las 00:01 todo lo de hoy sin hora.
 */
export async function hasOverdue(now: string): Promise<boolean> {
  const rows = await select<{ total: number }>(
    `SELECT COUNT(*) AS total
       FROM tasks
      WHERE completed_at IS NULL
        AND due_at IS NOT NULL
        AND ((has_time = 1 AND due_at < $1) OR (has_time = 0 AND substr(due_at, 1, 10) < $2))`,
    [now, dayOf(now)],
  );
  return (rows[0]?.total ?? 0) > 0;
}

// ── Escritura ──────────────────────────────────────────────────────────────────────────

/**
 * El barrido de completadas del arranque (spec 8). Devuelve cuántas raíces se llevó.
 *
 * Borra solo tareas raíz: una subtarea completada hace dos meses cuya madre sigue pendiente
 * es una línea viva de una tarea viva, y hacerla desaparecer sería editar la tarea de alguien
 * a sus espaldas. Las hijas de una raíz barrida se van con ella por el `ON DELETE CASCADE`.
 */
export async function sweepCompleted(days: number): Promise<number> {
  return execute(
    `DELETE FROM tasks WHERE ${SWEEPABLE}`,
    [sweepCutoff(days)],
  );
}

/** La frontera del barrido: lo completado antes de esto se va. */
const sweepCutoff = (days: number) =>
  localIso(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

/** Escrito una vez porque contar y borrar tienen que mirar exactamente las mismas filas. */
const SWEEPABLE = "parent_id IS NULL AND completed_at IS NOT NULL AND completed_at < $1";

/**
 * Cuántas se llevaría el barrido con esa retención, sin borrar nada.
 *
 * Es lo que hace posible preguntar antes de bajar el plazo (spec 8). Una confirmación que
 * dijera «se van a borrar tareas» sin la cifra no informa de nada: la diferencia entre tres y
 * trescientas es justo la que decide si alguien acepta o exporta primero.
 */
export async function countSweepable(days: number): Promise<number> {
  const rows = await select<{ total: number }>(
    `SELECT COUNT(*) AS total FROM tasks WHERE ${SWEEPABLE}`,
    [sweepCutoff(days)],
  );
  return rows[0]?.total ?? 0;
}

/**
 * La tarea nueva va al final de sus hermanas: al final de la lista si es raíz, al final de
 * las subtareas de su padre si cuelga de alguien.
 *
 * Ojo con los `$n`: para SQLite son *nombres*, y les asigna el índice según el orden en que
 * aparecen en el texto. Mientras se escriban en orden ascendente coinciden número e índice,
 * y repetir uno — `$5` aquí — vuelve a apuntar al mismo valor, que es justo lo que se busca.
 */
export async function createTask(input: NewTask): Promise<Task> {
  const id = crypto.randomUUID();

  await execute(
    `INSERT INTO tasks (${COLUMNS})
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, NULL,
            COALESCE((SELECT MAX(position) FROM tasks WHERE parent_id IS $5), 0) + ${STEP},
            $9, $10, $11`,
    [
      id,
      input.title,
      input.notes ?? null,
      input.projectId ?? null,
      input.parentId ?? null,
      input.dueAt ?? null,
      input.hasTime ? 1 : 0,
      input.priority ?? 0,
      localIso(),
      // Una subtarea nunca lleva regla: la instancia siguiente se lleva las hijas enteras, así
      // que una regla aquí repetiría dentro de algo que ya repite.
      input.parentId ? null : formatRepeat(input.repeat ?? null),
      input.repeatFrom ?? "fecha",
    ],
  );

  const created = await getTask(id);
  if (!created) throw new Error("la tarea se insertó pero no se pudo releer");
  return created;
}

const PATCH_COLUMNS: Record<keyof TaskPatch, string> = {
  title: "title",
  notes: "notes",
  projectId: "project_id",
  dueAt: "due_at",
  hasTime: "has_time",
  priority: "priority",
  repeat: "repeat",
  repeatFrom: "repeat_from",
};

/** Lo que va al parámetro, para los tres campos cuya forma en la fila no es la del dominio. */
function toColumn(key: keyof TaskPatch, value: NonNullable<TaskPatch[keyof TaskPatch]>): unknown {
  if (key === "hasTime") return value ? 1 : 0;
  if (key === "repeat") return formatRepeat(value as Task["repeat"]);
  return value;
}

/**
 * Edita campos sueltos.
 *
 * Con un efecto que no está en el parche: **quitar la fecha quita la regla**. Una repetición
 * es una fecha que se mueve sola, así que sin fecha de la que partir no queda nada que mover;
 * dejarla guardada sería un ajuste puesto que no hace nada y que reviviría solo al volver a
 * poner una fecha cualquiera, meses después y sin que nadie lo pidiera.
 */
export async function updateTask(id: string, patch: TaskPatch): Promise<TaskPatch> {
  const values: TaskPatch =
    patch.dueAt === null && patch.repeat === undefined ? { ...patch, repeat: null } : patch;

  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(PATCH_COLUMNS) as [keyof TaskPatch, string][]) {
    const value = values[key];
    if (value === undefined) continue;
    assignments.push(`${column} = $${params.length + 1}`);
    params.push(value === null ? null : toColumn(key, value));
  }

  if (!assignments.length) return values;

  params.push(id);
  await execute(
    `UPDATE tasks SET ${assignments.join(", ")} WHERE id = $${params.length}`,
    params,
  );

  // Lo que de verdad se escribió, que puede llevar algo que el parche no traía. Quien mantiene
  // una copia en memoria de la fila la actualiza con esto y no con lo que pidió.
  return values;
}

/**
 * Colgar una tarea de otra. El único nivel permitido lo defiende un disparador de la base,
 * así que esto falla con un error de SQLite si se intenta anidar de más — es lo que se
 * quiere: la regla no depende de que la UI se acuerde.
 */
export async function setTaskParent(id: string, parentId: string | null): Promise<void> {
  await execute(`UPDATE tasks SET parent_id = $1 WHERE id = $2`, [parentId, id]);
}

/**
 * Borra la tarea y devuelve lo que se llevó por delante — ella y sus subtareas, que caen por
 * la clave foránea. Es lo que necesita ⌘Z para reponerlas tal cual estaban.
 */
export async function deleteTask(id: string): Promise<Task[]> {
  const rows = await select<Row>(
    `SELECT ${COLUMNS} FROM tasks WHERE id = $1 OR parent_id = $2 ${ORDER}`,
    [id, id],
  );
  await execute(`DELETE FROM tasks WHERE id = $1`, [id]);
  return rows.map(toTask);
}

/**
 * Repone tareas borradas, con su id y su posición originales. Va en una sola sentencia para
 * que no pueda quedar la padre puesta y las hijas no; por eso mismo las padres tienen que ir
 * primero en la lista de valores, o la clave foránea rechaza a la hija que llega antes.
 */
export async function restoreTasks(tasks: Task[]): Promise<void> {
  if (!tasks.length) return;

  const ordered = [...tasks].sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null));
  const params: unknown[] = [];
  const tuples = ordered.map((task) => {
    const values = [
      task.id,
      task.title,
      task.notes,
      task.projectId,
      task.parentId,
      task.dueAt,
      task.hasTime ? 1 : 0,
      task.priority,
      task.completedAt,
      task.position,
      task.createdAt,
      formatRepeat(task.repeat),
      task.repeatFrom,
    ];
    const tuple = `(${placeholders(values.length, params.length + 1)})`;
    params.push(...values);
    return tuple;
  });

  await execute(`INSERT INTO tasks (${COLUMNS}) VALUES ${tuples.join(", ")}`, params);
}

/**
 * Completar. Devuelve exactamente qué filas cambiaron: la tarea y, si era una padre, las
 * subtareas que estaban pendientes — el disparador `tasks_completar_subtareas` las arrastra
 * en la misma transacción. Deshacer usa esa lista para no descompletar de más.
 *
 * Si la tarea ya estaba completada no cambia nada y la lista vuelve vacía.
 *
 * Y es donde vive la repetición: una tarea con regla deja detrás su instancia siguiente. Se
 * hace aquí, en la capa de datos, y no en el manejador de la casilla, porque completar entra
 * por más de una puerta — la fila, el detalle, el botón del aviso del sistema (§7)— y una
 * repetición que dependiera de por dónde se entró no sería una regla, sería una casualidad.
 */
export async function completeTask(id: string): Promise<Completion> {
  const at = localIso();
  const before = await getTask(id);
  const pending = await select<{ id: string }>(
    `SELECT id FROM tasks WHERE parent_id = $1 AND completed_at IS NULL`,
    [id],
  );

  const changed = await execute(
    `UPDATE tasks SET completed_at = $1 WHERE id = $2 AND completed_at IS NULL`,
    [at, id],
  );
  if (!changed) return { ids: [], at, spawned: null };

  return {
    ids: [id, ...pending.map((row) => row.id)],
    at,
    spawned: before ? await spawnNext(before, at) : null,
  };
}

/**
 * La instancia siguiente de una tarea recurrente, o nula si no había regla, no había fecha, o
 * la regla no llega a ninguna parte.
 *
 * **La regla se muda.** La tarea que se acaba de completar la pierde y la nueva la hereda, así
 * que lo que queda en Completadas es un registro de lo que se hizo aquel día y no una plantilla
 * viva. Sin esto, descompletar desde Completadas y volver a marcar fabricaría una segunda
 * instancia de la misma vuelta, y la lista tendría dos «Pagar impuestos» de septiembre sin que
 * nadie hubiera escrito la segunda.
 *
 * Las subtareas se copian sin completar: una tarea recurrente con lista de comprobación —los
 * cuatro pasos de cerrar el mes— no sirve de nada si la vuelta siguiente llega con los cuatro
 * ya tachados.
 *
 * La posición se copia tal cual. Es la misma escala para todas las tareas y el empate lo rompe
 * la antigüedad (`ORDER`), así que la nueva cae exactamente en el hueco que deja la vieja al
 * salir de la lista, sin renumerar nada y sin aterrizar al final.
 */
async function spawnNext(task: Task, completedAt: string): Promise<TaskTree | null> {
  // Solo las raíces. Una subtarea no lleva regla (`createTask` la deja fuera), pero un archivo
  // importado a mano sí podría traerla, y aquí es donde no cuesta nada ignorarla.
  if (!task.repeat || !task.dueAt || task.parentId !== null) return null;

  const due = nextDue(task.repeat, task.dueAt, task.repeatFrom, completedAt);
  if (due === null) return null;

  const id = crypto.randomUUID();
  await execute(
    `INSERT INTO tasks (${COLUMNS})
     VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, NULL, $8, $9, $10, $11)`,
    [
      id,
      task.title,
      task.notes,
      task.projectId,
      due,
      task.hasTime ? 1 : 0,
      task.priority,
      task.position,
      localIso(),
      formatRepeat(task.repeat),
      task.repeatFrom,
    ],
  );

  // La regla se va con la nueva. Se escribe después de insertarla: si el INSERT falla, la
  // vieja conserva la suya y la vuelta siguiente sigue existiendo.
  await execute(`UPDATE tasks SET repeat = NULL WHERE id = $1`, [task.id]);

  const children = await subtasksOf([task.id]);
  const born = await getTask(id);
  if (!born) throw new Error("la repetición se insertó pero no se pudo releer");

  const subtasks: Task[] = [];
  for (const child of children) {
    subtasks.push(
      await createTask({
        parentId: id,
        title: child.title,
        notes: child.notes,
        priority: child.priority,
      }),
    );
  }

  return { ...born, subtasks };
}

/**
 * Deshace la repetición que dejó `completeTask`: borra la instancia nueva y devuelve la regla
 * a la tarea de la que salió.
 *
 * Es el par exacto de `spawnNext`, y por eso vive aquí y no en el manejador de la casilla: los
 * tres segundos de gracia (§3.6) tienen que dejar la base como estaba, no *casi* como estaba.
 */
export async function undoSpawn(spawned: Task, source: Task): Promise<void> {
  await execute(`DELETE FROM tasks WHERE id = $1`, [spawned.id]);
  await execute(`UPDATE tasks SET repeat = $1 WHERE id = $2`, [
    formatRepeat(source.repeat),
    source.id,
  ]);
}

/**
 * Descompletar. Nunca toca a la padre de una subtarea: el spec dice que completar todas las
 * hijas no completa a la madre, y lo simétrico — descompletar una hija — tampoco la revive.
 */
export async function uncompleteTasks(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await execute(
    `UPDATE tasks SET completed_at = NULL WHERE id IN (${placeholders(ids.length)})`,
    ids,
  );
}

export async function moveTask(id: string, { after, before }: Between): Promise<void> {
  const neighbours = await positionsOf([after, before]);
  const a = after === null ? null : neighbours.get(after) ?? null;
  const b = before === null ? null : neighbours.get(before) ?? null;

  if (needsRenumber(a, b)) {
    await renumberTasks();
    return moveTask(id, { after, before });
  }

  await execute(`UPDATE tasks SET position = $1 WHERE id = $2`, [between(a, b), id]);
}

async function positionsOf(ids: (string | null)[]): Promise<Map<string, number>> {
  const wanted = ids.filter((id): id is string => id !== null);
  if (!wanted.length) return new Map();

  const rows = await select<{ id: string; position: number }>(
    `SELECT id, position FROM tasks WHERE id IN (${placeholders(wanted.length)})`,
    wanted,
  );
  return new Map(rows.map((row) => [row.id, row.position]));
}

/**
 * `position` es una sola escala para todas las tareas, así que renumerar es renumerar todo,
 * respetando el orden que ya se ve. Pasa cuando el hueco entre dos vecinas se agota, o sea
 * casi nunca — y aun así es una sentencia sobre una base local de unas pocas miles de filas.
 */
async function renumberTasks(): Promise<void> {
  await execute(
    `UPDATE tasks SET position = (
       SELECT ordenado.fila * ${STEP}.0
         FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position, created_at, id) AS fila
                 FROM tasks) AS ordenado
        WHERE ordenado.id = tasks.id
     )`,
  );
}
