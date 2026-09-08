import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

import type { Project } from "./data";
import { tint } from "./design/palette";
import { useAtajo } from "./state/atajo";
import { CREATED_EVENT } from "./state/useCaptura";
import { useAgenda } from "./state/agenda";
import { useClaude } from "./state/claude";
import { useDevMode } from "./state/editors";
import { usePreferencias } from "./state/preferencias";
import { useReminders } from "./state/reminders";
import { useUpdates } from "./state/updates";
import { useRiel } from "./state/useRiel";
import { acceptsNew } from "./state/views";
import { Composer } from "./ui/Composer";
import { useFocoDeTeclado } from "./ui/foco";
import { PanelLeftClose, PanelLeftOpen } from "./ui/icons";
import { ImportSheet } from "./ui/ImportSheet";
import { ProjectEditor } from "./ui/ProjectEditor";
import { Rail } from "./ui/Rail";
import { RemindersSheet } from "./ui/RemindersSheet";
import { SettingsPopover } from "./ui/SettingsPopover";
import { TopBar } from "./ui/TopBar";
import { ClaudeSessions } from "./views/ClaudeSessions";
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
  const prefs = usePreferencias();
  // El atajo global vive aquí y no en el popover: hay que registrarlo al arrancar, y el
  // popover se monta la primera vez que alguien abre el `⚙︎` — que puede no pasar nunca.
  const atajo = useAtajo();
  const updates = useUpdates();
  const dev = useDevMode();
  const agenda = useAgenda(riel.today);
  const reminders = useReminders(riel.reloadAll);
  const composer = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [settings, setSettings] = useState<DOMRect | null>(null);
  const [importing, setImporting] = useState(false);
  const [picking, setPicking] = useState(false);
  /** Si lo que ocupa el área de contenido es el apartado de Claude (spec 17). */
  const [sessions, setSessions] = useState(false);
  // Solo lee mientras el apartado está a la vista: contar `~/.claude` cuesta más que el
  // presupuesto entero del criterio 1, y al abrir Hoy no hay ahí nada que mirar (spec 17.6).
  const claude = useClaude(sessions);
  const [wantsCapture, setWantsCapture] = useState(false);

  useFocoDeTeclado();

  // El foco del primer arranque (spec 3.7) no puede ser `autoFocus`: cuando el componente se
  // monta todavía no se sabe si la base está vacía, y para cuando se sabe ya es tarde.
  useEffect(() => {
    if (riel.firstRun) composer.current?.focus();
  }, [riel.firstRun]);

  /**
   * Cada apertura del panel lo devuelve a la vista elegida en Ajustes, y limpia lo que hubiera
   * encima: búsqueda, detalle, editor de proyecto.
   *
   * El panel no se cierra, se oculta, así que sin esto reabrirlo te devuelve exactamente donde
   * lo dejaste — que en una ventana normal sería lo correcto, pero esta se abre y se cierra
   * decenas de veces al día y la última vez casi nunca es la que importa ahora.
   */
  const { select } = riel;
  const { startView } = prefs;
  useEffect(() => {
    // Se depende de `select` y de la vista, no de `riel` entero: ese es un objeto nuevo en cada
    // render, y con él aquí el oyente se daría de baja y de alta constantemente. `listen`
    // devuelve una promesa, así que entre una cosa y la otra hay un hueco sin nadie
    // escuchando — y el evento que se cayera en ese hueco es justo el que importa.
    //
    // `select` ya limpia la búsqueda y cierra el detalle; lo que no sabe es de las capas que
    // vive App.
    const unlisten = listen("riel://panel-abierto", () => {
      setSettings(null);
      setEditing(null);
      setImporting(false);
      setPicking(false);
      setSessions(false);
      select({ kind: startView });
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, [select, startView]);

  /**
   * Una tarea escrita desde la captura rápida (spec 18). El panel está escondido pero vivo, así
   * que se entera ahora y no cuando alguien lo abra: es lo que hace que la tarea ya esté en la
   * lista al abrirlo, y programada si traía hora — el plan de avisos cuelga de `tasks` (spec 7).
   */
  const { reloadAll } = riel;
  useEffect(() => {
    const unlisten = listen(CREATED_EVENT, () => void reloadAll());
    return () => {
      void unlisten.then((off) => off());
    };
  }, [reloadAll]);

  // ⌘N puede llegar con el detalle abierto o con el editor de proyecto delante, y el campo de
  // captura no está en el DOM hasta que esa capa se cierra. Pedirle el foco en el mismo golpe
  // de tecla no haría nada, así que la petición se guarda y se cobra cuando el campo aparece.
  useEffect(() => {
    if (!wantsCapture || !composer.current) return;
    composer.current.focus();
    setWantsCapture(false);
  }, [wantsCapture, editing, riel.detail, riel.view]);

  /**
   * Lo que el oyente de teclas necesita leer, siempre en su versión de este render.
   *
   * Va en una `ref` por lo mismo que el oyente del panel depende de `select` y no de `riel`
   * entero: `riel` es un objeto nuevo en cada render, así que con él en las dependencias este
   * oyente se daba de baja y de alta con cada tecla escrita en la búsqueda y con cada fila que
   * entra o sale de la lista. Y aquí no vale destructurar como allí, porque este usa media
   * docena de miembros: la lista de dependencias sería media App.
   *
   * Se escribe en un efecto sin dependencias —después de cada render— y no durante el render.
   * Un `keydown` se atiende siempre después de que los efectos se hayan vaciado, así que lo que
   * lee el oyente es lo del render que se acaba de pintar.
   */
  const teclado = useRef({ riel, editing, importing, picking });
  useEffect(() => {
    teclado.current = { riel, editing, importing, picking };
  });

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
      const { riel, editing, importing, picking } = teclado.current;

      if (event.key === "Escape") {
        event.preventDefault();
        if (riel.query) {
          riel.setQuery("");
        } else if (importing) {
          setImporting(false);
        } else if (picking) {
          setPicking(false);
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

      // ⌘Z repone el último borrado. ⇧⌘Z sería rehacer, que no existe: dejarlo caer aquí
      // haría que rehacer deshiciera, que es lo contrario de lo que se pidió.
      if (event.key === "z" && !event.shiftKey) {
        event.preventDefault();
        void riel.undo();
        return;
      }

      if (event.key === "n") {
        event.preventDefault();
        setEditing(null);
        setSessions(false);
        riel.closeDetail();
        // En Completadas no hay campo de captura, y una tecla que no hace nada es peor que una
        // que te mueve: ⌘N lleva a la vista donde siempre se puede agregar.
        if (!acceptsNew(riel.view)) riel.select({ kind: "hoy" });
        setWantsCapture(true);
        return;
      }

      // ⌘5, detrás de ⌘1..4 (spec 17.6). Va antes de la tabla porque no es una vista de tareas
      // y no tiene sitio en ella.
      if (event.key === "5") {
        event.preventDefault();
        setEditing(null);
        riel.closeDetail();
        riel.setQuery("");
        setSessions(true);
        return;
      }

      const numbered = NUMBERED[Number(event.key) - 1];
      if (numbered) {
        event.preventDefault();
        setEditing(null);
        setSessions(false);
        riel.select({ kind: numbered });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Dentro de un proyecto, el acento de todo el panel es el suyo (spec 3.1). Fuera, se queda
  // el grafito neutro y el color solo aparece en el punto de cada fila.
  const project = riel.view.kind === "proyecto" ? riel.projectsById.get(riel.view.id) : undefined;

  return (
    <div
      className={[
        "panel",
        prefs.railExpanded && "is-rail-expanded",
        // El apartado de Claude no es un proyecto y no está dentro de uno: su acento es el de
        // la app (spec 17.4), así que el tinte del proyecto seleccionado no lo alcanza.
        project && !editing && !sessions && "is-project tinted",
      ]
        .filter(Boolean)
        .join(" ")}
      /* Un atributo en la raíz y no una prop hasta cada fila: lo mira solo el CSS, y de aquí
         cuelgan por igual la lista, los resultados de búsqueda y las subtareas del detalle. */
      data-texto={prefs.rowText}
      style={project && !editing && !sessions ? tint(project.color) : undefined}
    >
      <TopBar
        ref={field}
        query={riel.query}
        settingsOpen={settings !== null}
        updateReady={updates.state.stage === "disponible"}
        onQuery={(value) => {
          // Escribir manda sobre lo que estuviera tapando la lista: el resultado se ve donde
          // se ve la lista, y dejarlo detrás de un editor abierto sería teclear a ciegas.
          if (value) {
            setEditing(null);
            setSessions(false);
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
          startView={prefs.startView}
          onStartView={prefs.setStartView}
          rowText={prefs.rowText}
          onRowText={prefs.setRowText}
          horizonte={prefs.horizonte}
          onHorizonte={prefs.setHorizonte}
          trayGlyph={prefs.trayGlyph}
          onTrayGlyph={prefs.setTrayGlyph}
          atajo={atajo}
          editors={dev.editors}
          editor={dev.editor}
          onEditor={dev.setEditor}
          agenda={agenda.enabled}
          onAgenda={agenda.setEnabled}
          calendar={agenda.permission}
          reminders={reminders.enabled}
          onReminders={reminders.setEnabled}
          remindersPermission={reminders.permission}
          reminderLists={reminders.lists.length}
          onPickLists={() => {
            // Igual que la importación: la hoja se lo lleva el área de contenido entera, así
            // que lo que hubiera puesto ahí se cierra antes.
            setEditing(null);
            setSessions(false);
            riel.closeDetail();
            setPicking(true);
          }}
          updates={updates}
          onImport={() => {
            // La hoja se lo lleva todo el área de contenido, así que lo que hubiera puesto ahí
            // se cierra: importar puede borrar la tarea que se estaba leyendo o el proyecto que
            // se estaba editando, y volver a ellos después sería volver a un fantasma.
            setEditing(null);
            setSessions(false);
            riel.closeDetail();
            setImporting(true);
          }}
          onClose={() => setSettings(null)}
        />
      )}

      <div className="panel__middle">
        <Rail
          view={riel.view}
          projects={riel.projects}
          counts={riel.counts}
          expanded={prefs.railExpanded}
          sessions={sessions}
          onSelect={(next) => {
            setEditing(null);
            setSessions(false);
            riel.select(next);
          }}
          onSessions={() => {
            setEditing(null);
            riel.closeDetail();
            // La búsqueda es de tareas y aquí no hay ninguna (spec 17.6). Dejarla puesta haría
            // que volver al riel devolviera a unos resultados que nadie pidió otra vez.
            riel.setQuery("");
            setSessions(true);
          }}
          onNewProject={() => setEditing({ project: null })}
          onEditProject={(target) => setEditing({ project: target })}
          onReorder={riel.reorderProject}
        />

        <main className="panel__body">
          {importing ? (
            <ImportSheet
              onImported={() => void riel.reloadAll()}
              onClose={() => setImporting(false)}
            />
          ) : picking ? (
            <RemindersSheet
              lists={reminders.lists}
              onLists={reminders.setLists}
              onClose={() => {
                setPicking(false);
                // Al salir, sin esperar al mínimo entre pasadas: quien acaba de vincular una
                // lista viene a ver sus tareas, no a esperar medio minuto.
                reminders.sync();
              }}
            />
          ) : sessions ? (
            <ClaudeSessions claude={claude} />
          ) : editing ? (
            <ProjectEditor
              key={editing.project?.id ?? "nuevo"}
              project={editing.project}
              pendingCount={
                editing.project ? (riel.counts.get(editing.project.id) ?? 0) : 0
              }
              onSave={(name, color, folder) =>
                riel.saveProject(editing.project, name, color, folder)
              }
              onPickFolder={dev.pickFolder}
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
              onAddSubtask={(title) =>
                riel.detail ? riel.addSubtask(riel.detail.id, title) : Promise.resolve(false)
              }
              onRemoveSubtask={(id) => void riel.remove(id)}
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
              /* La búsqueda no lleva horizonte: buscar mira todo (spec 5), y esconderle a
                 quien busca lo que cae en diciembre sería justo lo contrario. */
              horizonte={prefs.horizonte}
              loading={riel.loading}
              /* El fallo de abrir la carpeta sale por el mismo renglón que los de la lista:
                 es el único sitio donde ese botón está, y dos avisos distintos en la misma
                 vista serían dos sitios donde mirar. */
              error={riel.error ?? dev.error}
              leaving={riel.leaving}
              undoing={riel.undoing}
              toggle={riel.toggle}
              patch={riel.patch}
              remove={riel.remove}
              reorder={riel.reorder}
              addAfter={riel.addAfter}
              onOpen={riel.openDetail}
              onCapture={() => composer.current?.focus()}
              editorName={dev.editor?.name}
              onOpenFolder={dev.openFolder}
              events={agenda.events}
            />
          )}
        </main>
      </div>

      <div className="panel__foot">
        <div className="foot__rail">
          <button
            type="button"
            className="foot__toggle"
            title={prefs.railExpanded ? "Contraer el riel" : "Expandir el riel"}
            aria-label={prefs.railExpanded ? "Contraer el riel" : "Expandir el riel"}
            aria-expanded={prefs.railExpanded}
            onClick={prefs.toggleRail}
          >
            {prefs.railExpanded ? (
              <PanelLeftClose size={15} aria-hidden />
            ) : (
              <PanelLeftOpen size={15} aria-hidden />
            )}
          </button>
        </div>

        {/* El pie no captura mientras hay una hoja delante —editar un proyecto, importar, elegir
            listas— ni leyendo el detalle de una tarea: en ninguno hay lista a la que agregar. */}
        {!editing && !importing && !picking && !sessions && !riel.detail && acceptsNew(riel.view) && (
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
