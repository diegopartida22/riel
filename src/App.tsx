import { getCurrentWindow } from "@tauri-apps/api/window";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Project } from "./data";
import { tint } from "./design/palette";
import { useRiel } from "./state/useRiel";
import { acceptsNew } from "./state/views";
import { Composer } from "./ui/Composer";
import { ProjectEditor } from "./ui/ProjectEditor";
import { Rail } from "./ui/Rail";
import { SettingsPopover } from "./ui/SettingsPopover";
import { TopBar } from "./ui/TopBar";
import { SearchResults } from "./views/SearchResults";
import { TaskDetail } from "./views/TaskDetail";
import { TaskList } from "./views/TaskList";

/** Qué se está editando: un proyecto existente, o `null` para uno nuevo. Sin nada, se ve la lista. */
type Editing = { project: Project | null } | null;

/** Las cuatro vistas del sistema, en el orden en que las numera ⌘1..4 (spec 5). */
const NUMBERED = ["hoy", "proximas", "todas", "completadas"] as const;

/**
 * Paso 6: la barra superior con la búsqueda y los ajustes, sobre el riel y las vistas.
 */
export default function App() {
  const riel = useRiel();
  const composer = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [settings, setSettings] = useState<DOMRect | null>(null);
  const [wantsCapture, setWantsCapture] = useState(false);

  // El foco del primer arranque (spec 3.7) no puede ser `autoFocus`: cuando el componente se
  // monta todavía no se sabe si la base está vacía, y para cuando se sabe ya es tarde.
  useEffect(() => {
    if (riel.firstRun) composer.current?.focus();
  }, [riel.firstRun]);

  // ⌘N puede llegar con el detalle abierto o con el editor de proyecto delante, y el campo de
  // captura no está en el DOM hasta que esa capa se cierra. Pedirle el foco en el mismo golpe
  // de tecla no haría nada, así que la petición se guarda y se cobra cuando el campo aparece.
  useEffect(() => {
    if (!wantsCapture || !composer.current) return;
    composer.current.focus();
    setWantsCapture(false);
  }, [wantsCapture, editing, riel.detail, riel.view]);

  /**
   * Los atajos que no dependen de dónde esté el foco (spec 5). El resto —flechas, Espacio,
   * ⏎— van con la fila enfocada y llegan con la pasada de teclado.
   *
   * Escape va deshaciendo capas de fuera hacia dentro: primero la búsqueda, después lo que
   * esté tapando la lista, y solo con la lista limpia cierra el panel. El spec solo nombra
   * los dos primeros tiempos; que el detalle y el editor de proyecto se cierren antes que el
   * panel es una extensión, pero al revés reabrir el panel te devolvería a una pantalla que
   * ya habías querido dejar. Los menús se lo comen antes de que llegue aquí.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (riel.query) {
          riel.setQuery("");
        } else if (editing) {
          setEditing(null);
        } else if (riel.detail) {
          riel.closeDetail();
        } else {
          void getCurrentWindow().hide();
        }
        return;
      }

      if (!event.metaKey || event.altKey || event.ctrlKey) return;

      if (event.key === "f") {
        event.preventDefault();
        field.current?.focus();
        field.current?.select();
        return;
      }

      if (event.key === "n") {
        event.preventDefault();
        setEditing(null);
        riel.closeDetail();
        // En Completadas no hay campo de captura, y una tecla que no hace nada es peor que una
        // que te mueve: ⌘N lleva a la vista donde siempre se puede agregar.
        if (!acceptsNew(riel.view)) riel.select({ kind: "hoy" });
        setWantsCapture(true);
        return;
      }

      const numbered = NUMBERED[Number(event.key) - 1];
      if (numbered) {
        event.preventDefault();
        setEditing(null);
        riel.select({ kind: numbered });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, riel]);

  // Dentro de un proyecto, el acento de todo el panel es el suyo (spec 3.1). Fuera, se queda
  // el grafito neutro y el color solo aparece en el punto de cada fila.
  const project = riel.view.kind === "proyecto" ? riel.projectsById.get(riel.view.id) : undefined;

  return (
    <div
      className={[
        "panel",
        riel.railExpanded && "is-rail-expanded",
        project && !editing && "is-project tinted",
      ]
        .filter(Boolean)
        .join(" ")}
      style={project && !editing ? tint(project.color) : undefined}
    >
      <TopBar
        ref={field}
        query={riel.query}
        settingsOpen={settings !== null}
        onQuery={(value) => {
          // Escribir manda sobre lo que estuviera tapando la lista: el resultado se ve donde
          // se ve la lista, y dejarlo detrás de un editor abierto sería teclear a ciegas.
          if (value) {
            setEditing(null);
            riel.closeDetail();
          }
          riel.setQuery(value);
        }}
        onSettings={(anchor) => setSettings((current) => (current ? null : anchor))}
      />

      {settings && (
        <SettingsPopover
          anchor={settings}
          retention={riel.retention}
          onRetention={riel.setRetention}
          onClose={() => setSettings(null)}
        />
      )}

      <div className="panel__middle">
        <Rail
          view={riel.view}
          projects={riel.projects}
          counts={riel.counts}
          expanded={riel.railExpanded}
          onSelect={(next) => {
            setEditing(null);
            riel.select(next);
          }}
          onNewProject={() => setEditing({ project: null })}
          onEditProject={(target) => setEditing({ project: target })}
        />

        <main className="panel__body">
          {editing ? (
            <ProjectEditor
              key={editing.project?.id ?? "nuevo"}
              project={editing.project}
              pendingCount={
                editing.project ? (riel.counts.get(editing.project.id) ?? 0) : 0
              }
              onSave={(name, color) => riel.saveProject(editing.project, name, color)}
              onDelete={async () => {
                if (editing.project) await riel.removeProject(editing.project.id);
                setEditing(null);
              }}
              onClose={() => setEditing(null)}
            />
          ) : riel.detail ? (
            <TaskDetail
              key={riel.detail.id}
              task={riel.detail}
              project={
                riel.detail.projectId
                  ? (riel.projectsById.get(riel.detail.projectId) ?? null)
                  : null
              }
              projects={riel.projects}
              today={riel.today}
              onPatch={(values) => riel.detail && void riel.patch(riel.detail.id, values)}
              onToggle={riel.toggle}
              onDelete={() => riel.detail && void riel.remove(riel.detail.id)}
              onClose={riel.closeDetail}
            />
          ) : riel.searching ? (
            /* Va después del detalle: abrir una tarea desde un resultado tiene que llevar al
               detalle sin borrar la consulta, para que cerrarlo devuelva a la misma lista. */
            <SearchResults
              query={riel.term}
              results={riel.tasks}
              projectsById={riel.projectsById}
              today={riel.today}
              loading={riel.loading}
              error={riel.error}
              leaving={riel.leaving}
              toggle={riel.toggle}
              onOpen={riel.openDetail}
            />
          ) : (
            <TaskList
              view={riel.view}
              tasks={riel.tasks}
              projectsById={riel.projectsById}
              today={riel.today}
              loading={riel.loading}
              error={riel.error}
              leaving={riel.leaving}
              toggle={riel.toggle}
              patch={riel.patch}
              remove={riel.remove}
              reorder={riel.reorder}
              onOpen={riel.openDetail}
              onCapture={() => composer.current?.focus()}
            />
          )}
        </main>
      </div>

      <div className="panel__foot">
        <div className="foot__rail">
          <button
            type="button"
            className="foot__toggle"
            title={riel.railExpanded ? "Contraer el riel" : "Expandir el riel"}
            aria-label={riel.railExpanded ? "Contraer el riel" : "Expandir el riel"}
            aria-expanded={riel.railExpanded}
            onClick={riel.toggleRail}
          >
            {riel.railExpanded ? (
              <PanelLeftClose size={15} strokeWidth={1.75} aria-hidden />
            ) : (
              <PanelLeftOpen size={15} strokeWidth={1.75} aria-hidden />
            )}
          </button>
        </div>

        {/* El pie no captura mientras se edita un proyecto ni mientras se lee el detalle de
            una tarea: en ninguno de los dos casos hay una lista delante a la que agregar. */}
        {!editing && !riel.detail && acceptsNew(riel.view) && (
          <Composer
            ref={composer}
            firstRun={riel.firstRun}
            projects={riel.projects}
            today={riel.today}
            onAdd={riel.add}
          />
        )}
      </div>
    </div>
  );
}
