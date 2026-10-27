/**
 * Cómo se ve cada una de las cuatro listas del sistema: su glifo y su color.
 *
 * El glifo es el mismo en el mosaico de la pantalla de listas, en el encabezado de la lista y
 * en Ajustes, donde se elige con cuál abrir: lo que se está eligiendo es a qué mosaico caer, así
 * que enseñar otra cosa obligaría a aprender dos vocabularios para una sola lista de cuatro.
 *
 * El color sale de la paleta de proyectos y no de un hex escrito aquí (spec 3.1, criterio 9),
 * salvo Hoy, que lleva el acento del sistema: es la lista que se mira casi siempre, y la que
 * tiene que verse primero es la del color que la persona eligió para su Mac. Las otras tres se
 * eligen por lo que dicen y no por adorno — rojo para lo que viene, como el calendario; gris
 * para el montón entero; verde para lo hecho.
 */

import { PALETTE } from "../design/palette";
import type { SystemKind } from "../state/views";
import { CalendarDays, CheckCircle, List, Sun, type Icon } from "./icons";

export const SYSTEM_ICONS: Record<SystemKind, Icon> = {
  hoy: Sun,
  proximas: CalendarDays,
  todas: List,
  completadas: CheckCircle,
};

const color = (id: string): string => PALETTE.find((swatch) => swatch.id === id)?.light ?? "";

/** El hex de cada lista, o nulo para la que va con el acento del sistema. */
export const SYSTEM_COLORS: Record<SystemKind, string | null> = {
  hoy: null,
  proximas: color("ladrillo"),
  todas: color("grafito"),
  completadas: color("jade"),
};

/**
 * La inicial del proyecto, que es lo que va en su disco: en la pantalla de listas y, en grande,
 * en el editor del proyecto. Por grafema y no por carácter, para que un proyecto que empiece por
 * un emoji enseñe el emoji entero y no medio par sustituto.
 */
export function initialOf(name: string): string {
  const [first] = new Intl.Segmenter("es", { granularity: "grapheme" }).segment(name.trim());
  return first ? first.segment.toLocaleUpperCase("es") : "·";
}
