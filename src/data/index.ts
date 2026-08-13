/**
 * La capa de datos. Todo el SQL de la app vive aquí dentro; la UI no importa
 * `@tauri-apps/plugin-sql` en ningún lado.
 */

export * from "./types";
export * from "./projects";
export * from "./tasks";
export * from "./settings";
export * from "./backup";
export { localDay, localIso, dayOf, nextDay } from "./time";
export { db, dbPath } from "./db";
