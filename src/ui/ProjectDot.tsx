import { tint } from "../design/palette";

/**
 * El punto de proyecto: 6px, y solo en las vistas donde conviven varios proyectos. Dentro de
 * un proyecto es redundante y no se dibuja — de eso se encarga quien monta la fila.
 *
 * Lleva su propio `tinted` para poder usarse suelto, fuera de una fila.
 */
export function ProjectDot({ color, title }: { color: string; title?: string }) {
  return <span className="project-dot tinted" style={tint(color)} title={title} aria-hidden="true" />;
}
