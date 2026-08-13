/**
 * El export a JSON de la sección 8 del spec.
 *
 * Va en la forma del dominio —`projectId`, `hasTime`— y no en la de las filas de SQLite. El
 * archivo es para leerlo o para llevárselo a otro lado; que se parezca al esquema interno solo
 * serviría para atar el formato a decisiones que pueden cambiar en la próxima migración.
 */

import { listProjects } from "./projects";
import { allTasks } from "./tasks";
import { localIso } from "./time";
import type { Project, Task } from "./types";

export interface Snapshot {
  app: "Riel";
  exportedAt: string;
  projects: Project[];
  tasks: Task[];
}

/** El nombre que propone el panel de guardar: ordena solo al listarlos por nombre. */
export const exportName = () => `riel-${localIso().slice(0, 10)}.json`;

export async function snapshot(): Promise<string> {
  const [projects, tasks] = await Promise.all([listProjects(), allTasks()]);
  const data: Snapshot = { app: "Riel", exportedAt: localIso(), projects, tasks };
  // Con sangría: un export que no se puede abrir y leer es medio export.
  return JSON.stringify(data, null, 2);
}
