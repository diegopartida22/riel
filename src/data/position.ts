/**
 * `position` es un REAL para poder soltar algo entre dos vecinos escribiendo una sola fila,
 * en vez de renumerar la lista entera en cada arrastre (spec, sección 2).
 *
 * El precio es que partir el hueco a la mitad lo agota: a partir de unas 50 inserciones
 * seguidas en el mismo punto, `(a + b) / 2` devuelve `a` y dos filas empatan. Eso no se ve
 * como un error, se ve como que el orden dejó de obedecer — así que hay que detectarlo y
 * renumerar. `needsRenumber` es esa detección, y cada módulo trae su propio renumerado.
 */

/** Separación entre elementos consecutivos cuando se numera desde cero. */
export const STEP = 1024;

/**
 * Por debajo de esto el hueco ya no da para muchas más mitades. Es holgado a propósito: un
 * renumerado de más no cuesta nada y un empate sí.
 */
const MIN_GAP = 1e-6;

/** La posición para caer entre dos vecinos. `null` es el borde de la lista. */
export function between(after: number | null, before: number | null): number {
  if (after === null && before === null) return 0;
  if (after === null) return before! - STEP;
  if (before === null) return after + STEP;
  return (after + before) / 2;
}

/** Cierto cuando el hueco entre los dos vecinos ya no aguanta otra mitad. */
export function needsRenumber(after: number | null, before: number | null): boolean {
  if (after === null || before === null) return false;
  return Math.abs(before - after) < MIN_GAP;
}
