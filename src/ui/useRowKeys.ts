import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";

/**
 * Las teclas que se manejan con una fila enfocada (spec 5): ↑↓ para moverse, Espacio para
 * completar y ⏎ para editar el título en línea.
 *
 * El recorrido se lee del DOM y no de las props. Una lista trae raíces con subtareas colgando,
 * y en la búsqueda no cuelga nada; consultar el árbol pintado es lo único que da el orden que
 * de verdad se ve, sin que cada vista tenga que aplanarlo a su manera.
 */
const ROW = "[data-task-id]";

export interface RowKeysOptions {
  /**
   * Los ids en el orden en que se ven, subtareas incluidas. No decide el recorrido —eso lo
   * hace el DOM— sino cuál de las filas entra en el Tab, y sirve para curar el cursor cuando
   * la fila que lo tenía se fue.
   */
  order: string[];
  /** Espacio. */
  onToggle: (id: string) => void;
  /** ⏎. Sin esto la tecla no hace nada: en los resultados de búsqueda no se edita en línea. */
  onEdit?: (id: string) => void;
}

/**
 * Tabulación itinerante: de toda la lista, una sola fila está en el recorrido del Tab. Con
 * `tabIndex` a 0 en todas, llegar desde la búsqueda hasta el campo de captura costaría tantas
 * pulsaciones como tareas haya, y el Tab dejaría de servir para moverse entre zonas — que es
 * justo para lo que están las flechas.
 */
export function useRowKeys({ order, onToggle, onEdit }: RowKeysOptions) {
  const box = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  // Completar una tarea la saca de la lista y se llevaría con ella el único `tabIndex` de 0:
  // el Tab dejaría de entrar en la lista hasta cambiar de vista. Si el cursor apunta a algo
  // que ya no está, manda la primera fila.
  const focused = cursor !== null && order.includes(cursor) ? cursor : (order[0] ?? null);

  const focus = useCallback((id: string) => {
    box.current?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)?.focus();
  }, []);

  const onFocusCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    const id = (event.target as HTMLElement).closest?.(ROW)?.getAttribute("data-task-id");
    if (id) setCursor(id);
  }, []);

  /**
   * Completar con Espacio saca la fila de la lista a los tres segundos, y al quitarla del DOM
   * el navegador manda el foco al `body`: el anillo desaparece y la sección 5 pide que
   * navegando con el teclado siempre se vea dónde estás. El foco pasa entonces a la fila que
   * ocupó su sitio.
   *
   * Solo cuando el foco cayó al `body`, que es la firma exacta de «se lo llevó el nodo que se
   * fue». Si estaba en cualquier otro sitio —la búsqueda, el riel— es que el usuario lo movió
   * a propósito y no hay que robárselo. Con el ratón tampoco se ve nada: `:focus-visible` no
   * pinta un anillo por un foco puesto a mano después de un clic.
   */
  const previo = useRef(order);
  useEffect(() => {
    const antes = previo.current;
    previo.current = order;

    if (cursor === null || order.includes(cursor)) return;
    if (document.activeElement !== document.body) return;

    const list = box.current?.querySelectorAll<HTMLElement>(ROW);
    if (!list?.length) return;

    const at = antes.indexOf(cursor);
    list[Math.min(at < 0 ? 0 : at, list.length - 1)]?.focus();
  }, [cursor, order]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      // Mientras se edita en línea, las teclas son del campo: ↑↓ mueven el cursor dentro del
      // texto y el Espacio escribe un espacio.
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      // Los atajos con ⌘ son del panel entero y se atienden arriba.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const list = Array.from(box.current?.querySelectorAll<HTMLElement>(ROW) ?? []);
      if (!list.length) return;

      const row = target.closest<HTMLElement>(ROW);
      const at = row ? list.indexOf(row) : -1;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        // Sin fila enfocada se entra por un extremo: ↓ por arriba, ↑ por abajo.
        const next = at < 0 ? (step === 1 ? 0 : list.length - 1) : at + step;
        // Tope en los extremos, sin dar la vuelta: en una lista de seis filas, saltar de la
        // última a la primera se lee como que la tecla se perdió.
        list[Math.min(Math.max(next, 0), list.length - 1)]?.focus();
        return;
      }

      if (!row) return;
      const id = row.getAttribute("data-task-id");
      if (!id) return;

      if (event.key === " ") {
        // Sin esto la barra espaciadora desplaza la lista además de completar.
        event.preventDefault();
        onToggle(id);
        return;
      }

      if (event.key === "Enter" && onEdit) {
        event.preventDefault();
        onEdit(id);
      }
    },
    [onEdit, onToggle],
  );

  /**
   * La entrada a la lista. El manejador de arriba cuelga del contenedor, así que solo se entera
   * de una flecha cuando el foco ya está dentro. Al abrir el panel el foco está en el `body`, y
   * en cuanto se busca algo está en el campo de arriba: en los dos casos ↓ no hacía nada y la
   * única forma de llegar a la lista era tabular once veces por la barra y el riel enteros, que
   * es tanto como decir que las flechas de la sección 5 no existían.
   *
   * Solo se toman esos dos sitios. Si el foco está en un botón del riel, la flecha es suya.
   */
  useEffect(() => {
    const enter = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const active = document.activeElement;
      const suelto = active === null || active === document.body;
      const desdeCampo = active instanceof HTMLElement && active.dataset.intoList !== undefined;
      if (!suelto && !desdeCampo) return;

      const list = box.current?.querySelectorAll<HTMLElement>(ROW);
      if (!list?.length) return;

      event.preventDefault();
      (event.key === "ArrowDown" ? list[0] : list[list.length - 1]).focus();
    };

    document.addEventListener("keydown", enter);
    return () => document.removeEventListener("keydown", enter);
  }, []);

  return { ref: box, focused, focus, onKeyDown, onFocusCapture };
}
