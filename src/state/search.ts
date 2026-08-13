/**
 * Búsqueda difusa (spec 1). Escrita a mano: el dominio son títulos cortos en español, y una
 * librería genérica traería un modelo de puntuación pensado para otra cosa —rutas de archivo,
 * normalmente— que aquí ordena peor de lo que ordena esto.
 *
 * «difusa» aquí significa subsecuencia: las letras de la consulta tienen que aparecer en el
 * texto en ese orden, pero no pegadas. Así `rnvr` encuentra «Renovar el dominio» y una letra
 * de más en medio de una palabra no vacía la lista.
 */

/** Un hueco del área de uso privado: no puede aparecer en un texto real. */
const NN = "";
const DIACRITICS = /[\u0300-\u036f]/g;

/**
 * Los acentos se ignoran en los dos sentidos: escribir `renovacion` tiene que encontrar
 * «Renovación», y escribir `renovación` tiene que encontrar una tarea escrita sin acento.
 *
 * La ñ **no** se pliega a n — en español son dos letras distintas, y confundirlas haría que
 * `ano` encontrara «año». Se aparta antes de descomponer, porque `NFD` la parte en `n` más
 * una tilde y el barrido de diacríticos la dejaría convertida en `n`.
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ñ", NN)
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replaceAll(NN, "ñ");
}

/** Puntos por letra que cae justo después de la anterior. Premia los tramos seguidos. */
const RUN_BONUS = 6;
/** Puntos por letra que abre palabra. Es lo que pone «Renovar el dominio» antes que otra
 *  tarea donde esas mismas letras caen sueltas a media palabra. */
const WORD_BONUS = 10;
/** Lo que cuesta cada letra saltada antes de la primera coincidencia. */
const LEAD_PENALTY = 0.4;
/** Lo que se le descuenta a una coincidencia que no fue en el título. */
const SECONDARY_PENALTY = 20;

const BOUNDARY = /[\s\-_/(«"']/;

const isBoundary = (text: string, index: number): boolean =>
  index === 0 || BOUNDARY.test(text[index - 1]);

/**
 * Puntúa una consulta contra un texto, o devuelve `null` si no casa.
 *
 * Recorre el texto una vez tomando la primera letra que sirve. No busca la combinación
 * óptima —eso es programación dinámica y aquí no compensa— pero el desempate por tramos
 * seguidos y por inicio de palabra deja el orden correcto en la práctica.
 */
export function score(query: string, text: string): number | null {
  const needle = fold(query);
  const hay = fold(text);
  if (!needle) return 0;
  if (needle.length > hay.length) return null;

  let points = 0;
  let at = 0;
  let previous = -1;

  for (const letter of needle) {
    const found = hay.indexOf(letter, at);
    if (found < 0) return null;

    // `previous >= 0` no sobra: sin él, una primera letra en el índice 0 cumple
    // `0 === -1 + 1` y cobra un tramo seguido que no existe. Con eso, «Dejar comentarios en el
    // diff» le ganaba a «Renovar el dominio» buscando `dom` — la letra suelta del principio
    // valía lo mismo que las tres pegadas.
    if (previous >= 0 && found === previous + 1) points += RUN_BONUS;
    if (isBoundary(hay, found)) points += WORD_BONUS;
    if (previous < 0) points -= found * LEAD_PENALTY;

    previous = found;
    at = found + 1;
  }

  // A igualdad de todo lo demás, gana el texto más corto: la coincidencia ocupa más de él.
  return points - hay.length * 0.05;
}

/**
 * Ordena una lista por lo bien que casa con la consulta. Cada elemento aporta varios textos
 * —el título primero, después las notas y el nombre del proyecto— y se queda con el mejor de
 * los suyos. Los que no son el primero valen menos: encontrar algo por su título es una
 * coincidencia mejor que encontrarlo porque la palabra salía en un párrafo.
 */
export function rank<T>(query: string, items: T[], fields: (item: T) => (string | null)[]): T[] {
  const clean = query.trim();
  if (!clean) return items;

  const hits: { item: T; score: number }[] = [];

  for (const item of items) {
    let best: number | null = null;

    fields(item).forEach((text, index) => {
      if (!text) return;
      const value = score(clean, text);
      if (value === null) return;
      const weighted = index === 0 ? value : value - SECONDARY_PENALTY;
      if (best === null || weighted > best) best = weighted;
    });

    if (best !== null) hits.push({ item, score: best });
  }

  return hits.sort((a, b) => b.score - a.score).map((hit) => hit.item);
}
