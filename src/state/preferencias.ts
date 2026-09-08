/**
 * Las preferencias de esta máquina: el riel, la vista de arranque, el texto de la fila, hasta
 * dónde llega la lista y el glifo de la barra.
 *
 * Las cinco viven en `localStorage` y no en SQLite, y eso es lo que las junta aquí. No son
 * datos del usuario: perderlas devuelve el riel colapsado, Hoy y el icono de omisión, y no
 * borra ninguna tarea. Por eso tampoco salen en el export (spec 8) — un respaldo de la lista
 * que además reordenara el riel de la máquina donde se restaura estaría de más — y por eso la
 * que falta, la retención, no está aquí: esa sí decide qué se borra, así que va con los datos.
 *
 * Estaban dentro de `useRiel`, que es donde no pintan nada: no consultan la base, no dependen
 * de la vista y nadie las relee al cambiar de día. Lo que hacían ahí era engordar su interfaz
 * y volver a montar sus efectos cada vez que se pulsaba un segmentado de Ajustes.
 */

import { useCallback, useEffect, useState } from "react";

import { storeHorizonte, storedHorizonte, type Horizonte } from "./horizonte";
import { storeRowText, storedRowText, type RowText } from "./rowText";
import { applyTrayGlyph, storeTrayGlyph, storedTrayGlyph, type TrayGlyph } from "./trayGlyph";
import { SYSTEM_VIEWS, type SystemKind } from "./views";

/** El estado de expansión del riel persiste (spec 3.4). */
const RAIL_KEY = "riel:rail-expandido";

/** Con qué vista se abre el panel. */
const START_KEY = "riel:vista-al-abrir";

/**
 * La vista con la que arranca el panel, o Hoy si no hay nada elegido.
 *
 * Solo las cuatro del sistema. Un proyecto fijado tendría que decidir qué hacer cuando ese
 * proyecto se borra, y la respuesta —caer a otra vista— sería un ajuste que cambia solo.
 *
 * Se exporta suelta porque `useRiel` la necesita para su primer estado y no para nada más: la
 * vista en curso es suya, la preferencia de con cuál abrir es de aquí.
 */
export function startView(): SystemKind {
  const saved = localStorage.getItem(START_KEY);
  return SYSTEM_VIEWS.some((each) => each.kind === saved) ? (saved as SystemKind) : "hoy";
}

export interface Preferencias {
  /** La vista con la que se abre el panel, y con la que vuelve a abrirse cada vez. */
  startView: SystemKind;
  setStartView: (kind: SystemKind) => void;

  railExpanded: boolean;
  toggleRail: () => void;

  /** Si el título de la fila se corta a una línea o se enseña entero. */
  rowText: RowText;
  setRowText: (value: RowText) => void;

  /** Hasta dónde llega la lista antes de plegar lo de más adelante (spec 19). */
  horizonte: Horizonte;
  setHorizonte: (value: Horizonte) => void;

  /** Qué silueta dibuja el icono de la barra de menú (spec 4). */
  trayGlyph: TrayGlyph;
  setTrayGlyph: (value: TrayGlyph) => void;
}

export function usePreferencias(): Preferencias {
  const [start, setStart] = useState<SystemKind>(startView);
  const [railExpanded, setRailExpanded] = useState(() => localStorage.getItem(RAIL_KEY) === "1");
  const [rowText, setRowText] = useState<RowText>(storedRowText);
  const [horizonte, setHorizonte] = useState<Horizonte>(storedHorizonte);
  const [trayGlyph, setTrayGlyph] = useState<TrayGlyph>(storedTrayGlyph);

  // La silueta es la única de las cinco que tiene efecto fuera del webview, y Rust no puede
  // leerla: hay que mandársela. Va en un efecto y no dentro del que la cambia porque este
  // también cubre el arranque — Rust monta el icono con el de omisión, porque la preferencia
  // vive en el webview y el webview todavía no existe cuando se monta la barra, y esta es la
  // primera pasada que lo pone en su sitio.
  useEffect(() => applyTrayGlyph(trayGlyph), [trayGlyph]);

  /** Con qué vista se abre el panel a partir de ahora. Se aplica en la siguiente apertura. */
  const setStartView = useCallback((kind: SystemKind) => {
    localStorage.setItem(START_KEY, kind);
    setStart(kind);
  }, []);

  const toggleRail = useCallback(() => {
    setRailExpanded((current) => {
      localStorage.setItem(RAIL_KEY, current ? "0" : "1");
      return !current;
    });
  }, []);

  const changeRowText = useCallback((value: RowText) => {
    storeRowText(value);
    setRowText(value);
  }, []);

  const changeHorizonte = useCallback((value: Horizonte) => {
    storeHorizonte(value);
    setHorizonte(value);
  }, []);

  const changeTrayGlyph = useCallback((value: TrayGlyph) => {
    storeTrayGlyph(value);
    setTrayGlyph(value);
  }, []);

  return {
    startView: start,
    setStartView,
    railExpanded,
    toggleRail,
    rowText,
    setRowText: changeRowText,
    horizonte,
    setHorizonte: changeHorizonte,
    trayGlyph,
    setTrayGlyph: changeTrayGlyph,
  };
}
