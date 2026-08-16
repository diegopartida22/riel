import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";

import {
  applyImport,
  parseSnapshot,
  planImport,
  safetyBackup,
  type ImportMode,
  type ImportPlan,
} from "../data";

export interface ImportSheetProps {
  /** Se llama cuando la base cambió: la vista de detrás tiene que releerlo todo. */
  onImported: () => void;
  onClose: () => void;
}

/**
 * La importación (spec 8), en el área de contenido y no flotando sobre ella — la misma razón
 * que el editor de proyecto: en 440px no hay sitio para una capa encima de otra, y oscurecer el
 * fondo para separarlas apagaría el vidrio.
 *
 * La hoja se lo lleva todo: abre el panel de archivos, valida, resume y escribe. Repartir el
 * flujo entre el popover y App dejaría el estado del import en tres sitios para un gesto que
 * es uno solo, y ninguno de los tres podría enseñar por sí mismo en qué punto se quedó.
 *
 * El resumen antes de escribir no es una cortesía: los dos modos hacen cosas incomparables
 * —uno agrega, el otro borra la base entera— y elegir entre ellos sin saber qué trae el
 * archivo es elegir a ciegas.
 */
type Stage =
  | { kind: "eligiendo" }
  | { kind: "resumen"; plan: ImportPlan; name: string }
  | { kind: "escribiendo" }
  | { kind: "hecho"; added: number; backup: string }
  /**
   * `backup` es lo que separa un fallo que no llegó a escribir de uno que sí: `null` mientras
   * nada se ha tocado —elegir el archivo, validarlo, planearlo— y la ruta de la copia en cuanto
   * la escritura pudo empezar. No es un detalle de presentación: sin transacción que deshaga un
   * volcado a medias (spec 8), es la diferencia entre poder prometer que todo sigue igual y no.
   */
  | { kind: "problema"; problem: string; backup: string | null };

/** Cuántas tareas del plan entran de verdad, según el modo. */
const arriving = (plan: ImportPlan, mode: ImportMode) =>
  mode === "reemplazar" ? plan.tasks.length : plan.tasks.length - plan.knownTasks;

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export function ImportSheet({ onImported, onClose }: ImportSheetProps) {
  const [stage, setStage] = useState<Stage>({ kind: "eligiendo" });
  const [mode, setMode] = useState<ImportMode>("combinar");
  /** El segundo sí de reemplazar. Se olvida al volver a combinar: no es una casilla pegajosa. */
  const [confirming, setConfirming] = useState(false);
  /** StrictMode monta dos veces en desarrollo, y con ello saldrían dos paneles de archivos. */
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;

    void (async () => {
      // El panel de abrir es una ventana del sistema y se lleva el foco: sin la bandera, el
      // panel de Riel se cerraría por debajo mientras se elige el archivo (spec 4).
      await invoke("set_keep_open", { value: true }).catch((cause) => console.error(cause));
      try {
        const path = await open({
          multiple: false,
          directory: false,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (typeof path !== "string") {
          onClose();
          return;
        }

        const contents = await invoke<string>("read_import", { path });
        const parsed = parseSnapshot(contents);
        if (!parsed.ok) {
          setStage({ kind: "problema", problem: parsed.problem, backup: null });
          return;
        }

        const planned = await planImport(parsed.snapshot);
        if (!planned.ok) {
          setStage({ kind: "problema", problem: planned.problem, backup: null });
          return;
        }

        setStage({
          kind: "resumen",
          plan: planned.plan,
          name: path.split("/").pop() ?? "el archivo",
        });
      } catch (cause) {
        console.error(cause);
        setStage({
          kind: "problema",
          problem: `No se pudo leer el archivo. ${String(cause)}`,
          backup: null,
        });
      } finally {
        await invoke("set_keep_open", { value: false }).catch((cause) => console.error(cause));
      }
    })();
  }, [onClose]);

  const run = async (plan: ImportPlan) => {
    const added = arriving(plan, mode);
    setStage({ kind: "escribiendo" });
    // Fuera del `try` a propósito: si lo que falla es el propio respaldo sigue valiendo `null`,
    // y eso es exactamente lo que hay que saber después — que no se escribió nada.
    let backup: string | null = null;
    try {
      // Antes de tocar nada. Si lo que falla es el propio respaldo, la importación no empieza:
      // escribir sin red justo en la operación que puede borrarlo todo es lo que no se hace.
      backup = await safetyBackup();
      await applyImport(plan, mode);
      onImported();
      setStage({ kind: "hecho", added, backup });
    } catch (cause) {
      console.error(cause);
      onImported();
      setStage({
        kind: "problema",
        problem: `No se pudo completar la importación. ${String(cause)}`,
        backup,
      });
    }
  };

  /** Acepta el `null` del estado sin estrecharlo fuera: el botón solo existe cuando hay ruta. */
  const reveal = (path: string | null) => {
    if (path === null) return;
    void revealItemInDir(path).catch((cause) => console.error(cause));
  };

  return (
    <section className="editor" aria-label="Importar desde JSON">
      <h2 className="editor__title">Importar desde JSON</h2>

      {stage.kind === "eligiendo" && <p className="editor__confirm-text">Eligiendo un archivo…</p>}

      {stage.kind === "escribiendo" && <p className="editor__confirm-text">Importando…</p>}

      {stage.kind === "problema" && (
        <>
          {/* Qué pasó y qué hacer, sin disculpas (spec 3.8). Lo segundo es en qué quedaron los
              datos, que es la primera pregunta de quien ve fallar algo que iba a escribir en su
              base — y la respuesta no es la misma según dónde falló.

              Fallando antes de escribir, la base está intacta y decirlo cierra el asunto. Una
              vez empezado el volcado no hay transacción que lo deshaga (spec 8), así que puede
              haber quedado a medias: prometer ahí que todo sigue igual sería mentir justo donde
              más caro sale, y en «reemplazar» —que borra las dos tablas antes de insertar— la
              mentira podría estar tapando una base vacía. Lo que sirve entonces no es una frase
              sino la copia, que es el deshacer de esto. */}
          <p className="editor__confirm-text">{stage.problem}</p>
          {stage.backup === null ? (
            <p className="editor__confirm-text">
              Tus tareas siguen como estaban. Revisa el archivo y vuelve a intentarlo.
            </p>
          ) : (
            <p className="editor__confirm-text">
              La escritura se quedó a medias, así que puede haber entrado parte de lo del
              archivo. La copia de cómo estaba todo antes es lo que devuelve Riel a como estaba.
            </p>
          )}
          <div className="editor__actions">
            {stage.backup !== null && (
              <button
                type="button"
                className="editor__button"
                onClick={() => reveal(stage.backup)}
              >
                Ver la copia
              </button>
            )}
            <button type="button" className="editor__button" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </>
      )}

      {stage.kind === "hecho" && (
        <>
          <p className="editor__confirm-text">
            {stage.added === 0
              ? "No había nada nuevo que importar: todo lo del archivo ya estaba en Riel."
              : `Se ${stage.added === 1 ? "importó" : "importaron"} ${plural(stage.added, "tarea", "tareas")}.`}
          </p>
          {/* El respaldo es el deshacer de esto, así que tiene que decir dónde quedó. Un
              «se guardó una copia» sin ruta obliga a salir a buscarla a ciegas. */}
          <p className="editor__confirm-text">
            La copia de cómo estaba todo antes quedó guardada por si hace falta volver.
          </p>
          <div className="editor__actions">
            <button
              type="button"
              className="editor__button"
              onClick={() => reveal(stage.backup)}
            >
              Ver la copia
            </button>
            <button type="button" className="editor__button editor__button--primary" onClick={onClose}>
              Listo
            </button>
          </div>
        </>
      )}

      {stage.kind === "resumen" && (
        <>
          <p className="editor__confirm-text">
            «{stage.name}» tiene {plural(stage.plan.tasks.length, "tarea", "tareas")} en{" "}
            {plural(stage.plan.projects.length, "proyecto", "proyectos")}.
            {stage.plan.knownTasks > 0 &&
              ` ${plural(stage.plan.knownTasks, "ya está", "ya están")} en Riel.`}
          </p>

          {/* Antes de confirmar y no después: entrar sin proyecto es un resultado legítimo
              —es lo que ya hace borrar un proyecto (spec 2)— pero enterarse al terminar de que
              cuarenta tareas perdieron el suyo es enterarse tarde. */}
          {stage.plan.orphaned > 0 && (
            <p className="editor__confirm-text">
              {plural(stage.plan.orphaned, "tarea apunta", "tareas apuntan")} a proyectos que no
              están en el archivo, así que {stage.plan.orphaned === 1 ? "entrará" : "entrarán"} sin
              proyecto.
            </p>
          )}

          {/* Los dos modos con la gramática de Ajustes: nombre a la izquierda, opciones a la
              derecha. Es la misma clase de elección —una lista cerrada de dos— y darle aquí
              botones de radio apilados sería una segunda forma para lo mismo. */}
          <div className="settings__row settings__row--flush">
            <span className="settings__label">Qué hacer</span>
            <div className="settings__choices" role="radiogroup" aria-label="Qué hacer">
              {(["combinar", "reemplazar"] as const).map((option) => (
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
                  {option === "combinar" ? "Combinar" : "Reemplazar"}
                </button>
              ))}
            </div>
          </div>

          {/* El nivel único, dicho aquí y no al fallar. Combinar deja intacto lo que ya está por
              id, así que una tarea que el archivo trae como raíz pero que en Riel ya es subtarea
              no entra, y su hija acabaría colgando de una subtarea: el disparador lo ataja, pero
              a media escritura. Reemplazar sí puede, porque vacía Riel antes de escribir — por
              eso esto no rechaza el archivo, solo cierra el modo que no cabe. */}
          {mode === "combinar" && stage.plan.mergeBlocked !== null ? (
            <p className="editor__confirm-text">
              «{stage.plan.mergeBlocked}» cuelga de una tarea que en Riel ya es subtarea, y solo
              hay un nivel. Combinar la dejaría sin sitio. Reemplazar sí puede con este archivo,
              porque vacía Riel antes de escribir.
            </p>
          ) : (
            <p className="editor__confirm-text">
              {mode === "combinar"
                ? `Combinar no borra nada: entra lo que falte y lo que ya está se queda como está. ${
                    arriving(stage.plan, "combinar") === 0
                      ? "Con este archivo no entraría nada nuevo."
                      : `Entrarían ${plural(arriving(stage.plan, "combinar"), "tarea", "tareas")}.`
                  }`
                : `Reemplazar borra ${plural(stage.plan.currentTasks, "tarea", "tareas")} y ${plural(
                    stage.plan.currentProjects,
                    "proyecto",
                    "proyectos",
                  )} de Riel, y deja solo lo del archivo.`}
            </p>
          )}

          <div className="editor__actions">
            <button type="button" className="editor__button" onClick={onClose}>
              Cancelar
            </button>
            {/* Reemplazar pide un segundo sí, como eliminar un proyecto: es la única acción de
                la app que se lleva por delante todo lo que hay, y un solo clic para eso no. */}
            {mode === "reemplazar" && !confirming ? (
              <button
                type="button"
                className="editor__button editor__button--danger"
                onClick={() => setConfirming(true)}
              >
                Reemplazar todo
              </button>
            ) : (
              <button
                type="button"
                className={`editor__button editor__button--${mode === "reemplazar" ? "danger" : "primary"}`}
                disabled={mode === "combinar" && stage.plan.mergeBlocked !== null}
                onClick={() => void run(stage.plan)}
              >
                {mode === "reemplazar" ? "Sí, borrar y reemplazar" : "Importar"}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
