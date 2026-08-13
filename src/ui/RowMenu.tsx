import { Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Priority, Task } from "../data";

export interface RowMenuProps {
  task: Task;
  /** Rectángulo del `⋯` que lo abrió, en coordenadas de ventana. */
  anchor: DOMRect;
  onOpen: () => void;
  onPriority: (priority: Priority) => void;
  onDelete: () => void;
  onClose: () => void;
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 2, label: "Prioridad alta" },
  { value: 1, label: "Prioridad media" },
  { value: 0, label: "Prioridad baja" },
];

/** Margen mínimo contra los bordes del panel. */
const EDGE = 8;

/**
 * El menú del `⋯` de la fila (spec 3.5).
 *
 * Va en `position: fixed` y no dentro de la fila: la lista tiene su propio desbordamiento, y
 * un menú absoluto dentro de ella se cortaría contra el borde en cuanto la fila estuviera
 * abajo del todo. Fijo mide el panel entero y se voltea hacia arriba cuando no cabe.
 *
 * Lo justo y nada más: abrir el detalle, cambiar la prioridad —que es el único campo que se
 * toca lo bastante seguido como para no querer entrar al detalle— y eliminar. Todo lo demás
 * vive en el detalle, que es donde hay sitio para explicarlo.
 */
export function RowMenu({ task, anchor, onOpen, onPriority, onDelete, onClose }: RowMenuProps) {
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
      className="menu"
      role="menu"
      tabIndex={-1}
      aria-label={`Opciones de ${task.title}`}
      style={box ? { top: box.top, left: box.left } : { top: -9999, left: -9999 }}
    >
      <button type="button" className="menu__item" role="menuitem" onClick={onOpen}>
        <span className="menu__check" />
        Ver detalle
      </button>

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
            {task.priority === value && <Check size={12} strokeWidth={2.25} aria-hidden />}
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
