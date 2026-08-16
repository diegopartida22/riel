/**
 * El modo desarrollo (spec 13): la carpeta de un proyecto y el editor con el que se abre.
 *
 * Un proyecto de Riel y una carpeta del disco son la misma cosa muchas veces —«riel» es la
 * lista de tareas y también el repositorio— y lo que se hace con la segunda es siempre lo
 * mismo: abrirla en el editor. Vinculadas, eso es un clic desde donde ya se está mirando la
 * lista, en vez de un viaje al Finder.
 *
 * Qué editor hay instalado lo contesta Rust, que es el único que puede preguntarlo. Cuál se
 * usa vive en `localStorage` con el riel y la vista de arranque: es una preferencia de esta
 * máquina, no un dato, y en otra el editor puesto ni siquiera tiene por qué estar instalado.
 */

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";

export interface Editor {
  /** Identificador de paquete. Es lo que se le devuelve a Rust para abrir. */
  id: string;
  /** Nombre corto, el que cabe en la fila de opciones de Ajustes. */
  name: string;
}

const KEY = "editor";

export interface DevMode {
  /** Los instalados, en el orden en que Rust los prefiere. Vacío mientras se pregunta. */
  editors: Editor[];
  /** El puesto: el elegido si sigue instalado, si no el primero. Nulo sin ninguno. */
  editor: Editor | null;
  setEditor: (id: string) => void;
  /** Abre una carpeta en el editor puesto. Lo que falle se queda en `error`. */
  openFolder: (folder: string) => void;
  /** Abre el panel del sistema para elegir una carpeta. Nulo si se cerró sin elegir. */
  pickFolder: () => Promise<string | null>;
  error: string | null;
}

export function useDevMode(): DevMode {
  const [editors, setEditors] = useState<Editor[]>([]);
  const [chosen, setChosen] = useState<string | null>(() => localStorage.getItem(KEY));
  const [error, setError] = useState<string | null>(null);

  // Una vez y para siempre: instalar un editor con Riel abierta pide salir de Riel, así que la
  // lista no cambia mientras el panel vive.
  useEffect(() => {
    invoke<Editor[]>("editors").then(setEditors, (cause) => console.error(cause));
  }, []);

  // El elegido puede haberse desinstalado desde la última vez, y entonces manda el primero que
  // quede: un botón que abre un editor que ya no está no falla, no hace nada.
  const editor = editors.find((each) => each.id === chosen) ?? editors[0] ?? null;

  const setEditor = useCallback((id: string) => {
    localStorage.setItem(KEY, id);
    setChosen(id);
  }, []);

  const openFolder = useCallback(
    (folder: string) => {
      setError(null);
      if (!editor) {
        setError("No hay ningún editor de los que Riel conoce instalado.");
        return;
      }
      invoke("open_in_editor", { editor: editor.id, path: folder }).catch((cause) => {
        console.error(cause);
        setError(typeof cause === "string" ? cause : "No se pudo abrir la carpeta.");
      });
    },
    [editor],
  );

  /**
   * El panel de elegir carpeta es una ventana del sistema: se lleva el foco, y sin levantar la
   * bandera el panel de Riel se cerraría por debajo mientras se contesta (spec 4).
   */
  const pickFolder = useCallback(async () => {
    setError(null);
    await invoke("set_keep_open", { value: true }).catch((cause) => console.error(cause));
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      return typeof picked === "string" ? picked : null;
    } catch (cause) {
      console.error(cause);
      return null;
    } finally {
      await invoke("set_keep_open", { value: false }).catch((cause) => console.error(cause));
    }
  }, []);

  return { editors, editor, setEditor, openFolder, pickFolder, error };
}

/**
 * La ruta como se enseña: sin el `~` del usuario y, si sigue sin caber, con el principio
 * comido. Lo que identifica una carpeta es su nombre y el de la que la contiene, así que lo
 * que se recorta es lo de más a la izquierda, que es lo que se comparte con todo el disco.
 */
export function shortPath(path: string, max = 34): string {
  const home = path.match(/^\/Users\/[^/]+(\/|$)/);
  const short = home ? `~${path.slice(home[0].length - (home[1] ? 1 : 0))}` : path;
  if (short.length <= max) return short;

  const parts = short.split("/");
  let tail = parts.pop() ?? short;
  while (parts.length && `…/${parts[parts.length - 1]}/${tail}`.length <= max) {
    tail = `${parts.pop()}/${tail}`;
  }
  return `…/${tail}`;
}
