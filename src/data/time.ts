/**
 * Las fechas se guardan en ISO 8601 **local y sin zona** (`2026-08-12T14:30:00`), como pide
 * la sección 2 del spec. La razón es que «mañana a las 10:00» significa las 10:00 donde esté
 * la persona; convertir a UTC haría que la tarea se moviera de hora al cambiar de huso o al
 * entrar el horario de verano.
 *
 * El formato es lexicográficamente ordenable, así que comparar rangos en SQL es comparar
 * texto. Por eso ninguna consulta necesita funciones de fecha de SQLite.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** `2026-08-12T14:30:00` */
export function localIso(date: Date = new Date()): string {
  return `${localDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** `2026-08-12` */
export function localDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** El día de una fecha guardada, sin volver a pasar por `Date`. */
export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * El día siguiente. Pasa por `Date` a propósito: sumarle uno al número del día se rompe a fin
 * de mes, y en marzo y octubre además hay días de 23 y 25 horas.
 */
export function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return localDay(new Date(year, month - 1, date + 1));
}
