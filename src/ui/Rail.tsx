import { useMemo, useState, type ReactNode } from "react";

import type { Between, Project } from "../data";
import { tint } from "../design/palette";
import { SYSTEM_VIEWS, sameView, type SystemKind, type View } from "../state/views";
import { CalendarDays, CheckCircle, Ellipsis, List, Plus, Sun, type Icon } from "./icons";
import { ProjectMenu } from "./ProjectMenu";
import { useReorder } from "./useReorder";

/** Un icono por vista del sistema, para cuando el riel está colapsado (spec 3.4). */
const ICONS: Record<SystemKind, Icon> = {
  hoy: Sun,
  proximas: CalendarDays,
  todas: List,
  completadas: CheckCircle,
};

export interface RailProps {
  view: View;
  projects: Project[];
  counts: Map<string | null, number>;
  expanded: boolean;
  onSelect: (view: View) => void;
  onNewProject: () => void;
  onEditProject: (project: Project) => void;
  onReorder: (id: string, between: Between) => void;
}

/**
 * El riel: la columna de la izquierda. Colapsado son discos de color y nada más — un proyecto
 * se reconoce por su color, que es lo que le da carácter a la app. Expandido añade los
 * nombres.
 *
 * El tooltip es el `title` de siempre, o sea el nativo del sistema: el spec lo pide así, y uno
 * dibujado en HTML se saldría del panel, que no tiene por dónde desbordarse.
 *
 * El proyecto se reordena arrastrando el disco: la manija aparte que asoma al hover en una
 * fila de tarea aquí no cabe — en 44px de ancho taparía justo el disco, que es lo único que
 * hay. El umbral de 3px de `useReorder` es lo que deja convivir el arrastre con el clic que
 * selecciona.
 *
 * Expandido, cada proyecto lleva además un `⋯` con lo mismo por escrito. Sin él, editar un
 * proyecto solo se podía con clic derecho o doble clic, y reordenarlo solo arrastrando: tres
 * gestos que funcionan pero que no se ven, así que para quien no los conoce el riel no tenía
 * ninguna de las dos cosas. Colapsado no está, porque ahí no hay dónde ponerlo sin romper la
 * columna de discos; los gestos siguen valiendo en los dos estados.
 */
export function Rail({
  view,
  projects,
  counts,
  expanded,
  onSelect,
  onNewProject,
  onEditProject,
  onReorder,
}: RailProps) {
  // Un solo grupo: los proyectos. Las vistas del sistema son fijas y no entran.
  const groups = useMemo(() => [projects.map((project) => project.id)], [projects]);
  const drag = useReorder(groups, onReorder);
  const [menu, setMenu] = useState<{ project: Project; anchor: DOMRect } | null>(null);

  /** Un puesto arriba o abajo, dicho como los dos vecinos entre los que cae. */
  const shift = (index: number, delta: -1 | 1) => {
    const at = index + delta;
    const [after, before] = delta < 0 ? [projects[at - 1], projects[at]] : [projects[at], projects[at + 1]];
    onReorder(projects[index].id, { after: after?.id ?? null, before: before?.id ?? null });
    setMenu(null);
  };

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
              <Icon size={15} aria-hidden />
            </RailItem>
          );
        })}
      </ul>

      <div className="rail__rule" role="presentation" />

      <ul className={`rail__group rail__group--projects${drag.dragging ? " is-sorting" : ""}`}>
        {projects.map((project) => (
          <RailItem
            key={project.id}
            label={project.name}
            tooltip={expanded ? undefined : tooltipFor(project.name, counts.get(project.id) ?? 0)}
            selected={sameView(view, { kind: "proyecto", id: project.id })}
            tinted={project.color}
            onSelect={() => onSelect({ kind: "proyecto", id: project.id })}
            onEdit={() => onEditProject(project)}
            nodeRef={drag.register(project.id)}
            offset={drag.offsetOf(project.id)}
            flying={drag.dragging === project.id}
            onGrab={(event) => drag.grab(event, project.id)}
            onMenu={
              expanded
                ? (anchor) =>
                    setMenu((open) => (open?.project.id === project.id ? null : { project, anchor }))
                : undefined
            }
            menuOpen={menu?.project.id === project.id}
            menuLabel={`Opciones de ${project.name}`}
          >
            <span className="rail__dot" />
          </RailItem>
        ))}
      </ul>

      {menu && (
        <ProjectMenu
          project={menu.project}
          anchor={menu.anchor}
          canRaise={projects[0]?.id !== menu.project.id}
          canLower={projects[projects.length - 1]?.id !== menu.project.id}
          onEdit={() => {
            onEditProject(menu.project);
            setMenu(null);
          }}
          onRaise={() => shift(projects.findIndex((each) => each.id === menu.project.id), -1)}
          onLower={() => shift(projects.findIndex((each) => each.id === menu.project.id), 1)}
          onClose={() => setMenu(null)}
        />
      )}

      <button
        type="button"
        className="rail__item rail__item--quiet"
        title={expanded ? undefined : "Nuevo proyecto"}
        onClick={onNewProject}
      >
        <span className="rail__mark">
          <Plus size={15} aria-hidden />
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
  nodeRef?: (node: HTMLElement | null) => void;
  offset?: number;
  flying?: boolean;
  /**
   * El propio botón es la manija. Conviven porque `useReorder` no considera que haya arrastre
   * hasta los 3px: un clic quieto llega entero a `onClick`, y el derecho ni se toca —`grab` se
   * sale antes de tocar el evento si el botón no es el izquierdo, así que el menú de edición
   * sigue abriéndose—.
   */
  onGrab?: (event: React.PointerEvent<HTMLElement>) => void;
  /** Solo en el riel expandido, y solo para proyectos: las vistas del sistema no tienen qué. */
  onMenu?: (anchor: DOMRect) => void;
  menuOpen?: boolean;
  menuLabel?: string;
  children: ReactNode;
}

function RailItem({
  label,
  tooltip,
  selected,
  tinted,
  onSelect,
  onEdit,
  nodeRef,
  offset,
  flying,
  onGrab,
  onMenu,
  menuOpen,
  menuLabel,
  children,
}: RailItemProps) {
  return (
    <li
      ref={nodeRef}
      className={`rail__slot${flying ? " is-flying" : ""}`}
      style={offset ? { transform: `translateY(${offset}px)` } : undefined}
    >
      <button
        type="button"
        className={`rail__item${selected ? " is-selected" : ""}${tinted ? " tinted" : ""}`}
        style={tinted ? tint(tinted) : undefined}
        title={tooltip}
        aria-current={selected ? "page" : undefined}
        onClick={onSelect}
        onDoubleClick={onEdit}
        onPointerDown={onGrab}
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

      {/* Hermano del botón y no hijo suyo: un botón dentro de otro no es HTML válido. Va
          encima del hueco que el propio `.rail__item` reserva a su derecha, que se reserva
          siempre y no al pasar el puntero — si apareciera solo al hover, el nombre se
          recortaría de golpe justo cuando lo estás mirando. */}
      {onMenu && (
        <button
          type="button"
          className={`rail__tool${menuOpen ? " is-open" : ""}`}
          data-menu-trigger
          aria-label={menuLabel}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => onMenu(event.currentTarget.getBoundingClientRect())}
        >
          <Ellipsis size={14} aria-hidden />
        </button>
      )}
    </li>
  );
}
