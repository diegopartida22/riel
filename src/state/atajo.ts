/**
 * El atajo global que abre la captura rápida (spec 18).
 *
 * Vive en `localStorage` con las otras preferencias de la máquina (spec 13) por la misma razón
 * que ellas: no es un dato del usuario —perderlo no borra ninguna tarea— y es de este equipo,
 * no de esta lista. Rust no puede leerlo, así que el panel se lo pasa al arrancar y cada vez
 * que cambia; hasta entonces no hay nada registrado, que es lo mismo que pasa con el glifo de
 * la barra.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";

const KEY = "riel:atajo-captura";

/**
 * ⌥Espacio, y puesto de fábrica.
 *
 * Un atajo global que hay que ir a configurar antes de que exista no lo encuentra nadie, y
 * entonces la captura rápida es una ventana a la que no se puede llegar. macOS no usa ⌥Espacio
 * para nada suyo —⌘Espacio es Spotlight— y quitarlo es un clic en Ajustes.
 */
export const DEFAULT = "alt+Space";

/** Nulo cuando se quitó a propósito; el de fábrica cuando nadie lo ha tocado todavía. */
export function storedShortcut(): string | null {
  const saved = localStorage.getItem(KEY);
  if (saved === null) return DEFAULT;
  return saved || null;
}

const MODS: [string, string][] = [
  ["control", "⌃"],
  ["alt", "⌥"],
  ["shift", "⇧"],
  ["super", "⌘"],
];

/** Los que no se llaman como se ven. El resto sale de quitarle el prefijo al `code`. */
const KEYS: Record<string, string> = {
  Space: "Espacio",
  Enter: "⏎",
  Tab: "⇥",
  Escape: "⎋",
  Backspace: "⌫",
  Delete: "⌦",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

const keyLabel = (code: string) =>
  KEYS[code] ?? code.replace(/^(Key|Digit|Numpad)/, "") ?? code;

/** Cómo se escribe un atajo en macOS: los modificadores en su orden y sin separadores. */
export function describe(accel: string | null): string {
  if (!accel) return "Sin atajo";

  const parts = accel.split("+");
  const key = parts[parts.length - 1];
  const mods = MODS.filter(([name]) => parts.includes(name)).map(([, glyph]) => glyph);

  return `${mods.join("")}${keyLabel(key)}`;
}

/**
 * Lo pulsado, en la gramática que entiende el plugin. Nulo si no sirve como atajo global.
 *
 * Pide al menos un modificador, y eso no es una comodidad: un atajo global sin modificador se
 * queda con esa tecla en todas las apps de la máquina, incluida la que se esté usando para
 * escribir.
 */
export function fromEvent(event: {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(event.code)) return null;
  if (!/^[A-Za-z0-9]+$/.test(event.code)) return null;

  const mods: string[] = [];
  if (event.ctrlKey) mods.push("control");
  if (event.altKey) mods.push("alt");
  if (event.shiftKey) mods.push("shift");
  if (event.metaKey) mods.push("super");
  if (mods.length === 0) return null;

  return [...mods, event.code].join("+");
}

export interface Atajo {
  accel: string | null;
  /** Dicho en castellano y listo para enseñarse tal cual. Casi siempre: ya lo usa otra app. */
  error: string | null;
  set: (accel: string | null) => void;
}

export function useAtajo(): Atajo {
  const [accel, setAccel] = useState<string | null>(storedShortcut);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void invoke("set_capture_shortcut", { accel })
      .then(() => setError(null))
      .catch((cause: unknown) => {
        console.error(cause);
        setError(typeof cause === "string" ? cause : "No se pudo poner el atajo.");
      });
  }, [accel]);

  const set = useCallback((next: string | null) => {
    // La cadena vacía es «quitado a propósito», que no es lo mismo que no haberlo tocado nunca.
    localStorage.setItem(KEY, next ?? "");
    setAccel(next);
  }, []);

  return { accel, error, set };
}

/**
 * Las combinaciones que se ofrecen cuando hay que elegir una, en orden de preferencia.
 *
 * Todas llevan una tecla que no se escribe —espacio o una letra con dos modificadores— y
 * ninguna es de las que macOS trae puestas de fábrica. No es una lista cerrada de lo que se
 * puede poner: se puede poner cualquier cosa que el grabador acepte. Es lo que se enseña a
 * quien no quiere pensarlo, que es casi todo el mundo.
 */
const CANDIDATOS = [
  "alt+Space",
  "control+shift+Space",
  "alt+shift+Space",
  "super+shift+Space",
  "control+alt+KeyN",
  "alt+shift+KeyN",
  "control+alt+KeyT",
];

/** Lo que contesta Rust: una combinación cogida y quién la tiene, ya dicho en castellano. */
interface Ocupado {
  accel: string;
  name: string;
}

export interface Conflictos {
  /** Quién usa el atajo puesto, o nulo si no lo usa nadie más. Va detrás de «ya lo usa». */
  owner: string | null;
  /** Hasta tres combinaciones libres, listas para pulsarse. */
  free: string[];
}

/**
 * Qué hay ya cogido en esta Mac, para que elegir un atajo no sea a ciegas (spec 18.7).
 *
 * Un atajo global que ya usa otra cosa no falla al ponerse: se pone, y luego no pasa nada al
 * pulsarlo, porque quien llegó antes se lo queda. Enterarse de eso es enterarse tarde.
 *
 * Las dos mitades de la pregunta se contestan distinto y por eso dicen cosas distintas. Los del
 * sistema salen de la configuración de verdad —quien haya movido Spotlight a ⌥Espacio tiene que
 * verlo— y se pueden nombrar. Los de otras apps solo se saben probando a registrarlos, así que
 * de esos lo único que se puede decir es que la combinación no está libre, y por eso salen de
 * la lista de sugerencias en vez de convertirse en un aviso.
 *
 * Se pregunta al abrirse Ajustes y no al arrancar: son dos procesos y una vuelta al sistema por
 * algo que se mira una vez en la vida.
 */
export function useConflictos(accel: string | null): Conflictos {
  const [sistema, setSistema] = useState<Map<string, string>>(() => new Map());
  const [libres, setLibres] = useState<string[]>([]);

  useEffect(() => {
    let vivo = true;

    void (async () => {
      let usados = new Map<string, string>();
      try {
        const ocupados = await invoke<Ocupado[]>("system_shortcuts");
        usados = new Map(ocupados.map((uno) => [uno.accel, uno.name]));
      } catch (cause) {
        // Sin esto se elige a ciegas, que es como se elegía antes. No es un error que enseñar.
        console.error(cause);
      }
      if (!vivo) return;
      setSistema(usados);

      const candidatos = CANDIDATOS.filter((uno) => !usados.has(uno));
      try {
        const free = await invoke<string[]>("free_shortcuts", { accels: candidatos });
        if (vivo) setLibres(free);
      } catch (cause) {
        console.error(cause);
        if (vivo) setLibres(candidatos);
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  return useMemo(
    () => ({
      owner: accel ? (sistema.get(accel) ?? null) : null,
      // El puesto no se ofrece: sugerir lo que ya está es no sugerir nada.
      free: libres.filter((uno) => uno !== accel).slice(0, 3),
    }),
    [accel, sistema, libres],
  );
}
