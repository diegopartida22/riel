import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface TitleEditorProps {
  /** El título de partida. Vacío en la fila que todavía no existe. */
  value?: string;
  placeholder?: string;
  /** El segundo argumento es cierto si además se pidió otra debajo (⌘⏎). */
  onSave: (title: string, andAnother: boolean) => void;
  onCancel: () => void;
}

/**
 * El campo que sustituye al título mientras se edita en línea (spec 5, ⏎). Es el mismo para
 * editar una tarea que para escribir una nueva debajo de otra: en los dos casos lo que se pide
 * es un título y nada más, y la diferencia —si al guardar hay que crear o actualizar— la
 * decide quien lo pone, no él.
 *
 * Al abrirse selecciona el texto entero, como el renombrado en línea del Finder: lo que se
 * quiere casi siempre es escribir otro título, y quien quiera retocar tiene una flecha.
 */
export function TitleEditor({ value = "", placeholder, onSave, onCancel }: TitleEditorProps) {
  const [text, setText] = useState(value);
  const box = useRef<HTMLInputElement>(null);
  /**
   * Escape cancela y de paso saca el foco, y el `blur` que viene detrás guardaría justo lo que
   * se acaba de descartar. Vale igual para Enter, que también termina con el campo desmontado.
   */
  const done = useRef(false);

  // En el montaje, no con `autoFocus`: hace falta además dejar el texto seleccionado, y las
  // dos cosas tienen que ocurrir en el mismo golpe para que no se vea el cursor al final.
  useEffect(() => {
    box.current?.focus();
    box.current?.select();
  }, []);

  const finish = (andAnother: boolean) => {
    if (done.current) return;
    done.current = true;
    onSave(text.trim(), andAnother);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      // Este Escape cancela la edición y nada más. Si llegara al panel limpiaría la búsqueda o
      // cerraría la ventana, y lo que se pedía era dejar el título como estaba.
      event.preventDefault();
      event.stopPropagation();
      done.current = true;
      onCancel();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      finish(event.metaKey);
    }
  };

  return (
    <input
      ref={box}
      type="text"
      className="title-editor"
      aria-label="Título de la tarea"
      placeholder={placeholder}
      value={text}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setText(event.currentTarget.value)}
      onBlur={() => finish(false)}
      onKeyDown={onKeyDown}
    />
  );
}
