/**
 * Los ajustes que se guardan (spec 8). Hoy solo la retención de completadas: abrir al iniciar
 * sesión lo guarda el sistema en `~/Library/LaunchAgents` y el permiso de notificaciones lo
 * guarda macOS, así que ninguno de los dos necesita fila aquí.
 */

import { execute, select } from "./db";

/**
 * Días que se conservan las completadas antes del barrido. `null` es «siempre».
 *
 * El spec fija 30 por omisión y las opciones 7 / 30 / 90 / siempre.
 */
export type Retention = 7 | 30 | 90 | null;

/**
 * `short` es lo que se dibuja en la fila de opciones de Ajustes, donde las cuatro tienen que
 * caber una junto a otra; `label` es lo que se lee —el tooltip y el nombre para quien navega
 * a ciegas— y ahí «7 d» no vale.
 */
export const RETENTIONS: { value: Retention; label: string; short: string }[] = [
  { value: 7, label: "7 días", short: "7 d" },
  { value: 30, label: "30 días", short: "30 d" },
  { value: 90, label: "90 días", short: "90 d" },
  { value: null, label: "Siempre", short: "Siempre" },
];

export const DEFAULT_RETENTION: Retention = 30;

const KEY = "retention";
/** Cómo se escribe «siempre» en la tabla. Una cadena, porque la columna es TEXT. */
const FOREVER = "siempre";

/**
 * Lo guardado, o el valor por omisión. Un valor que no reconozcamos —una versión futura que
 * añada opciones y luego se vuelva atrás— cae en el de omisión en vez de romper el arranque.
 */
export async function getRetention(): Promise<Retention> {
  const rows = await select<{ value: string }>("SELECT value FROM settings WHERE key = $1", [KEY]);
  const stored = rows[0]?.value;
  if (stored === undefined) return DEFAULT_RETENTION;
  if (stored === FOREVER) return null;

  const days = Number(stored);
  return RETENTIONS.some((option) => option.value === days) ? (days as Retention) : DEFAULT_RETENTION;
}

export async function setRetention(retention: Retention): Promise<void> {
  await execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [KEY, retention === null ? FOREVER : String(retention)],
  );
}
