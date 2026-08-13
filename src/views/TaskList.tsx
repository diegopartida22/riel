import { useState } from "react";

import type { Between, Priority, Project, Task, TaskPatch, TaskTree } from "../data";
import { emptyMessage, titleOf, type View } from "../state/views";
import { EmptyState } from "../ui/EmptyState";
import { GroupHeader } from "../ui/GroupHeader";
import { RowMenu } from "../ui/RowMenu";
import { TaskRow } from "../ui/TaskRow";
import { useReorder } from "../ui/useReorder";

export interface TaskListProps {
  view: View;
  tasks: TaskTree[];
  projectsById: Map<string, Project>;
  today: string;
  loading: boolean;
  error: string | null;
  leaving: ReadonlySet<string>;
  toggle: (task: Task, checked: boolean) => void;
  patch: (id: string, patch: TaskPatch) => void;
  remove: (id: string) => void;
  reorder: (id: string, between: Between) => void;
  onOpen: (id: string) => void;
  /** Lleva el foco al campo de captura desde el botón del estado vacío. */
  onCapture: () => void;
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
  toggle,
  patch,
  remove,
  reorder,
  onOpen,
  onCapture,
}: TaskListProps) {
  const project = view.kind === "proyecto" ? projectsById.get(view.id) : undefined;
  const title = titleOf(view, project?.name);
  const sortable = view.kind !== "completadas";

  const [menu, setMenu] = useState<OpenMenu>(null);
  const drag = useReorder(
    tasks.map((task) => task.id),
    reorder,
  );

  // Sin este hueco la lista parpadea con el estado vacío cada vez que se cambia de vista.
  if (loading) return <div className="view" />;

  const open = menu && tasks.find((task) => task.id === menu.id);

  return (
    <div className="view">
      {error && <p className="notice notice--error">{error}</p>}

      {tasks.length === 0 ? (
        <EmptyState
          message={emptyMessage(view)}
          action={view.kind === "hoy" ? "Agregar tarea" : undefined}
          onAction={onCapture}
        />
      ) : (
        <>
          <GroupHeader>{title}</GroupHeader>
          <ul className={`task-list${drag.dragging ? " is-sorting" : ""}`}>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
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
                onToggle={toggle}
                onOpen={() => onOpen(task.id)}
                onMenu={(anchor) =>
                  setMenu((current) =>
                    current?.id === task.id ? null : { id: task.id, anchor },
                  )
                }
              />
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
