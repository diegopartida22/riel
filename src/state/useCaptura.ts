/**
 * Todo lo que sabe hacer un campo de captura, sin decidir cómo se ve.
 *
 * Lo comparten el campo del pie del panel y la ventana de captura rápida (spec 18), y eso es
 * lo que hace que la gramática se aprenda una sola vez: los mismos chips, el mismo menú de
 * proyecto, el mismo menú de comandos y las mismas teclas en los dos sitios. Lo que cada uno
 * decide por su cuenta es lo único en lo que de verdad se diferencian — qué hace Enter y qué
 * hace Escape.
 */

import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { Project } from "../data";
import {
  completions,
  dismissKey,
  isComplete,
  parse,
  sigilAt,
  slashAt,
  type CaptureToken,
} from "./capture";
import { commandsFor, filterCommands, type Command, type CommandGroup } from "./comandos";

/**
 * El aviso que la ventana de captura le manda al panel cuando ha escrito una tarea (spec 18).
 *
 * Vive aquí, en lo que las dos ventanas ya comparten, y no en el componente de la ventana: el
 * panel solo necesita el nombre del evento, y sacárselo de ahí le metía en su bundle el markup
 * entero de una ventana que nunca dibuja.
 */
export const CREATED_EVENT = "riel://tarea-creada";

export interface MenuItem {
  id: string;
  label: string;
  /** El literal que va a escribir, a la derecha del renglón y en la fuente de datos. */
  hint: string;
  color?: string;
  /** Solo en el menú de comandos: de qué grupo es. */
  group?: CommandGroup;
}

export interface Menu {
  kind: "proyecto" | "comando";
  label: string;
  items: MenuItem[];
  active: number;
}

interface Options {
  projects: Project[];
  /** El día local con el que se resuelven `hoy`, `mañana` y los días de la semana. */
  today: string;
  /** Si el menú de comandos ofrece abrir las notas. Solo donde hay sitio para escribirlas. */
  notes?: boolean;
  onNotes?: () => void;
}

export function useCaptura({ projects, today, notes = false, onNotes }: Options) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  /** Un Escape cierra el menú sin tocar el texto; la siguiente tecla lo devuelve. */
  const [menuOff, setMenuOff] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /** El menú solo existe mientras se escribe: colgado sin el foco en el campo sería un trozo
   *  de interfaz sin dueño. */
  const [focused, setFocused] = useState(false);

  const box = useRef<HTMLInputElement | null>(null);

  const capture = useMemo(
    () => parse(text, projects, today, dismissed),
    [text, projects, today, dismissed],
  );

  const commands = useMemo(
    () => commandsFor(projects, notes, today),
    [projects, notes, today],
  );

  const slash = slashAt(text, caret);
  const sigil = sigilAt(text, caret);

  const opened: { menu: Menu; at: number; pick: (index: number) => void } | null = (() => {
    if (!focused || menuOff) return null;

    // La barra manda sobre la marca de proyecto: es la que se acaba de escribir.
    if (slash) {
      const matches = filterCommands(commands, slash.fragment);
      if (matches.length === 0) return null;
      return {
        at: slash.at,
        menu: {
          kind: "comando",
          label: "Comandos",
          items: matches.map((command) => ({
            id: command.id,
            label: command.label,
            hint: command.insert,
            color: command.color,
            group: command.group,
          })),
          active: Math.min(highlight, matches.length - 1),
        },
        pick: (index) => runCommand(slash.at, matches[index]),
      };
    }

    if (sigil) {
      const matches = completions(sigil.fragment, projects);
      // En cuanto lo escrito nombra un proyecto entero, el menú sobra: el chip ya lo dice.
      if (matches.length === 0 || isComplete(sigil.fragment, projects)) return null;
      return {
        at: sigil.at,
        menu: {
          kind: "proyecto",
          label: "Proyectos",
          items: matches.map((project) => ({
            id: project.id,
            label: project.name,
            // La marca que se reescribe es la que se estaba escribiendo: empezar con `@` y
            // que el menú devuelva un `#` enseñaría a mano una gramática que no es la usada.
            hint: `${sigil.sigilo}${project.name}`,
            color: project.color,
          })),
          active: Math.min(highlight, matches.length - 1),
        },
        pick: (index) => write(sigil.at, `${sigil.sigilo}${matches[index].name}`),
      };
    }

    return null;
  })();

  const menu = opened?.menu ?? null;

  function place(next: string, position: number) {
    setText(next);
    setCaret(position);
    setHighlight(0);
    setMenuOff(false);
    // El valor lo pinta React en el siguiente pintado; mover el cursor antes lo dejaría al final.
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(position, position);
    });
  }

  /**
   * Sustituye la palabra que hay bajo el cursor desde `at`. La palabra **entera** y no solo
   * hasta el cursor: completar «#in|ra» tiene que dar «#Infra», no «#Infrara».
   */
  function write(at: number, insert: string) {
    let end = caret;
    while (end < text.length && !/\s/.test(text[end])) end++;

    const prefix = text.slice(0, at);
    let suffix = text.slice(end);

    if (!insert) {
      // Un comando que no escribe nada se lleva también el hueco que dejaría detrás.
      if (/\s$/.test(prefix)) suffix = suffix.replace(/^\s+/, "");
      place(prefix + suffix, prefix.length);
      return;
    }

    const glue = /^\s/.test(suffix) ? "" : " ";
    place(`${prefix}${insert}${glue}${suffix}`, prefix.length + insert.length + glue.length);
  }

  function runCommand(at: number, command: Command) {
    write(at, command.insert);
    if (command.action === "notas") onNotes?.();
  }

  const attach = (node: HTMLInputElement | null) => {
    box.current = node;
  };

  const sync = (node: HTMLInputElement) => {
    setText(node.value);
    setCaret(node.selectionStart ?? node.value.length);
    setMenuOff(false);
    // Cada tecla rehace la lista; conservar el resaltado señalaría a otro renglón del que
    // estaba señalando.
    setHighlight(0);
  };

  /** Solo mover el cursor. Es lo que hace un clic o una flecha dentro del texto: la lista de
   *  coincidencias cambia, pero lo escrito no. */
  const select = (node: HTMLInputElement) => {
    setCaret(node.selectionStart ?? 0);
  };

  const dismiss = (token: CaptureToken) => {
    setDismissed((current) => new Set(current).add(dismissKey(token)));
    box.current?.focus();
  };

  const reset = () => {
    setText("");
    setCaret(0);
    setDismissed(new Set());
    setHighlight(0);
    setMenuOff(false);
  };

  /**
   * Las teclas que son del menú, y solo esas. Devuelve cierto cuando se la quedó, para que
   * quien llama sepa que no tiene que seguir mirándola.
   */
  const menuKeyDown = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (!opened) return false;
    const { items } = opened.menu;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : items.length - 1;
      setHighlight((current) => (Math.min(current, items.length - 1) + step) % items.length);
      return true;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      opened.pick(opened.menu.active);
      return true;
    }

    if (event.key === "Escape") {
      // Este Escape cierra el menú y no llega al que limpia el campo ni al que cierra la
      // ventana: lo que se pedía era deshacerse de la lista.
      event.preventDefault();
      event.stopPropagation();
      setMenuOff(true);
      return true;
    }

    return false;
  };

  return {
    text,
    capture,
    menu,
    box,
    attach,
    sync,
    select,
    dismiss,
    reset,
    menuKeyDown,
    setFocused,
    pick: (index: number) => opened?.pick(index),
  };
}
