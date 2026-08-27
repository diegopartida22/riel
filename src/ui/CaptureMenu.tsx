import { Fragment } from "react";

import { tint } from "../design/palette";
import { GROUP_LABEL } from "../state/comandos";
import type { Menu } from "../state/useCaptura";

export interface CaptureMenuProps {
  menu: Menu;
  /** De dónde cuelga: `hashes` en el pie del panel, `captura__menu` en la captura rápida. */
  className: string;
  onPick: (index: number) => void;
}

/**
 * El menú que cuelga del campo de captura: los proyectos de una marca a medias, o los comandos
 * de una barra (spec 18).
 *
 * Cada renglón enseña a su derecha el literal que va a escribir, en la fuente de datos y en
 * `--ink-tertiary`. Es lo único que separa un menú que enseña la gramática de uno que la
 * esconde: quien pulse «Alta» veinte veces acaba escribiendo `!!` sin abrir nada.
 */
export function CaptureMenu({ menu, className, onPick }: CaptureMenuProps) {
  let previous: string | undefined;

  return (
    <ul className={className} role="listbox" aria-label={menu.label}>
      {menu.items.map((item, index) => {
        const group = item.group ? GROUP_LABEL[item.group] : undefined;
        const header = group && group !== previous ? group : null;
        previous = group;

        return (
          <Fragment key={item.id}>
            {/* El rótulo no es una opción: se lee, no se pulsa. Lo que dice va también en el
                `aria-label` de cada renglón, porque «Alta» a secas no dice de qué. */}
            {header && (
              <li className="menu__grupo" role="presentation" aria-hidden="true">
                {header}
              </li>
            )}
            <li role="presentation">
              <button
                type="button"
                className={`menu__item${index === menu.active ? " is-active" : ""}`}
                role="option"
                aria-selected={index === menu.active}
                aria-label={group ? `${group}: ${item.label}` : item.label}
                // `mousedown` y no `click`: para cuando llega el clic el campo ya perdió el
                // foco, y con él el cursor que dice dónde insertar.
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(index);
                }}
              >
                {item.color && (
                  <span className="hashes__dot tinted" style={tint(item.color)} aria-hidden />
                )}
                <span className="menu__label">{item.label}</span>
                {item.hint && (
                  <span className="menu__hint" aria-hidden="true">
                    {item.hint}
                  </span>
                )}
              </button>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}
