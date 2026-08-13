import { execute, placeholders, select } from "./db";
import { STEP, between, needsRenumber } from "./position";
import { localIso } from "./time";
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
}

const COLUMNS =
  "id, title, notes, project_id, parent_id, due_at, has_time, priority, completed_at, position, created_at";

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

// ── Escritura ──────────────────────────────────────────────────────────────────────────

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
            $9`,
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
};

export async function updateTask(id: string, patch: TaskPatch): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(PATCH_COLUMNS) as [keyof TaskPatch, string][]) {
    const value = patch[key];
    if (value === undefined) continue;
    assignments.push(`${column} = $${params.length + 1}`);
    params.push(key === "hasTime" ? (value ? 1 : 0) : value);
  }

  if (!assignments.length) return;

  params.push(id);
  await execute(
    `UPDATE tasks SET ${assignments.join(", ")} WHERE id = $${params.length}`,
    params,
  );
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
 */
export async function completeTask(id: string): Promise<Completion> {
  const at = localIso();
  const pending = await select<{ id: string }>(
    `SELECT id FROM tasks WHERE parent_id = $1 AND completed_at IS NULL`,
    [id],
  );

  const changed = await execute(
    `UPDATE tasks SET completed_at = $1 WHERE id = $2 AND completed_at IS NULL`,
    [at, id],
  );
  if (!changed) return { ids: [], at };

  return { ids: [id, ...pending.map((row) => row.id)], at };
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
