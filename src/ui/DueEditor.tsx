import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";

import { dayOf, localDay, nextDay } from "../data";
import { formatDueLong } from "./dueDate";
import { ChevronLeft, ChevronRight, X } from "./icons";

export interface DueEditorProps {
  dueAt: string | null;
  hasTime: boolean;
  /** El día local de la app, el mismo con el que la lista decidió qué es hoy. */
  today: string;
  /** `null` borra la fecha. La hora viaja aparte: `due_at` la lleva igual sin usarla. */
  onChange: (dueAt: string | null, hasTime: boolean) => void;
}

/** Lunes primero, que es como se lee un calendario en español. */
const SEMANA = ["lu", "ma", "mi", "ju", "vi", "sá", "do"];

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const pad = (value: number) => String(value).padStart(2, "0");

const parseDay = (day: string): Date => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
};

/**
 * Sumar días pasando por `Date` y no por el número del día: a fin de mes el número se desborda,
 * y en marzo y octubre además hay días de 23 y 25 horas.
 */
function shiftDay(day: string, delta: number): string {
  const base = parseDay(day);
  return localDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta));
}

/**
 * El mismo día del mes vecino. Si no existe ahí —un 31 en un mes de 30— cae en el último, que
 * es lo que hace que avanzar y retroceder desde el 31 de enero no acabe en marzo.
 */
function shiftMonth(day: string, delta: number): string {
  const base = parseDay(day);
  const target = new Date(base.getFullYear(), base.getMonth() + delta, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return localDay(
    new Date(target.getFullYear(), target.getMonth(), Math.min(base.getDate(), last)),
  );
}

/**
 * Las seis semanas que se pintan, desde el lunes de la que abre el mes.
 *
 * Seis siempre, aunque el mes quepa en cinco. Un calendario que cambia de alto al pasar de mes
 * mueve todo lo que tiene debajo —la hora, el pie, el botón de eliminar— y el panel entero da
 * un salto por avanzar un mes.
 */
function monthGrid(year: number, month: number): string[] {
  // `getDay()` cuenta desde el domingo; aquí el domingo va al final de la semana.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => localDay(new Date(year, month, 1 - lead + index)));
}

/**
 * `14:30`, `1430` o `14.30`. Nada más: lo que no case se descarta y el campo vuelve a lo que
 * había. Adivinar qué quiso decir un «2 pm» a medio escribir acaba guardando una hora que
 * nadie escribió, y una hora equivocada es una notificación a deshora.
 */
function parseTime(text: string): string | null {
  const match = /^(\d{1,2})[:.]?(\d{2})$/.exec(text.trim().replace(/\s/g, ""));
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

/**
 * La fecha del detalle, ahora editable.
 *
 * Un `<input type="date">` habría costado tres líneas, pero trae el calendario de WebKit
 * entero: su propia tipografía, su propia rejilla y un desplegable que se dibuja fuera de la
 * ventana, o sea fuera del vidrio. Así que la rejilla es nuestra, con los mismos tokens que el
 * resto del panel.
 *
 * El camino de la captura («mañana 10:00») sigue siendo el rápido; este es el que faltaba para
 * mover una fecha ya puesta sin tener que reescribir la tarea entera.
 */
export function DueEditor({ dueAt, hasTime, today, onChange }: DueEditorProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);

  /**
   * Con el selector desplegado, perder el foco no cierra el panel (spec 4). No es por una
   * ventana del sistema —la rejilla es nuestra— sino por el gesto de mirar el calendario de la
   * barra a media elección: sin esto, comprobar en qué cae el jueves cierra el panel.
   */
  useEffect(() => {
    if (!open) return;
    void invoke("set_keep_open", { value: true }).catch((cause) => console.error(cause));
    return () => {
      void invoke("set_keep_open", { value: false }).catch((cause) => console.error(cause));
    };
  }, [open]);

  /**
   * Y se trae entero a la vista. El calendario se despliega dentro de la columna que ya
   * desplaza, así que abrirlo desde una fecha que quedaba cerca del pie enseñaba dos semanas y
   * dejaba fuera la hora y los atajos: no es que costaran de alcanzar, es que no se sabía que
   * estaban ahí.
   *
   * Después del hijo a propósito —los efectos de dentro corren antes—, para que el último
   * ajuste sea este y no el que hace el foco del día señalado, que solo se ocupa de sí mismo.
   */
  useEffect(() => {
    if (!open) return;
    box.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  // Un clic fuera lo cierra, como los menús. El disparador se excluye, o su propio clic
  // reabriría lo que este manejador acaba de cerrar y el botón nunca apagaría nada.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (box.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    // El foco vuelve al disparador: si se quedara en un botón que acaba de dejar de existir,
    // se iría al `body` y el recorrido de teclado empezaría otra vez desde arriba.
    trigger.current?.focus();
  }, []);

  return (
    <div className="due-editor">
      <button
        ref={trigger}
        type="button"
        className={`due-editor__trigger${dueAt ? "" : " is-empty"}`}
        aria-expanded={open}
        aria-label={
          dueAt ? `Cambiar la fecha: ${formatDueLong(dueAt, hasTime, today)}` : "Poner fecha"
        }
        onClick={() => setOpen((current) => !current)}
      >
        {dueAt ? formatDueLong(dueAt, hasTime, today) : "Sin fecha"}
      </button>

      {open && (
        <Calendar
          ref={box}
          dueAt={dueAt}
          hasTime={hasTime}
          today={today}
          onChange={onChange}
          onClose={close}
        />
      )}
    </div>
  );
}

function Calendar({
  ref,
  dueAt,
  hasTime,
  today,
  onChange,
  onClose,
}: DueEditorProps & { ref: Ref<HTMLDivElement>; onClose: () => void }) {
  const day = dueAt ? dayOf(dueAt) : null;
  const time = hasTime && dueAt ? dueAt.slice(11, 16) : null;

  /** Qué mes se ve y qué día lleva el foco. Son lo mismo: el mes es el del día señalado. */
  const [cursor, setCursor] = useState(day ?? today);
  const [text, setText] = useState(time ?? "");
  const grid = useRef<HTMLDivElement>(null);
  /** Se levanta al abrir y con cada flecha; es lo que decide si el foco sigue al cursor. */
  const chase = useRef(true);

  useEffect(() => setText(time ?? ""), [time]);

  useEffect(() => {
    if (!chase.current) return;
    chase.current = false;
    grid.current?.querySelector<HTMLElement>('button[tabindex="0"]')?.focus();
  }, [cursor]);

  const at = parseDay(cursor);
  const days = monthGrid(at.getFullYear(), at.getMonth());

  /**
   * Escribe la fecha entera de una vez. Elegir día conserva la hora puesta y poner hora
   * conserva el día: son dos controles sobre una sola columna, y el que se toca no puede
   * llevarse por delante lo que dice el otro.
   */
  const commit = (next: string | null, clock: string | null) => {
    if (next === null) return onChange(null, false);
    onChange(`${next}T${clock ?? "00:00"}:00`, clock !== null);
  };

  const pick = (chosen: string) => {
    setCursor(chosen);
    commit(chosen, time);
  };

  const walk = (to: string) => {
    chase.current = true;
    setCursor(to);
  };

  /**
   * La hora se guarda al salir del campo o con ⏎, no con cada tecla: a mitad de escribir
   * «14:30» hay un «14:3» que no parsea, y reescribir la tarea en cada pulsación pediría el
   * permiso de notificaciones antes de que la hora esté completa.
   */
  const commitTime = () => {
    const clean = text.trim();
    if (!clean) {
      if (time !== null) commit(day ?? today, null);
      return;
    }

    const parsed = parseTime(clean);
    // Lo que no parsea vuelve a lo que había: el campo no se queda enseñando algo que no se
    // guardó.
    if (parsed === null) return setText(time ?? "");
    setText(parsed);
    // Una hora suelta es hoy a esa hora, igual que en el campo de captura (spec 6).
    if (parsed !== time || day === null) commit(day ?? today, parsed);
  };

  /**
   * Escape cierra el selector, y no el detalle ni el panel.
   *
   * En el documento y en captura, como los menús. Colgarlo del `div` no bastaría: en WebKit un
   * clic sobre un botón no le da el foco, así que después de elegir un día con el ratón el
   * foco puede estar fuera de la rejilla y la tecla no pasaría por aquí — cerraría el panel
   * entero con el calendario abierto.
   */
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onClose]);

  const onGridKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const delta = step[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    // Que no salga de la rejilla: aquí las flechas caminan por el calendario, no por la lista.
    event.stopPropagation();
    walk(shiftDay(cursor, delta));
  };

  return (
    <div ref={ref} className="due-editor__panel" role="dialog" aria-label="Fecha">
      <div className="due-editor__month">
        <button
          type="button"
          className="due-editor__step"
          aria-label="Mes anterior"
          onClick={() => walk(shiftMonth(cursor, -1))}
        >
          <ChevronLeft size={13} aria-hidden />
        </button>
        <span className="due-editor__title">
          {MESES[at.getMonth()]} {at.getFullYear()}
        </span>
        <button
          type="button"
          className="due-editor__step"
          aria-label="Mes siguiente"
          onClick={() => walk(shiftMonth(cursor, 1))}
        >
          <ChevronRight size={13} aria-hidden />
        </button>
      </div>

      <div className="due-editor__week" aria-hidden>
        {SEMANA.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div ref={grid} className="due-editor__grid" onKeyDown={onGridKeys}>
        {days.map((each) => {
          const date = parseDay(each);
          return (
            <button
              key={each}
              type="button"
              className={[
                "due-editor__day",
                date.getMonth() !== at.getMonth() && "is-outside",
                each === today && "is-today",
                each === day && "is-selected",
              ]
                .filter(Boolean)
                .join(" ")}
              // Tabulación itinerante: de los 42 días, solo el señalado entra en el Tab.
              tabIndex={each === cursor ? 0 : -1}
              aria-pressed={each === day}
              aria-label={`${date.getDate()} de ${MESES[date.getMonth()]} de ${date.getFullYear()}`}
              onClick={() => pick(each)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      <div className="due-editor__row">
        <label className="due-editor__label" htmlFor="due-editor-hora">
          Hora
        </label>
        <input
          id="due-editor-hora"
          type="text"
          className="due-editor__time"
          value={text}
          placeholder="--:--"
          inputMode="numeric"
          maxLength={5}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
          onBlur={commitTime}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitTime();
          }}
        />
        {time !== null && (
          <button
            type="button"
            className="due-editor__clear"
            aria-label="Quitar la hora"
            onClick={() => {
              setText("");
              commit(day ?? today, null);
            }}
          >
            <X size={12} aria-hidden />
          </button>
        )}
      </div>

      <div className="due-editor__foot">
        <button type="button" className="due-editor__quick" onClick={() => pick(today)}>
          Hoy
        </button>
        <button type="button" className="due-editor__quick" onClick={() => pick(nextDay(today))}>
          Mañana
        </button>
        {/* Sin fecha puesta no hay nada que quitar, así que el botón no promete nada. */}
        <button
          type="button"
          className="due-editor__quick due-editor__quick--end"
          disabled={dueAt === null}
          onClick={() => {
            commit(null, null);
            onClose();
          }}
        >
          Sin fecha
        </button>
      </div>
    </div>
  );
}
