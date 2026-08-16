import { Fragment, useEffect, useMemo, useState } from "react";

import type { Between, Priority, Project, Task, TaskPatch, TaskTree } from "../data";
import { tint } from "../design/palette";
import { emptyMessage, titleOf, type View } from "../state/views";
import { EmptyState } from "../ui/EmptyState";
import { GroupHeader } from "../ui/GroupHeader";
import { Code } from "../ui/icons";
import { RowMenu } from "../ui/RowMenu";
import { TaskRow } from "../ui/TaskRow";
import { TitleEditor } from "../ui/TitleEditor";
import { useReorder } from "../ui/useReorder";
import { useRowKeys } from "../ui/useRowKeys";

export interface TaskListProps {
  view: View;
  tasks: TaskTree[];
  projectsById: Map<string, Project>;
  today: string;
  loading: boolean;
  error: string | null;
  leaving: ReadonlySet<string>;
  /** Las completadas que todavía están en su ventana de deshacer. */
  undoing: ReadonlySet<string>;
  toggle: (task: Task, checked: boolean) => void;
  patch: (id: string, patch: TaskPatch) => void;
  remove: (id: string) => void;
  reorder: (id: string, between: Between) => void;
  /** ⌘⏎: guardar y crear otra debajo. */
  addAfter: (title: string, afterId: string) => Promise<string | null>;
  onOpen: (id: string) => void;
  /** Lleva el foco al campo de captura desde el botón del estado vacío. */
  onCapture: () => void;
  /** El editor puesto, para nombrar el botón de la carpeta. Nulo si no hay ninguno (spec 13). */
  editorName?: string | null;
  /** Abre la carpeta del proyecto en ese editor. */
  onOpenFolder?: (folder: string) => void;
}

/** Qué fila tiene el menú abierto y dónde anclarlo. */
type OpenMenu = { id: string; anchor: DOMRect } | null;

/**
 * La lista de cualquier vista. Lo único que cambia entre Hoy, Próximas, Todas, Completadas y
 * un proyecto es la consulta que la llenó y el encabezado; la fila es la misma en todas.
 *
 * Dentro de un proyecto se oculta el punto de color de cada fila: ahí sería decir en cada
 * renglón algo que ya dice el riel (spec 3.5).
 *
 * En Completadas no se arrastra. El orden de esa vista lo da la fecha en que se terminó cada
 * tarea, no `position`, así que una manija ahí prometería algo que no se puede guardar.
 */
export function TaskList({
  view,
  tasks,
  projectsById,
  today,
  loading,
  error,
  leaving,
  undoing,
  toggle,
  patch,
  remove,
  reorder,
  addAfter,
  onOpen,
  onCapture,
  editorName,
  onOpenFolder,
}: TaskListProps) {
  const project = view.kind === "proyecto" ? projectsById.get(view.id) : undefined;
  const title = titleOf(view, project?.name);
  const sortable = view.kind !== "completadas";

  const [menu, setMenu] = useState<OpenMenu>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** Debajo de qué fila se está escribiendo una tarea que todavía no existe (⌘⏎). */
  const [draftAfter, setDraftAfter] = useState<string | null>(null);
  /** A qué fila devolver el foco en cuanto vuelva a estar pintada. */
  const [restore, setRestore] = useState<string | null>(null);

  /**
   * Lo que de verdad se pinta. La lista es de trabajo pendiente, así que una subtarea que ya
   * estaba completada al leer la vista no ocupa renglón: tuvo su tachado y su colapso el día
   * que se marcó (spec 3.6), y volver a enseñarla en cada lectura sería no haberla dejado ir
   * nunca. Sigue existiendo —el detalle la lista tachada y el barrido no la toca—, que es la
   * diferencia entre terminada y borrada.
   *
   * Las que están en su ventana de deshacer se quedan: ahí el tachado se está dibujando y la
   * casilla todavía revierte. Y bajo una raíz completada no se filtra nada, porque en
   * Completadas lo terminado es justo lo que se viene a ver.
   */
  const visible = useMemo(
    () =>
      tasks.map((task) =>
        task.completedAt
          ? task
          : {
              ...task,
              subtasks: task.subtasks.filter(
                (subtask) => !subtask.completedAt || undoing.has(subtask.id),
              ),
            },
      ),
    [tasks, undoing],
  );

  // Las raíces en un grupo y las subtareas de cada una en el suyo: se ordena entre hermanas.
  const groups = useMemo(
    () => [
      visible.map((task) => task.id),
      ...visible.map((task) => task.subtasks.map((subtask) => subtask.id)),
    ],
    [visible],
  );

  const drag = useReorder(groups, reorder);

  // El orden en que se ven las filas, subtareas incluidas: es el recorrido de ↑↓ y quien
  // decide cuál entra en el Tab.
  const order = useMemo(
    () => visible.flatMap((task) => [task.id, ...task.subtasks.map((subtask) => subtask.id)]),
    [visible],
  );

  const find = (id: string): Task | undefined =>
    visible.find((task) => task.id === id) ??
    visible.flatMap((task) => task.subtasks).find((subtask) => subtask.id === id);

  const keys = useRowKeys({
    order,
    onToggle: (id) => {
      const task = find(id);
      if (task) toggle(task, task.completedAt === null);
    },
    onEdit: setEditing,
  });

  // Al cerrar el campo, el foco se iría al `body` y con él se irían las flechas y el anillo.
  // Va por estado y no en el mismo golpe porque la fila a la que hay que volver puede ser una
  // que se acaba de crear y todavía no existe en el DOM.
  const { focus } = keys;
  useEffect(() => {
    if (!restore) return;
    focus(restore);
    setRestore(null);
  }, [restore, focus, visible]);

  const saveTitle = (id: string, text: string, andAnother: boolean) => {
    const task = find(id);
    // Un título vacío no es una edición, es medio borrado: se deja como estaba y para borrar
    // está el menú, que además avisa.
    if (text && task && text !== task.title) patch(id, { title: text });
    setEditing(null);
    if (andAnother) setDraftAfter(id);
    else setRestore(id);
  };

  const saveDraft = async (afterId: string, text: string, andAnother: boolean) => {
    if (!text) {
      setDraftAfter(null);
      setRestore(afterId);
      return;
    }

    const created = await addAfter(text, afterId);
    // Encadenar: otro ⌘⏎ deja el campo abierto de nuevo, ahora colgando de la recién creada.
    // Es el modo en que se escriben cinco tareas seguidas sin bajar al pie.
    if (andAnother && created) {
      setDraftAfter(created);
      return;
    }
    setDraftAfter(null);
    if (created) setRestore(created);
  };

  /**
   * El botón que abre la carpeta del proyecto en el editor (spec 13). Solo aparece con las dos
   * condiciones puestas —hay carpeta vinculada y hay editor instalado— porque cualquiera de las
   * dos sin la otra lo deja prometiendo algo que no puede hacer, que es lo mismo que ya decide
   * si una fila dibuja su manija de arrastre.
   *
   * Lo nombra el editor y no la carpeta: lo que hace falta saber antes de pulsar es en qué se
   * va a abrir, y la ruta ya está en el editor del proyecto, que es donde se puso.
   */
  const openFolder =
    project?.folder && editorName && onOpenFolder ? (
      <button
        type="button"
        className="group-header__tool"
        title={`Abrir en ${editorName}`}
        aria-label={`Abrir «${project.name}» en ${editorName}`}
        onClick={() => onOpenFolder(project.folder as string)}
      >
        <Code size={13} aria-hidden />
      </button>
    ) : undefined;

  // Sin este hueco la lista parpadea con el estado vacío cada vez que se cambia de vista.
  if (loading) return <div className="view" />;

  const open = menu && visible.find((task) => task.id === menu.id);

  return (
    <div className="view" ref={keys.ref} onKeyDown={keys.onKeyDown} onFocusCapture={keys.onFocusCapture}>
      {error && <p className="notice notice--error">{error}</p>}

      {visible.length === 0 ? (
        <>
          {/* Con la lista vacía el encabezado solo sale si trae el botón. Un proyecto recién
              creado y vinculado a su carpeta es exactamente cuando hace falta abrirla, y sin
              esto el botón desaparecía justo ahí; sin botón, en cambio, repetir el nombre que
              ya está marcado en el riel sobre un «Este proyecto está vacío» son dos renglones
              para no decir nada. */}
          {openFolder && <GroupHeader action={openFolder}>{title}</GroupHeader>}
          <EmptyState
            message={emptyMessage(view)}
            action={view.kind === "hoy" ? "Agregar tarea" : undefined}
            onAction={onCapture}
          />
        </>
      ) : (
        <>
          <GroupHeader action={openFolder}>{title}</GroupHeader>
          <ul className={`task-list${drag.dragging ? " is-sorting" : ""}`}>
            {visible.map((task) => (
              <Fragment key={task.id}>
                <TaskRow
                  ref={drag.register(task.id)}
                  task={task}
                  project={task.projectId ? projectsById.get(task.projectId) : null}
                  showProjectDot={view.kind !== "proyecto"}
                  subtasks={task.subtasks}
                  today={today}
                  leaving={leaving}
                  offset={drag.offsetOf(task.id)}
                  flying={drag.dragging === task.id}
                  onGrab={sortable ? (event) => drag.grab(event, task.id) : undefined}
                  sortSubtasks={sortable ? drag : undefined}
                  onToggle={toggle}
                  onOpen={() => onOpen(task.id)}
                  onMenu={(anchor) =>
                    setMenu((current) =>
                      current?.id === task.id ? null : { id: task.id, anchor },
                    )
                  }
                  focused={keys.focused}
                  editing={editing}
                  onEditSave={saveTitle}
                  onEditCancel={() => {
                    setEditing(null);
                    setRestore(task.id);
                  }}
                />

                {/* La fila que todavía no existe. Nada llega a la base hasta que tenga
                    título: así un ⌘⏎ del que uno se arrepiente no deja una tarea en blanco
                    que después hay que ir a buscar y borrar. */}
                {draftAfter === task.id && (
                  <li
                    className="task-row task-row--draft tinted"
                    style={tint(task.projectId ? projectsById.get(task.projectId)?.color : undefined)}
                  >
                    <div className="task-row__main">
                      {/* El anillo de la casilla, inerte: la tarea no existe, así que no hay
                          nada que completar. Sin él la fila arranca desalineada con las de
                          arriba y se lee como si faltara algo. */}
                      <span className="task-row__ghost" aria-hidden />
                      <div className="task-row__text">
                        <TitleEditor
                          placeholder="Nueva tarea"
                          onSave={(text, andAnother) => void saveDraft(task.id, text, andAnother)}
                          onCancel={() => {
                            setDraftAfter(null);
                            setRestore(task.id);
                          }}
                        />
                      </div>
                    </div>
                  </li>
                )}
              </Fragment>
            ))}
          </ul>
        </>
      )}

      {open && menu && (
        <RowMenu
          task={open}
          anchor={menu.anchor}
          onOpen={() => {
            setMenu(null);
            onOpen(open.id);
          }}
          onPriority={(priority: Priority) => {
            setMenu(null);
            patch(open.id, { priority });
          }}
          onDelete={() => {
            setMenu(null);
            remove(open.id);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
