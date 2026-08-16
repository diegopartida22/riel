import type { CalendarEvent } from "../state/agenda";
import { GroupHeader } from "./GroupHeader";

const pad = (value: number) => String(value).padStart(2, "0");

/** `14:30`, en 24 h como el resto de la app. */
function hour(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * El día que ya está comprometido, encima de las tareas de Hoy (spec 15).
 *
 * No es una lista de tareas y no lo finge: sin casilla, sin manija, sin `⋯` y sin punto de
 * proyecto. Un evento no se completa ni se reordena, y darle los mismos gestos que a una tarea
 * sería prometer cinco cosas que ninguna funciona. Lo único que hace es estar.
 *
 * Se queda lo que ya pasó, apagado. Una agenda que va borrando lo cumplido obliga a recordar si
 * la junta de las diez estaba ahí o no, y la pregunta que contesta este bloque —cuánto día
 * queda— se lee mejor viendo por dónde va el día que viendo solo lo que falta.
 */
export function Agenda({ events }: { events: CalendarEvent[] }) {
  if (!events.length) return null;

  /**
   * El reloj se lee una vez por pintada y no con un temporizador: el panel se oculta al perder
   * el foco (spec 4), así que casi nunca vive lo suficiente para que la hora se le quede vieja,
   * y cada apertura vuelve a pasar por aquí. Un `setInterval` de un minuto para eso sería un
   * temporizador corriendo todo el día por un caso que dura segundos.
   */
  const now = Date.now() / 1000;

  return (
    <>
      <GroupHeader>Agenda</GroupHeader>
      <ul className="agenda">
        {events.map((event) => {
          const past = !event.allDay && event.end <= now;
          const current = !event.allDay && event.start <= now && now < event.end;

          return (
            <li
              key={event.id}
              className={`agenda__row${past ? " is-past" : ""}${current ? " is-now" : ""}`}
              /* Solo se enseña la hora de entrada, que es la que ubica; el rango entero cabe
                 aquí, que es donde se pregunta por él y donde no le cuesta ancho a nadie. */
              title={event.allDay ? "Todo el día" : `${hour(event.start)} – ${hour(event.end)}`}
            >
              {/* De día entero no dibuja hora, y la columna se queda vacía para que el título
                  arranque donde arrancan los demás. Escribir «todo el día» costaría el doble de
                  ancho que la hora más larga y torcería la única columna que hay. */}
              <span className="agenda__time">{event.allDay ? "" : hour(event.start)}</span>
              <span className="agenda__title">{event.title}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
