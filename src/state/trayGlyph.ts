/**
 * Qué glifo dibuja el icono de la barra de menú.
 *
 * El spec (sección 4) fija dos cosas que no se eligen: que la imagen sea *template* monocroma
 * y que el aviso de vencidas sea un cambio de peso y no un badge numérico. Lo que sí se elige
 * es la silueta, porque la barra es del usuario y no de la app: en una barra con quince extras
 * lo que hace falta es reconocer el propio de un vistazo, y para eso lo que importa no es qué
 * icono sea el «correcto» sino que no se parezca a sus vecinos.
 *
 * Los cinco los genera `scripts/make-tray-icons.mjs`, que escribe los PNG dos veces: los diez
 * que Rust mete en el binario y las cinco previsualizaciones de `public/tray/` que salen en
 * Ajustes.
 *
 * Va a `localStorage` con el riel y la vista de arranque, no a SQLite con la retención: perder
 * esto devuelve el icono de omisión y no borra nada. Como está en el webview, Rust no lo puede
 * leer al arrancar y hay que mandárselo — igual que el peso, que también depende de datos que
 * Rust no lee, así que el icono ya dependía del frontend para verse bien.
 */

import { invoke } from "@tauri-apps/api/core";

export type TrayGlyph = "casilla" | "palomita" | "lista" | "disco" | "cuadro";

/** El orden es el de Ajustes, y tiene que coincidir con el de `GLYPHS` en `tray.rs`. */
export const TRAY_GLYPHS: { value: TrayGlyph; label: string }[] = [
  { value: "casilla", label: "Casilla" },
  { value: "palomita", label: "Palomita" },
  { value: "lista", label: "Lista" },
  { value: "disco", label: "Disco" },
  { value: "cuadro", label: "Cuadro" },
];

export const DEFAULT_TRAY_GLYPH: TrayGlyph = "casilla";

const KEY = "riel:glifo-de-la-barra";

/** Lo guardado, o la casilla. Un valor que no reconozcamos cae en el de omisión. */
export function storedTrayGlyph(): TrayGlyph {
  const saved = localStorage.getItem(KEY);
  return TRAY_GLYPHS.some((option) => option.value === saved)
    ? (saved as TrayGlyph)
    : DEFAULT_TRAY_GLYPH;
}

export function storeTrayGlyph(value: TrayGlyph): void {
  localStorage.setItem(KEY, value);
}

/**
 * Se lo pasa a Rust, que es quien tiene los PNG y el icono.
 *
 * Un fallo aquí deja el glifo de omisión en la barra y nada más: no hay nada que decirle al
 * usuario que no vea ya mirando arriba, así que no se dibuja error (§3.8).
 */
export function applyTrayGlyph(value: TrayGlyph): void {
  void invoke("set_tray_glyph", { glyph: value }).catch((cause) => console.error(cause));
}
