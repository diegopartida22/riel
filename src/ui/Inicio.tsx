import { useMemo, useRef, useState } from "react";

import type { Between, Project, ViewCounts } from "../data";
import { tint } from "../design/palette";
import { SYSTEM_VIEWS, type SystemKind, type View } from "../state/views";
import { ChevronRight, Ellipsis, Plus, Terminal } from "./icons";
import { initialOf, SYSTEM_COLORS, SYSTEM_ICONS } from "./listas";
import { ProjectMenu } from "./ProjectMenu";
import { useReorder } from "./useReorder";

export interface InicioProps {
  projects: Project[];
  /** Pendientes por proyecto. */
  counts: Map<string | null, number>;
  /** Lo que enseña cada mosaico. */
  viewCounts: ViewCounts;
  onSelect: (view: View) => void;
  onSessions: () => void;
  onNewProject: () => void;
  onEditProject: (project: Project) => void;
  onReorder: (id: string, between: Between) => void;
}

/**
 * La pantalla de listas: lo que se ve al abrir el panel (spec 3.4).
 *
 * Sustituye al riel. El riel era una columna de 44px que reconocía los proyectos solo por su
 * color, y cobraba ese carácter en el ancho de todo lo demás: con él expandido, a la lista le
 * quedaban 260px y los títulos se cortaban a media frase. Aquí las listas tienen la pantalla
 * entera para ellas, y entrar en una le da la pantalla entera a sus tareas. Es la forma de
 * Recordatorios y de Notas, y la de casi cualquier cosa que el sistema enseñe en un sitio
 * estrecho: se elige primero, se lee después.
 *
 * Arriba los cuatro mosaicos del sistema, con el conteo grande, porque lo primero que se quiere
 * saber al abrir es cuánto hay. Debajo los proyectos, cada uno con su inicial sobre su color —
 * un disco sin letra se distinguía de sus vecinos pero no decía cuál era — y la sesión de Claude
 * al final, aparte, porque no es una lista de tareas.
 */
export function Inicio({
  projects,
  counts,
  viewCounts,
  onSelect,
  onSessions,
  onNewProject,
  onEditProject,
  onReorder,
}: InicioProps) {
  const groups = useMemo(() => [projects.map((project) => project.id)], [projects]);
  const drag = useReorder(groups, onReorder);
  const [menu, setMenu] = useState<{ project: Project; anchor: DOMRect } | null>(null);
  const list = useRef<HTMLUListElement>(null);

  /** Un puesto arriba o abajo, dicho como los dos vecinos entre los que cae. */
  const shift = (index: number, delta: -1 | 1) => {
    const at = index + delta;
    const [after, before] = delta < 0 ? [projects[at - 1], projects[at]] : [projects[at], projects[at + 1]];
    onReorder(projects[index].id, { after: after?.id ?? null, before: before?.id ?? null });
    setMenu(null);
  };

  /**
   * ↑↓ entre los proyectos, como en cualquier lista del sistema. Los mosaicos no entran: son
   * cuatro y están a la vista, y ⌘1..4 llega a ellos sin pasar por aquí.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>(".lists__row") ?? []);
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = rows[at + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <div className="inicio view">
      <div className="tiles">
        {SYSTEM_VIEWS.map(({ kind, label }) => (
          <Tile
            key={kind}
            kind={kind}
            label={label}
            count={viewCounts[kind]}
            overdue={kind === "hoy" ? viewCounts.vencidas : 0}
            onSelect={() => onSelect({ kind })}
          />
        ))}
      </div>

      <h2 className="lists__title">Mis proyectos</h2>

      <div className="lists">
        <ul
          ref={list}
          className={`lists__group${drag.dragging ? " is-sorting" : ""}`}
          onKeyDown={onKeyDown}
        >
          {projects.map((project) => {
            const pending = counts.get(project.id) ?? 0;
            return (
              <li
                key={project.id}
                ref={drag.register(project.id)}
                className={`lists__slot tinted${drag.dragging === project.id ? " is-flying" : ""}`}
                style={{
                  ...tint(project.color),
                  ...(drag.offsetOf(project.id)
                    ? { transform: `translateY(${drag.offsetOf(project.id)}px)` }
                    : null),
                }}
              >
                {/* La fila entera es el botón y también la manija: el umbral de 3px de
                    `useReorder` deja convivir el arrastre con el clic que entra, y el clic que
                    llega al soltar un arrastre se lo traga el propio gesto. */}
                <button
                  type="button"
                  className="lists__row"
                  title={tooltipFor(project.name, pending)}
                  onClick={() => onSelect({ kind: "proyecto", id: project.id })}
                  onDoubleClick={() => onEditProject(project)}
                  onPointerDown={(event) => drag.grab(event, project.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ project, anchor: pointAt(event) });
                  }}
                >
                  <span className="lists__badge" aria-hidden>
                    {initialOf(project.name)}
                  </span>
                  <span className="lists__name">{project.name}</span>
                  {/* Fuera del árbol de accesibilidad: el `title` lo dice con todas sus letras,
                      y un «3» suelto pegado al nombre sería el mismo dato dos veces. */}
                  {pending > 0 && (
                    <span className="lists__count" aria-hidden>
                      {pending > 999 ? "999+" : pending}
                    </span>
                  )}
                  <ChevronRight size={11} className="lists__chevron" aria-hidden />
                </button>

                <button
                  type="button"
                  className={`lists__tool${menu?.project.id === project.id ? " is-open" : ""}`}
                  data-menu-trigger
                  aria-label={`Opciones de ${project.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menu?.project.id === project.id}
                  onClick={(event) => {
                    const anchor = event.currentTarget.getBoundingClientRect();
                    setMenu((open) => (open?.project.id === project.id ? null : { project, anchor }));
                  }}
                >
                  <Ellipsis size={14} aria-hidden />
                </button>
              </li>
            );
          })}

          <li className="lists__slot">
            <button type="button" className="lists__row lists__row--new" onClick={onNewProject}>
              <span className="lists__badge lists__badge--new" aria-hidden>
                <Plus size={12} />
              </span>
              <span className="lists__name">Nuevo proyecto</span>
            </button>
          </li>
        </ul>
      </div>

      {/* Aparte y en su propio grupo, porque no es una lista de tareas (spec 17.6): ni se
          completa nada ahí ni entra nada desde la captura. */}
      <div className="lists lists--apart">
        <button type="button" className="lists__row" onClick={onSessions}>
          <span className="lists__badge lists__badge--claude" aria-hidden>
            <Terminal size={12} />
          </span>
          <span className="lists__name">Sesiones de Claude</span>
          <ChevronRight size={11} className="lists__chevron" aria-hidden />
        </button>
      </div>

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
    </div>
  );
}

/**
 * Un mosaico del sistema: el glifo sobre su color, el conteo grande y el nombre.
 *
 * El conteo es lo que se lee desde lejos y por eso es lo más grande de la pantalla. Hoy dice
 * además cuántas de esas ya vencieron, en rojo y pegadas al nombre: es la única cifra del
 * mosaico que pide hacer algo, y escondida dentro del total no se distinguiría de un día normal.
 */
function Tile({
  kind,
  label,
  count,
  overdue,
  onSelect,
}: {
  kind: SystemKind;
  label: string;
  count: number;
  overdue: number;
  onSelect: () => void;
}) {
  const Icon = SYSTEM_ICONS[kind];
  const color = SYSTEM_COLORS[kind];
  return (
    <button
      type="button"
      className={`tile${color ? " tinted" : " tile--app"}`}
      style={color ? tint(color) : undefined}
      aria-label={`${label}: ${count}${overdue ? `, ${overdue} vencida${overdue === 1 ? "" : "s"}` : ""}`}
      onClick={onSelect}
    >
      <span className="tile__icon" aria-hidden>
        <Icon size={14} />
      </span>
      {/* Completadas no lleva cifra: es un archivo que solo crece, y un número que sube cada
          vez que se cumple algo se leería como algo pendiente. */}
      {kind !== "completadas" && (
        <span className="tile__count" aria-hidden>
          {count}
        </span>
      )}
      <span className="tile__label" aria-hidden>
        {label}
        {overdue > 0 && <span className="tile__overdue">{overdue} vencida{overdue === 1 ? "" : "s"}</span>}
      </span>
    </button>
  );
}

/** «Infra — 3 pendientes», y en singular cuando toca. */
function tooltipFor(name: string, pending: number): string {
  if (pending === 0) return `${name} — sin pendientes`;
  return `${name} — ${pending} pendiente${pending === 1 ? "" : "s"}`;
}

/** El menú del clic derecho sale del puntero, que es de donde salen los menús contextuales. */
function pointAt(event: React.MouseEvent): DOMRect {
  return new DOMRect(event.clientX, event.clientY, 0, 0);
}
