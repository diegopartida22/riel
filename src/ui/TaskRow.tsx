import { Ellipsis, GripVertical } from "lucide-react";

import type { Project, Task } from "../data";
import { tint } from "../design/palette";
import { Checkbox } from "./Checkbox";
import { DueChip } from "./DueChip";
import { PriorityMark } from "./PriorityMark";
import { ProjectDot } from "./ProjectDot";

export interface TaskRowProps {
  task: Task;
  /** El proyecto de la tarea, si tiene. De aquí sale el color de la casilla y del punto. */
  project?: Project | null;
  /** Falso dentro de la vista de un proyecto, donde el punto sería redundante. */
  showProjectDot?: boolean;
  subtasks?: Task[];
  /** Día local, para decidir si la fecha está vencida. Se pasa desde arriba para que todas
   *  las filas de una lista coincidan aunque el render cruce la medianoche. */
  today?: string;
  /** Ids en sus 200ms de colapso (spec 3.6). Vale para la fila y para sus subtareas. */
  leaving?: ReadonlySet<string>;
  /** Px que la fila lleva desplazados por un arrastre en curso. */
  offset?: number;
  /** Verdadero para la fila que va en vuelo: se levanta sobre las demás y no transiciona. */
  flying?: boolean;
  /** Sin esto la manija no se dibuja: no hay orden que tocar en Completadas. */
  onGrab?: (event: React.PointerEvent<HTMLElement>) => void;
  onToggle?: (task: Task, checked: boolean) => void;
  onOpen?: () => void;
  /** Recibe el rectángulo del `⋯` para anclar el menú. */
  onMenu?: (anchor: DOMRect) => void;
  ref?: React.Ref<HTMLLIElement>;
}

/**
 * La fila de tarea de la sección 3.5:
 *
 * ```
 * ○  Revisar el PR de autenticación        ●  mié 12
 * ```
 *
 * En reposo es solo texto. Las dos herramientas de la derecha — el `⋯` y la manija de
 * arrastre — aparecen al hover, pero su hueco está reservado siempre: si apareciera de la
 * nada, la fecha daría un salto cada vez que el puntero cruza una fila.
 *
 * El título va a una sola línea con corte por elipsis. Es la condición para que el tachado
 * pueda trazarse de izquierda a derecha; el texto completo se ve al editar en línea.
 */
export function TaskRow({
  task,
  project,
  showProjectDot = true,
  subtasks = [],
  today,
  leaving,
  offset = 0,
  flying = false,
  onGrab,
  onToggle,
  onOpen,
  onMenu,
  ref,
}: TaskRowProps) {
  const completed = task.completedAt !== null;

  return (
    <li
      ref={ref}
      className={[
        "task-row collapse tinted",
        completed && "is-completed",
        leaving?.has(task.id) && "is-leaving",
        flying && "is-flying",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        ...tint(project?.color),
        ...(offset ? { transform: `translateY(${offset}px)` } : null),
      }}
    >
      <div className="task-row__clip">
        {/* El texto abre el detalle; la casilla y las herramientas no, porque cada una hace ya
            lo suyo. Un `div` con `onClick` y no un `button`: dentro va el título con su
            elipsis y su tachado, y un botón le impondría sus propias métricas al texto. */}
        <div className="task-row__main">
          <Checkbox
            checked={completed}
            label={task.title}
            onChange={(checked) => onToggle?.(task, checked)}
          />

          <div
            className="task-row__text"
            role={onOpen ? "button" : undefined}
            tabIndex={onOpen ? 0 : undefined}
            onClick={onOpen}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              onOpen?.();
            }}
          >
            <span className="task-row__title">{task.title}</span>
            {task.notes && <span className="task-row__notes">{task.notes}</span>}
          </div>

          <div className="task-row__meta">
            {showProjectDot && project && <ProjectDot color={project.color} title={project.name} />}
            <PriorityMark priority={task.priority} />
            {task.dueAt && <DueChip dueAt={task.dueAt} hasTime={task.hasTime} today={today} />}
          </div>

          {/* Cada herramienta se dibuja solo si tiene a quién avisar. Un `⋯` sin menú detrás o
              una manija donde no se puede reordenar son promesas que la fila no cumple. */}
          {(onMenu || onGrab) && (
            <div className="task-row__tools">
              {onMenu && (
                <button
                  type="button"
                  className="task-row__tool"
                  aria-label={`Opciones de ${task.title}`}
                  aria-haspopup="menu"
                  data-menu-trigger
                  onClick={(event) => onMenu(event.currentTarget.getBoundingClientRect())}
                >
                  <Ellipsis size={14} strokeWidth={2} aria-hidden />
                </button>
              )}
              {onGrab && (
                <span
                  className="task-row__tool task-row__grip"
                  aria-hidden="true"
                  onPointerDown={onGrab}
                >
                  <GripVertical size={14} strokeWidth={2} />
                </span>
              )}
            </div>
          )}
        </div>

        {subtasks.length > 0 && (
          <ul className="subtasks">
            {subtasks.map((subtask) => (
              <SubtaskRow
                key={subtask.id}
                task={subtask}
                leaving={leaving?.has(subtask.id)}
                onToggle={onToggle}
              />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * La subtarea: sangrada 22px, título a 12px y sin punto de proyecto ni fecha propia. Hereda
 * el `--project` de su padre, así que su casilla se llena del mismo color.
 *
 * Completar una subtarea la saca de la lista igual que a una raíz — es una tarea como
 * cualquier otra — así que también necesita su envoltura que colapsa.
 */
function SubtaskRow({
  task,
  leaving = false,
  onToggle,
}: {
  task: Task;
  leaving?: boolean;
  onToggle?: (task: Task, checked: boolean) => void;
}) {
  const completed = task.completedAt !== null;

  return (
    <li className={`subtask-row collapse${leaving ? " is-leaving" : ""}`}>
      <div className={`subtask${completed ? " is-completed" : ""}`}>
        <Checkbox
          checked={completed}
          label={task.title}
          onChange={(checked) => onToggle?.(task, checked)}
        />
        <span className="task-row__title">{task.title}</span>
      </div>
    </li>
  );
}
