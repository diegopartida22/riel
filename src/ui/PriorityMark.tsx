import type { Priority } from "../data";

/**
 * La prioridad, justo antes de la fecha: alta pinta el `!` con el color del proyecto, media
 * lo pinta en `--ink-tertiary` y **baja no dibuja nada**.
 *
 * Eso último es lo que impide que la lista se vuelva un semáforo, así que la ausencia es
 * parte del diseño y no un caso sin cubrir.
 */
export function PriorityMark({ priority }: { priority: Priority }) {
  if (priority === 0) return null;

  return (
    <span
      className={`priority priority--${priority === 2 ? "alta" : "media"}`}
      title={priority === 2 ? "Prioridad alta" : "Prioridad media"}
    >
      !
    </span>
  );
}
