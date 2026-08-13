import { useCallback, useRef, useState } from "react";

import type { Between } from "../data";

export interface Reorder {
  /** Id de la fila en vuelo, o nulo. */
  dragging: string | null;
  /** Cuánto se ha desplazado cada fila, en px. Cero para las que no se mueven. */
  offsetOf: (id: string) => number;
  /** Se engancha al `pointerdown` de la manija. */
  grab: (event: React.PointerEvent<HTMLElement>, id: string) => void;
  /** Guarda el nodo de cada fila para poder medirlas al empezar. */
  register: (id: string) => (node: HTMLElement | null) => void;
}

/** Lo que hay que arrastrar antes de considerarlo un arrastre y no un clic torpe. */
const THRESHOLD = 3;

interface Flight {
  id: string;
  /** Las hermanas entre las que se mueve, en orden. Fuera de este grupo nadie se entera. */
  group: string[];
  /** Índice de la fila en vuelo dentro de su grupo. */
  from: number;
  /**
   * Dónde va a caer, contado sobre la lista **sin** ella. Es el índice que quiere `splice`, y
   * medirlo así evita el error clásico de este gesto: contra la lista completa, el mismo
   * hueco tiene un número distinto según se venga subiendo o bajando.
   */
  to: number;
  /** Desplazamiento vertical del puntero desde que se agarró. */
  dy: number;
  /** Alto de la fila en vuelo: es lo que se corren las demás para hacerle sitio. */
  height: number;
}

/**
 * Reordenar arrastrando (spec 1, paso 8 del orden de construcción).
 *
 * Con eventos de puntero y no con la API de arrastre de HTML: esa dibuja su propia imagen
 * fantasma —una captura semitransparente del elemento— que sobre el vidrio se ve como lo que
 * es, un recorte de mapa de bits. Aquí la fila real es la que se mueve.
 *
 * Las medidas se toman una sola vez, al agarrar. Durante el arrastre las filas van desplazadas
 * con `transform`, que no cambia el flujo, así que los rectángulos medidos al principio siguen
 * describiendo el hueco de cada una y no hay que volver a medir en cada movimiento.
 *
 * Los grupos son las listas de hermanas: las raíces por un lado y las subtareas de cada una por
 * el suyo. Una subtarea se ordena entre las suyas y nada más — dejarla salir de su grupo sería
 * cambiarla de madre, que es otro gesto y no está en la v1.
 */
export function useReorder(
  groups: string[][],
  onDrop: (id: string, between: Between) => void,
): Reorder {
  const nodes = useRef(new Map<string, HTMLElement>());
  const [flight, setFlight] = useState<Flight | null>(null);

  const register = useCallback(
    (id: string) => (node: HTMLElement | null) => {
      if (node) nodes.current.set(id, node);
      else nodes.current.delete(id);
    },
    [],
  );

  const grab = useCallback(
    (event: React.PointerEvent<HTMLElement>, id: string) => {
      const group = groups.find((each) => each.includes(id));
      if (!group) return;

      const from = group.indexOf(id);
      if (event.button !== 0 || group.length < 2) return;

      const rects = group.map((other) => nodes.current.get(other)?.getBoundingClientRect() ?? null);
      const own = rects[from];
      if (!own) return;

      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);

      const startY = event.clientY;
      /** El último vuelo calculado. El estado de React va un render por detrás al soltar. */
      let current: Flight | null = null;

      /** Los centros de las demás filas, en orden y sin la que va en vuelo. */
      const others = rects
        .filter((_, i) => i !== from)
        .map((rect) => (rect ? rect.top + rect.height / 2 : Infinity));

      /**
       * Cuántas de las demás quedan por encima del centro de la fila en vuelo. Ese número es
       * justo el hueco donde hay que insertarla, y sale igual subiendo que bajando.
       */
      const landing = (dy: number): number => {
        const center = own.top + dy + own.height / 2;
        return others.filter((middle) => middle < center).length;
      };

      const track = (move: PointerEvent) => {
        const dy = move.clientY - startY;
        if (!current && Math.abs(dy) < THRESHOLD) return;
        current = { id, group, from, to: landing(dy), dy, height: own.height };
        setFlight(current);
      };

      const release = (up: PointerEvent, drop: boolean) => {
        handle.releasePointerCapture(up.pointerId);
        handle.removeEventListener("pointermove", track);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onCancel);
        setFlight(null);

        if (!drop || !current || current.to === from) return;
        const next = group.filter((other) => other !== id);
        const at = current.to;
        onDrop(id, { after: next[at - 1] ?? null, before: next[at] ?? null });
      };

      const onUp = (up: PointerEvent) => release(up, true);
      const onCancel = (up: PointerEvent) => release(up, false);

      handle.addEventListener("pointermove", track);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onCancel);
    },
    [groups, onDrop],
  );

  const offsetOf = useCallback(
    (id: string) => {
      if (!flight) return 0;
      if (id === flight.id) return flight.dy;

      // Las de otro grupo no se mueven: arrastrar una subtarea no corre las tareas raíz, ni al
      // revés — una raíz en vuelo se lleva sus propias subtareas dentro, sin desplazarlas.
      const index = flight.group.indexOf(id);
      if (index < 0) return 0;

      const { from, to, height } = flight;
      // El mismo índice «sin la fila en vuelo» que usa `landing`, para comparar peras con
      // peras: las de antes conservan el suyo, las de después bajan uno.
      const own = index < from ? index : index - 1;

      // Estaba antes y ahora la de vuelo se le pone delante: baja.
      if (index < from && own >= to) return height;
      // Estaba después y ahora la de vuelo se le queda detrás: sube.
      if (index > from && own < to) return -height;
      return 0;
    },
    [flight],
  );

  return { dragging: flight?.id ?? null, offsetOf, grab, register };
}
