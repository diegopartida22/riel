import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  completeTask,
  createTask,
  listProjects,
  localDay,
  pendingTasks,
  pushDone,
  shortRepeat,
  tasksDueAfter,
  tasksDueBy,
  uncompleteTasks,
  undoSpawn,
  type Project,
  type Task,
} from "../data";
import { tint } from "../design/palette";
import { CHANGED_EVENT, useCaptura } from "../state/useCaptura";
import { emptyMessage } from "../state/views";
import { CaptureMenu } from "./CaptureMenu";
import { Checkbox } from "./Checkbox";
import { DueChip } from "./DueChip";
import { ChevronRight, Repeat, X } from "./icons";
import { PriorityMark } from "./PriorityMark";
import { ProjectDot } from "./ProjectDot";

/** Las tres listas que se pueden mirar desde aquí, en el orden del riel y de ⌘1..3. */
type Pestana = "hoy" | "proximas" | "todas";

const PESTANAS: { kind: Pestana; label: string }[] = [
  { kind: "hoy", label: "Hoy" },
  { kind: "proximas", label: "Próximas" },
  { kind: "todas", label: "Todas" },
];

type Listas = Record<Pestana, Task[]>;

/** Lo mismo que el panel (spec 3.6): tres segundos para arrepentirse y 200 ms para irse. */
const UNDO_MS = 3000;
const COLLAPSE_MS = 200;

/** Una tarea completada desde aquí que todavía se puede desmarcar. */
interface Hecha {
  task: Task;
  ids: string[];
  spawned: Task | null;
  timers: number[];
}

/** Si una tarea recién escrita cae en la lista que se está mirando — `belongs` del panel,
 *  ceñido a las tres que hay aquí. */
function cabe(pestana: Pestana, task: Task, today: string): boolean {
  if (pestana === "todas") return true;
  if (!task.dueAt) return false;
  const day = task.dueAt.slice(0, 10);
  return pestana === "hoy" ? day <= today : day > today;
}

/**
 * Las listas releídas, con las completadas de los tres segundos de gracia en su sitio.
 *
 * La base ya no las devuelve —están completadas— y sin esto cualquier recarga en medio de la
 * ventana de deshacer, la de un ⌘⏎ por ejemplo, se llevaría la fila tachada antes de tiempo y
 * con ella la única forma de desmarcarla. Cada una vuelve detrás de la que la precedía, que es
 * donde estaba.
 */
function conservar(antes: Task[], despues: Task[], hechas: Map<string, Hecha>): Task[] {
  if (!hechas.size) return despues;
  // La vuelta siguiente de una recurrente ya está escrita, pero entra al terminar la gracia y
  // no antes: con la vieja tachada todavía en pantalla, las dos juntas se leen como una tarea
  // duplicada y no como una que volvió. Es lo mismo que hace el panel.
  const nacidas = new Set([...hechas.values()].map((hecha) => hecha.spawned?.id));
  const out = despues.filter((task) => !nacidas.has(task.id));
  antes.forEach((task, index) => {
    const hecha = hechas.get(task.id);
    if (!hecha || out.some((one) => one.id === task.id)) return;
    const previa = antes[index - 1]?.id;
    const at = previa ? out.findIndex((one) => one.id === previa) + 1 : 0;
    out.splice(at, 0, hecha.task);
  });
  return out;
}

/**
 * La ventana de captura rápida (spec 18).
 *
 * Es el campo del pie del panel con sitio para respirar, y debajo la lista: Hoy, Próximas y
 * Todas, a un ⇥ de distancia. Lo que se viene a hacer aquí es apuntar algo sin dejar lo que se
 * estaba haciendo, y lo primero que se quiere saber antes de apuntarlo es qué hay ya — si
 * estaba, qué más cae hoy, qué se puede tachar de paso.
 *
 * Nada se hereda de ninguna vista, por lo mismo que un `riel://` (spec 14): la ventana se abre
 * con el panel cerrado, y heredar de la vista que quedó abierta hace tres días es heredar de un
 * azar. Lo que el texto no diga, no lo pone nadie — y los chips son lo que dice, antes de
 * guardar, a dónde va. La pestaña que se esté mirando tampoco: mirar Próximas no es decir que
 * lo que se escriba es para mañana.
 */
export function QuickCapture() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [today, setToday] = useState(() => localDay());
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listas, setListas] = useState<Listas | null>(null);
  const [pestana, setPestana] = useState<Pestana>("hoy");
  /** La fila señalada con el teclado. Nunca con el ratón: el espacio la completa, y un puntero
   *  que se quedó apoyado encima no puede decidir qué se tacha. */
  const [activa, setActiva] = useState<string | null>(null);
  /** Las completadas que siguen en pantalla, y las que ya se están yendo. */
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [saliendo, setSaliendo] = useState<ReadonlySet<string>>(new Set());
  /** La que se acaba de escribir con ⌘⏎, para que entre en la lista en vez de aparecer. */
  const [nueva, setNueva] = useState<string | null>(null);

  const shell = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const notesBox = useRef<HTMLTextAreaElement>(null);
  /** Un Enter repetido antes de que conteste la base crearía la misma tarea dos veces. */
  const saving = useRef(false);
  const hechas = useRef(new Map<string, Hecha>());

  const captura = useCaptura({
    projects,
    today,
    notes: true,
    onNotes: () => setNotesOpen(true),
  });

  const { reset, box } = captura;

  /** El panel sigue vivo con esta ventana escondida y se entera en el acto: es lo que hace que
   *  la tarea ya esté ahí al abrirlo, y ya programada si trae hora. */
  const avisar = () =>
    void emitTo("main", CHANGED_EVENT, {}).catch((cause) => console.error(cause));

  const cargar = useCallback(async () => {
    try {
      const day = localDay();
      const [hoy, proximas, todas] = await Promise.all([
        tasksDueBy(day),
        tasksDueAfter(day),
        pendingTasks(),
      ]);
      // Próximas en el orden del calendario y no en el de la lista: aquí no hay encabezados de
      // día que lo pongan, y sin ellos una tarea del viernes delante de una del martes se lee
      // como un error.
      proximas.sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
      setToday(day);
      setListas((antes) => ({
        hoy: conservar(antes?.hoy ?? [], hoy, hechas.current),
        proximas: conservar(antes?.proximas ?? [], proximas, hechas.current),
        todas: conservar(antes?.todas ?? [], todas, hechas.current),
      }));
    } catch (cause) {
      console.error(cause);
      setListas((antes) => antes ?? { hoy: [], proximas: [], todas: [] });
    }
  }, []);

  /** Da por buenas las completadas que siguen en su ventana de deshacer. Ya están guardadas;
   *  lo único que se suelta es la posibilidad de desmarcarlas desde aquí. */
  const asentar = useCallback(() => {
    for (const hecha of hechas.current.values()) hecha.timers.forEach(clearTimeout);
    hechas.current.clear();
    setMarcadas(new Set());
    setSaliendo(new Set());
  }, []);

  // Al cerrarse y no al abrirse: con la ventana escondida, el campo se vacía y la ventana vuelve
  // a medir lo que mide con la lista recién leída, así que la próxima vez aparece ya con su alto
  // y con su contenido — sin un fotograma de lo de la vez pasada.
  const cerrada = useCallback(() => {
    reset();
    setNotes("");
    setNotesOpen(false);
    setError(null);
    setPestana("hoy");
    setActiva(null);
    asentar();
    void cargar();
  }, [reset, asentar, cargar]);

  const abierta = useCallback(async () => {
    box.current?.focus();
    void cargar();
    try {
      setProjects(await listProjects());
    } catch (cause) {
      console.error(cause);
    }
  }, [box, cargar]);

  // Al montar además del evento: la primera vez, la ventana se construye y se muestra antes de
  // que esta página exista, así que ese aviso no lo oye nadie.
  useEffect(() => {
    void abierta();
    const offs = [
      listen("riel://captura-abierta", () => void abierta()),
      listen("riel://captura-cerrada", cerrada),
    ];
    return () => {
      for (const off of offs) void off.then((stop) => stop()).catch((cause) => console.error(cause));
    };
  }, [abierta, cerrada]);

  useEffect(() => () => asentar(), [asentar]);

  /**
   * La ventana mide lo que mide su contenido. Sin esto habría que elegir entre un alto fijo con
   * vidrio vacío debajo del campo o uno que recorta la lista, y las dos se ven mal de la misma
   * forma: una superficie flotante que no encaja con lo que lleva dentro.
   */
  useEffect(() => {
    const node = shell.current;
    if (!node) return;

    let last = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      if (height === last || height === 0) return;
      last = height;
      void invoke("resize_capture", { height }).catch((cause) => console.error(cause));
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // La señalada tiene que verse: con más filas que alto, ↓ la llevaría por debajo del borde.
  useEffect(() => {
    if (!activa) return;
    lista.current
      ?.querySelector(`[data-task-id="${CSS.escape(activa)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activa]);

  const close = () => void invoke("close_capture").catch((cause) => console.error(cause));

  /** Lo mismo que se está mirando, en grande: el panel, abierto en esta lista. */
  const alPanel = () =>
    void invoke("capture_to_panel", { vista: pestana }).catch((cause) => console.error(cause));

  const filas = listas?.[pestana] ?? [];

  const cambiar = (siguiente: Pestana) => {
    setPestana(siguiente);
    setActiva(null);
    if (lista.current) lista.current.scrollTop = 0;
  };

  /**
   * Completar desde aquí, con el mismo gesto y la misma gracia que en el panel (spec 3.6): la
   * casilla se llena, la fila se tacha y se queda tres segundos por si fue sin querer. Lo que
   * no hay es lo demás de una fila —ni detalle, ni arrastre, ni `⋯`—: esto es para tachar de
   * paso lo que ya se hizo, no para organizar la lista.
   */
  const alternar = async (task: Task) => {
    setError(null);
    try {
      const previa = hechas.current.get(task.id);
      if (previa) {
        previa.timers.forEach(clearTimeout);
        hechas.current.delete(task.id);
        if (previa.spawned) await undoSpawn(previa.spawned, task);
        await uncompleteTasks(previa.ids);
        // El deshacer llega también al recordatorio vinculado (spec 16.1).
        void pushDone(previa.ids, false);
        setMarcadas((current) => sin(current, task.id));
        setSaliendo((current) => sin(current, task.id));
        avisar();
        return;
      }

      const { ids, at, spawned } = await completeTask(task.id);
      if (!ids.length) return;
      void pushDone(ids, true);

      hechas.current.set(task.id, {
        task: { ...task, completedAt: at },
        ids,
        spawned,
        timers: [
          window.setTimeout(() => setSaliendo((current) => con(current, task.id)), UNDO_MS),
          window.setTimeout(() => {
            hechas.current.delete(task.id);
            setMarcadas((current) => sin(current, task.id));
            setSaliendo((current) => sin(current, task.id));
            setActiva((current) => (current === task.id ? null : current));
            void cargar();
          }, UNDO_MS + COLLAPSE_MS),
        ],
      });
      setMarcadas((current) => con(current, task.id));
      avisar();
    } catch (cause) {
      console.error(cause);
      setError("No se pudo guardar el cambio. Vuelve a intentarlo.");
    }
  };

  const submit = async (seguir: boolean) => {
    const { title, draft } = captura.capture;
    if (!title || saving.current) return;

    saving.current = true;
    setError(null);
    try {
      const task = await createTask({ title, ...draft, notes: notes.trim() || null });
      avisar();

      reset();
      setNotes("");
      setNotesOpen(false);
      if (!seguir) {
        close();
        return;
      }

      // Se queda: la tarea entra en la lista donde cae, y si no cae en la que se está mirando
      // se pasa a la que sí. Escribir «mañana» desde Hoy y no verla en ningún sitio deja sin
      // saber si se guardó.
      if (!cabe(pestana, task, today)) {
        cambiar(PESTANAS.find((one) => cabe(one.kind, task, today))?.kind ?? "todas");
      }
      setNueva(task.id);
      window.setTimeout(() => setNueva((current) => (current === task.id ? null : current)), 400);
      await cargar();
      box.current?.focus();
    } catch (cause) {
      console.error(cause);
      // El texto se queda donde está: lo que no se pudo guardar no se puede perder también.
      setError("No se pudo guardar la tarea. Vuelve a intentarlo.");
    } finally {
      saving.current = false;
    }
  };

  const mover = (paso: number) => {
    const visibles = filas.filter((task) => !saliendo.has(task.id));
    if (!visibles.length) return;
    const index = visibles.findIndex((task) => task.id === activa);
    const siguiente =
      index === -1
        ? paso > 0
          ? 0
          : visibles.length - 1
        : Math.min(Math.max(index + paso, 0), visibles.length - 1);
    setActiva(visibles[siguiente].id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (captura.menuKeyDown(event)) return;

    // Vacío lo dice el campo y no el estado: el `keydown` corre antes de que React haya
    // redibujado, así que `captura.text` puede ir un render por detrás si el hilo se atasca, y
    // ahí un espacio de verdad se leería como el de la lista. El valor del campo ya trae todo
    // lo tecleado hasta esta tecla, que es justo lo que se está preguntando.
    const campo = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    const enTitulo = campo.tagName !== "TEXTAREA";
    const vacio = enTitulo && !campo.value;

    if (event.metaKey && /^[123]$/.test(event.key)) {
      event.preventDefault();
      cambiar(PESTANAS[Number(event.key) - 1].kind);
      return;
    }

    if (event.metaKey && event.key.toLowerCase() === "o") {
      event.preventDefault();
      alPanel();
      return;
    }

    // ⇥ cambia de lista. En un campo de una línea no hay a dónde más llevar el foco: lo único
    // que hay detrás son las pestañas mismas, y llegar a ellas para pulsarlas es más viaje.
    if (event.key === "Tab" && enTitulo) {
      event.preventDefault();
      const index = PESTANAS.findIndex((one) => one.kind === pestana);
      const paso = event.shiftKey ? PESTANAS.length - 1 : 1;
      cambiar(PESTANAS[(index + paso) % PESTANAS.length].kind);
      return;
    }

    // Las flechas recorren la lista solo con el campo vacío: con algo escrito, lo que se está
    // haciendo es escribir, y el espacio que completaría la señalada tiene que volver a ser un
    // espacio.
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && vacio) {
      event.preventDefault();
      mover(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    // El espacio, y solo con el campo vacío y una fila señalada: ahí no escribe nada —el título
    // se recorta antes de guardarse— así que la tecla está libre, y es la de la casilla en
    // todas las listas del sistema.
    if (event.key === " " && vacio && activa) {
      event.preventDefault();
      const task = filas.find((one) => one.id === activa);
      if (task) void alternar(task);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      // La misma escalera que el panel (spec 4), con un peldaño más: lo primero que Escape se
      // lleva es la fila señalada, luego lo escrito, y solo cuando no queda nada cierra.
      if (activa) {
        setActiva(null);
        return;
      }
      if (captura.text || notes || notesOpen) {
        reset();
        setNotes("");
        setNotesOpen(false);
        setError(null);
        box.current?.focus();
        return;
      }
      close();
      return;
    }

    if (event.key === "Enter") {
      // En las notas, ⇧⏎ hace renglón: son varias líneas por naturaleza, y sin la excepción no
      // habría forma de escribir la segunda.
      if (!enTitulo && event.shiftKey) return;
      event.preventDefault();
      // ⌘⏎ deja la ventana abierta para la siguiente, que es como se apuntan tres cosas
      // seguidas sin volver a pulsar el atajo.
      void submit(event.metaKey);
    }
  };

  const project = captura.capture.tokens.find((token) => token.color);
  const style = project?.color ? tint(project.color) : undefined;
  const colorDe = (task: Task) => projects.find((one) => one.id === task.projectId);
  const escrito = Boolean(captura.capture.title);
  const marcada = activa ? marcadas.has(activa) : false;

  return (
    <div
      ref={shell}
      // Cuando el texto nombra un proyecto, el acento de la ventana es el suyo: la misma regla
      // que hace que dentro de un proyecto manden sus colores (spec 3.1). Es también la única
      // confirmación en color de que la marca se entendió.
      className={`quick${project ? " quick--project tinted" : ""}`}
      style={style}
    >
      <div className="quick__row">
        {/* La casilla de una fila de tarea, a escala. Es lo que se está haciendo, dicho con el
            vocabulario que la app ya usa para decirlo. */}
        <span className="quick__mark" aria-hidden="true" />
        <input
          ref={captura.attach}
          type="text"
          className="quick__field"
          placeholder="¿Qué hay que hacer?"
          aria-label="Nueva tarea"
          value={captura.text}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          onChange={(event) => {
            // Escribir suelta la fila señalada: el espacio vuelve a ser un espacio.
            setActiva(null);
            captura.sync(event.currentTarget);
          }}
          onSelect={(event) => captura.select(event.currentTarget)}
          onFocus={() => captura.setFocused(true)}
          onBlur={() => captura.setFocused(false)}
          onKeyDown={onKeyDown}
        />
      </div>

      {notesOpen && (
        <textarea
          ref={notesBox}
          className="quick__notes"
          placeholder="Notas"
          aria-label="Notas"
          rows={2}
          value={notes}
          spellCheck={false}
          autoFocus
          onChange={(event) => setNotes(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      )}

      {captura.capture.tokens.length > 0 && (
        <ul className="chips quick__chips">
          {captura.capture.tokens.map((token) => (
            <li key={`${token.kind}:${token.at}`}>
              <button
                type="button"
                className={`chip chip--${token.kind}`}
                aria-label={`Quitar ${token.label}`}
                onClick={() => captura.dismiss(token)}
              >
                {token.color && (
                  <span className="chip__dot tinted" style={tint(token.color)} aria-hidden />
                )}
                {token.label}
                <X className="chip__x" size={11} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="quick__error">{error}</p>}

      {/* El menú de comandos sustituye a la lista mientras está abierto, en vez de apilarse
          encima: los dos son «lo de debajo del campo», y con los dos a la vez la ventana
          doblaría su alto para enseñar una cosa que no se está mirando. */}
      {captura.menu ? (
        <CaptureMenu menu={captura.menu} className="quick__menu" onPick={captura.pick} />
      ) : (
        listas && (
          <section className="quick__lista" aria-label="Tareas pendientes">
            <div className="quick__cabeza">
              {/* Las tres listas como un segmentado de Ajustes, con su cuenta. El ratón no se
                  lleva el foco del campo: se puede cambiar de lista y seguir escribiendo. */}
              <div className="settings__choices quick__pestanas" role="tablist">
                {PESTANAS.map(({ kind, label }) => (
                  <button
                    key={kind}
                    type="button"
                    role="tab"
                    tabIndex={-1}
                    aria-selected={pestana === kind}
                    className={`settings__choice quick__pestana${pestana === kind ? " is-selected" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => cambiar(kind)}
                  >
                    {label}
                    <span className="quick__cuenta">
                      {listas[kind].filter((task) => !marcadas.has(task.id)).length || ""}
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                tabIndex={-1}
                className="quick__abrir"
                onMouseDown={(event) => event.preventDefault()}
                onClick={alPanel}
              >
                Abrir en el panel
                <ChevronRight size={11} aria-hidden />
              </button>
            </div>

            {filas.length === 0 ? (
              <p className="quick__vacio">{emptyMessage({ kind: pestana })}</p>
            ) : (
              <ul ref={lista} className="quick__tareas" role="list">
                {filas.map((task) => {
                  const proyecto = colorDe(task);
                  const hecha = marcadas.has(task.id);
                  return (
                    <li
                      key={task.id}
                      data-task-id={task.id}
                      className={[
                        "collapse quick__item",
                        saliendo.has(task.id) && "is-leaving",
                        nueva === task.id && "is-new",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div
                        className={[
                          "quick__tarea tinted",
                          hecha && "is-completed",
                          activa === task.id && "is-active",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        style={tint(proyecto?.color)}
                        // Pulsar una fila no se lleva el foco del campo: lo que se escriba
                        // después tiene que seguir entrando ahí.
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        <Checkbox
                          checked={hecha}
                          label={task.title}
                          onChange={() => void alternar(task)}
                        />
                        <span className="quick__tarea-text">
                          <span className="task-row__title">{task.title}</span>
                        </span>
                        <span className="quick__tarea-meta">
                          {proyecto && <ProjectDot color={proyecto.color} title={proyecto.name} />}
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
                          {task.dueAt && (
                            <DueChip dueAt={task.dueAt} hasTime={task.hasTime} today={today} />
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )
      )}

      {/* El renglón de pistas es lo que hace que la barra no se lea como una línea de comandos:
          dice qué teclas hay sin obligar a probarlas. Las dos marcas van siempre, porque son lo
          que hay que aprender; lo de la derecha cambia con lo que ya se puede hacer. */}
      <div className="quick__hints">
        <span className="quick__hint">
          <kbd>/</kbd> comandos
        </span>
        <span className="quick__hint">
          <kbd>@</kbd> proyecto
        </span>
        <span className="quick__gap" />
        {escrito ? (
          <>
            <span className="quick__hint">
              <kbd>⌘⏎</kbd> Agregar y seguir
            </span>
            <span className="quick__hint quick__hint--strong">
              <kbd>⏎</kbd> Agregar
            </span>
          </>
        ) : activa ? (
          <>
            <span className="quick__hint quick__hint--strong">
              <kbd>␣</kbd> {marcada ? "Desmarcar" : "Completar"}
            </span>
            <span className="quick__hint">
              <kbd>⌘O</kbd> Abrir en el panel
            </span>
          </>
        ) : (
          <>
            <span className="quick__hint">
              <kbd>↑↓</kbd> Elegir
            </span>
            <span className="quick__hint">
              <kbd>⇥</kbd> Lista
            </span>
            <span className="quick__hint">
              <kbd>⎋</kbd> Cerrar
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function con(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return new Set(set).add(id);
}

function sin(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}
