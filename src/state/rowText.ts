/**
 * Cuánto texto enseña una fila de la lista.
 *
 * Entero, de omisión. La fila iba a una sola línea con corte por elipsis, y eso escondía justo
 * lo que hace falta para decidir: un título cortado a la mitad obliga a abrir el detalle para
 * saber de qué tarea se trata, y quien escribe títulos largos los escribe en todas. Así que
 * ahora el título se parte en los renglones que pida y las notas asoman debajo, como en
 * Recordatorios; «Compacto» es la vuelta a una línea para quien prefiera ver más filas que más
 * texto. Una preferencia de la persona y no un desplegable por tarea.
 *
 * No es un dato, es una preferencia de esta máquina, así que va a `localStorage` con la vista de
 * arranque, y no a SQLite con la retención.
 */

export type RowText = "completo" | "una";

export const ROW_TEXTS: { value: RowText; label: string }[] = [
  { value: "completo", label: "Completo" },
  { value: "una", label: "Compacto" },
];

export const DEFAULT_ROW_TEXT: RowText = "completo";

/**
 * Con versión en el nombre a propósito. La clave de antes guardaba «una» para casi todo el
 * mundo —era lo de omisión, y elegirlo una vez lo dejaba escrito— y el rediseño existe para que
 * las tareas se lean enteras: heredar la elección vieja dejaría la queja exactamente donde
 * estaba. Quien quiera la línea corta la vuelve a elegir en un clic.
 */
const KEY = "riel:texto-de-la-fila@2";

/** Lo guardado, o el texto entero. Un valor que no reconozcamos cae en el de omisión. */
export function storedRowText(): RowText {
  const saved = localStorage.getItem(KEY);
  return ROW_TEXTS.some((option) => option.value === saved) ? (saved as RowText) : DEFAULT_ROW_TEXT;
}

export function storeRowText(value: RowText): void {
  localStorage.setItem(KEY, value);
}
