import type { Priority } from "../data";

/**
 * La prioridad, delante del título y escrita como se escribe en la captura: `!!` alta, con el
 * color del proyecto, y `!` media, en `--ink-tertiary`. **Baja no dibuja nada.**
 *
 * Eso último es lo que impide que la lista se vuelva un semáforo, así que la ausencia es
 * parte del diseño y no un caso sin cubrir. Y va delante del título y no al lado de la fecha
 * porque es lo primero que hay que saber de la tarea, antes que cuándo: con el título partido
 * en dos renglones, al final quedaba a media fila y no se leía con ninguno de los dos.
 */
export function PriorityMark({ priority }: { priority: Priority }) {
  if (priority === 0) return null;

  return (
    <span
      className={`priority priority--${priority === 2 ? "alta" : "media"}`}
      title={priority === 2 ? "Prioridad alta" : "Prioridad media"}
    >
      {priority === 2 ? "!!" : "!"}
    </span>
  );
}
