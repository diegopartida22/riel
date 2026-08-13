import type { ReactNode } from "react";

/**
 * El encabezado de un grupo de la lista — HOY, PRÓXIMAS, un día suelto. Mono a 10px, en
 * mayúsculas y con mucho tracking (spec 3.3), que es lo que lo separa del título de una fila
 * sin necesidad de una línea divisoria.
 */
export function GroupHeader({ children }: { children: ReactNode }) {
  return <h2 className="group-header">{children}</h2>;
}
