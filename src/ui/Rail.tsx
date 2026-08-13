import { CalendarDays, CheckCheck, List, Plus, Sun, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Project } from "../data";
import { tint } from "../design/palette";
import { SYSTEM_VIEWS, sameView, type SystemKind, type View } from "../state/views";

/** Un icono de Lucide por vista del sistema, para cuando el riel está colapsado (spec 3.4). */
const ICONS: Record<SystemKind, LucideIcon> = {
  hoy: Sun,
  proximas: CalendarDays,
  todas: List,
  completadas: CheckCheck,
};

export interface RailProps {
  view: View;
  projects: Project[];
  counts: Map<string | null, number>;
  expanded: boolean;
  onSelect: (view: View) => void;
  onNewProject: () => void;
  onEditProject: (project: Project) => void;
}

/**
 * El riel: la columna de la izquierda. Colapsado son discos de color y nada más — un proyecto
 * se reconoce por su color, que es lo que le da carácter a la app. Expandido añade los
 * nombres.
 *
 * El tooltip es el `title` de siempre, o sea el nativo del sistema: el spec lo pide así, y uno
 * dibujado en HTML se saldría del panel, que no tiene por dónde desbordarse.
 *
 * Para editar un proyecto: clic derecho o doble clic sobre él. Es lo que hacen las barras
 * laterales de Finder, Mail y Notas, y es lo único que no le añade cromo al riel colapsado,
 * que existe precisamente para no tener ninguno.
 */
export function Rail({
  view,
  projects,
  counts,
  expanded,
  onSelect,
  onNewProject,
  onEditProject,
}: RailProps) {
  return (
    <nav className="rail" aria-label="Vistas y proyectos">
      <ul className="rail__group">
        {SYSTEM_VIEWS.map(({ kind, label }) => {
          const Icon = ICONS[kind];
          return (
            <RailItem
              key={kind}
              label={label}
              tooltip={expanded ? undefined : label}
              selected={sameView(view, { kind })}
              onSelect={() => onSelect({ kind })}
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden />
            </RailItem>
          );
        })}
      </ul>

      <div className="rail__rule" role="presentation" />

      <ul className="rail__group rail__group--projects">
        {projects.map((project) => (
          <RailItem
            key={project.id}
            label={project.name}
            tooltip={expanded ? undefined : tooltipFor(project.name, counts.get(project.id) ?? 0)}
            selected={sameView(view, { kind: "proyecto", id: project.id })}
            tinted={project.color}
            onSelect={() => onSelect({ kind: "proyecto", id: project.id })}
            onEdit={() => onEditProject(project)}
          >
            <span className="rail__dot" />
          </RailItem>
        ))}
      </ul>

      <button
        type="button"
        className="rail__item rail__item--quiet"
        title={expanded ? undefined : "Nuevo proyecto"}
        onClick={onNewProject}
      >
        <span className="rail__mark">
          <Plus size={15} strokeWidth={1.75} aria-hidden />
        </span>
        <span className="rail__label">Nuevo proyecto</span>
      </button>
    </nav>
  );
}

/** «Infra — 3 pendientes», y en singular cuando toca. */
function tooltipFor(name: string, pending: number): string {
  if (pending === 0) return `${name} — sin pendientes`;
  return `${name} — ${pending} pendiente${pending === 1 ? "" : "s"}`;
}

interface RailItemProps {
  label: string;
  tooltip?: string;
  selected: boolean;
  /** Hex del proyecto: pinta el disco y, si está seleccionado, el acento de la fila. */
  tinted?: string;
  onSelect: () => void;
  onEdit?: () => void;
  children: ReactNode;
}

function RailItem({
  label,
  tooltip,
  selected,
  tinted,
  onSelect,
  onEdit,
  children,
}: RailItemProps) {
  return (
    <li>
      <button
        type="button"
        className={`rail__item${selected ? " is-selected" : ""}${tinted ? " tinted" : ""}`}
        style={tinted ? tint(tinted) : undefined}
        title={tooltip}
        aria-current={selected ? "page" : undefined}
        onClick={onSelect}
        onDoubleClick={onEdit}
        onContextMenu={
          onEdit &&
          ((event) => {
            event.preventDefault();
            onEdit();
          })
        }
      >
        <span className="rail__mark">{children}</span>
        <span className="rail__label">{label}</span>
      </button>
    </li>
  );
}
