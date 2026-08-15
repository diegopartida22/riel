/**
 * Cuánto texto enseña una fila de la lista.
 *
 * La fila del spec (sección 3.5) va a una sola línea con corte por elipsis, y eso sigue siendo
 * lo de omisión: es lo que mantiene la lista escaneable de un vistazo y lo que permite trazar
 * el tachado de izquierda a derecha al completar (sección 3.6). Pero un título largo cortado a
 * la mitad obliga a abrir el detalle para saber de qué tarea se trata, y quien escribe títulos
 * largos lo hace en todas, así que la elección es de la persona y no de cada fila: un ajuste,
 * no un desplegable por tarea.
 *
 * No es un dato, es una preferencia de esta máquina, así que va a `localStorage` con el riel y
 * la vista de arranque, y no a SQLite con la retención.
 */

export type RowText = "una" | "completo";

export const ROW_TEXTS: { value: RowText; label: string }[] = [
  { value: "una", label: "Una línea" },
  { value: "completo", label: "Completo" },
];

export const DEFAULT_ROW_TEXT: RowText = "una";

const KEY = "riel:texto-de-la-fila";

/** Lo guardado, o una línea. Un valor que no reconozcamos cae en el de omisión. */
export function storedRowText(): RowText {
  const saved = localStorage.getItem(KEY);
  return ROW_TEXTS.some((option) => option.value === saved) ? (saved as RowText) : DEFAULT_ROW_TEXT;
}

export function storeRowText(value: RowText): void {
  localStorage.setItem(KEY, value);
}
