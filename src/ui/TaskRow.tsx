
import { shortRepeat, type Project, type Task } from "../data";
import { tint } from "../design/palette";
import { Checkbox } from "./Checkbox";
import { DueChip } from "./DueChip";
import { Ellipsis, GripVertical, Repeat } from "./icons";
import { PriorityMark } from "./PriorityMark";
import { ProjectDot } from "./ProjectDot";
import { TitleEditor } from "./TitleEditor";
import type { Reorder } from "./useReorder";

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
  /**
   * El arrastre de las subtareas. Lo lleva la fila y no la lista porque las subtareas se
   * pintan aquí dentro: la lista solo conoce las raíces. Ordena entre hermanas, nunca entre
   * madres — sacar una subtarea de su grupo sería cambiarla de padre, que es otro gesto.
   */
  sortSubtasks?: Reorder;
  onToggle?: (task: Task, checked: boolean) => void;
  onOpen?: () => void;
  /** Recibe el rectángulo del `⋯` para anclar el menú. */
  onMenu?: (anchor: DOMRect) => void;
  /** El id que lleva el `tabIndex` de 0 de toda la lista (tabulación itinerante). */
  focused?: string | null;
  /** El id que se está editando en línea. Puede ser esta tarea o una de sus subtareas. */
  editing?: string | null;
  /** El tercer argumento es cierto si se pidió además otra debajo (⌘⏎). */
  onEditSave?: (id: string, title: string, andAnother: boolean) => void;
  onEditCancel?: () => void;
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
 * arrastre — aparecen al hover, y lo hacen en el sitio de la fecha: comparten hueco con ella
 * en vez de llevar uno propio que estaría vacío casi todo el tiempo comiéndose el título.
 *
 * Si el título va a una línea con elipsis o entero en varias lo decide un ajuste, y de ahí
 * para abajo lo lleva el CSS: cambia el tachado, que no puede ser la misma raya, y el aire de
 * la fila, que con dos renglones tiene que separar más de lo que junta.
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
  sortSubtasks,
  onToggle,
  onOpen,
  onMenu,
  focused,
  editing,
  onEditSave,
  onEditCancel,
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

          {/* El foco vive aquí y no en el `li`: es lo que se ve como «la tarea» y lo que el
              anillo tiene que rodear. Sin `role="button"`, que sería mentira desde que la
              tecla ⏎ edita en vez de abrir — un botón activa, y aquí ⏎, Espacio y ↑↓ hacen
              tres cosas distintas. El teclado lo lleva `useRowKeys` desde el contenedor. */}
          <div
            className="task-row__text"
            data-task-id={task.id}
            tabIndex={focused === task.id ? 0 : -1}
            onClick={editing === task.id ? undefined : onOpen}
          >
            {editing === task.id ? (
              <TitleEditor
                value={task.title}
                onSave={(title, andAnother) => onEditSave?.(task.id, title, andAnother)}
                onCancel={() => onEditCancel?.()}
              />
            ) : (
              <span className="task-row__title">{task.title}</span>
            )}
            {task.notes && <span className="task-row__notes">{task.notes}</span>}
          </div>

          {/* La fecha y las herramientas comparten celda en vez de ir una detrás de otra. Puestas
              en fila, el hueco de la derecha medía la suma de las dos y las herramientas se
              llevaban 40px del título aunque solo se vean al pasar por encima — con el riel
              expandido eso es casi un tercio de la columna. Apiladas, el hueco mide lo que el más
              ancho de los dos, y como el ancho no depende de cuál se esté viendo, al cruzarse no
              se mueve nada. */}
          <div className="task-row__right">
            <div className="task-row__meta">
              {showProjectDot && project && (
                <ProjectDot color={project.color} title={project.name} />
              )}
              {/* Una tarea que vuelve no se distingue de una que no en ningún otro sitio, y la
                  diferencia importa antes de completarla: es lo que separa «esto se acabó» de
                  «esto vuelve el mes que viene». Del tamaño y el color del `!` de prioridad
                  media — es un dato de la fila, no una alarma. */}
              {task.repeat && (
                <span
                  className="task-row__repeat"
                  role="img"
                  aria-label={`Se repite: ${shortRepeat(task.repeat).toLowerCase()}`}
                  title={shortRepeat(task.repeat)}
                >
                  <Repeat size={11} aria-hidden />
                </span>
              )}
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
                    <Ellipsis size={14} aria-hidden />
                  </button>
                )}
                {onGrab && (
                  <span
                    className="task-row__tool task-row__grip"
                    aria-hidden="true"
                    onPointerDown={onGrab}
                  >
                    <GripVertical size={14} />
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {subtasks.length > 0 && (
          <ul
            className={`subtasks${
              sortSubtasks && subtasks.some((one) => one.id === sortSubtasks.dragging)
                ? " is-sorting"
                : ""
            }`}
          >
            {subtasks.map((subtask) => (
              <SubtaskRow
                key={subtask.id}
                ref={sortSubtasks?.register(subtask.id)}
                task={subtask}
                leaving={leaving?.has(subtask.id)}
                offset={sortSubtasks?.offsetOf(subtask.id) ?? 0}
                flying={sortSubtasks?.dragging === subtask.id}
                /* Con una sola subtarea no hay nada que ordenar, y una manija que no mueve
                   nada es de las afordancias muertas que la fila no puede permitirse. */
                onGrab={
                  sortSubtasks && subtasks.length > 1
                    ? (event) => sortSubtasks.grab(event, subtask.id)
                    : undefined
                }
                onToggle={onToggle}
                focused={focused}
                editing={editing}
                onEditSave={onEditSave}
                onEditCancel={onEditCancel}
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
  ref,
  task,
  leaving = false,
  offset = 0,
  flying = false,
  onGrab,
  onToggle,
  focused,
  editing,
  onEditSave,
  onEditCancel,
}: {
  ref?: React.Ref<HTMLLIElement>;
  task: Task;
  leaving?: boolean;
  offset?: number;
  flying?: boolean;
  onGrab?: (event: React.PointerEvent<HTMLElement>) => void;
  onToggle?: (task: Task, checked: boolean) => void;
  focused?: string | null;
  editing?: string | null;
  onEditSave?: (id: string, title: string, andAnother: boolean) => void;
  onEditCancel?: () => void;
}) {
  const completed = task.completedAt !== null;

  return (
    <li
      ref={ref}
      className={[
        "subtask-row collapse",
        leaving && "is-leaving",
        flying && "is-flying",
      ]
        .filter(Boolean)
        .join(" ")}
      style={offset ? { transform: `translateY(${offset}px)` } : undefined}
    >
      <div className={`subtask${completed ? " is-completed" : ""}`}>
        <Checkbox
          checked={completed}
          label={task.title}
          onChange={(checked) => onToggle?.(task, checked)}
        />
        {/* Una subtarea es una tarea: entra en el recorrido de ↑↓ y se edita con ⏎ igual que
            su madre. Lo único que ⌘⏎ no hace aquí es abrir otra debajo — las hermanas se
            crean desde el detalle, y una raíz nueva colada entre dos subtareas rompería la
            lectura de la sangría. */}
        <div className="task-row__text" data-task-id={task.id} tabIndex={focused === task.id ? 0 : -1}>
          {editing === task.id ? (
            <TitleEditor
              value={task.title}
              onSave={(title) => onEditSave?.(task.id, title, false)}
              onCancel={() => onEditCancel?.()}
            />
          ) : (
            <span className="task-row__title">{task.title}</span>
          )}
        </div>

        {/* Solo la manija. De las tres cosas del `⋯` de una raíz —abrir el detalle, cambiar la
            prioridad, borrar— una subtarea no tiene detalle propio ni dibuja prioridad, así
            que quedaría un menú de un solo elemento, que no es un menú. Borrarla se hace
            donde se crea: en el detalle de su madre. */}
        {onGrab && (
          <div className="task-row__tools task-row__tools--one">
            <span className="task-row__tool task-row__grip" aria-hidden="true" onPointerDown={onGrab}>
              <GripVertical size={14} />
            </span>
          </div>
        )}
      </div>
    </li>
  );
}
