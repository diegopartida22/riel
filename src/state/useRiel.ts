import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_RETENTION,
  allTasks,
  completeTask,
  countTasks,
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  getRetention,
  hasOverdue,
  listProjects,
  localDay,
  localIso,
  moveProject,
  moveTask,
  pendingCountByProject,
  renameProject,
  restoreProject,
  restoreTasks,
  setProjectColor,
  setRetention as storeRetention,
  sweepCompleted,
  uncompleteTasks,
  updateTask,
  withSubtasks,
  type Between,
  type NewTask,
  type Project,
  type RemovedProject,
  type Retention,
  type Task,
  type TaskPatch,
  type TaskTree,
} from "../data";
import {
  DONE_EVENT,
  ensurePermission,
  start as startNotifications,
  takeCompleted,
} from "./notifications";
import { rank } from "./search";
import {
  SYSTEM_VIEWS,
  belongs,
  draftFor,
  exiles,
  loadView,
  sameView,
  viewKey,
  type SystemKind,
  type View,
} from "./views";

/**
 * Mientras esto esté en alto, perder el foco no cierra el panel (spec 4). Lo necesita el
 * diálogo de permiso de notificaciones, que es una ventana del sistema y se lleva el foco.
 */
const keepOpen = (value: boolean) => invoke<void>("set_keep_open", { value });

/** Los tres segundos de gracia y los 200ms de colapso de la sección 3.6. */
const UNDO_MS = 3000;
const COLLAPSE_MS = 200;

/** El estado de expansión del riel persiste (spec 3.4). No es un dato: no va a SQLite. */
const RAIL_KEY = "riel:rail-expandido";

/** Con qué vista se abre el panel. Tampoco es un dato: es una preferencia de esta máquina. */
const START_KEY = "riel:vista-al-abrir";

/**
 * La vista con la que arranca el panel, o Hoy si no hay nada elegido.
 *
 * Solo las cuatro del sistema. Un proyecto fijado tendría que decidir qué hacer cuando ese
 * proyecto se borra, y la respuesta —caer a otra vista— sería un ajuste que cambia solo.
 */
function startView(): SystemKind {
  const saved = localStorage.getItem(START_KEY);
  return SYSTEM_VIEWS.some((each) => each.kind === saved) ? (saved as SystemKind) : "hoy";
}

/** Lo que se espera tras la última tecla antes de consultar. Una pulsación lee la base entera. */
const TYPING_MS = 120;

/**
 * Cuántos borrados recuerda ⌘Z. Acotado a propósito: lo que se deshace es «lo último», y una
 * pila sin fondo acabaría reponiendo algo que se tiró hace media hora y ya se había olvidado.
 */
const UNDO_DEPTH = 20;

/**
 * Un borrado que se puede reponer. Completar no entra: tiene sus propios tres segundos con la
 * casilla, que es un deshacer más directo que un atajo (spec 3.6).
 */
type Undoable =
  | { kind: "tareas"; tasks: Task[] }
  | { kind: "proyecto"; removed: RemovedProject };

export interface RielState {
  view: View;
  select: (view: View) => void;

  projects: Project[];
  projectsById: Map<string, Project>;
  /** Pendientes por proyecto, para el tooltip del riel colapsado. */
  counts: Map<string | null, number>;

  tasks: TaskTree[];
  /** El día local con el que se compararon las fechas de esta lista. */
  today: string;
  loading: boolean;
  /** Base vacía: el campo de captura cambia de texto y se queda con el foco (spec 3.7). */
  firstRun: boolean;
  error: string | null;
  /** Ids en sus 200ms de colapso. Siguen en el DOM: si no, no habría nada que animar. */
  leaving: ReadonlySet<string>;
  /**
   * Ids completados que todavía están en su ventana de deshacer, colapso incluido.
   *
   * Es lo que separa una subtarea que se acaba de marcar —y que sigue en la lista, tachada y
   * a un clic de volver— de una que ya estaba completada al abrir la vista, que no tiene por
   * qué ocupar un renglón de trabajo pendiente.
   */
  undoing: ReadonlySet<string>;

  /** Lo que el parser de captura sacó del texto pisa lo que la vista pondría por omisión. */
  add: (draft: NewTask) => Promise<boolean>;
  /** Crea una tarea justo debajo de otra y devuelve su id. Es lo que hace ⌘⏎ (spec 5). */
  addAfter: (title: string, afterId: string) => Promise<string | null>;
  /** Cuelga una subtarea de una tarea. Solo desde el detalle: es donde se ven las hermanas. */
  addSubtask: (parentId: string, title: string) => Promise<boolean>;
  toggle: (task: Task, checked: boolean) => Promise<void>;
  /** Edita campos sueltos de una tarea, desde el detalle o desde el menú de la fila. */
  patch: (id: string, patch: TaskPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reorder: (id: string, between: Between) => Promise<void>;
  /** ⌘Z: repone el último borrado. Sin nada que reponer no hace nada (spec 5). */
  undo: () => Promise<void>;

  /** La tarea cuyo detalle se está mirando, o nula si se ve la lista. */
  detail: TaskTree | null;
  openDetail: (id: string) => void;
  closeDetail: () => void;

  /**
   * Lo escrito en la barra de búsqueda. Con algo escrito, `tasks` deja de ser la vista en
   * curso y pasa a ser el resultado: la búsqueda no es otra lista, es otra consulta para la
   * misma lista, y así completar, editar y deshacer siguen funcionando sin nada aparte.
   */
  query: string;
  setQuery: (query: string) => void;
  /** Cierto en cuanto la consulta ya se aplicó — no mientras se teclea el primer carácter. */
  searching: boolean;
  /** La consulta que produjo lo que se ve. Es la que va en «Sin resultados para «…»». */
  term: string;

  /** Crea si `project` es nulo, actualiza si no. Falso si la escritura falló. */
  saveProject: (project: Project | null, name: string, color: string) => Promise<boolean>;
  removeProject: (id: string) => Promise<void>;
  /** Mueve un proyecto en el riel, entre los dos que se le indiquen. */
  reorderProject: (id: string, between: Between) => Promise<void>;

  /** La vista con la que se abre el panel, y con la que vuelve a abrirse cada vez. */
  startView: SystemKind;
  setStartView: (kind: SystemKind) => void;

  railExpanded: boolean;
  toggleRail: () => void;

  /** Cuánto se conservan las completadas antes del barrido (spec 8). `null` es «siempre». */
  retention: Retention;
  setRetention: (retention: Retention) => void;
}

/**
 * Saca un id de un conjunto de estado. Devuelve el mismo si no estaba: sin eso, apagar dos
 * veces lo que ya estaba apagado repintaría la lista entera por nada.
 */
const without =
  (id: string) =>
  (current: ReadonlySet<string>): ReadonlySet<string> => {
    if (!current.has(id)) return current;
    const next = new Set(current);
    next.delete(id);
    return next;
  };

/**
 * Recoloca un elemento justo detrás de `after`, o a la cabeza si no hay nadie detrás de quien
 * ponerse. Devuelve nulo si el elemento o su vecino no están en la lista, que es la señal de
 * que este no era el grupo de hermanas que había que tocar.
 */
function sortBetween<T extends { id: string }>(list: T[], id: string, after: string | null): T[] | null {
  const moved = list.find((each) => each.id === id);
  if (!moved) return null;

  const rest = list.filter((each) => each.id !== id);
  let at = 0;
  if (after !== null) {
    // `findIndex` devuelve -1 cuando no está, y sumarle uno da 0 — o sea, la cabeza de la
    // lista, que es el sitio equivocado. Hay que mirarlo antes de sumar.
    const previous = rest.findIndex((each) => each.id === after);
    if (previous < 0) return null;
    at = previous + 1;
  }

  rest.splice(at, 0, moved);
  return rest;
}

/**
 * El estado del panel entero: qué vista se mira, qué proyectos hay y qué tareas se ven.
 *
 * La lista **no** se relee después de completar. Una tarea completada tiene que quedarse tres
 * segundos a la vista para poder deshacerla, y la consulta de la vista no la devolvería;
 * releer la borraría de la pantalla al instante. Así que cada operación aplica su propio
 * cambio sobre el estado local, que es además lo que hace que el deshacer se sienta inmediato.
 */
export function useRiel(): RielState {
  const [today] = useState(localDay);
  const [view, setView] = useState<View>(() => ({ kind: startView() }));
  const [start, setStart] = useState<SystemKind>(startView);
  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState<Map<string | null, number>>(new Map());
  const [tasks, setTasks] = useState<TaskTree[]>([]);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [undoing, setUndoing] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [firstRun, setFirstRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [retention, setRetention] = useState<Retention>(DEFAULT_RETENTION);
  /** Se incrementa para forzar una relectura cuando la base cambió por debajo de la vista. */
  const [epoch, setEpoch] = useState(0);
  const [railExpanded, setRailExpanded] = useState(
    () => localStorage.getItem(RAIL_KEY) === "1",
  );

  /**
   * Por cada tarea completada, los temporizadores que la sacarán de la lista y la lista exacta
   * de ids que se completaron con ella — una padre arrastra a sus hijas pendientes, y deshacer
   * no puede descompletar a las que ya estaban tachadas de antes.
   */
  const pending = useRef(new Map<string, { ids: string[]; timers: number[] }>());

  /**
   * La pila de ⌘Z. En una `ref` y no en el estado porque nadie la dibuja: no hay botón de
   * deshacer, solo el atajo, así que apilar no tiene por qué repintar el panel.
   */
  const undoable = useRef<Undoable[]>([]);

  /**
   * Tareas que ya no pertenecen a la vista y cuya fila espera a que se cierre su detalle.
   *
   * El detalle se deriva de la lista, así que sacar la fila lo cierra. Al cambiar el proyecto
   * eso daba igual —es lo último que se toca— pero la fecha se pone en dos tiempos: se elige el
   * día y después la hora. Desterrar en el primero cierra el detalle justo antes del segundo.
   */
  const strayed = useRef(new Set<string>());

  const remember = useCallback((entry: Undoable) => {
    undoable.current.push(entry);
    if (undoable.current.length > UNDO_DEPTH) undoable.current.shift();
  }, []);

  const clearTimers = useCallback(() => {
    for (const entry of pending.current.values()) entry.timers.forEach(clearTimeout);
    pending.current.clear();
  }, []);

  const reloadProjects = useCallback(async () => {
    const [list, totals] = await Promise.all([listProjects(), pendingCountByProject()]);
    setProjects(list);
    setCounts(totals);
  }, []);

  // Proyectos y conteos: una vez, y después cada vez que alguien los mueva.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // El barrido de completadas va antes de la primera lectura (spec 8). Al revés, lo que
        // se vería un instante en Completadas es justo lo que está a punto de desaparecer.
        const kept = await getRetention();
        if (alive) setRetention(kept);
        if (kept !== null) await sweepCompleted(kept);

        const total = await countTasks();
        await reloadProjects();
        if (alive) setFirstRun(total === 0);
      } catch (cause) {
        console.error(cause);
        if (alive) setError("No se pudieron leer los proyectos. Cierra y vuelve a abrir el panel.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadProjects]);

  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  // El plan de notificaciones se rehace al arrancar y cada vez que cambia algo que pueda
  // mover una hora (spec 7). Depender de `tasks` es más ancho de lo necesario —cambia también
  // al navegar— pero `schedule` relee la base y es idempotente: de más solo cuesta una
  // consulta, y de menos costaría un aviso que no llega.
  useEffect(() => startNotifications(projectsById), [projectsById, tasks]);

  // El peso del glifo de la barra (spec 4). Se recalcula contra la base entera y no contra la
  // vista: en Casa puede no haber nada vencido y seguir habiéndolo en Infra.
  useEffect(() => {
    let alive = true;
    hasOverdue(localIso())
      .then((overdue) => {
        if (alive) void invoke("set_overdue", { overdue });
      })
      .catch((cause) => console.error(cause));
    return () => {
      alive = false;
    };
  }, [tasks]);

  // Escribir espera un respiro; borrar no. Limpiar la búsqueda tiene que devolver la vista de
  // golpe — es lo que hace el primer Escape (spec 4), y ahí una demora se siente como un tirón.
  useEffect(() => {
    const clean = query.trim();
    if (!clean) {
      setTerm("");
      return;
    }
    const id = window.setTimeout(() => setTerm(clean), TYPING_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Las tareas se releen al cambiar de vista o de consulta. Los temporizadores pendientes se
  // cancelan: la fila que estaba por irse ya está completada en la base, y lo que se carga
  // ahora no la incluye.
  const key = `${epoch}:${term ? `buscar:${term}` : viewKey(view)}`;
  useEffect(() => {
    let alive = true;
    clearTimers();
    strayed.current.clear();
    setLeaving(new Set());
    setLoading(true);

    (async () => {
      try {
        // Buscando se lee la base entera y se filtra en memoria. `LIKE` no sabe de
        // subsecuencias, y son unos cientos de filas: la consulta que las trae vale menos que
        // el índice que haría falta para no traerlas.
        const roots = term
          ? rank(term, await allTasks(), (task) => [task.title, task.notes])
          : await loadView(view, today);

        // En los resultados cada tarea sale como fila de pleno derecho, subtareas incluidas.
        // Anidarlas duplicaría a la hija que casa por su cuenta bajo una madre que también casa.
        const trees = term ? roots.map((task) => ({ ...task, subtasks: [] })) : await withSubtasks(roots);
        if (!alive) return;
        setTasks(trees);
        setError(null);
      } catch (cause) {
        console.error(cause);
        if (alive) setError("No se pudieron leer las tareas. Cierra y vuelve a abrir el panel.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // `view` y `term` se derivan de `key`; el día se fija al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, today, clearTimers]);

  // Los temporizadores no pueden sobrevivir al panel: al cerrarse, la ventana se oculta pero
  // el webview sigue vivo, y un disparo tardío tocaría un estado que ya nadie mira.
  useEffect(() => clearTimers, [clearTimers]);

  /** Marca o desmarca en el estado local exactamente los ids que cambiaron en la base. */
  const stamp = useCallback((ids: string[], at: string | null) => {
    const wanted = new Set(ids);
    setTasks((current) =>
      current.map((root) => {
        const hit = wanted.has(root.id);
        const touched = root.subtasks.some((subtask) => wanted.has(subtask.id));
        if (!hit && !touched) return root;
        return {
          ...root,
          completedAt: hit ? at : root.completedAt,
          subtasks: root.subtasks.map((subtask) =>
            wanted.has(subtask.id) ? { ...subtask, completedAt: at } : subtask,
          ),
        };
      }),
    );
  }, []);

  const forget = useCallback((id: string) => {
    const entry = pending.current.get(id);
    if (!entry) return null;
    entry.timers.forEach(clearTimeout);
    pending.current.delete(id);
    return entry.ids;
  }, []);

  const unmarkLeaving = useCallback((id: string) => {
    setLeaving(without(id));
  }, []);

  const unmarkUndoing = useCallback((id: string) => {
    setUndoing(without(id));
  }, []);

  /** Saca la fila de la lista: una raíz se lleva a sus hijas, una hija sale sola. */
  const drop = useCallback(
    (id: string) => {
      // Si estaba esperando a que se cerrara su detalle, ya no espera nada: se fue por otra vía
      // —completada, borrada— y dejarla apuntada haría que la próxima ronda buscara un fantasma.
      strayed.current.delete(id);
      unmarkLeaving(id);
      unmarkUndoing(id);
      setTasks((current) =>
        current
          .filter((root) => root.id !== id)
          .map((root) =>
            root.subtasks.some((subtask) => subtask.id === id)
              ? { ...root, subtasks: root.subtasks.filter((subtask) => subtask.id !== id) }
              : root,
          ),
      );
    },
    [unmarkLeaving, unmarkUndoing],
  );

  const refreshCounts = useCallback(async () => {
    try {
      setCounts(await pendingCountByProject());
    } catch (cause) {
      console.error(cause);
    }
  }, []);

  /**
   * El botón «Completar» del banner (spec 7), de vuelta en la base.
   *
   * No pasa por `toggle`: ahí hace falta la fila, y de un aviso solo llega un identificador de
   * una tarea que puede no estar en la vista abierta — o en ninguna, si el panel lleva cerrado
   * toda la mañana. Sin fila tampoco hay nada que animar ni ventana de deshacer que ofrecer,
   * así que se completa de una y la vista se relee. Deshacerlo sigue estando: ⌘Z y la casilla
   * de Completadas, que es lo mismo que hay para cualquier otra tarea vieja.
   *
   * Rust encola la pulsación *y* avisa; aquí solo se vacía la cola. Tener un único consumidor
   * es lo que evita aplicar dos veces la misma pulsación, y la cola es la que cubre el caso en
   * que el aviso sea justo lo que arrancó la app y todavía no hubiera nadie escuchando.
   */
  useEffect(() => {
    const drain = () => {
      void takeCompleted()
        .then(async (ids) => {
          if (!ids.length) return;
          for (const id of ids) await completeTask(id);
          setEpoch((current) => current + 1);
          await refreshCounts();
        })
        .catch((cause) => console.error(cause));
    };

    drain();
    const off = listen(DONE_EVENT, drain);
    return () => void off.then((stop) => stop()).catch((cause) => console.error(cause));
  }, [refreshCounts]);

  const toggle = useCallback(
    async (task: Task, checked: boolean) => {
      setError(null);
      try {
        if (checked) {
          const { ids, at } = await completeTask(task.id);
          if (!ids.length) return;

          stamp(ids, at);
          setUndoing((current) => new Set(current).add(task.id));
          pending.current.set(task.id, {
            ids,
            timers: [
              window.setTimeout(
                () => setLeaving((current) => new Set(current).add(task.id)),
                UNDO_MS,
              ),
              window.setTimeout(() => {
                pending.current.delete(task.id);
                // Una subtarea no se va del árbol al terminar su salida: sale de la lista,
                // que es donde estorba, pero sigue siendo un renglón de una tarea viva y el
                // detalle la enseña tachada. Es la misma razón por la que el barrido del
                // arranque no las borra. Una raíz sí se va: para eso está Completadas.
                if (task.parentId !== null) unmarkLeaving(task.id);
                else drop(task.id);
                unmarkUndoing(task.id);
              }, UNDO_MS + COLLAPSE_MS),
            ],
          });
        } else {
          // Dentro de la ventana de gracia se repone tal cual estaba; fuera de ella —una fila
          // de Completadas, por ejemplo— basta con ella misma.
          const ids = forget(task.id) ?? [task.id];
          await uncompleteTasks(ids);
          stamp(ids, null);
          unmarkLeaving(task.id);
          unmarkUndoing(task.id);
        }
        void refreshCounts();
      } catch (cause) {
        console.error(cause);
        setError("No se pudo guardar el cambio. Vuelve a intentarlo.");
      }
    },
    [drop, forget, refreshCounts, stamp, unmarkLeaving, unmarkUndoing],
  );

  const add = useCallback(
    async (draft: NewTask) => {
      const clean = draft.title.trim();
      if (!clean) return false;

      setError(null);
      try {
        // La vista pone el fondo —Hoy da la fecha de hoy, un proyecto da el suyo— y lo que se
        // escribió lo pisa. Escribir `#casa` dentro de Infra manda la tarea a Casa.
        const created = await createTask({ ...draftFor(view, today), ...draft, title: clean });
        // El permiso se pide la primera vez que alguien le pone hora a algo, no en el primer
        // arranque (spec 7): así la pregunta llega cuando ya se ve para qué sirve.
        if (created.hasTime) void ensurePermission(keepOpen);
        // La tarea nace en la vista en curso, no en la consulta. Si había una búsqueda escrita
        // se limpia para poder ver dónde cayó; si no, la forma funcional evita el redibujo.
        setQuery((current) => (current ? "" : current));
        // Y solo se queda en la lista si es de esta vista: «Comprar pan mañana» escrito en Hoy
        // se guarda para mañana, y verla aquí sería una promesa que la próxima carga rompe.
        if (belongs(view, created, today)) {
          setTasks((current) => [...current, { ...created, subtasks: [] }]);
        }
        setFirstRun(false);
        void refreshCounts();
        return true;
      } catch (cause) {
        console.error(cause);
        setError("No se pudo crear la tarea. Vuelve a intentarlo.");
        return false;
      }
    },
    [refreshCounts, today, view],
  );

  /**
   * La tarea nueva de ⌘⏎, que nace pegada a la de arriba y no al final de la lista. La
   * posición se resuelve con la misma maquinaria del arrastre: entre la de referencia y la que
   * la seguía.
   *
   * Hereda lo que da la vista, igual que la del pie: en Hoy sale con la fecha de hoy, dentro
   * de un proyecto sale con ese proyecto.
   */
  const addAfter = useCallback(
    async (title: string, afterId: string): Promise<string | null> => {
      const clean = title.trim();
      if (!clean) return null;

      setError(null);
      try {
        const created = await createTask({ ...draftFor(view, today), title: clean });

        const at = tasks.findIndex((task) => task.id === afterId);
        // `at + 1` sobre el índice de la de referencia, no sobre la lista ya modificada: la
        // nueva todavía no está dentro, así que la vecina de abajo sigue siendo la de siempre.
        await moveTask(created.id, { after: afterId, before: tasks[at + 1]?.id ?? null });

        setTasks((current) => {
          const index = current.findIndex((task) => task.id === afterId);
          const born = { ...created, subtasks: [] };
          if (index < 0) return [...current, born];
          const next = [...current];
          next.splice(index + 1, 0, born);
          return next;
        });

        setFirstRun(false);
        void refreshCounts();
        return created.id;
      } catch (cause) {
        console.error(cause);
        setError("No se pudo crear la tarea. Vuelve a intentarlo.");
        return null;
      }
    },
    [refreshCounts, tasks, today, view],
  );

  /**
   * Una subtarea nueva, al final de las de su madre.
   *
   * No hereda nada de la vista, al revés que una tarea raíz. Una subtarea no dibuja fecha ni
   * punto de proyecto (spec 3.5), así que darle los suyos sería guardar dos datos que nadie
   * lee y que se quedarían desfasados en cuanto la madre cambiara de proyecto. Su proyecto es
   * el de su madre porque cuelga de ella, y no hay que escribirlo dos veces para saberlo.
   *
   * El nivel único lo defiende un disparador de la base (spec 2). Aquí ni siquiera hay forma
   * de intentarlo: solo las raíces tienen detalle, y este es el único sitio donde se crean.
   */
  const addSubtask = useCallback(async (parentId: string, title: string) => {
    const clean = title.trim();
    if (!clean) return false;

    setError(null);
    try {
      const created = await createTask({ parentId, title: clean });
      setTasks((current) =>
        current.map((root) =>
          root.id === parentId ? { ...root, subtasks: [...root.subtasks, created] } : root,
        ),
      );
      setFirstRun(false);
      return true;
    } catch (cause) {
      console.error(cause);
      setError("No se pudo crear la subtarea. Vuelve a intentarlo.");
      return false;
    }
  }, []);

  /**
   * Edita campos sueltos. El cambio se aplica también en local en vez de releer la vista: una
   * relectura cancelaría los tres segundos de gracia de cualquier fila que se esté yendo.
   *
   * Lo que sí saca la fila de la lista es un cambio que la eche de la vista: el proyecto
   * estando dentro de uno, o la fecha estando en Hoy o en Próximas. Con su detalle abierto el
   * destierro se aplaza a cerrarlo — si no, elegir el día cerraría el detalle antes de poder
   * ponerle la hora.
   */
  const patch = useCallback(
    async (id: string, values: TaskPatch) => {
      setError(null);
      try {
        await updateTask(id, values);
        if (values.hasTime) void ensurePermission(keepOpen);

        // Buscando no hay destierro: lo que se ve no es una vista, es la consulta, y cambiarle
        // la fecha o el proyecto a una tarea no la saca de lo que casó.
        const exiled = !term && exiles(view, values, today);
        const later = exiled && detailId === id;
        if (later) strayed.current.add(id);
        else strayed.current.delete(id);

        setTasks((current) =>
          current.flatMap((root) => {
            if (root.id === id) return exiled && !later ? [] : [{ ...root, ...values }];
            if (!root.subtasks.some((subtask) => subtask.id === id)) return [root];
            return [
              {
                ...root,
                subtasks: root.subtasks.map((subtask) =>
                  subtask.id === id ? { ...subtask, ...values } : subtask,
                ),
              },
            ];
          }),
        );

        if (exiled && !later) setDetailId(null);
        if (values.projectId !== undefined) void refreshCounts();
      } catch (cause) {
        console.error(cause);
        setError("No se pudo guardar el cambio. Vuelve a intentarlo.");
      }
    },
    [detailId, refreshCounts, term, today, view],
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      try {
        forget(id);
        // Lo que devuelve es la tarea y las subtareas que se fueron con ella por la clave
        // foránea. Es lo único que hace posible ⌘Z: después del DELETE ya no hay dónde leerlo.
        const removed = await deleteTask(id);
        if (removed.length) remember({ kind: "tareas", tasks: removed });
        setDetailId((current) => (current === id ? null : current));
        drop(id);
        void refreshCounts();
      } catch (cause) {
        console.error(cause);
        setError("No se pudo eliminar la tarea. Vuelve a intentarlo.");
      }
    },
    [drop, forget, refreshCounts, remember],
  );

  /**
   * Mueve una tarea entre sus hermanas. El orden local se reordena antes de esperar a la base:
   * el arrastre ya dejó la fila donde el usuario la soltó y verla volver a su sitio para
   * regresar un instante después es peor que no animar nada.
   *
   * Vale para una raíz y para una subtarea. En la base es la misma escritura —`position` es una
   * sola escala y `moveTask` solo mira a los dos vecinos que se le pasan— y aquí lo único que
   * cambia es en qué lista hay que hacer el hueco.
   */
  const reorder = useCallback(async (id: string, between: Between) => {
    setError(null);
    setTasks((current) => {
      if (current.some((root) => root.id === id)) return sortBetween(current, id, between.after) ?? current;

      return current.map((root) => {
        if (!root.subtasks.some((subtask) => subtask.id === id)) return root;
        const subtasks = sortBetween(root.subtasks, id, between.after);
        return subtasks ? { ...root, subtasks } : root;
      });
    });

    try {
      await moveTask(id, between);
    } catch (cause) {
      console.error(cause);
      setError("No se pudo guardar el orden. Vuelve a intentarlo.");
    }
  }, []);

  // Aquí se cobra el destierro que `patch` dejó pendiente: la tarea a la que se le cambió la
  // fecha o el proyecto sale de la lista al cerrar su detalle, no mientras se edita.
  const closeDetail = useCallback(() => {
    if (detailId !== null && strayed.current.delete(detailId)) drop(detailId);
    setDetailId(null);
  }, [detailId, drop]);

  // Elegir en el riel manda sobre la búsqueda: si la consulta siguiera puesta, el clic no
  // cambiaría nada de lo que se ve y el riel parecería roto.
  const select = useCallback(
    (next: View) => {
      closeDetail();
      setQuery("");
      setView((current) => (sameView(current, next) ? current : next));
    },
    [closeDetail],
  );

  const saveProject = useCallback(
    async (project: Project | null, name: string, color: string) => {
      setError(null);
      try {
        if (project) {
          // Dos sentencias y no una: el nombre y el color son campos independientes y no hay
          // ningún momento intermedio que se vea mal si solo una llegara.
          if (name !== project.name) await renameProject(project.id, name);
          if (color !== project.color) await setProjectColor(project.id, color);
        } else {
          const created = await createProject(name, color);
          setView({ kind: "proyecto", id: created.id });
        }
        await reloadProjects();
        return true;
      } catch (cause) {
        console.error(cause);
        setError("No se pudo guardar el proyecto. Vuelve a intentarlo.");
        return false;
      }
    },
    [reloadProjects],
  );

  /**
   * Las tareas del proyecto no se van con él: la clave foránea las deja sin proyecto (spec 2).
   * Si se estaba mirando su vista, no queda dónde estar y se vuelve a Hoy.
   */
  const removeProject = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const removed = await deleteProject(id);
        if (removed) remember({ kind: "proyecto", removed });
        setView((current) =>
          current.kind === "proyecto" && current.id === id ? { kind: "hoy" } : current,
        );
        await reloadProjects();
      } catch (cause) {
        console.error(cause);
        setError("No se pudo eliminar el proyecto. Vuelve a intentarlo.");
      }
    },
    [reloadProjects, remember],
  );

  /**
   * Mueve un proyecto en el riel. Es la misma escritura que la de una tarea —`position` es una
   * escala de floats y solo se miran los dos vecinos— sobre la otra tabla.
   *
   * El orden local se cambia antes de esperar a la base, por lo mismo que en las tareas: el
   * disco ya está donde lo soltaron, y verlo volver a su sitio para regresar un instante
   * después se lee como un fallo.
   */
  const reorderProject = useCallback(async (id: string, between: Between) => {
    setError(null);
    setProjects((current) => sortBetween(current, id, between.after) ?? current);

    try {
      await moveProject(id, between);
    } catch (cause) {
      console.error(cause);
      setError("No se pudo guardar el orden de los proyectos. Vuelve a intentarlo.");
    }
  }, []);

  /**
   * ⌘Z. Repone el último borrado con sus ids y sus posiciones originales, así que lo repuesto
   * vuelve al sitio del que salió y no al final de la lista.
   *
   * Después releer es obligatorio y no una comodidad: una tarea repuesta puede pertenecer a
   * esta vista o no, puede traerse subtareas, y un proyecto repuesto recupera las suyas. Nada
   * de eso se puede reconstruir a mano sobre el estado local sin volver a preguntar.
   */
  const undo = useCallback(async () => {
    const last = undoable.current.pop();
    if (!last) return;

    setError(null);
    try {
      if (last.kind === "tareas") await restoreTasks(last.tasks);
      else await restoreProject(last.removed);
      await reloadProjects();
      setEpoch((current) => current + 1);
    } catch (cause) {
      console.error(cause);
      // Se devuelve a la pila: el borrado sigue sin deshacerse, y volver a intentarlo tiene
      // que ser posible.
      undoable.current.push(last);
      setError("No se pudo deshacer. Vuelve a intentarlo.");
    }
  }, [reloadProjects]);

  /**
   * Cambiar el plazo de conservación barre en el momento, sin esperar al próximo arranque.
   * Un ajuste que destruye datos tiene que enseñar lo que hace cuando se toca: bajar a 7 días
   * y no ver ningún cambio deja sin saber si se guardó.
   */
  const changeRetention = useCallback(async (next: Retention) => {
    setRetention(next);
    try {
      await storeRetention(next);
      if (next !== null && (await sweepCompleted(next)) > 0) setEpoch((current) => current + 1);
    } catch (cause) {
      console.error(cause);
      setError("No se pudo guardar el ajuste. Vuelve a intentarlo.");
    }
  }, []);

  /** Con qué vista se abre el panel a partir de ahora. Se aplica en la siguiente apertura. */
  const setStartView = useCallback((kind: SystemKind) => {
    localStorage.setItem(START_KEY, kind);
    setStart(kind);
  }, []);

  const toggleRail = useCallback(() => {
    setRailExpanded((current) => {
      localStorage.setItem(RAIL_KEY, current ? "0" : "1");
      return !current;
    });
  }, []);

  return {
    view,
    select,
    projects,
    projectsById,
    counts,
    tasks,
    today,
    loading,
    firstRun,
    error,
    leaving,
    undoing,
    add,
    addAfter,
    addSubtask,
    toggle,
    patch,
    remove,
    reorder,
    undo,
    // Se deriva de la lista en vez de guardarse aparte: así el detalle siempre muestra lo
    // mismo que la fila, y si la tarea se va —completada, borrada, movida a otro proyecto—
    // el detalle se cierra solo porque deja de haber nada que mostrar.
    detail: tasks.find((task) => task.id === detailId) ?? null,
    openDetail: setDetailId,
    closeDetail,
    query,
    setQuery,
    searching: term !== "",
    term,
    saveProject,
    removeProject,
    reorderProject,
    startView: start,
    setStartView,
    railExpanded,
    toggleRail,
    retention,
    setRetention: changeRetention,
  };
}
