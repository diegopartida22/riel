import { useRef, type KeyboardEvent, type Ref } from "react";

import type { NewTask, Project } from "../data";
import { tint } from "../design/palette";
import type { CaptureToken } from "../state/capture";
import { useCaptura } from "../state/useCaptura";
import { CaptureMenu } from "./CaptureMenu";
import { X } from "./icons";

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
 *
 * El estado y las teclas los lleva `useCaptura`, que es lo mismo que usa la ventana de captura
 * rápida (spec 18): la gramática se aprende una vez y vale en los dos sitios.
 */
export function Composer({ firstRun = false, projects, today, ref, onAdd }: ComposerProps) {
  // El pie no ofrece notas: un comando que abre un campo que aquí no cabe sería un renglón
  // prometiendo algo que no está.
  const captura = useCaptura({ projects, today });

  /** Un Enter repetido antes de que conteste la base crearía la misma tarea dos veces. */
  const saving = useRef(false);

  const attach = (node: HTMLInputElement | null) => {
    captura.attach(node);
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = node;
  };

  const submit = async () => {
    const { title, draft } = captura.capture;
    if (!title || saving.current) return;

    saving.current = true;
    try {
      // El campo se limpia solo si la tarea quedó guardada. Vaciarlo antes se siente más
      // rápido, pero si la escritura falla se lleva por delante lo que la persona escribió.
      if (await onAdd({ title, ...draft })) captura.reset();
    } finally {
      saving.current = false;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (captura.menuKeyDown(event)) return;

    // El Escape del campo escrito lo vacía, y solo el siguiente cierra el panel. Es la misma
    // escalera que la búsqueda (spec 4), y hace falta por lo mismo: sin ella, arrepentirse de
    // media tarea escrita costaba cerrar el panel entero, y volver a abrirlo devolvía el texto
    // igual que estaba porque el webview sigue vivo — o sea que Escape no cancelaba nada.
    if (event.key === "Escape" && captura.text) {
      event.preventDefault();
      event.stopPropagation();
      captura.reset();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="composer">
      {captura.menu && (
        <CaptureMenu menu={captura.menu} className="hashes" onPick={captura.pick} />
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
          value={captura.text}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => captura.sync(event.currentTarget)}
          onSelect={(event) => captura.select(event.currentTarget)}
          onFocus={() => captura.setFocused(true)}
          onBlur={() => captura.setFocused(false)}
          onKeyDown={onKeyDown}
        />
      </div>

      {captura.capture.tokens.length > 0 && (
        <ul className="chips">
          {captura.capture.tokens.map((token: CaptureToken) => (
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
    </div>
  );
}
