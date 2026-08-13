import { useState, type FormEvent } from "react";

import type { Project } from "../data";
import { PALETTE, tint } from "../design/palette";
import { ColorPicker } from "./ColorPicker";

export interface ProjectEditorProps {
  /** Nulo para uno nuevo. */
  project: Project | null;
  /** Cuántas tareas se quedarían sin proyecto al borrarlo. */
  pendingCount: number;
  onSave: (name: string, color: string) => Promise<boolean>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

/**
 * El alta y la edición de un proyecto. Ocupa el área de contenido en vez de flotar sobre ella:
 * un panel de 440px no tiene sitio para una capa encima de otra, y oscurecer el fondo para
 * separarlas apagaría el vidrio, que es lo único que no se puede tocar.
 *
 * El botón primario se pinta con el color elegido, que es la regla de la sección 3.1 llevada
 * a su caso más literal — aquí el proyecto en contexto es el que se está creando.
 */
export function ProjectEditor({
  project,
  pendingCount,
  onSave,
  onDelete,
  onClose,
}: ProjectEditorProps) {
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(project?.color ?? PALETTE[0].light);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;

    setSaving(true);
    try {
      if (await onSave(name.trim(), color)) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="editor tinted" style={tint(color)} onSubmit={submit}>
      <h2 className="editor__title">{project ? "Editar proyecto" : "Nuevo proyecto"}</h2>

      <input
        type="text"
        className="editor__name"
        value={name}
        placeholder="Nombre"
        aria-label="Nombre del proyecto"
        spellCheck={false}
        autoComplete="off"
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />

      <ColorPicker value={color} onChange={setColor} />

      <div className="editor__actions">
        <button type="button" className="editor__button" onClick={onClose}>
          Cancelar
        </button>
        <button
          type="submit"
          className="editor__button editor__button--primary"
          disabled={!name.trim() || saving}
        >
          {project ? "Guardar" : "Crear"}
        </button>
      </div>

      {/* Borrar deja las tareas sin proyecto, no las borra (spec 2). Decirlo con el número
          delante es lo que hace que la confirmación sirva de algo — y el número que hay es el
          de pendientes, así que la frase lo dice: contar también las completadas daría una
          cifra mayor que la que se ve en la lista. */}
      {project &&
        (confirming ? (
          <div className="editor__confirm">
            <p className="editor__confirm-text">
              {pendingCount === 0
                ? `Se elimina «${project.name}». Sus tareas se quedan sin proyecto.`
                : `Se elimina «${project.name}». Sus ${pendingCount} tarea${
                    pendingCount === 1 ? "" : "s"
                  } pendiente${pendingCount === 1 ? "" : "s"} se quedan sin proyecto.`}
            </p>
            <div className="editor__actions">
              <button
                type="button"
                className="editor__button"
                onClick={() => setConfirming(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="editor__button editor__button--danger"
                onClick={() => void onDelete()}
              >
                Eliminar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="editor__destroy"
            onClick={() => setConfirming(true)}
          >
            Eliminar proyecto
          </button>
        ))}
    </form>
  );
}
