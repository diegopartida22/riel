/**
 * Comprobación de la capa de datos, para el paso 2 del orden de construcción.
 *
 * Todavía no hay UI que ejercite las reglas de la sección 2, y son justo las que no se pueden
 * dejar «para probar después»: un anidamiento de más o una cascada que no cascadea se
 * descubren cuando ya hay datos de verdad encima. Esto las ejercita contra la base real y
 * borra todo lo que creó al terminar.
 *
 * Se cae con el andamiaje: en cuanto la vista Hoy exista (paso 4), este archivo sobra.
 */

import { getProject, createProject, deleteProject } from "./projects";
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  moveTask,
  setTaskParent,
  subtasksOf,
  tasksDueBy,
  uncompleteTasks,
} from "./tasks";
import { localDay } from "./time";

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

let running: Promise<Check[]> | null = null;

/**
 * Una sola pasada por arranque. `StrictMode` monta el efecto dos veces en desarrollo, y dos
 * corridas a la vez escribiendo y borrando en la misma base se pisan.
 */
export function runSelfTest(): Promise<Check[]> {
  running ??= run();
  return running;
}

async function run(): Promise<Check[]> {
  const checks: Check[] = [];
  const litter: string[] = [];

  const check = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
      checks.push({ name, ok: true });
    } catch (error) {
      checks.push({ name, ok: false, detail: String(error) });
    }
  };

  /** Falla si `run` **no** revienta. Sirve para las reglas que la base tiene que rechazar. */
  const rejects = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch {
      return;
    }
    throw new Error("no falló, y tenía que fallar");
  };

  const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };

  try {
    const project = await createProject("· prueba", "#6B7280");
    let padre = await createTask({
      title: "padre",
      projectId: project.id,
      dueAt: `${localDay()}T09:00:00`,
      hasTime: true,
      priority: 2,
    });
    const suelta = await createTask({ title: "suelta", projectId: project.id });
    const hija1 = await createTask({ title: "hija 1", parentId: padre.id });
    const hija2 = await createTask({ title: "hija 2", parentId: padre.id });
    litter.push(padre.id, suelta.id);

    await check("el proyecto se guarda y se relee", async () => {
      const leido = await getProject(project.id);
      assert(leido?.name === "· prueba", "el nombre no volvió igual");
      assert(leido?.color === "#6B7280", "el color no volvió igual");
    });

    await check("la tarea guarda fecha, hora y prioridad", async () => {
      const leida = await getTask(padre.id);
      assert(leida?.hasTime === true, "hasTime no volvió como booleano");
      assert(leida?.priority === 2, "la prioridad no volvió igual");
      assert(leida?.projectId === project.id, "el proyecto no quedó asignado");
    });

    await check("aparece en Hoy porque vence hoy", async () => {
      const hoy = await tasksDueBy(localDay());
      assert(hoy.some((t) => t.id === padre.id), "la tarea de hoy no salió en Hoy");
      assert(!hoy.some((t) => t.id === hija1.id), "una subtarea se coló como tarea raíz");
    });

    await check("admite un nivel de subtareas", async () => {
      const hijas = await subtasksOf([padre.id]);
      assert(hijas.length === 2, `esperaba 2 subtareas, hay ${hijas.length}`);
      assert(hijas[0].position < hijas[1].position, "las subtareas no quedaron en orden");
    });

    await check("rechaza colgar una subtarea de otra subtarea", () =>
      rejects(() => createTask({ title: "nieta", parentId: hija1.id })),
    );

    await check("rechaza convertir en subtarea a una tarea que ya tiene hijas", () =>
      rejects(() => setTaskParent(padre.id, suelta.id)),
    );

    await check("completar las subtareas no completa la padre", async () => {
      await completeTask(hija1.id);
      await completeTask(hija2.id);
      const leida = await getTask(padre.id);
      assert(leida?.completedAt === null, "la padre se completó sola");
      await uncompleteTasks([hija1.id, hija2.id]);
    });

    await check("completar la padre completa sus subtareas", async () => {
      const hecho = await completeTask(padre.id);
      assert(hecho.ids.length === 3, `esperaba 3 filas afectadas, hubo ${hecho.ids.length}`);
      const hijas = await subtasksOf([padre.id]);
      assert(hijas.every((h) => h.completedAt !== null), "quedó una subtarea sin completar");
    });

    await check("deshacer devuelve exactamente lo que se completó", async () => {
      await completeTask(hija1.id); // ya estaba: no debe entrar en el deshacer
      const hecho = await completeTask(padre.id);
      assert(hecho.ids.length === 0, "volvió a completar algo que ya estaba completado");

      await uncompleteTasks([padre.id, hija1.id, hija2.id]);
      const leida = await getTask(padre.id);
      assert(leida?.completedAt === null, "la padre siguió completada");
    });

    await check("reordenar cae entre las dos vecinas", async () => {
      const uno = await createTask({ title: "uno" });
      const dos = await createTask({ title: "dos" });
      litter.push(uno.id, dos.id);

      await moveTask(suelta.id, { after: uno.id, before: dos.id });
      const movida = await getTask(suelta.id);
      assert(
        movida !== null && uno.position < movida.position && movida.position < dos.position,
        "la posición no quedó entre las dos",
      );
    });

    await check("borrar el proyecto deja las tareas sin proyecto", async () => {
      await deleteProject(project.id);
      const leida = await getTask(padre.id);
      assert(leida !== null, "borrar el proyecto se llevó la tarea");
      assert(leida?.projectId === null, "la tarea conservó un proyecto que ya no existe");
      padre = leida!;
    });

    await check("borrar la padre se lleva sus subtareas", async () => {
      const borradas = await deleteTask(padre.id);
      assert(borradas.length === 3, `esperaba 3 filas borradas, hubo ${borradas.length}`);
      assert((await getTask(hija1.id)) === null, "la subtarea sobrevivió a su padre");
    });
  } catch (error) {
    checks.push({ name: "el andamiaje del propio test", ok: false, detail: String(error) });
  } finally {
    for (const id of litter) {
      try {
        await deleteTask(id);
      } catch {
        // Ya no estaba: es lo esperado para lo que el propio test borró.
      }
    }
  }

  return checks;
}
