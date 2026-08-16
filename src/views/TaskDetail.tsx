import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Priority, Project, Task, TaskPatch, TaskTree } from "../data";
import { tint } from "../design/palette";
import { Checkbox } from "../ui/Checkbox";
import { DueEditor } from "../ui/DueEditor";
import { ChevronLeft, Plus, X } from "../ui/icons";
import { RepeatEditor } from "../ui/RepeatEditor";
import { TitleEditor } from "../ui/TitleEditor";

export interface TaskDetailProps {
  task: TaskTree;
  project: Project | null;
  projects: Project[];
  today: string;
  onPatch: (patch: TaskPatch) => void;
  onToggle: (task: Task, checked: boolean) => void;
  onDelete: () => void;
  /** Crea una subtarea colgando de esta tarea. */
  onAddSubtask: (title: string) => Promise<boolean>;
  /** Borra una subtarea. Es reponible con ⌘Z, como cualquier otro borrado. */
  onRemoveSubtask: (id: string) => void;
  onClose: () => void;
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 0, label: "Baja" },
  { value: 1, label: "Media" },
  { value: 2, label: "Alta" },
];

/**
 * El detalle de una tarea. Ocupa el área de contenido, igual que el editor de proyecto: en un
 * panel de 440px no hay sitio para una capa sobre otra, y el velo que haría falta para
 * separarlas apagaría el vidrio.
 *
 * Existe por una razón concreta: en la lista el título y la nota van a una línea con elipsis
 * —es lo que mantiene el ritmo vertical y lo que permite trazar el tachado de un extremo a
 * otro— así que tiene que haber un sitio donde el texto se lea entero. Aquí ni el título ni
 * la nota se cortan: crecen hasta donde haga falta y el panel desplaza.
 *
 * Y es donde se cambia todo lo que la captura pone de una pasada — proyecto, prioridad y
 * fecha. Escribir «Renovar dominio mañana 10:00 #infra !!» sigue siendo el camino rápido; este
 * es el que hace falta cuando la tarea ya existe y lo que cambió es el plazo.
 */
export function TaskDetail({
  task,
  project,
  projects,
  today,
  onPatch,
  onToggle,
  onDelete,
  onAddSubtask,
  onRemoveSubtask,
  onClose,
}: TaskDetailProps) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [confirming, setConfirming] = useState(false);
  /** Cierto mientras se escribe una subtarea nueva. */
  const [adding, setAdding] = useState(false);

  // Al saltar de una tarea a otra sin desmontar, los campos tienen que traer lo nuevo.
  useEffect(() => {
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setConfirming(false);
    setAdding(false);
  }, [task.id, task.title, task.notes]);

  const commitTitle = () => {
    const clean = title.trim();
    // Un título vacío no es una tarea. Se repone el que había en vez de guardar la nada.
    if (!clean) return setTitle(task.title);
    if (clean !== task.title) onPatch({ title: clean });
  };

  const commitNotes = () => {
    const clean = notes.trim();
    if (clean !== (task.notes ?? "")) onPatch({ notes: clean || null });
  };

  return (
    <div className="detail tinted" style={tint(project?.color)}>
      <button type="button" className="detail__back" onClick={onClose}>
        <ChevronLeft size={14} aria-hidden />
        Volver
      </button>

      <div className="detail__head">
        <Checkbox
          checked={task.completedAt !== null}
          label={task.title}
          onChange={(checked) => onToggle(task, checked)}
        />
        <Grow
          className={`detail__title${task.completedAt ? " is-completed" : ""}`}
          value={title}
          placeholder="Título"
          aria-label="Título de la tarea"
          onChange={setTitle}
          onBlur={commitTitle}
        />
      </div>

      <Grow
        className="detail__notes"
        value={notes}
        placeholder="Notas"
        aria-label="Notas de la tarea"
        onChange={setNotes}
        onBlur={commitNotes}
      />

      <Field label="Proyecto">
        <div className="chips">
          <Chip selected={!task.projectId} onClick={() => onPatch({ projectId: null })}>
            Sin proyecto
          </Chip>
          {projects.map((each) => (
            <Chip
              key={each.id}
              selected={task.projectId === each.id}
              color={each.color}
              onClick={() => onPatch({ projectId: each.id })}
            >
              {each.name}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="Prioridad">
        <div className="chips">
          {PRIORITIES.map(({ value, label }) => (
            <Chip
              key={value}
              selected={task.priority === value}
              onClick={() => onPatch({ priority: value })}
            >
              {label}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="Fecha">
        <DueEditor
          dueAt={task.dueAt}
          hasTime={task.hasTime}
          today={today}
          onChange={(dueAt, hasTime) => onPatch({ dueAt, hasTime })}
        />
      </Field>

      {/* Pegada a la fecha porque es la fecha lo que mueve: una repetición no es un atributo de
          la tarea, es la regla con la que su día vuelve a ponerse solo. Separarlas —debajo de
          las subtareas, por ejemplo— dejaría el «cada mes el 17» a media pantalla del 17.

          Solo en las raíces: una subtarea no tiene detalle propio, y la vuelta siguiente se
          lleva las hijas enteras. */}
      {task.parentId === null && (
        <Field label="Repetición">
          <RepeatEditor
            dueAt={task.dueAt}
            repeat={task.repeat}
            repeatFrom={task.repeatFrom}
            onChange={(repeat) => onPatch({ repeat })}
            onFromChange={(repeatFrom) => onPatch({ repeatFrom })}
          />
        </Field>
      )}

      {/* Este es el único sitio donde nace una subtarea. En la lista no cabe —una fila ya tiene
          su casilla, su fecha y sus dos herramientas— y el campo de captura no las parsea: un
          `#proyecto` puede estar o no, pero una hija sin madre no existe, y la madre es
          justamente lo que la captura no sabe a cuál te refieres. Aquí no hay duda. */}
      <Field label={subtasksLabel(task.subtasks)}>
        {task.subtasks.length > 0 && (
          <ul className="detail__subtasks">
            {task.subtasks.map((subtask) => (
              <li key={subtask.id} className={subtask.completedAt ? "is-completed" : undefined}>
                <Checkbox
                  checked={subtask.completedAt !== null}
                  label={subtask.title}
                  onChange={(checked) => onToggle(subtask, checked)}
                />
                <span className="task-row__title">{subtask.title}</span>
                {/* Sin el paso de confirmación que sí lleva borrar la tarea entera: una
                    subtarea es un renglón, se repone con ⌘Z y el botón no está en reposo —
                    aparece al pasar por encima, como las herramientas de la fila. */}
                <button
                  type="button"
                  className="detail__drop"
                  aria-label={`Eliminar «${subtask.title}»`}
                  onClick={() => onRemoveSubtask(subtask.id)}
                >
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {adding ? (
          <div className="detail__new">
            <span className="task-row__ghost" aria-hidden />
            <TitleEditor
              placeholder="Nueva subtarea"
              // ⌘⏎ deja el campo abierto para la siguiente, igual que en la lista: las
              // subtareas se escriben de tres en tres o no se escriben.
              onSave={(text, andAnother) => {
                void onAddSubtask(text).then((saved) => setAdding(andAnother && saved));
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        ) : (
          <button type="button" className="detail__add" onClick={() => setAdding(true)}>
            <Plus size={12} aria-hidden />
            Agregar subtarea
          </button>
        )}
      </Field>

      {confirming ? (
        <div className="editor__confirm">
          <p className="editor__confirm-text">
            {task.subtasks.length === 0
              ? `Se elimina «${task.title}».`
              : `Se elimina «${task.title}» y sus ${task.subtasks.length} subtarea${
                  task.subtasks.length === 1 ? "" : "s"
                }.`}
          </p>
          <div className="editor__actions">
            <button type="button" className="editor__button" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="editor__button editor__button--danger"
              onClick={onDelete}
            >
              Eliminar
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="editor__destroy" onClick={() => setConfirming(true)}>
          Eliminar tarea
        </button>
      )}
    </div>
  );
}

/**
 * «Subtareas», y con alguna puesta el conteo de las que quedan. El conteo solo aparece cuando
 * hay algo que contar: «Subtareas · 0 pendientes» sobre una lista vacía dice dos veces lo
 * mismo, y encima con un número.
 *
 * Con todas terminadas tampoco se cuenta. Aquí las completadas se quedan a la vista —esta es
 * la hoja de la tarea, no la lista de lo que falta—, así que «0 pendientes» sería contar
 * hacia atrás para decir algo que se lee de un vistazo en los propios renglones tachados.
 */
function subtasksLabel(subtasks: Task[]): string {
  const pending = subtasks.filter((subtask) => !subtask.completedAt).length;
  if (!subtasks.length) return "Subtareas";
  if (!pending) return "Subtareas · completadas";
  return `Subtareas · ${pending} pendiente${pending === 1 ? "" : "s"}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detail__field">
      <span className="detail__label">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  selected,
  color,
  onClick,
  children,
}: {
  selected: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`chip${color ? " tinted" : ""}${selected ? " is-selected" : ""}`}
      style={color ? tint(color) : undefined}
      aria-pressed={selected}
      onClick={onClick}
    >
      {color && <span className="chip__dot" />}
      {children}
    </button>
  );
}

/**
 * Un `textarea` que crece con su contenido. Es lo que permite que un párrafo entero se lea sin
 * una barra de desplazamiento propia dentro de un panel que ya desplaza.
 *
 * El alto se pone a `auto` antes de leer `scrollHeight`: si no, al borrar texto la caja nunca
 * encogería, porque `scrollHeight` no baja del alto que ya tiene puesto.
 */
function Grow({
  className,
  value,
  placeholder,
  onChange,
  onBlur,
  ...rest
}: {
  className: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBlur: () => void;
} & React.AriaAttributes) {
  const box = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={box}
      className={className}
      value={value}
      placeholder={placeholder}
      rows={1}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      {...rest}
    />
  );
}
