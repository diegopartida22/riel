/**
 * El menú de comandos del campo de captura (spec 18).
 *
 * Lo que hace es **escribir la gramática que ya existe**, no una segunda. Cada renglón enseña
 * a su derecha el literal que va a insertar —«Alta … !!», «Infra … @Infra»— porque lo que se
 * gana con esto no es una forma nueva de poner una fecha, es enterarse de que la de siempre
 * está ahí. Quien lo use veinte veces acaba escribiendo `!!` directamente, y entonces el menú
 * ya hizo su trabajo. Es el mismo argumento por el que el spec 14 se niega a que `riel://`
 * tenga un parámetro por campo: una segunda gramática es otra cosa que mantener, y la que la
 * persona ya se sabe es la de la app.
 */

import type { Project } from "../data";
import { fold } from "./capture";

export type CommandGroup = "cuando" | "prioridad" | "proyecto" | "repite" | "notas";

/** Los rótulos de grupo, en el mismo tratamiento que los de la lista (spec 3.3). */
export const GROUP_LABEL: Record<CommandGroup, string> = {
  cuando: "Cuándo",
  prioridad: "Prioridad",
  proyecto: "Proyecto",
  repite: "Repite",
  notas: "Notas",
};

const GROUP_ORDER: CommandGroup[] = ["cuando", "prioridad", "proyecto", "repite", "notas"];

export interface Command {
  id: string;
  group: CommandGroup;
  /** Lo que se lee a la izquierda. */
  label: string;
  /** El literal que se escribe en el campo. Vacío cuando el comando no escribe nada. */
  insert: string;
  /** Solo en los de proyecto: el disco. */
  color?: string;
  /** Lo que hace además de escribir. */
  action?: "notas";
  /**
   * Fuera de la lista sin filtrar, pero encontrable escribiendo.
   *
   * Solo los días de la semana lejanos. Los siete seguidos son siete renglones que dicen lo
   * mismo, y sin filtro se comían la primera pantalla entera: quien abre la barra sin escribir
   * nada está preguntando qué se puede poner, y la respuesta no puede ser «fechas» siete veces
   * mientras la prioridad y los proyectos quedan bajo el pliegue. Es el mismo argumento con el
   * que un proyecto sin pendientes no enseña un cero (§3.4).
   */
  oculto?: boolean;
}

/** Empezando en domingo, que es como numera los días `Date.getDay()`. */
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Cuántos días de la semana salen sin haber escrito nada. */
const DIAS_A_LA_VISTA = 3;

const capital = (word: string) => word[0].toUpperCase() + word.slice(1);

/**
 * Los siete días, del más cercano al más lejano.
 *
 * Empieza en pasado mañana y no mañana: un día de la semana significa su próxima vez, así que
 * el de mañana es «Mañana» dicho de otra forma y ya tiene su renglón. Ordenados por cercanía
 * y no de lunes a domingo, porque lo que se elige de una lista de fechas es la más próxima.
 */
function diasDesde(today: string): string[] {
  const base = new Date(`${today}T00:00:00`);
  const primero = Number.isNaN(base.getTime()) ? 1 : (base.getDay() + 2) % 7;
  return Array.from({ length: 7 }, (_, step) => DIAS[(primero + step) % 7]);
}

/**
 * Todos los comandos, en el orden en que se leen.
 *
 * `notas` solo existe donde hay sitio para escribirlas — la ventana de captura rápida. En el
 * campo del pie del panel, un comando que abre un campo que no cabe sería un renglón que
 * promete algo que no está.
 */
export function commandsFor(projects: Project[], notes: boolean, today: string): Command[] {
  const out: Command[] = [
    { id: "hoy", group: "cuando", label: "Hoy", insert: "hoy" },
    { id: "manana", group: "cuando", label: "Mañana", insert: "mañana" },
    ...diasDesde(today).map((day, index) => ({
      id: `dia:${day}`,
      group: "cuando" as const,
      label: capital(day),
      insert: day,
      oculto: index >= DIAS_A_LA_VISTA,
    })),
    { id: "alta", group: "prioridad", label: "Alta", insert: "!!" },
    { id: "media", group: "prioridad", label: "Media", insert: "!" },
    ...projects.map((project) => ({
      id: `proyecto:${project.id}`,
      group: "proyecto" as const,
      label: project.name,
      insert: `@${project.name}`,
      color: project.color,
    })),
    { id: "cada-dia", group: "repite", label: "Cada día", insert: "cada día" },
    { id: "cada-semana", group: "repite", label: "Cada semana", insert: "cada semana" },
    { id: "cada-mes", group: "repite", label: "Cada mes", insert: "cada mes" },
    { id: "cada-ano", group: "repite", label: "Cada año", insert: "cada año" },
  ];

  if (notes) {
    out.push({ id: "notas", group: "notas", label: "Agregar notas", insert: "", action: "notas" });
  }

  return out;
}

/**
 * Los comandos que casan con lo escrito tras la barra.
 *
 * Por prefijo y por palabra, no difuso: `/ma` da «Mañana» y «Martes», y eso se puede predecir
 * de memoria. La búsqueda de tareas (spec 5) sí es difusa porque ahí lo que se busca puede
 * estar escrito de cualquier forma; aquí lo que hay son veinte renglones que uno mismo acaba
 * de ver, y un menú que reordena por parecido se vuelve imposible de aprender.
 */
export function filterCommands(commands: Command[], fragment: string): Command[] {
  const needle = fold(fragment.trim());
  if (!needle) return commands.filter((command) => !command.oculto);

  const matches = commands.filter((command) => {
    const label = fold(command.label);
    if (label.startsWith(needle)) return true;
    if (label.split(/\s+/).some((word) => word.startsWith(needle))) return true;
    // «/!!» tiene que encontrar «Alta»: lo que se recuerda a veces es el literal.
    return fold(command.insert).startsWith(needle);
  });

  return matches.sort(
    (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
  );
}
