import { useEffect, useState } from "react";

import { fetchReminders, reminderLists, type ReminderList } from "../state/reminders";
import { Switch } from "./Switch";

export interface RemindersSheetProps {
  /** Las listas vinculadas ahora mismo, por identificador. */
  lists: string[];
  onLists: (ids: string[]) => void;
  onClose: () => void;
}

/**
 * Qué listas de Recordatorios se vinculan (spec 16).
 *
 * En el área de contenido y no dentro del popover, por lo mismo que la importación: del `⚙︎`
 * sale solo la pregunta, y una lista de listas con su conteo necesita sitio para leerse. En 440
 * píxeles no hay forma de poner una capa sobre otra sin oscurecer el fondo, y oscurecerlo
 * apagaría el vidrio (§8).
 *
 * Cada lista es una fila con interruptor, la misma gramática que Ajustes: su nombre a la
 * izquierda y su estado a la derecha. Y el conteo al lado del nombre, porque «Trabajo» sin más
 * no dice si vincularla trae cinco tareas o doscientas — que es justo lo que se está decidiendo.
 */
export function RemindersSheet({ lists, onLists, onClose }: RemindersSheetProps) {
  const [available, setAvailable] = useState<ReminderList[] | null>(null);
  /** Cuántos pendientes tiene cada lista, y cuántos de ellos repiten y se van a quedar fuera. */
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [repeating, setRepeating] = useState(0);

  useEffect(() => {
    let alive = true;

    void (async () => {
      const found = await reminderLists();
      if (!alive) return;
      setAvailable(found);
      if (!found.length) return;

      // De todas y no solo de las vinculadas: el conteo es lo que ayuda a decidir sobre las que
      // todavía no lo están, que son las que se vienen a mirar aquí.
      const items = await fetchReminders(found.map((each) => each.id));
      if (!alive) return;

      const totals = new Map<string, number>();
      let repeats = 0;
      for (const item of items) {
        if (item.repeats) {
          repeats++;
          continue;
        }
        totals.set(item.list, (totals.get(item.list) ?? 0) + 1);
      }
      setCounts(totals);
      setRepeating(repeats);
    })().catch((cause) => console.error(cause));

    return () => {
      alive = false;
    };
  }, []);

  const toggle = (id: string, on: boolean) =>
    onLists(on ? [...lists, id] : lists.filter((each) => each !== id));

  return (
    <section className="editor" aria-label="Recordatorios de Apple">
      <h2 className="editor__title">Recordatorios de Apple</h2>

      {/* Lo que hace y lo que no, antes de la primera casilla. Vincular una lista escribe en
          otra app, y eso no se descubre después. */}
      <p className="editor__confirm-text">
        Los recordatorios sin completar de las listas que elijas entran en Riel como tareas.
        Completarlos aquí los marca allá, y completarlos allá los marca aquí. Riel no crea
        recordatorios: lo que escribas aquí se queda aquí.
      </p>

      {available === null && <p className="editor__confirm-text">Leyendo tus listas…</p>}

      {available?.length === 0 && (
        <p className="editor__confirm-text">No hay ninguna lista en Recordatorios.</p>
      )}

      {available !== null && available.length > 0 && (
        <div className="editor__lists">
          {available.map((list) => (
            <Switch
              key={list.id}
              label={list.title}
              hint={String(counts.get(list.id) ?? 0)}
              value={lists.includes(list.id)}
              onPick={(on) => toggle(list.id, on)}
            />
          ))}
        </div>
      )}

      {/* Solo cuando hay alguno. Explicar una exclusión que no le toca a nadie es ruido. */}
      {repeating > 0 && (
        <p className="editor__confirm-text">
          {repeating === 1
            ? "Un recordatorio que se repite se queda fuera"
            : `${repeating} recordatorios que se repiten se quedan fuera`}
          : Recordatorios ya los hace volver por su cuenta, y traerlos aquí sería repetirlos dos
          veces. Para eso están las tareas recurrentes de Riel.
        </p>
      )}

      {/* Los cambios ya están guardados —cada interruptor escribe al pulsarse— así que esto es
          una salida y no un «Guardar». Al cerrarse, la sincronización corre sin esperar. */}
      <div className="editor__actions">
        <button type="button" className="editor__button editor__button--primary" onClick={onClose}>
          Listo
        </button>
      </div>
    </section>
  );
}
