import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { dayOf, type Between, type Priority, type Project, type Task, type TaskPatch, type TaskTree } from "../data";
import { tint } from "../design/palette";
import type { CalendarEvent } from "../state/agenda";
import { beyond, horizonEnd, usesHorizon, type Horizonte } from "../state/horizonte";
import { shortPath } from "../state/editors";
import { emptyMessage, titleOf, viewKey, type View } from "../state/views";
import { Agenda } from "../ui/Agenda";
import { formatDueLong } from "../ui/dueDate";
import { EmptyState } from "../ui/EmptyState";
import { FoldHeader, GroupHeader } from "../ui/GroupHeader";
import { SYSTEM_COLORS } from "../ui/listas";
import { ListHeader } from "../ui/ListHeader";
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
  /** Lleva tareas a otro día, o las deja sin fecha. Una sola entrada en la pila de ⌘Z. */
  reschedule: (ids: string[], day: string | null) => void;
  /** Falso mientras se busca: lo que se ve es la consulta, no la vista, y no hay vencidas de Hoy. */
  searching?: boolean;
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
  /** Los eventos del Calendario de hoy, si la agenda está encendida (spec 15). */
  events?: CalendarEvent[];
  /** Hasta dónde llega la lista antes de plegar lo de más adelante (spec 19). */
  horizonte: Horizonte;
  /** La flecha del encabezado: vuelve a la pantalla de listas. */
  onBack: () => void;
  /** «Editar» en el encabezado de un proyecto: nombre, color y carpeta. */
  onEditProject?: (project: Project) => void;
}

/** Qué fila tiene el menú abierto y dónde anclarlo. */
type OpenMenu = { id: string; anchor: DOMRect } | null;

/**
 * La lista de cualquier vista. Lo único que cambia entre Hoy, Próximas, Todas, Completadas y
 * un proyecto es la consulta que la llenó y el encabezado; la fila es la misma en todas.
 *
 * Dentro de un proyecto se oculta el proyecto de cada fila: ahí sería decir en cada renglón lo
 * que ya dice el encabezado en grande (spec 3.5).
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
  reschedule,
  searching = false,
  remove,
  reorder,
  addAfter,
  onOpen,
  onCapture,
  editorName,
  onOpenFolder,
  events,
  horizonte,
  onBack,
  onEditProject,
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

  const entering = useEntradas(
    visible.map((task) => task.id),
    loading,
    viewKey(view),
  );

  /**
   * El horizonte (spec 19): el último día que se queda arriba. `null` en las vistas que no
   * recortan, y entonces `far` sale vacío y aquí abajo no cambia nada.
   */
  const end = usesHorizon(view) ? horizonEnd(horizonte, today) : null;

  const near = useMemo(() => visible.filter((task) => !beyond(task, end)), [visible, end]);
  const far = useMemo(() => visible.filter((task) => beyond(task, end)), [visible, end]);

  /**
   * Plegado de fábrica, y se vuelve a plegar al cambiar de vista: lo que el grupo existe para
   * hacer es que la lista arranque sin lo del mes que viene, y una vista que recuerda que la
   * abriste hace media hora no arranca así.
   */
  const [unfolded, setUnfolded] = useState(false);
  const key = viewKey(view);
  useEffect(() => setUnfolded(false), [key]);

  /**
   * Si no queda nada de este lado del horizonte no hay nada que separar, y la lista se enseña
   * entera: un grupo plegado que se lleva todas las filas deja la vista en blanco diciendo que
   * no hay nada pendiente, que es mentira.
   */
  const folding = near.length > 0 && far.length > 0;

  /** Lo que llega a pintarse, en el orden en que se pinta. */
  const shown = useMemo(
    () => (!folding ? visible : unfolded ? [...near, ...far] : near),
    [folding, unfolded, near, far, visible],
  );

  // Las raíces en un grupo y las subtareas de cada una en el suyo: se ordena entre hermanas.
  const groups = useMemo(
    () => [
      shown.map((task) => task.id),
      ...shown.map((task) => task.subtasks.map((subtask) => subtask.id)),
    ],
    [shown],
  );

  const drag = useReorder(groups, reorder);

  // El orden en que se ven las filas, subtareas incluidas: es el recorrido de ↑↓ y quien
  // decide cuál entra en el Tab. Lo plegado no está pintado, así que tampoco se recorre.
  const order = useMemo(
    () => shown.flatMap((task) => [task.id, ...task.subtasks.map((subtask) => subtask.id)]),
    [shown],
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
  }, [restore, focus, shown]);

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
   * La agenda del día, y solo en Hoy (spec 15). En Próximas serían los eventos de otro día, y
   * en un proyecto no vienen a cuento: lo que este bloque contesta es qué le queda al día que
   * se está repartiendo, y ese día es hoy.
   *
   * Va entre el encabezado de la lista y las tareas, cada bloque con su rótulo: son dos cosas
   * distintas —lo que ya está comprometido y lo que hay que hacer— y meterlas bajo el mismo
   * haría que un solo nombre cubriera dos gramáticas de fila a la vez.
   */
  const agenda = view.kind === "hoy" && events?.length ? <Agenda events={events} /> : null;

  /**
   * Las vencidas de días anteriores, en Hoy. Son las que se quedan en rojo arriba de la lista día
   * tras día, y moverlas de una en una es el trabajo que nadie hace: una lista que amanece con
   * nueve rojas deja de leerse. «Pasar a hoy» las trae todas de un clic, y ⌘Z las devuelve.
   *
   * Solo las de días que ya pasaron. Una de hoy a las 10:00 también está en rojo a las 11, pero
   * pasarla a hoy no le cambiaría nada.
   */
  const stale =
    view.kind === "hoy" && !searching
      ? visible.filter((task) => !task.completedAt && task.dueAt && dayOf(task.dueAt) < today)
      : [];
  /**
   * El encabezado de la lista (spec 3.4). Se pinta también mientras se lee, con el nombre y sin
   * la cifra: es lo que dice a dónde se acaba de entrar, y que llegara tarde haría saltar la
   * pantalla entera al terminar de leer en vez de solo la lista.
   *
   * La cifra son las raíces pendientes, plegadas incluidas: es lo que tiene la lista, no lo que
   * cabe en este mes (spec 19). En Completadas no hay cifra, porque ahí nada está pendiente y el
   * total de lo hecho en treinta días no contesta ninguna pregunta.
   *
   * Debajo, lo que es de la lista y no de una tarea. En Hoy, el día escrito entero, que es lo
   * que la lista está contestando. En un proyecto, su carpeta (spec 13) y las acciones: abrirla
   * en el editor —nombrado por el editor y no por la carpeta, porque lo que hay que saber antes
   * de pulsar es en qué se va a abrir— y editar el proyecto, que antes era un clic
   * derecho en un disco que nadie encontraba.
   */
  const pending = visible.filter((task) => !task.completedAt).length;
  const color = project ? project.color : view.kind === "proyecto" ? null : SYSTEM_COLORS[view.kind];
  const folder = project?.folder ?? null;

  const subtitle =
    view.kind === "hoy" ? (
      capitalize(formatDueLong(today, false, today))
    ) : folder ? (
      <span title={folder}>{shortPath(folder, 30)}</span>
    ) : undefined;

  const actions = (
    <>
      {stale.length > 0 && (
        <button
          type="button"
          className="list-header__action"
          title={`Mover ${stale.length === 1 ? "la vencida" : `las ${stale.length} vencidas`} a hoy`}
          onClick={() => reschedule(stale.map((task) => task.id), today)}
        >
          Pasar a hoy
        </button>
      )}
      {project && folder && editorName && onOpenFolder && (
        <button
          type="button"
          className="list-header__action"
          aria-label={`Abrir «${project.name}» en ${editorName}`}
          onClick={() => onOpenFolder(folder)}
        >
          Abrir en {editorName}
        </button>
      )}
      {project && onEditProject && (
        <button
          type="button"
          className="list-header__action"
          aria-label={`Editar el proyecto «${project.name}»`}
          onClick={() => onEditProject(project)}
        >
          Editar
        </button>
      )}
    </>
  );
  const hasActions = stale.length > 0 || (project && ((folder && editorName && onOpenFolder) || onEditProject));

  const header = (
    <ListHeader
      title={title}
      color={color}
      count={loading || view.kind === "completadas" ? undefined : pending}
      subtitle={subtitle}
      actions={hasActions ? actions : undefined}
      onBack={onBack}
    />
  );

  // Sin este hueco la lista parpadea con el estado vacío cada vez que se cambia de vista.
  if (loading) return <div className="view">{header}</div>;

  const open = menu && visible.find((task) => task.id === menu.id);

  /**
   * La carpeta del proyecto de la tarea que tiene el menú abierto (spec 13). En una vista mixta
   * cada fila puede ser de un proyecto distinto, así que se resuelve por la tarea y no por la
   * vista — que es justo lo que hace que valga desde Hoy.
   */
  const openFolderOf = open?.projectId ? projectsById.get(open.projectId)?.folder : null;

  /**
   * Una fila y, si le toca, el campo de la tarea que todavía no existe colgando debajo.
   * Sale del `map` porque la lista se pinta en dos tandas cuando hay horizonte —lo de aquí,
   * el encabezado que pliega, y lo de más adelante— y las dos tandas dibujan lo mismo.
   */
  const renderRow = (task: TaskTree) => (
    <Fragment key={task.id}>
      <TaskRow
        ref={drag.register(task.id)}
        task={task}
        project={task.projectId ? projectsById.get(task.projectId) : null}
        showProjectDot={view.kind !== "proyecto"}
        subtasks={task.subtasks}
        today={today}
        leaving={leaving}
        entering={entering.has(task.id)}
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
        menuOpen={menu?.id === task.id}
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
  );

  return (
    <div className="view" ref={keys.ref} onKeyDown={keys.onKeyDown} onFocusCapture={keys.onFocusCapture}>
      {header}
      {error && <p className="notice notice--error">{error}</p>}

      {/* Con la agenda delante, las tareas llevan su propio rótulo: sin él, la primera tarea
          colgaría de «Agenda» y «Nada para hoy» se leería como que no hay más eventos. Sin
          agenda sobra — el encabezado de la lista ya dice de qué es lo que hay debajo. */}
      {agenda}
      {agenda && <GroupHeader>Tareas</GroupHeader>}

      {visible.length === 0 ? (
        <EmptyState
          message={emptyMessage(view)}
          action={view.kind === "hoy" ? "Agregar tarea" : undefined}
          onAction={onCapture}
        />
      ) : (
        <ul className={`task-list${drag.dragging ? " is-sorting" : ""}`}>
          {(folding ? near : visible).map(renderRow)}

          {/* El corte del horizonte (spec 19). Va dentro de la misma lista y no entre dos
              `ul`: lo de más adelante se sigue pudiendo arrastrar contra lo de aquí, y dos
              listas separadas por un encabezado harían que cruzar el corte fuera imposible. */}
          {folding && (
            <FoldHeader
              label="Más adelante"
              count={far.length}
              open={unfolded}
              onToggle={() => setUnfolded((current) => !current)}
            />
          )}

          {folding && unfolded && far.map(renderRow)}
        </ul>
      )}

      {open && menu && (
        <RowMenu
          task={open}
          anchor={menu.anchor}
          onOpen={() => {
            setMenu(null);
            onOpen(open.id);
          }}
          editorName={openFolderOf && onOpenFolder ? editorName : null}
          onOpenFolder={
            openFolderOf && onOpenFolder
              ? () => {
                  setMenu(null);
                  onOpenFolder(openFolderOf);
                }
              : undefined
          }
          onPriority={(priority: Priority) => {
            setMenu(null);
            patch(open.id, { priority });
          }}
          today={today}
          onReschedule={(day) => {
            setMenu(null);
            reschedule([open.id], day);
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

/**
 * Las filas que acaban de aparecer en una lista que ya estaba pintada: la que se escribe en el
 * pie, la que vuelve con ⌘Z, la vuelta siguiente de una recurrente. Entran con un fundido en vez
 * de estar de golpe, que es lo que hace una tabla del sistema al insertar un renglón.
 *
 * Solo lo que llega **después** de la primera lectura de la vista: al abrirla la lista entera
 * es nueva, y que entrara fila a fila sería una animación de carga, no de inserción. Por eso se
 * olvida todo mientras se lee y se vuelve a sembrar con lo que haya al terminar.
 *
 * En `useLayoutEffect` para que la clase esté puesta antes del primer fotograma de la fila: con
 * un efecto normal se vería entera un instante y luego desaparecería para entrar.
 */
function useEntradas(ids: string[], loading: boolean, clave: string): ReadonlySet<string> {
  const vistas = useRef<{ clave: string; ids: Set<string> } | null>(null);
  const [nuevas, setNuevas] = useState<ReadonlySet<string>>(() => new Set());
  const firma = ids.join("|");

  useLayoutEffect(() => {
    if (loading) {
      vistas.current = null;
      return;
    }
    const antes = vistas.current;
    const actuales = firma ? firma.split("|") : [];
    if (!antes || antes.clave !== clave) {
      vistas.current = { clave, ids: new Set(actuales) };
      return;
    }
    const llegadas = actuales.filter((id) => !antes.ids.has(id));
    for (const id of actuales) antes.ids.add(id);
    if (llegadas.length) setNuevas(new Set(llegadas));
  }, [firma, loading, clave]);

  // La clase se quita en cuanto termina el fundido: si se quedara puesta, una fila que sale y
  // vuelve a entrar con el mismo id no lo repetiría.
  useEffect(() => {
    if (!nuevas.size) return;
    const timer = window.setTimeout(() => setNuevas(new Set()), 240);
    return () => window.clearTimeout(timer);
  }, [nuevas]);

  return nuevas;
}

/** «lunes 26 de octubre» → «Lunes 26 de octubre»: es el renglón entero, y empieza en mayúscula. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
