import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Project } from "../data";

export interface ProjectMenuProps {
  project: Project;
  /** Rectángulo del `⋯` que lo abrió, en coordenadas de ventana. */
  anchor: DOMRect;
  /** Falso en los extremos del riel: no hay hueco al que subir o bajar. */
  canRaise: boolean;
  canLower: boolean;
  onEdit: () => void;
  onRaise: () => void;
  onLower: () => void;
  onClose: () => void;
}

/** Margen mínimo contra los bordes del panel. */
const EDGE = 8;

/**
 * El menú del `⋯` de un proyecto en el riel expandido.
 *
 * Existe por una razón concreta: editar un proyecto se hacía solo con clic derecho o doble
 * clic, que son gestos que nadie encuentra si no se los cuentan. El riel colapsado no tiene
 * dónde ponerlo —44px son el disco y nada más, que es su gracia—, pero expandido sobra sitio
 * a la derecha del nombre.
 *
 * Subir y bajar acompañan a arrastrar en vez de sustituirlo. Arrastrar es el gesto y es el
 * que persiste igual; esto es lo que hace que se sepa que se puede, y de paso lo deja al
 * alcance del teclado, que con arrastrar solo no llegaba.
 */
export function ProjectMenu({
  project,
  anchor,
  canRaise,
  canLower,
  onEdit,
  onRaise,
  onLower,
  onClose,
}: ProjectMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  // Antes de pintar, como el de la fila: medido en un efecto normal se vería un fotograma en
  // la esquina antes de saltar a su sitio.
  useLayoutEffect(() => {
    const own = menu.current?.getBoundingClientRect();
    if (!own) return;

    const below = anchor.bottom + 4;
    const flip = below + own.height + EDGE > window.innerHeight;
    setBox({
      top: flip ? Math.max(EDGE, anchor.top - own.height - 4) : below,
      left: Math.min(Math.max(EDGE, anchor.left), window.innerWidth - own.width - EDGE),
    });
  }, [anchor]);

  useEffect(() => {
    menu.current?.focus();

    const away = (event: PointerEvent) => {
      const target = event.target as Element;
      // El propio `⋯` queda fuera: si el `pointerdown` cerrara, el `click` de detrás lo
      // reabriría y el botón no apagaría el menú nunca.
      if (target.closest?.("[data-menu-trigger]")) return;
      if (!menu.current?.contains(target)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Este Escape cierra el menú, no el panel.
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
      aria-label={`Opciones de ${project.name}`}
      style={box ? { top: box.top, left: box.left } : { top: -9999, left: -9999 }}
    >
      <button type="button" className="menu__item" role="menuitem" onClick={onEdit}>
        <span className="menu__check" />
        Editar proyecto
      </button>

      <div className="menu__rule" role="separator" />

      <button
        type="button"
        className="menu__item"
        role="menuitem"
        disabled={!canRaise}
        onClick={onRaise}
      >
        <span className="menu__check" />
        Subir
      </button>
      <button
        type="button"
        className="menu__item"
        role="menuitem"
        disabled={!canLower}
        onClick={onLower}
      >
        <span className="menu__check" />
        Bajar
      </button>
    </div>
  );
}
