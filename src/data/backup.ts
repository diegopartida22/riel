/**
 * El export a JSON de la sección 8 del spec.
 *
 * Va en la forma del dominio —`projectId`, `hasTime`— y no en la de las filas de SQLite. El
 * archivo es para leerlo o para llevárselo a otro lado; que se parezca al esquema interno solo
 * serviría para atar el formato a decisiones que pueden cambiar en la próxima migración.
 */

import { invoke } from "@tauri-apps/api/core";

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

/**
 * La copia que se guarda sola antes de importar, en `Backups/` dentro del directorio de datos.
 * Devuelve la ruta escrita.
 *
 * Es lo que hace que reemplazar sea una decisión y no una apuesta: el deshacer de una
 * importación no cabe en la pila de ⌘Z —son miles de filas y dos tablas— así que el respaldo
 * *es* el deshacer, y por eso se escribe siempre, también al combinar. Un import que solo
 * agrega parece inofensivo hasta el día que el archivo trae mil tareas que nadie esperaba.
 *
 * Con la hora en el nombre y no solo el día: en la misma tarde se prueban varios archivos, y
 * un respaldo que pisa al anterior deja de ser un respaldo en el segundo intento.
 */
export async function safetyBackup(): Promise<string> {
  const at = localIso().replace(/[:T]/g, "-");
  return invoke<string>("write_backup", {
    name: `riel-antes-de-importar-${at}.json`,
    contents: await snapshot(),
  });
}
