/**
 * Las preferencias de esta máquina: la vista de arranque, el texto de la fila, hasta dónde
 * llega la lista y el glifo de la barra.
 *
 * Las cuatro viven en `localStorage` y no en SQLite, y eso es lo que las junta aquí. No son
 * datos del usuario: perderlas devuelve la pantalla de listas y el icono de omisión, y no
 * borra ninguna tarea. Por eso tampoco salen en el export (spec 8) — un respaldo de la lista
 * que además cambiara cómo abre el panel de la máquina donde se restaura estaría de más — y por eso la
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

/** Con qué vista se abre el panel. */
const START_KEY = "riel:vista-al-abrir";

/** Con qué abre el panel: la pantalla de listas o una de las cuatro del sistema. */
export type StartKind = "inicio" | SystemKind;

/**
 * La vista con la que arranca el panel, o la pantalla de listas si no hay nada elegido.
 *
 * Solo la pantalla de listas y las cuatro del sistema. Un proyecto fijado tendría que decidir
 * qué hacer cuando ese proyecto se borra, y la respuesta —caer a otra vista— sería un ajuste
 * que cambia solo.
 *
 * Se exporta suelta porque `useRiel` la necesita para su primer estado y no para nada más: la
 * vista en curso es suya, la preferencia de con cuál abrir es de aquí.
 */
export function startView(): StartKind {
  const saved = localStorage.getItem(START_KEY);
  if (saved === "inicio") return saved;
  return SYSTEM_VIEWS.some((each) => each.kind === saved) ? (saved as SystemKind) : "inicio";
}

export interface Preferencias {
  /** La vista con la que se abre el panel, y con la que vuelve a abrirse cada vez. */
  startView: StartKind;
  setStartView: (kind: StartKind) => void;

  /** Si el título de la fila se enseña entero o se corta a una línea. */
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
  const [start, setStart] = useState<StartKind>(startView);
  const [rowText, setRowText] = useState<RowText>(storedRowText);
  const [horizonte, setHorizonte] = useState<Horizonte>(storedHorizonte);
  const [trayGlyph, setTrayGlyph] = useState<TrayGlyph>(storedTrayGlyph);

  // La silueta es la única de las cuatro que tiene efecto fuera del webview, y Rust no puede
  // leerla: hay que mandársela. Va en un efecto y no dentro del que la cambia porque este
  // también cubre el arranque — Rust monta el icono con el de omisión, porque la preferencia
  // vive en el webview y el webview todavía no existe cuando se monta la barra, y esta es la
  // primera pasada que lo pone en su sitio.
  useEffect(() => applyTrayGlyph(trayGlyph), [trayGlyph]);

  /** Con qué vista se abre el panel a partir de ahora. Se aplica en la siguiente apertura. */
  const setStartView = useCallback((kind: StartKind) => {
    localStorage.setItem(START_KEY, kind);
    setStart(kind);
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
    rowText,
    setRowText: changeRowText,
    horizonte,
    setHorizonte: changeHorizonte,
    trayGlyph,
    setTrayGlyph: changeTrayGlyph,
  };
}
