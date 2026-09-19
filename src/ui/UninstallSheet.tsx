import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

import { allTasks, exportName, listProjects, snapshot } from "../data";

export interface UninstallSheetProps {
  onClose: () => void;
}

/**
 * Desinstalar Riel (spec 20), en el área de contenido y por la misma razón que la importación:
 * hay dos modos que hacen cosas incomparables y elegir entre ellos sin leer qué se lleva cada
 * uno es elegir a ciegas. En el popover no cabe ese texto, y del `⚙︎` sale solo la pregunta.
 *
 * Lo que la hoja no hace es borrar Riel. El gesto de quitar una app en macOS es arrastrarla a
 * la papelera, y una app que se manda sola ahí mientras corre es una promesa que se rompe en
 * cuanto algo falla a mitad. Lo que sí hace es lo que la papelera no alcanza — el registro de
 * `launchd`, la caché, el almacén del webview, las preferencias de ventana— y dejar el paquete
 * señalado en el Finder al salir, que es donde se termina el gesto.
 */
type Stage = "contando" | "eligiendo" | "yendo";

/** Qué se lleva por delante: solo lo que Riel deja puesto, o además la carpeta con las tareas. */
type Mode = "conservar" | "borrar";

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

interface Counts {
  tasks: number;
  projects: number;
}

export function UninstallSheet({ onClose }: UninstallSheetProps) {
  const [stage, setStage] = useState<Stage>("contando");
  const [counts, setCounts] = useState<Counts>({ tasks: 0, projects: 0 });
  /** El arranque al iniciar sesión: es el único rastro que sigue haciendo algo sin la app. */
  const [autostart, setAutostart] = useState(false);
  const [mode, setMode] = useState<Mode>("conservar");
  /** El segundo sí de borrarlo todo. Se olvida al volver a conservar: no es una casilla pegajosa. */
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void (async () => {
      // Las dos cifras salen de la base y no del estado de la vista: lo que se está decidiendo
      // es qué pasa con todo lo que hay, y la vista enseña lo de un día o lo de un proyecto.
      const [tasks, projects, launchd] = await Promise.all([
        allTasks(),
        listProjects(),
        invoke<{ disponible: boolean; puesto: boolean }>("autostart_state").catch(() => null),
      ]);
      setCounts({ tasks: tasks.length, projects: projects.length });
      setAutostart(launchd?.puesto ?? false);
      setStage("eligiendo");
    })().catch((cause) => {
      console.error(cause);
      setStage("eligiendo");
    });
  }, []);

  const exportJson = async () => {
    // El panel de guardar es una ventana del sistema y se lleva el foco: sin la bandera, el
    // panel de Riel se cerraría por debajo mientras se elige dónde (spec 4).
    await invoke("set_keep_open", { value: true }).catch((cause) => console.error(cause));
    try {
      const path = await save({
        defaultPath: exportName(),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path) await invoke("write_export", { path, contents: await snapshot() });
    } catch (cause) {
      console.error(cause);
    } finally {
      await invoke("set_keep_open", { value: false }).catch((cause) => console.error(cause));
    }
  };

  const run = () => {
    setStage("yendo");
    // No hay estado de «hecho» y no le falta: el comando no vuelve, porque lo último que hace
    // es cerrar la app. Lo que queda en pantalla mientras tanto es este renglón.
    void invoke("uninstall", { data: mode === "borrar" }).catch((cause) => {
      console.error(cause);
      setStage("eligiendo");
    });
  };

  /**
   * Qué se lleva el modo elegido. Va calculado aquí y no dentro del JSX porque son cuatro
   * redacciones —dos modos, con y sin tareas que perder— y anidarlas entre las llaves dejaba la
   * frase partida por la sangría del archivo.
   */
  const explicacion =
    mode === "conservar"
      ? [
          "Se quitan el arranque al iniciar sesión, los ajustes, la caché y el almacén del navegador.",
          counts.tasks === 0
            ? "La carpeta con tus datos se queda donde está."
            : `Tus ${plural(counts.tasks, "tarea se queda", "tareas se quedan")} donde están, y` +
              " volver a instalar Riel las encuentra.",
        ].join(" ")
      : counts.tasks === 0
        ? "Se va además la carpeta de datos, que ahora mismo está vacía."
        : [
            `Se van además ${plural(counts.tasks, "tarea", "tareas")} en` +
              ` ${plural(counts.projects, "proyecto", "proyectos")},`,
            "y las copias que Riel guardó antes de cada importación.",
            "Esto no se puede deshacer.",
          ].join(" ");

  return (
    <section className="editor" aria-label="Desinstalar Riel">
      <h2 className="editor__title">Desinstalar Riel</h2>

      {stage === "contando" && <p className="editor__confirm-text">Contando…</p>}

      {stage === "yendo" && <p className="editor__confirm-text">Desinstalando…</p>}

      {stage === "eligiendo" && (
        <>
          <p className="editor__confirm-text">
            Riel se quita arrastrándola a la papelera, como cualquier app. Esto es lo que la
            papelera no se lleva, y al terminar Riel se cierra y te la deja señalada en el Finder.
          </p>

          {/* El registro de `launchd` es la razón por la que este botón existe, así que se dice
              entero y solo cuando es verdad: apagado no hay nada que explicar. Apunta a una ruta
              dentro del paquete, así que con el paquete borrado no falla ruidosamente — falla
              callado, en cada inicio de sesión, y no hay nada en la pantalla que lo nombre. */}
          {autostart && (
            <p className="editor__confirm-text">
              El arranque al iniciar sesión está puesto, y ese registro apunta a una ruta dentro
              de Riel. Sin quitarlo, tu Mac va a seguir intentando abrirla en cada sesión sin
              decir nada.
            </p>
          )}

          {/* Los dos modos con la gramática de Ajustes y la misma forma que los de importar:
              nombre a la izquierda, opciones a la derecha. Es la misma clase de elección. */}
          <div className="settings__row settings__row--flush">
            <span className="settings__label">Qué hacer</span>
            <div className="settings__choices" role="radiogroup" aria-label="Qué hacer">
              {(["conservar", "borrar"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`settings__choice${mode === option ? " is-selected" : ""}`}
                  role="radio"
                  aria-checked={mode === option}
                  onClick={() => {
                    setMode(option);
                    setConfirming(false);
                  }}
                >
                  {option === "conservar" ? "Conservar" : "Borrarlo todo"}
                </button>
              ))}
            </div>
          </div>

          <p className="editor__confirm-text">{explicacion}</p>

          <div className="editor__actions">
            {/* Solo en el modo que borra, y ahí es lo primero que hay que poder hacer: un export
                es lo que convierte «esto no se puede deshacer» en una decisión reversible
                (spec 8). En el otro modo no hace falta — los datos se quedan puestos. */}
            {mode === "borrar" && counts.tasks > 0 && (
              <button type="button" className="editor__button" onClick={() => void exportJson()}>
                Exportar a JSON…
              </button>
            )}
            <button type="button" className="editor__button" onClick={onClose}>
              Cancelar
            </button>
            {/* El segundo sí, como reemplazar al importar y por lo mismo. Y no cuando no hay
                nada que perder: una confirmación que sale siempre se aprende a pulsar sin
                leerla, y entonces ya no protege de nada (spec 8). */}
            {mode === "borrar" && counts.tasks > 0 && !confirming ? (
              <button
                type="button"
                className="editor__button editor__button--danger"
                onClick={() => setConfirming(true)}
              >
                Borrarlo todo
              </button>
            ) : (
              <button
                type="button"
                className={`editor__button editor__button--${mode === "borrar" ? "danger" : "primary"}`}
                onClick={run}
              >
                {mode === "borrar" && counts.tasks > 0 ? "Sí, borrarlo todo" : "Desinstalar"}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
