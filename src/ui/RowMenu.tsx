import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { dayOf, nextDay, type Priority, type Task } from "../data";
import { formatDueLong } from "./dueDate";
import { Check } from "./icons";

export interface RowMenuProps {
  task: Task;
  /** Rectángulo del `⋯` que lo abrió, en coordenadas de ventana. */
  anchor: DOMRect;
  onOpen: () => void;
  /**
   * El editor puesto, para nombrar la acción de abrir la carpeta del proyecto de esta tarea
   * (spec 13). Nulo si la tarea no tiene proyecto, si su proyecto no tiene carpeta o si no hay
   * editor instalado — que son las mismas tres condiciones del botón del encabezado.
   */
  editorName?: string | null;
  onOpenFolder?: () => void;
  onPriority: (priority: Priority) => void;
  /** Día local de la lista, para calcular los destinos de «Para cuándo». */
  today: string;
  /** Lleva la tarea a ese día, o la deja sin fecha con `null`. */
  onReschedule: (day: string | null) => void;
  onDelete: () => void;
  onClose: () => void;
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 2, label: "Prioridad alta" },
  { value: 1, label: "Prioridad media" },
  { value: 0, label: "Prioridad baja" },
];

/**
 * Los cuatro destinos de «Para cuándo», que son los que se eligen sin pensar: hoy, mañana, la
 * semana que viene y ninguno. Cualquier otro día pide mirar un calendario, y para eso está el
 * detalle.
 *
 * El lunes es el siguiente que no sea mañana. Un domingo, «Lunes» y «Mañana» serían el mismo
 * botón dos veces; lo que se quiere decir con él es «la semana que viene», y eso es el de
 * después.
 */
function targets(today: string): { label: string; day: string | null }[] {
  const tomorrow = nextDay(today);
  let monday = nextDay(tomorrow);
  while (new Date(`${monday}T00:00:00`).getDay() !== 1) monday = nextDay(monday);
  return [
    { label: "Hoy", day: today },
    { label: "Mañana", day: tomorrow },
    { label: "Lunes", day: monday },
    { label: "Sin fecha", day: null },
  ];
}

/** Margen mínimo contra los bordes del panel. */
const EDGE = 8;

/**
 * El menú del `⋯` de la fila (spec 3.5).
 *
 * Va en `position: fixed` y no dentro de la fila: la lista tiene su propio desbordamiento, y
 * un menú absoluto dentro de ella se cortaría contra el borde en cuanto la fila estuviera
 * abajo del todo. Fijo mide el panel entero y se voltea hacia arriba cuando no cabe.
 *
 * Lo justo y nada más: abrir el detalle, moverla de día, cambiar la prioridad —los dos campos
 * que se tocan lo bastante seguido como para no querer entrar al detalle— y eliminar. Todo lo
 * demás vive en el detalle, que es donde hay sitio para explicarlo.
 */
export function RowMenu({
  task,
  anchor,
  onOpen,
  editorName,
  onOpenFolder,
  onPriority,
  today,
  onReschedule,
  onDelete,
  onClose,
}: RowMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  /** Eliminar pide confirmación dentro del propio menú: mientras no exista ⌘Z (spec 5) esto
   *  es lo único que separa un clic torpe de perder una tarea. */
  const [confirming, setConfirming] = useState(false);

  // Se coloca antes de pintar: si se midiera en un efecto normal se vería un fotograma en la
  // esquina antes de saltar a su sitio.
  useLayoutEffect(() => {
    const own = menu.current?.getBoundingClientRect();
    if (!own) return;

    const below = anchor.bottom + 4;
    const flip = below + own.height + EDGE > window.innerHeight;
    setBox({
      top: flip ? Math.max(EDGE, anchor.top - own.height - 4) : below,
      left: Math.min(Math.max(EDGE, anchor.right - own.width), window.innerWidth - own.width - EDGE),
    });
    // Confirmar el borrado cambia el alto del menú, y con él si cabe hacia abajo o no.
  }, [anchor, confirming]);

  useEffect(() => {
    menu.current?.focus();

    const away = (event: PointerEvent) => {
      const target = event.target as Element;
      // El botón que abre un menú se queda fuera de esto: si el `pointerdown` cerrara, el
      // `click` que viene detrás lo reabriría al instante y volver a pulsarlo no cerraría
      // nunca. Cerrar o mover el menú es cosa suya, no de este manejador.
      if (target.closest?.("[data-menu-trigger]")) return;
      if (!menu.current?.contains(target)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Que no llegue al manejador que cierra el panel entero: cerrar el menú es lo que se
      // pedía con este Escape.
      event.stopPropagation();
      onClose();
    };

    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={menu}
      /* `--estados` es lo que reserva el hueco de la palomita: es el único menú de la app
         donde una opción puede estar marcada — la prioridad puesta. */
      className="menu menu--estados"
      role="menu"
      tabIndex={-1}
      aria-label={`Opciones de ${task.title}`}
      style={box ? { top: box.top, left: box.left } : { top: -9999, left: -9999 }}
    >
      <button type="button" className="menu__item" role="menuitem" onClick={onOpen}>
        <span className="menu__check" />
        Ver detalle
      </button>

      {/* Pegado a «Ver detalle» porque son lo mismo: las dos únicas que llevan a otro sitio en
          vez de cambiar la tarea. Y aquí y no solo en el encabezado del proyecto porque el
          trabajo se decide desde Hoy, mirando la tarea — tener que entrar al proyecto para
          abrir su carpeta es el viaje que el vínculo existía para ahorrar.

          Lo nombra el editor y no la carpeta, igual que el botón del encabezado: lo que hace
          falta saber antes de pulsar es en qué se va a abrir. */}
      {editorName && onOpenFolder && (
        <button type="button" className="menu__item" role="menuitem" onClick={onOpenFolder}>
          <span className="menu__check" />
          Abrir en {editorName}
        </button>
      )}

      <div className="menu__rule" role="separator" />

      {/* Para cuándo. Un segmentado y no cuatro renglones: son cuatro palabras cortas, y en
          renglones el menú doblaba de alto por una pregunta que se contesta de un vistazo. La
          misma pista que las preferencias de Ajustes (spec 8), con el día puesto levantado. */}
      <div className="settings__choices menu__fechas" role="group" aria-label="Para cuándo">
        {targets(today).map(({ label, day }) => {
          const current = day === null ? task.dueAt === null : task.dueAt !== null && dayOf(task.dueAt) === day;
          return (
            <button
              key={label}
              type="button"
              className={`settings__choice${current ? " is-selected" : ""}`}
              role="menuitemradio"
              aria-checked={current}
              title={
                day
                  ? formatDueLong(`${day}T00:00:00`, false, today)
                  : task.repeat
                    ? "Quitar la fecha y la repetición"
                    : "Quitar la fecha"
              }
              onClick={() => (current ? onClose() : onReschedule(day))}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="menu__rule" role="separator" />

      {PRIORITIES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          className="menu__item"
          role="menuitemradio"
          aria-checked={task.priority === value}
          onClick={() => onPriority(value)}
        >
          <span className="menu__check">
            {task.priority === value && <Check size={12} aria-hidden />}
          </span>
          {label}
        </button>
      ))}

      <div className="menu__rule" role="separator" />

      {confirming ? (
        <>
          <p className="menu__note">
            {task.title.length > 32 ? `${task.title.slice(0, 32)}…` : task.title}
          </p>
          <button
            type="button"
            className="menu__item menu__item--danger"
            role="menuitem"
            autoFocus
            onClick={onDelete}
          >
            <span className="menu__check" />
            Sí, eliminar
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => setConfirming(false)}
          >
            <span className="menu__check" />
            Cancelar
          </button>
        </>
      ) : (
        <button
          type="button"
          className="menu__item menu__item--danger"
          role="menuitem"
          onClick={() => setConfirming(true)}
        >
          <span className="menu__check" />
          Eliminar tarea
        </button>
      )}
    </div>
  );
}
