import type { ReactNode } from "react";

import { tint } from "../design/palette";
import { ChevronLeft } from "./icons";

export interface ListHeaderProps {
  title: string;
  /** El hex de la lista, o nulo para la que va con el acento del sistema. */
  color: string | null;
  /** Lo que queda pendiente. Sin cifra en cero, ni en las listas que no cuentan. */
  count?: number;
  /** Un renglón debajo del título: el día en Hoy, la carpeta en un proyecto. */
  subtitle?: ReactNode;
  /** Botones de texto al otro extremo del renglón de abajo. */
  actions?: ReactNode;
  onBack: () => void;
}

/**
 * El encabezado de una lista: la flecha que vuelve a la pantalla de listas, el nombre en grande
 * y en su color, y lo que queda pendiente al otro extremo (spec 3.4).
 *
 * Es lo que dice dónde se está, y por eso es lo más grande del panel. Con el riel eso lo decía
 * un disco de 22px marcado entre otros siete, y el nombre de la lista era un rótulo de 10px en
 * versalitas que se leía como un adorno; ahora la lista se nombra como lo hace Recordatorios.
 * El conteo va en el mismo color y al mismo tamaño, porque es la otra mitad de la respuesta.
 *
 * Debajo, el renglón de lo que es de la lista y no de una tarea: el día en Hoy, la carpeta de un
 * proyecto, y las acciones que antes colgaban del rótulo — «Pasar a hoy», abrir en el editor,
 * editar el proyecto. En texto y no en glifos sueltos: son acciones que se leen antes de pulsar.
 */
export function ListHeader({ title, color, count, subtitle, actions, onBack }: ListHeaderProps) {
  return (
    <header
      className={`list-header tinted${color ? "" : " list-header--app"}`}
      style={color ? tint(color) : undefined}
    >
      <div className="list-header__top">
        <button
          type="button"
          className="list-header__back"
          title="Listas (⌘[)"
          aria-label="Volver a las listas"
          onClick={onBack}
        >
          <ChevronLeft size={15} aria-hidden />
        </button>
        <h1 className="list-header__title">{title}</h1>
        {/* Fuera del árbol de accesibilidad: el título de la página ya lo nombra, y un número
            suelto leído detrás de él no dice de qué es. */}
        {count ? (
          <span className="list-header__count" aria-hidden>
            {count}
          </span>
        ) : null}
      </div>

      {(subtitle || actions) && (
        <div className="list-header__sub">
          <span className="list-header__note">{subtitle}</span>
          {actions && <span className="list-header__actions">{actions}</span>}
        </div>
      )}
    </header>
  );
}
