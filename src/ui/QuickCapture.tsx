import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { createTask, listProjects, localDay, tasksDueBy, type Project, type Task } from "../data";
import { tint } from "../design/palette";
import { CREATED_EVENT, useCaptura } from "../state/useCaptura";
import { CaptureMenu } from "./CaptureMenu";
import { DueChip } from "./DueChip";
import { GroupHeader } from "./GroupHeader";
import { ProjectDot } from "./ProjectDot";
import { X } from "./icons";

/**
 * Cuántas tareas de Hoy caben antes de que la ventana deje de ser una ventana de captura.
 *
 * Seis y no las que haya: lo que esto contesta es «¿qué tengo hoy?», que se lee de un vistazo,
 * y una lista entera aquí sería el panel abierto en medio de la pantalla — que es lo que ya
 * hace el icono de la barra. Lo que sobra se dice contado, que es la respuesta a la única
 * pregunta que queda: cuánto más hay.
 */
const VISIBLES = 6;

/**
 * La ventana de captura rápida (spec 18).
 *
 * Es el campo del pie del panel con sitio para respirar: la misma gramática, los mismos chips
 * y el mismo menú, en una superficie que no tiene lista debajo ni riel al lado. Lo que cambia
 * es a qué contesta cada tecla — aquí Enter guarda y cierra, porque quien la abrió estaba
 * escribiendo en otra app y quiere volver.
 *
 * Nada se hereda de ninguna vista, por lo mismo que un `riel://` (spec 14): la ventana se abre
 * con el panel cerrado, y heredar de la vista que quedó abierta hace tres días es heredar de un
 * azar. Lo que el texto no diga, no lo pone nadie — y los chips son lo que dice, antes de
 * guardar, a dónde va.
 */
export function QuickCapture() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [today, setToday] = useState(() => localDay());
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Las de Hoy, o nulo mientras nadie las haya pedido. */
  const [lista, setLista] = useState<Task[] | null>(null);

  const shell = useRef<HTMLDivElement>(null);
  const notesBox = useRef<HTMLTextAreaElement>(null);
  /** Un Enter repetido antes de que conteste la base crearía la misma tarea dos veces. */
  const saving = useRef(false);

  const captura = useCaptura({
    projects,
    today,
    notes: true,
    onNotes: () => setNotesOpen(true),
  });

  const { reset, box } = captura;

  /** Cada apertura empieza de cero: es una ventana que se abre para una tarea, no una que se
   *  queda con lo de la vez pasada. */
  const open = useCallback(async () => {
    reset();
    setNotes("");
    setNotesOpen(false);
    setError(null);
    setLista(null);
    setToday(localDay());
    box.current?.focus();
    try {
      setProjects(await listProjects());
    } catch (cause) {
      console.error(cause);
    }
  }, [reset, box]);

  // Al montar además del evento: la primera vez, la ventana se construye y se muestra antes de
  // que esta página exista, así que ese aviso no lo oye nadie.
  useEffect(() => {
    void open();
    const unlisten = listen("riel://captura-abierta", () => void open());
    return () => {
      void unlisten.then((off) => off()).catch((cause) => console.error(cause));
    };
  }, [open]);

  /**
   * La ventana mide lo que mide su contenido. Sin esto habría que elegir entre un alto fijo con
   * vidrio vacío debajo del campo o uno que recorta el menú de comandos, y las dos se ven mal
   * de la misma forma: una superficie flotante que no encaja con lo que lleva dentro.
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

  const close = () => void invoke("close_capture").catch((cause) => console.error(cause));

  /**
   * Hoy, sin salir de aquí.
   *
   * Es lo mismo que enseña la vista Hoy del panel —lo vencido y lo de hoy, pendiente y sin
   * subtareas— y no lo finge: sin casilla, sin manija y sin `⋯`, por lo mismo que la agenda no
   * las tiene (spec 15). Desde aquí una tarea no se completa ni se reordena; lo único que hace
   * es estar, que es justo lo que se vino a ver antes de escribir la siguiente.
   *
   * Se lee al pedirla y no al abrirse la ventana: el alto de arranque es el del campo con su
   * renglón de pistas, y traer la lista siempre pondría medio panel delante de quien solo
   * quería apuntar una cosa.
   */
  const ver = async () => {
    try {
      setLista(await tasksDueBy(localDay()));
    } catch (cause) {
      console.error(cause);
      setLista([]);
    }
  };

  const submit = async (seguir: boolean) => {
    const { title, draft } = captura.capture;
    if (!title || saving.current) return;

    saving.current = true;
    setError(null);
    try {
      await createTask({ title, ...draft, notes: notes.trim() || null });
      // El panel sigue vivo con la ventana escondida, así que se entera ahora y no cuando
      // alguien lo abra: es lo que hace que la tarea ya esté ahí, y ya programada si trae hora.
      await emitTo("main", CREATED_EVENT, {});

      reset();
      setNotes("");
      setNotesOpen(false);
      if (seguir) box.current?.focus();
      else close();
    } catch (cause) {
      console.error(cause);
      // El texto se queda donde está: lo que no se pudo guardar no se puede perder también.
      setError("No se pudo guardar la tarea. Vuelve a intentarlo.");
    } finally {
      saving.current = false;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (captura.menuKeyDown(event)) return;

    // El espacio, y solo con el campo vacío: ahí no escribe nada —el título se recorta antes de
    // guardarse— así que la tecla está libre y es la más grande del teclado. Con algo escrito
    // vuelve a ser un espacio, que es lo que tiene que ser.
    //
    // Vacío lo dice el campo y no el estado: el `keydown` corre antes de que React haya
    // redibujado, así que `captura.text` puede ir un render por detrás si el hilo se atasca, y
    // ahí un espacio de verdad se leería como el de la lista. El valor del campo ya trae todo
    // lo tecleado hasta esta tecla, que es justo lo que se está preguntando.
    const campo = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;

    if (event.key === " " && campo.tagName !== "TEXTAREA" && !campo.value) {
      event.preventDefault();
      if (lista) setLista(null);
      else void ver();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      // La misma escalera que el panel (spec 4), con un peldaño más: lo primero que Escape se
      // lleva es lo que se haya abierto encima, luego lo escrito, y solo cuando no queda nada
      // cierra la ventana.
      if (lista) {
        setLista(null);
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
      // En las notas, un Enter suelto guarda y ⇧⏎ hace renglón: son varias líneas por
      // naturaleza, y sin la excepción no habría forma de escribir la segunda.
      if (campo.tagName === "TEXTAREA" && event.shiftKey) return;
      event.preventDefault();
      // ⌘⏎ deja la ventana abierta para la siguiente, que es como se apuntan tres cosas
      // seguidas sin volver a pulsar el atajo.
      void submit(event.metaKey);
    }
  };

  const project = captura.capture.tokens.find((token) => token.color);
  const style = project?.color ? tint(project.color) : undefined;

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
            // Escribir es lo contrario de mirar: la lista se va sola en cuanto hay título.
            setLista(null);
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

      {captura.menu && (
        <CaptureMenu menu={captura.menu} className="quick__menu" onPick={captura.pick} />
      )}

      {lista && (
        <div className="quick__lista">
          <GroupHeader>Hoy</GroupHeader>
          {lista.length === 0 ? (
            <p className="quick__vacio">Nada para hoy.</p>
          ) : (
            <ul className="quick__tareas">
              {lista.slice(0, VISIBLES).map((task) => {
                const color = projects.find((one) => one.id === task.projectId)?.color;
                return (
                  <li key={task.id} className="quick__tarea">
                    <span className="quick__tarea-title">{task.title}</span>
                    {color && <ProjectDot color={color} />}
                    {task.dueAt && (
                      <DueChip dueAt={task.dueAt} hasTime={task.hasTime} today={today} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {lista.length > VISIBLES && (
            <p className="quick__mas">y {lista.length - VISIBLES} más</p>
          )}
        </div>
      )}

      {error && <p className="quick__error">{error}</p>}

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
        {captura.capture.title ? (
          <>
            <span className="quick__hint">
              <kbd>⌘⏎</kbd> Agregar y seguir
            </span>
            <span className="quick__hint quick__hint--strong">
              <kbd>⏎</kbd> Agregar
            </span>
          </>
        ) : (
          <>
            <span className="quick__hint">
              <kbd>Espacio</kbd> {lista ? "Ocultar" : "Ver Hoy"}
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
