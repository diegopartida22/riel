/**
 * Los iconos de la interfaz, todos por aquí.
 *
 * El resto de la app importa de este archivo y no del paquete, por dos razones. La primera es
 * que el juego de iconos es una decisión de diseño y no de cada componente: cambiarlo entero
 * —que es justo lo que se acaba de hacer, de Lucide a Hugeicons— tiene que ser un archivo y no
 * diez. La segunda es el grosor, que aquí abajo se explica.
 *
 * De Hugeicons se importa icono a icono por su ruta propia y no del barril, que son 6 MB de
 * declaraciones: el barril se poda en la compilación, pero el servidor de desarrollo lo
 * pre-empaqueta entero cada vez que se toca una dependencia.
 */

import Calendar03Icon from "@hugeicons/core-free-icons/Calendar03Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import DragDropVerticalIcon from "@hugeicons/core-free-icons/DragDropVerticalIcon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import LeftToRightListBulletIcon from "@hugeicons/core-free-icons/LeftToRightListBulletIcon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import PanelLeftCloseIcon from "@hugeicons/core-free-icons/PanelLeftCloseIcon";
import PanelLeftOpenIcon from "@hugeicons/core-free-icons/PanelLeftOpenIcon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import Refresh01Icon from "@hugeicons/core-free-icons/Refresh01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon";
import Sun03Icon from "@hugeicons/core-free-icons/Sun03Icon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

/**
 * El grosor del trazo, en píxeles ya dibujados y no en unidades de la rejilla de 24.
 *
 * Es la diferencia que importa. Un `stroke-width` de 1.5 sobre la rejilla se encoge con el
 * icono: a 15px pinta 0.94px de raya y a 11px pinta 0.69px, así que el icono chico sale más
 * pálido que el grande aunque los dos digan 1.5. Con la raya fijada en píxeles, un `⌄` de 11px
 * y un sol de 15px pesan lo mismo, que es lo que hace que una barra de iconos se lea como una
 * sola familia. `absoluteStrokeWidth` es exactamente esta cuenta, hecha por el paquete.
 *
 * 1.15 y no 1 porque sobre el vidrio, y con los grises translúcidos de la paleta, una raya de
 * exactamente 1px se deshace en cuanto el fondo tiene algo de textura.
 */
const WEIGHT = 1.15;

export interface IconProps {
  /** Lado del cuadro, en px. El icono siempre es cuadrado. */
  size?: number;
  /** Solo para las excepciones: el grosor en px dibujados. Casi nunca hay que tocarlo. */
  weight?: number;
  className?: string;
  "aria-hidden"?: boolean;
}

/** El tipo de los componentes de aquí abajo, para las tablas que eligen icono por vista. */
export type Icon = (props: IconProps) => React.ReactElement;

function glyph(icon: IconSvgElement): Icon {
  return function Glyph({ size = 15, weight = WEIGHT, ...rest }: IconProps) {
    return <HugeiconsIcon icon={icon} size={size} strokeWidth={weight} absoluteStrokeWidth {...rest} />;
  };
}

/* Las cuatro vistas del sistema en el riel. */
export const Sun = glyph(Sun03Icon);
export const CalendarDays = glyph(Calendar03Icon);
export const List = glyph(LeftToRightListBulletIcon);
/* Lucide traía un doble palomita para Completadas; en Hugeicons no hay, y la palomita dentro
   del círculo dice lo mismo: es la casilla de la fila, ya marcada. */
export const CheckCircle = glyph(CheckmarkCircle02Icon);

export const Search = glyph(Search01Icon);
export const Settings = glyph(Settings02Icon);
export const Plus = glyph(PlusSignIcon);
export const Check = glyph(Tick02Icon);
export const X = glyph(Cancel01Icon);
export const Ellipsis = glyph(MoreHorizontalIcon);
export const GripVertical = glyph(DragDropVerticalIcon);
/* La marca de una tarea que vuelve. La flecha en círculo y no el bucle de dos rayas del
   reproductor: a 11px en una fila, dos rayas paralelas se funden en una mancha. */
export const Repeat = glyph(Refresh01Icon);

/** El modo desarrollo (spec 13): la carpeta que se vincula y el editor con el que se abre. */
export const Folder = glyph(Folder01Icon);
export const Code = glyph(CodeIcon);
export const ChevronLeft = glyph(ArrowLeft01Icon);
export const ChevronRight = glyph(ArrowRight01Icon);
export const PanelLeftClose = glyph(PanelLeftCloseIcon);
export const PanelLeftOpen = glyph(PanelLeftOpenIcon);
