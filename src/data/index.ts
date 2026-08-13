/**
 * La capa de datos. Todo el SQL de la app vive aquí dentro; la UI no importa
 * `@tauri-apps/plugin-sql` en ningún lado.
 */

export * from "./types";
export * from "./projects";
export * from "./tasks";
export { localDay, localIso, dayOf } from "./time";
export { db } from "./db";
