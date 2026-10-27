import type { ReactNode } from "react";

import { ChevronRight } from "./icons";

/**
 * El encabezado de un grupo dentro de una lista — Agenda y Tareas en Hoy, los resultados de una
 * búsqueda, el disco de las sesiones. El nombre de la lista no es esto: lo lleva `ListHeader`,
 * en grande. Esto parte lo que hay debajo, y por eso va un tono por debajo (spec 3.3).
 *
 * `action` es un glifo al otro extremo, para lo que se le hace al grupo entero.
 */
export function GroupHeader({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <h2 className="group-header">
      {children}
      {action}
    </h2>
  );
}

/**
 * El encabezado que pliega: «Más adelante 7» (spec 19).
 *
 * Del mismo peso que los otros, porque nombra un grupo igual que ellos; lo único que lo separa
 * es que se pulsa, y eso lo dice el triángulo. El conteo va pegado al nombre y no contra el
 * borde derecho: no es una columna que se compare con nada, es cuánto hay ahí dentro, y sin él
 * un grupo plegado no dice si esconde una tarea o cuarenta.
 */
export function FoldHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="group-fold">
      <button
        type="button"
        className="group-header group-header--fold"
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChevronRight size={10} className="group-header__caret" aria-hidden />
        {label}
        <span className="group-header__count">{count}</span>
      </button>
    </li>
  );
}
