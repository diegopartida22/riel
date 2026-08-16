import type { ReactNode } from "react";

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
