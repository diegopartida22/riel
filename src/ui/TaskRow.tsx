import { shortRepeat, type Project, type Task } from "../data";
import { tint } from "../design/palette";
import { Checkbox } from "./Checkbox";
import { DueChip } from "./DueChip";
import { Ellipsis, Repeat } from "./icons";
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
  /** Si la fila acaba de aparecer en una lista que ya estaba pintada: entra con un fundido. */
  entering?: boolean;
  /** Px que la fila lleva desplazados por un arrastre en curso. */
  offset?: number;
  /** Verdadero para la fila que va en vuelo: se levanta sobre las demás y no transiciona. */
  flying?: boolean;
  /** Se engancha al texto, que es la manija. Sin esto no se arrastra: en Completadas no hay orden. */
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
  /** Si el menú de esta fila está abierto: el `⋯` se queda a la vista mientras tanto. */
  menuOpen?: boolean;
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
 * ○  !! Revisar el PR de autenticación, que lleva          ⋯
 *       dos días esperando
 *       dejar comentarios en el middleware
 *       mié 12  ↻  ● Infra
 * ```
 *
 * El título se enseña entero, con la prioridad delante como la escribe la captura, y debajo
 * las notas y un renglón con los datos: la fecha, si vuelve y de qué proyecto es. Antes los
 * datos iban a la derecha del título y le disputaban el ancho, y lo que perdía era el título:
 * una tarea cortada a media frase obliga a abrirla para saber cuál era.
 *
 * En reposo es solo texto. El `⋯` aparece al pasar por encima, y no hay manija: se arrastra
 * desde el texto mismo (`useReorder` distingue el arrastre del clic por los 3px que separan uno
 * de otro), así que la fila no paga ancho por una afordancia que casi nunca se usa.
 */
export function TaskRow({
  task,
  project,
  showProjectDot = true,
  subtasks = [],
  today,
  leaving,
  entering = false,
  offset = 0,
  flying = false,
  onGrab,
  sortSubtasks,
  onToggle,
  onOpen,
  onMenu,
  menuOpen = false,
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
        entering && "is-entering",
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
        {/* El texto abre el detalle; la casilla y el `⋯` no, porque cada uno hace ya lo suyo.
            Un `div` con `onClick` y no un `button`: dentro van el título con su tachado, las
            notas y los datos, y un botón le impondría sus propias métricas al texto. */}
        <div className="task-row__main">
          <Checkbox
            checked={completed}
            label={task.title}
            onChange={(checked) => onToggle?.(task, checked)}
          />

          {/* El foco vive aquí y no en el `li`: es lo que se ve como «la tarea» y lo que el
              anillo tiene que rodear. Sin `role="button"`, que sería mentira desde que la
              tecla ⏎ edita en vez de abrir — un botón activa, y aquí ⏎, Espacio y ↑↓ hacen
              tres cosas distintas. El teclado lo lleva `useRowKeys` desde el contenedor.

              Es también la manija del arrastre, salvo mientras se edita: ahí el puntero es
              para poner el cursor en el texto. */}
          <div
            className="task-row__text"
            data-task-id={task.id}
            tabIndex={focused === task.id ? 0 : -1}
            onClick={editing === task.id ? undefined : onOpen}
            onPointerDown={editing === task.id ? undefined : onGrab}
          >
            {editing === task.id ? (
              <TitleEditor
                value={task.title}
                onSave={(title, andAnother) => onEditSave?.(task.id, title, andAnother)}
                onCancel={() => onEditCancel?.()}
              />
            ) : (
              <span className="task-row__title">
                <PriorityMark priority={task.priority} />
                {task.title}
              </span>
            )}
            {task.notes && <span className="task-row__notes">{task.notes}</span>}

            {(task.dueAt || task.repeat || (showProjectDot && project)) && (
              <span className="task-row__meta">
                {task.dueAt && <DueChip dueAt={task.dueAt} hasTime={task.hasTime} today={today} />}
                {/* Una tarea que vuelve no se distingue de una que no en ningún otro sitio, y la
                    diferencia importa antes de completarla: es lo que separa «esto se acabó» de
                    «esto vuelve el mes que viene». */}
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
                {/* El proyecto con su nombre y no solo su punto: en una vista mixta un disco de
                    6px dice que hay un proyecto pero no cuál. Dentro de uno sobra (spec 3.5). */}
                {showProjectDot && project && (
                  <span className="task-row__project">
                    <ProjectDot color={project.color} />
                    {project.name}
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Se dibuja solo si tiene a quién avisar: un `⋯` sin menú detrás es una promesa que
              la fila no cumple. */}
          {onMenu && (
            <button
              type="button"
              className="task-row__tool"
              aria-label={`Opciones de ${task.title}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-menu-trigger
              onClick={(event) => onMenu(event.currentTarget.getBoundingClientRect())}
            >
              <Ellipsis size={14} aria-hidden />
            </button>
          )}
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
                /* Con una sola subtarea no hay nada que ordenar. */
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
 * La subtarea: sangrada bajo el título de su madre, a 12px y sin punto de proyecto ni fecha.
 * Hereda el `--project` de su padre, así que su casilla se llena del mismo color.
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
            lectura de la sangría.

            Sin `⋯`: de las cosas del menú de una raíz, una subtarea no tiene detalle propio ni
            dibuja prioridad, y un menú de un solo elemento no es un menú. Se arrastra desde el
            texto, como su madre, y se borra donde se crea: en el detalle de su madre. */}
        <div
          className="task-row__text"
          data-task-id={task.id}
          tabIndex={focused === task.id ? 0 : -1}
          onPointerDown={editing === task.id ? undefined : onGrab}
        >
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
      </div>
    </li>
  );
}
