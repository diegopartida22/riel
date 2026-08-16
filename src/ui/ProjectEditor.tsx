import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useState, type FormEvent } from "react";

import type { Project } from "../data";
import { PALETTE, tint } from "../design/palette";
import { shortPath } from "../state/editors";
import { ColorPicker } from "./ColorPicker";
import { Folder, X } from "./icons";

export interface ProjectEditorProps {
  /** Nulo para uno nuevo. */
  project: Project | null;
  /** Cuántas tareas se quedarían sin proyecto al borrarlo. */
  pendingCount: number;
  onSave: (name: string, color: string, folder: string | null) => Promise<boolean>;
  onDelete: () => Promise<void>;
  /** Abre el panel del sistema para elegir carpeta. Nulo si se cerró sin elegir (spec 13). */
  onPickFolder: () => Promise<string | null>;
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
  onPickFolder,
  onClose,
}: ProjectEditorProps) {
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(project?.color ?? PALETTE[0].light);
  const [folder, setFolder] = useState(project?.folder ?? null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;

    setSaving(true);
    try {
      if (await onSave(name.trim(), color, folder)) onClose();
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

      {/* La carpeta (spec 13). Un renglón y no un campo de texto: una ruta no se teclea, se
          señala, y el panel del sistema es lo único que garantiza que la que quede guardada
          existe. Sin carpeta puesta el renglón invita a ponerla; con una puesta se lee, se
          abre en el Finder al pulsarla y se quita con la `✕`. */}
      <div className="editor__folder">
        {folder === null ? (
          <button
            type="button"
            className="editor__link"
            onClick={() => void onPickFolder().then((picked) => picked && setFolder(picked))}
          >
            <Folder size={13} aria-hidden />
            Vincular una carpeta
          </button>
        ) : (
          <>
            {/* La ruta entera en el `title`: lo que se ve va recortado por delante, y el
                principio comido es justo lo que hace falta para saber si es la de este
                proyecto o la de otro con el mismo nombre. */}
            <button
              type="button"
              className="editor__link editor__path"
              title={folder}
              onClick={() => void revealItemInDir(folder).catch((cause) => console.error(cause))}
            >
              <Folder size={13} aria-hidden />
              <span>{shortPath(folder)}</span>
            </button>
            <button
              type="button"
              className="editor__unlink"
              aria-label="Quitar la carpeta"
              onClick={() => setFolder(null)}
            >
              <X size={12} aria-hidden />
            </button>
          </>
        )}
      </div>

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
