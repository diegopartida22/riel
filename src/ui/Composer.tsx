import { X } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";

import type { NewTask, Project } from "../data";
import { tint } from "../design/palette";
import {
  completions,
  dismissKey,
  hashAt,
  isComplete,
  parse,
  type CaptureToken,
} from "../state/capture";

export interface ComposerProps {
  /** Base vacía: cambia el texto de invitación (spec 3.7). */
  firstRun?: boolean;
  /** Para resolver `#proyecto` y para el autocompletado. */
  projects: Project[];
  /** El día local con el que se resuelven `hoy`, `mañana` y los días de la semana. */
  today: string;
  ref?: Ref<HTMLInputElement>;
  /** Falso si no se pudo guardar; entonces el texto se queda donde está. */
  onAdd: (draft: NewTask) => Promise<boolean>;
}

/**
 * El campo de captura del pie del panel. Enter guarda y deja el campo listo para la
 * siguiente: es el modo en que se escriben cinco tareas seguidas sin levantar las manos.
 *
 * Lo escrito se parsea al vuelo (spec 6) y lo entendido sale como chips **debajo** del campo,
 * que es donde los pide el spec. El pie crece hacia arriba para hacerles sitio en vez de
 * meterlos entre el `+` y el texto: así el campo no se mueve mientras se escribe, y los chips
 * quedan donde no tapan nada.
 *
 * Un clic en un chip lo quita y su texto vuelve al título. El descarte se recuerda por texto y
 * no por posición, porque el índice se corre con cada tecla que se escriba por delante.
 */
export function Composer({ firstRun = false, projects, today, ref, onAdd }: ComposerProps) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  /** Un Escape cierra el menú del `#` sin tocar el texto; la siguiente tecla lo devuelve. */
  const [menuOff, setMenuOff] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /** El menú solo existe mientras se escribe. Colgado sobre la lista sin el foco en el campo
   *  sería un trozo de interfaz sin dueño, y encima tapando tareas. */
  const [focused, setFocused] = useState(false);

  const box = useRef<HTMLInputElement>(null);
  /** Un Enter repetido antes de que conteste la base crearía la misma tarea dos veces. */
  const saving = useRef(false);

  const capture = useMemo(
    () => parse(text, projects, today, dismissed),
    [text, projects, today, dismissed],
  );

  const hash = hashAt(text, caret);
  const matches = hash ? completions(hash.fragment, projects) : [];
  // En cuanto lo escrito nombra un proyecto entero, el menú sobra: el chip ya lo dice.
  const menu =
    focused && hash !== null && matches.length > 0 && !menuOff && !isComplete(hash.fragment, projects)
      ? matches
      : null;
  const active = menu ? Math.min(highlight, menu.length - 1) : 0;

  const attach = (node: HTMLInputElement | null) => {
    box.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = node;
  };

  const sync = (node: HTMLInputElement) => {
    setText(node.value);
    setCaret(node.selectionStart ?? node.value.length);
    setMenuOff(false);
    // Cada tecla rehace la lista de coincidencias; conservar el resaltado señalaría a otro
    // proyecto del que estaba señalando.
    setHighlight(0);
  };

  const complete = (project: Project) => {
    if (!hash) return;
    // El nombre sustituye la palabra entera y no solo hasta el cursor: completar «#in|ra»
    // tiene que dar «#Infra», no «#Infrara».
    let end = caret;
    while (end < text.length && !/\s/.test(text[end])) end++;
    const next = `${text.slice(0, hash.at)}#${project.name}${text.slice(end)}`;
    const at = hash.at + 1 + project.name.length;
    setText(next);
    setCaret(at);
    setHighlight(0);
    // El valor lo pinta React en el siguiente pintado; mover el cursor antes lo dejaría al final.
    requestAnimationFrame(() => box.current?.setSelectionRange(at, at));
  };

  const dismiss = (token: CaptureToken) => {
    setDismissed((current) => new Set(current).add(dismissKey(token)));
    box.current?.focus();
  };

  const submit = async () => {
    const { title, draft } = capture;
    if (!title || saving.current) return;

    saving.current = true;
    try {
      // El campo se limpia solo si la tarea quedó guardada. Vaciarlo antes se siente más
      // rápido, pero si la escritura falla se lleva por delante lo que la persona escribió.
      if (await onAdd({ title, ...draft })) {
        setText("");
        setCaret(0);
        setDismissed(new Set());
      }
    } finally {
      saving.current = false;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (menu) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : menu.length - 1;
        setHighlight((current) => (Math.min(current, menu.length - 1) + step) % menu.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        complete(menu[active]);
        return;
      }
      if (event.key === "Escape") {
        // Este Escape cierra el menú. Que no llegue al que limpia la búsqueda ni al que cierra
        // el panel: lo que se pedía era deshacerse de la lista de proyectos.
        event.preventDefault();
        event.stopPropagation();
        setMenuOff(true);
        return;
      }
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="composer">
      {menu && (
        <ul className="hashes" role="listbox" aria-label="Proyectos">
          {menu.map((project, index) => (
            <li key={project.id} role="presentation">
              <button
                type="button"
                className={`menu__item${index === active ? " is-active" : ""}`}
                role="option"
                aria-selected={index === active}
                // `mousedown` y no `click`: para cuando llega el clic el campo ya perdió el
                // foco, y con él el cursor que dice dónde insertar el nombre.
                onMouseDown={(event) => {
                  event.preventDefault();
                  complete(project);
                }}
              >
                <span className="hashes__dot tinted" style={tint(project.color)} aria-hidden />
                {project.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="composer__row">
        <span className="composer__plus" aria-hidden="true">
          +
        </span>
        <input
          ref={attach}
          type="text"
          className="composer__field"
          placeholder={firstRun ? "¿Qué hay que hacer?" : "Nueva tarea"}
          aria-label="Nueva tarea"
          value={text}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => sync(event.currentTarget)}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        />
      </div>

      {capture.tokens.length > 0 && (
        <ul className="chips">
          {capture.tokens.map((token) => (
            <li key={`${token.kind}:${token.at}`}>
              <button
                type="button"
                className={`chip chip--${token.kind}`}
                aria-label={`Quitar ${token.label}`}
                onClick={() => dismiss(token)}
              >
                {token.color && (
                  <span className="chip__dot tinted" style={tint(token.color)} aria-hidden />
                )}
                {token.label}
                <X className="chip__x" size={11} strokeWidth={2.25} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
