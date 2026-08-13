import { appDataDir, join } from "@tauri-apps/api/path";
import Database from "@tauri-apps/plugin-sql";

/** El mismo nombre que registra las migraciones en `src-tauri/src/db.rs`. */
const URL = "sqlite:riel.db";
const FILE = "riel.db";

/**
 * La ruta absoluta del archivo, para el enlace a los datos en Finder (spec 8). El plugin
 * resuelve `sqlite:riel.db` contra el directorio de datos de la app, así que se arma igual.
 */
export function dbPath(): Promise<string> {
  return appDataDir().then((dir) => join(dir, FILE));
}

let connection: Promise<Database> | null = null;

/**
 * `Database.load` corre las migraciones pendientes, así que la primera llamada es la que
 * crea el esquema. Se guarda la promesa, no la conexión: si dos vistas piden la base a la
 * vez durante el arranque, las dos esperan la misma carga en vez de abrir dos.
 */
export function db(): Promise<Database> {
  connection ??= Database.load(URL);
  return connection;
}

export async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db()).select<T[]>(sql, params);
}

export async function execute(sql: string, params: unknown[] = []): Promise<number> {
  const result = await (await db()).execute(sql, params);
  return result.rowsAffected;
}

/**
 * `$1, $2, …` para un `IN`. SQLite no acepta un arreglo como un solo parámetro, y pegar los
 * ids en el SQL a mano es justo la forma de acabar con una inyección en una app que no la
 * necesitaba.
 */
export function placeholders(count: number, from = 1): string {
  return Array.from({ length: count }, (_, i) => `$${from + i}`).join(", ");
}
