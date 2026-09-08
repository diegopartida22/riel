import type { ReactNode } from "react";

import { ChevronRight } from "./icons";

/**
 * El encabezado de un grupo de la lista — HOY, PRÓXIMAS, un día suelto. Mono a 10px, en
 * mayúsculas y con mucho tracking (spec 3.3), que es lo que lo separa del título de una fila
 * sin necesidad de una línea divisoria.
 *
 * `action` es para el único encabezado que lleva algo al lado: el de un proyecto con carpeta
 * vinculada (spec 13). Va aquí y no en una barra propia porque el encabezado ya es el renglón
 * que nombra lo que se está viendo, y una segunda fila para un solo botón le quitaría a la
 * lista una tarea de alto en la vista donde más se trabaja.
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
 * El encabezado que pliega: MÁS ADELANTE · 7 (spec 19).
 *
 * Del mismo peso y la misma mono que los otros, porque nombra un grupo igual que ellos; lo
 * único que lo separa es que se pulsa, y eso lo dice el triángulo. El conteo va pegado al
 * nombre y no contra el borde derecho: no es una columna que se compare con nada, es cuánto
 * hay ahí dentro, y sin él un grupo plegado no dice si esconde una tarea o cuarenta.
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
        <ChevronRight size={9} className="group-header__caret" aria-hidden />
        {label} · {count}
      </button>
    </li>
  );
}
