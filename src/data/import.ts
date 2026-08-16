/**
 * La importación del JSON (spec 8).
 *
 * Es la contraparte de `snapshot()`: lee la misma forma del dominio que escribe el export, no
 * las filas de SQLite. Y va en tres tiempos separados a propósito —validar, planear, aplicar—
 * porque los tres fallan por razones distintas y solo el último toca la base:
 *
 * - `parseSnapshot` mira el archivo y nada más. Es puro, así que el resumen se puede enseñar
 *   sin haber escrito una fila.
 * - `planImport` lo cruza con lo que ya hay y cuenta qué se repite. Consulta, no escribe.
 * - `applyImport` es el único que escribe, y lo hace después de que alguien haya dicho que sí.
 *
 * El orden importa porque un import a medias es peor que uno que no empezó: la validación
 * completa por delante es lo que hace que el archivo entero se rechace antes y no en la fila
 * número doscientos, con las ciento noventa y nueve anteriores ya dentro.
 */

import type { Snapshot } from "./backup";
import { execute, select } from "./db";
import { STEP } from "./position";
import { listProjects } from "./projects";
import { allTasks } from "./tasks";
import { localIso } from "./time";
import type { Priority, Project, Task } from "./types";

/** Hex `#RRGGBB`, el mismo formato que valida el selector de color (spec 3.2). */
const HEX = /^#[0-9a-fA-F]{6}$/;

/** `2026-08-12T14:30:00` o `2026-08-12`. Lo que no se pueda ordenar como texto no sirve. */
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;

export type Parsed =
  | { ok: true; snapshot: Snapshot }
  /** Qué está mal y dónde, nombrando el campo. Se enseña tal cual (spec 3.8). */
  | { ok: false; problem: string };

/** Qué hacer con lo que ya hay. */
export type ImportMode = "combinar" | "reemplazar";

export interface ImportPlan {
  projects: Project[];
  tasks: Task[];
  /** Cuántos del archivo ya están en la base, por id. Es lo que distingue los dos modos. */
  knownProjects: number;
  knownTasks: number;
  /** Lo que hay ahora mismo. Es la cifra que tiene que decir el aviso de reemplazar. */
  currentProjects: number;
  currentTasks: number;
  /** Cuántas entran sin proyecto porque el suyo no estaba. Se dice en el resumen. */
  orphaned: number;
}

// ── Validación ─────────────────────────────────────────────────────────────────────────

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Un campo de texto obligatorio y no vacío. */
function text(row: Record<string, unknown>, field: string, where: string): string {
  const value = row[field];
  if (typeof value !== "string") throw new Error(`${where}: «${field}» tiene que ser texto.`);
  if (!value) throw new Error(`${where}: «${field}» está vacío.`);
  return value;
}

/** Un campo que puede ser texto o nulo, pero tiene que estar. */
function maybeText(row: Record<string, unknown>, field: string, where: string): string | null {
  const value = row[field];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${where}: «${field}» tiene que ser texto o nulo.`);
  }
  return value;
}

function number(row: Record<string, unknown>, field: string, where: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${where}: «${field}» tiene que ser un número.`);
  }
  return value;
}

function stamp(row: Record<string, unknown>, field: string, where: string): string {
  const value = text(row, field, where);
  if (!ISO.test(value)) {
    throw new Error(`${where}: «${field}» no es una fecha ISO («${value}»).`);
  }
  return value;
}

function project(value: unknown, index: number): Project {
  const where = `projects[${index}]`;
  if (!isObject(value)) throw new Error(`${where}: tendría que ser un objeto.`);

  const color = text(value, "color", where);
  if (!HEX.test(color)) {
    throw new Error(`${where}: «color» tiene que ser un hex #RRGGBB («${color}»).`);
  }

  return {
    id: text(value, "id", where),
    name: text(value, "name", where),
    color,
    position: number(value, "position", where),
    createdAt: stamp(value, "createdAt", where),
  };
}

function task(value: unknown, index: number): Task {
  const where = `tasks[${index}]`;
  if (!isObject(value)) throw new Error(`${where}: tendría que ser un objeto.`);

  const priority = number(value, "priority", where);
  if (priority !== 0 && priority !== 1 && priority !== 2) {
    throw new Error(`${where}: «priority» solo puede ser 0, 1 o 2 (es ${priority}).`);
  }

  if (typeof value.hasTime !== "boolean") {
    throw new Error(`${where}: «hasTime» tiene que ser true o false.`);
  }

  const dueAt = maybeText(value, "dueAt", where);
  if (dueAt !== null && !ISO.test(dueAt)) {
    throw new Error(`${where}: «dueAt» no es una fecha ISO («${dueAt}»).`);
  }

  const completedAt = maybeText(value, "completedAt", where);
  if (completedAt !== null && !ISO.test(completedAt)) {
    throw new Error(`${where}: «completedAt» no es una fecha ISO («${completedAt}»).`);
  }

  return {
    id: text(value, "id", where),
    title: text(value, "title", where),
    notes: maybeText(value, "notes", where),
    projectId: maybeText(value, "projectId", where),
    parentId: maybeText(value, "parentId", where),
    dueAt,
    hasTime: value.hasTime,
    priority: priority as Priority,
    completedAt,
    position: number(value, "position", where),
    createdAt: stamp(value, "createdAt", where),
  };
}

/**
 * Valida el archivo entero antes de que nadie vea un resumen.
 *
 * Nombra el campo y no la línea: un export sale con sangría, pero un JSON que pasó por otra
 * herramienta puede venir en una sola línea, y ahí «línea 1» no localiza nada. `tasks[12]:
 * «title» está vacío` sí.
 */
export function parseSnapshot(contents: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch (cause) {
    return { ok: false, problem: `El archivo no es JSON válido. ${(cause as Error).message}` };
  }

  try {
    if (!isObject(raw)) throw new Error("El archivo tendría que empezar con un objeto.");

    // La marca del export. Sin ella, un JSON cualquiera con un arreglo `tasks` pasaría por un
    // respaldo de Riel y llegaría a la base con una forma que no es la suya.
    if (raw.app !== "Riel") {
      throw new Error(
        raw.app === undefined
          ? "Falta el campo «app», así que el archivo no es un export de Riel."
          : `El archivo dice ser de «${String(raw.app)}» y no de Riel.`,
      );
    }

    if (!Array.isArray(raw.projects)) throw new Error("Falta el arreglo «projects».");
    if (!Array.isArray(raw.tasks)) throw new Error("Falta el arreglo «tasks».");

    const projects = raw.projects.map(project);
    const tasks = raw.tasks.map(task);

    // Ids repetidos dentro del propio archivo. La base los rechazaría de todos modos por la
    // clave primaria, pero a mitad del volcado y con la mitad anterior ya dentro.
    const projectIds = new Set<string>();
    for (const each of projects) {
      if (projectIds.has(each.id)) throw new Error(`El proyecto «${each.id}» está dos veces.`);
      projectIds.add(each.id);
    }

    const taskIds = new Set<string>();
    for (const each of tasks) {
      if (taskIds.has(each.id)) throw new Error(`La tarea «${each.id}» está dos veces.`);
      taskIds.add(each.id);
    }

    // Un solo nivel de subtareas (spec 2). El disparador de la base lo defiende igual, pero
    // aquí se puede decir cuál es la tarea que sobra en vez de dejar salir un error de SQLite.
    const roots = new Set(tasks.filter((each) => each.parentId === null).map((each) => each.id));
    for (const each of tasks) {
      if (each.parentId === null) continue;
      if (each.parentId === each.id) {
        throw new Error(`La tarea «${each.title}» cuelga de sí misma.`);
      }
      if (taskIds.has(each.parentId) && !roots.has(each.parentId)) {
        throw new Error(
          `La tarea «${each.title}» es subtarea de otra subtarea, y solo hay un nivel.`,
        );
      }
    }

    return {
      ok: true,
      snapshot: {
        app: "Riel",
        exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : localIso(),
        projects,
        tasks,
      },
    };
  } catch (cause) {
    return { ok: false, problem: (cause as Error).message };
  }
}

// ── Plan ───────────────────────────────────────────────────────────────────────────────

/**
 * Cruza el archivo con lo que ya hay: cuánto se repite, y si las referencias que el archivo no
 * resuelve por sí solo las resuelve la base.
 *
 * Lo segundo importa para un archivo editado a mano, que puede traer una tarea colgada de una
 * que ya está puesta o dentro de un proyecto que ya existe. Un export completo de Riel no
 * necesita nada de esto —trae siempre todos sus proyectos— pero fallar con un error de clave
 * foránea a medio volcado no es una respuesta.
 */
export async function planImport(snapshot: Snapshot): Promise<
  { ok: true; plan: ImportPlan } | { ok: false; problem: string }
> {
  const [existingProjects, existingTasks] = await Promise.all([listProjects(), allTasks()]);

  const projectIds = new Set(existingProjects.map((each) => each.id));
  const fileProjectIds = new Set(snapshot.projects.map((each) => each.id));
  /** Las de la base que ya son subtareas: nada del archivo puede colgarse de ellas. */
  const existingSubtasks = new Set(
    existingTasks.filter((each) => each.parentId !== null).map((each) => each.id),
  );
  const taskIds = new Set(existingTasks.map((each) => each.id));
  const fileRoots = new Set(
    snapshot.tasks.filter((each) => each.parentId === null).map((each) => each.id),
  );

  /**
   * Las tareas cuyo proyecto no existe en ninguna parte entran sin proyecto, no tumban el
   * archivo. Es exactamente lo que ya hace `ON DELETE SET NULL` cuando se borra un proyecto
   * (spec 2): una tarea sin proyecto es un estado normal de la app, no un dato roto.
   *
   * Un export de Riel nunca llega aquí —siempre lleva todos sus proyectos— así que esto solo
   * lo pisa un archivo editado a mano, y rechazarlo entero por una referencia colgada sería
   * tirar doscientas tareas buenas por una mala. Lo que no se hace es callárselo: la cifra va
   * en el resumen antes de que nadie confirme.
   */
  const tasks = snapshot.tasks.map((each) =>
    each.projectId !== null &&
    !fileProjectIds.has(each.projectId) &&
    !projectIds.has(each.projectId)
      ? { ...each, projectId: null }
      : each,
  );
  const orphaned = tasks.filter(
    (each, index) => each.projectId === null && snapshot.tasks[index].projectId !== null,
  ).length;

  for (const each of snapshot.tasks) {
    if (each.parentId === null) continue;

    if (!fileRoots.has(each.parentId)) {
      if (!taskIds.has(each.parentId)) {
        return {
          ok: false,
          problem: `La subtarea «${each.title}» cuelga de una tarea que no está ni en el archivo ni en Riel.`,
        };
      }
      if (existingSubtasks.has(each.parentId)) {
        return {
          ok: false,
          problem: `La subtarea «${each.title}» cuelga de una tarea que en Riel ya es subtarea, y solo hay un nivel.`,
        };
      }
    }
  }

  return {
    ok: true,
    plan: {
      projects: snapshot.projects,
      tasks,
      knownProjects: snapshot.projects.filter((each) => projectIds.has(each.id)).length,
      knownTasks: tasks.filter((each) => taskIds.has(each.id)).length,
      currentProjects: existingProjects.length,
      currentTasks: existingTasks.length,
      orphaned,
    },
  };
}

// ── Escritura ──────────────────────────────────────────────────────────────────────────

/**
 * Cuántos parámetros como mucho por sentencia.
 *
 * SQLite acepta bastantes más, pero el tope depende de con qué se compiló y no es algo que se
 * pueda comprobar desde aquí. Mil es cómodo en cualquier versión y parte un import de diez mil
 * tareas en unos cientos de sentencias, que sobre un archivo local no se nota.
 */
const MAX_PARAMS = 900;

const PROJECT_COLUMNS = "id, name, color, position, created_at";
const TASK_COLUMNS =
  "id, title, notes, project_id, parent_id, due_at, has_time, priority, completed_at, position, created_at";

/** Vuelca filas en tandas, cada una una sola sentencia. */
async function insertAll(
  table: string,
  columns: string,
  rows: unknown[][],
): Promise<void> {
  if (!rows.length) return;

  const width = rows[0].length;
  const perChunk = Math.max(1, Math.floor(MAX_PARAMS / width));

  for (let from = 0; from < rows.length; from += perChunk) {
    const chunk = rows.slice(from, from + perChunk);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const tuple = `(${row.map((_, i) => `$${params.length + i + 1}`).join(", ")})`;
      params.push(...row);
      return tuple;
    });
    await execute(`INSERT INTO ${table} (${columns}) VALUES ${tuples.join(", ")}`, params);
  }
}

const projectRow = (each: Project, offset: number): unknown[] => [
  each.id,
  each.name,
  each.color,
  each.position + offset,
  each.createdAt,
];

const taskRow = (each: Task, offset: number): unknown[] => [
  each.id,
  each.title,
  each.notes,
  each.projectId,
  each.parentId,
  each.dueAt,
  each.hasTime ? 1 : 0,
  each.priority,
  each.completedAt,
  each.position + offset,
  each.createdAt,
];

/**
 * Cuánto hay que correr las posiciones importadas para que caigan detrás de las que ya hay.
 *
 * Sin esto, dos listas hechas por separado empiezan las dos cerca de cero y lo importado se
 * intercala entre lo propio en un orden que no es el de ninguna de las dos. Corridas, lo
 * importado llega entero al final y conserva su orden relativo.
 */
async function offsetFor(table: string, rows: { position: number }[]): Promise<number> {
  if (!rows.length) return 0;

  const found = await select<{ top: number | null }>(`SELECT MAX(position) AS top FROM ${table}`);
  const top = found[0]?.top;
  if (top === null || top === undefined) return 0;

  const lowest = Math.min(...rows.map((each) => each.position));
  return top + STEP - lowest;
}

/**
 * Escribe. Es lo único de este archivo que toca la base, y solo se llama con un plan que ya
 * pasó por `planImport` y con un sí explícito de por medio.
 *
 * Combinar no pisa nada: lo que ya está por id se deja como está y solo entra lo que falta.
 * Que no se actualice lo repetido es deliberado —un respaldo de hace un mes no puede revivir
 * el título viejo de una tarea que se editó ayer— y es lo que hace que combinar sea seguro
 * sin preguntar nada más.
 *
 * Las padres van antes que las hijas porque la clave foránea rechazaría a una hija que llegue
 * primero. Los proyectos, antes que las dos, por lo mismo.
 *
 * No hay transacción: `tauri-plugin-sql` reparte las sentencias sobre un pool, así que un
 * BEGIN y su COMMIT pueden caer en conexiones distintas y no significarían nada. Lo que cubre
 * un fallo a mitad es el respaldo que se escribe antes de llamar aquí.
 */
export async function applyImport(plan: ImportPlan, mode: ImportMode): Promise<void> {
  if (mode === "reemplazar") {
    // Las tareas primero: son las que apuntan a los proyectos. Al revés, `ON DELETE SET NULL`
    // las desvincularía una por una para borrarlas enseguida.
    await execute("DELETE FROM tasks");
    await execute("DELETE FROM projects");
  }

  const known =
    mode === "combinar"
      ? await Promise.all([
          select<{ id: string }>("SELECT id FROM projects"),
          select<{ id: string }>("SELECT id FROM tasks"),
        ])
      : [[], []];

  const knownProjects = new Set(known[0].map((row) => row.id));
  const knownTasks = new Set(known[1].map((row) => row.id));

  const projects = plan.projects.filter((each) => !knownProjects.has(each.id));
  const tasks = plan.tasks.filter((each) => !knownTasks.has(each.id));

  // Reemplazando, las tablas quedaron vacías y no hay nada detrás de lo que ponerse: las
  // posiciones del archivo valen tal cual.
  const [projectOffset, taskOffset] =
    mode === "combinar"
      ? await Promise.all([offsetFor("projects", projects), offsetFor("tasks", tasks)])
      : [0, 0];

  await insertAll(
    "projects",
    PROJECT_COLUMNS,
    projects.map((each) => projectRow(each, projectOffset)),
  );

  await insertAll(
    "tasks",
    TASK_COLUMNS,
    tasks.filter((each) => each.parentId === null).map((each) => taskRow(each, taskOffset)),
  );

  await insertAll(
    "tasks",
    TASK_COLUMNS,
    tasks.filter((each) => each.parentId !== null).map((each) => taskRow(each, taskOffset)),
  );
}
