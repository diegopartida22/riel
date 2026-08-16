import { useEffect, useState } from "react";

import {
  DIAS_CORTOS,
  DIAS_SEMANA,
  LAST_DAY,
  MAX_EVERY,
  dayOf,
  defaultRepeat,
  describeRepeat,
  type Repeat,
  type RepeatFrom,
  type RepeatUnit,
} from "../data";

export interface RepeatEditorProps {
  /** La fecha de la tarea. Sin ella no hay desde dónde contar, y el control se apaga. */
  dueAt: string | null;
  repeat: Repeat | null;
  repeatFrom: RepeatFrom;
  onChange: (repeat: Repeat | null) => void;
  onFromChange: (from: RepeatFrom) => void;
}

const UNITS: { value: RepeatUnit; label: string }[] = [
  { value: "diario", label: "Diario" },
  { value: "semanal", label: "Semanal" },
  { value: "mensual", label: "Mensual" },
  { value: "anual", label: "Anual" },
];

/** El sustantivo que sigue al número. En plural desde el dos, que es donde el campo tiene uso. */
const NOUNS: Record<RepeatUnit, [string, string]> = {
  diario: ["día", "días"],
  semanal: ["semana", "semanas"],
  mensual: ["mes", "meses"],
  anual: ["año", "años"],
};

const FROMS: { value: RepeatFrom; label: string }[] = [
  { value: "fecha", label: "La fecha" },
  { value: "completada", label: "Que la complete" },
];

/**
 * La repetición de una tarea, en el detalle y justo debajo de su fecha, que es de donde parte.
 *
 * Va en dos alturas a propósito. Arriba, una fila de chips con las cuatro periodicidades y el
 * «no se repite» — que es lo que se toca el 99% de las veces, y con eso ya está configurada una
 * tarea mensual. Abajo, y solo cuando hay regla, el panel con lo que casi nunca se cambia: cada
 * cuántos, qué días y desde dónde se cuenta. Enseñarlo todo siempre convertiría el campo más
 * raro del detalle en el más grande.
 *
 * Y al pie, la regla dicha en una frase. Una fila de botones dice qué está pulsado pero no qué
 * va a pasar: entre «cada 2», «semanal» y tres días marcados hay una frase, y esa frase es lo
 * único que se puede leer y desmentir de un vistazo antes de cerrar el detalle.
 */
export function RepeatEditor({
  dueAt,
  repeat,
  repeatFrom,
  onChange,
  onFromChange,
}: RepeatEditorProps) {
  if (dueAt === null) {
    return (
      <p className="repeat-editor__note">Ponle una fecha y podrá repetirse desde ella.</p>
    );
  }

  const day = dayOf(dueAt);

  return (
    <div className="repeat-editor">
      <div className="chips">
        <Chip selected={repeat === null} onClick={() => onChange(null)}>
          No se repite
        </Chip>
        {UNITS.map(({ value, label }) => (
          <Chip
            key={value}
            selected={repeat?.unit === value}
            // La regla nace de la fecha que la tarea ya tiene: elegir «semanal» en una tarea
            // del martes marca el martes, y «mensual» en una del 17 pone el 17. Un control que
            // arrancara en lunes y en día 1 obligaría a arreglarlo siempre.
            onClick={() => onChange(repeat?.unit === value ? repeat : defaultRepeat(value, day))}
          >
            {label}
          </Chip>
        ))}
      </div>

      {repeat && (
        <div className="repeat-editor__panel">
          <div className="repeat-editor__row">
            <span className="repeat-editor__label">Cada</span>
            <Count
              value={repeat.every}
              min={1}
              max={MAX_EVERY}
              label="Cada cuántos se repite"
              onCommit={(every) => onChange({ ...repeat, every })}
            />
            <span className="repeat-editor__unit">
              {NOUNS[repeat.unit][repeat.every === 1 ? 0 : 1]}
            </span>
          </div>

          {repeat.unit === "semanal" && (
            <Weekdays
              chosen={repeat.weekdays}
              onChange={(weekdays) => onChange({ ...repeat, weekdays })}
            />
          )}

          {repeat.unit === "mensual" && (
            <div className="repeat-editor__row">
              <span className="repeat-editor__label">Día</span>
              <Count
                value={repeat.day === LAST_DAY ? Number(day.slice(8, 10)) : repeat.day}
                min={1}
                max={31}
                disabled={repeat.day === LAST_DAY}
                label="Día del mes"
                onCommit={(value) => onChange({ ...repeat, day: value })}
              />
              {/* El último día no es un número: en un mes son 30 y en el siguiente 31, y quien
                  cierra el mes lo cierra el que toque. Marcarlo con el 31 lo dejaría en el 28
                  de febrero. */}
              <Chip
                selected={repeat.day === LAST_DAY}
                onClick={() =>
                  onChange({
                    ...repeat,
                    day: repeat.day === LAST_DAY ? Number(day.slice(8, 10)) : LAST_DAY,
                  })
                }
              >
                Último del mes
              </Chip>
            </div>
          )}

          <div className="repeat-editor__row">
            <span className="repeat-editor__label">Desde</span>
            <div className="chips">
              {FROMS.map(({ value, label }) => (
                <Chip
                  key={value}
                  selected={repeatFrom === value}
                  onClick={() => onFromChange(value)}
                >
                  {label}
                </Chip>
              ))}
            </div>
          </div>

          <p className="repeat-editor__summary">{describeRepeat(repeat, repeatFrom)}.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Las siete iniciales. Marcar y desmarcar, salvo el último que quede: una regla semanal sin
 * ningún día no repite nunca, así que el botón se apaga en vez de dejar guardar una regla
 * muerta. Es lo mismo que hace el campo de título con el texto vacío.
 */
function Weekdays({
  chosen,
  onChange,
}: {
  chosen: number[];
  onChange: (weekdays: number[]) => void;
}) {
  return (
    <div className="repeat-editor__week" role="group" aria-label="Días de la semana">
      {DIAS_CORTOS.map((letter, index) => {
        const value = index + 1;
        const on = chosen.includes(value);
        const only = on && chosen.length === 1;
        return (
          <button
            key={value}
            type="button"
            className={`repeat-editor__day${on ? " is-selected" : ""}`}
            aria-pressed={on}
            aria-label={DIAS_SEMANA[index]}
            disabled={only}
            onClick={() =>
              onChange(on ? chosen.filter((each) => each !== value) : [...chosen, value].sort((a, b) => a - b))
            }
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Un número corto con su propio texto en curso.
 *
 * Se guarda al salir del campo o con ⏎, y no con cada tecla, por lo mismo que la hora del
 * selector de fecha: borrando el «17» para escribir «3» hay un instante en que el campo está
 * vacío, y guardar ahí escribiría una regla que nadie pidió. Lo que no parsea vuelve a lo que
 * había — el campo no se queda enseñando algo que no se guardó.
 */
function Count({
  value,
  min,
  max,
  label,
  disabled = false,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const parsed = Number(text.trim());
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      return setText(String(value));
    }
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <input
      type="text"
      className="repeat-editor__number"
      value={text}
      inputMode="numeric"
      maxLength={2}
      spellCheck={false}
      autoComplete="off"
      disabled={disabled}
      aria-label={label}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commit();
      }}
    />
  );
}

/** El mismo chip del detalle, sin color de proyecto: aquí nada representa a un proyecto. */
function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`chip${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
