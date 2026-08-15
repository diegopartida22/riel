import { useState } from "react";

import { HEX, PALETTE, contrastWarning, curatedOf, parseHex, tint } from "../design/palette";
import { Check, Plus } from "./icons";

export interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

/**
 * Los ocho colores curados como discos, más un `+` que abre un campo de hex manual (spec 3.2).
 *
 * El campo se abre solo si el color que ya trae el proyecto no es uno de los ocho: así, al
 * editar un proyecto con color propio, se ve el hex y no un selector que aparenta no tener
 * nada elegido.
 */
export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [manual, setManual] = useState(() => curatedOf(value) === null);
  const [draft, setDraft] = useState(value);
  /** Si el campo se abrió al montar, el foco es del nombre; solo lo reclama si lo abren. */
  const [claimFocus, setClaimFocus] = useState(false);

  const openManual = () => {
    setDraft(value);
    setManual(true);
    setClaimFocus(true);
  };

  const onDraft = (text: string) => {
    setDraft(text);
    const hex = parseHex(text);
    if (hex) onChange(hex);
  };

  const malformed = manual && draft.length > 0 && !parseHex(draft);
  /**
   * El `+` se marca solo si el color de verdad no es de los ocho. Con el campo abierto sobre
   * un color curado —se abre trayendo el que había— marcarlo también pondría dos cosas
   * elegidas a la vez, y entonces ninguna de las dos dice nada.
   */
  const custom = manual && HEX.test(value) && !curatedOf(value);
  // El aviso es para el hex a mano y solo para él (spec 3.2). Un color curado se juzgaría por
  // el par equivocado: en oscuro no se pinta con este valor sino con su variante aclarada, y
  // Ámbar —2.95:1 contra el blanco— saldría avisado por un problema que no tiene.
  const warning = custom ? contrastWarning(value) : null;

  return (
    <div className="picker">
      <div className="picker__discs">
        {PALETTE.map((color) => {
          const selected = color.light.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={color.id}
              type="button"
              className={`picker__disc tinted${selected ? " is-selected" : ""}`}
              style={tint(color.light)}
              title={color.name}
              aria-label={color.name}
              aria-pressed={selected}
              onClick={() => {
                setManual(false);
                onChange(color.light);
              }}
            >
              {/* El anillo solo no bastaba: sobre ocho discos de 22px, a un color oscuro se le
                  lee igual que a su vecino. La palomita dentro es la misma señal que usa la
                  casilla de una tarea, y va en la tinta que contrasta con el disco.

                  Más gruesa que el resto a propósito: es la única palomita que no cae sobre el
                  vidrio sino sobre un color saturado, y ahí la raya de siempre se hunde. */}
              {selected && <Check size={13} weight={1.5} aria-hidden />}
            </button>
          );
        })}

        <button
          type="button"
          className={`picker__more${custom ? " is-selected" : ""}`}
          title="Otro color"
          aria-label="Otro color"
          aria-pressed={manual}
          onClick={openManual}
        >
          <Plus size={13} aria-hidden />
        </button>
      </div>

      {manual && (
        <input
          type="text"
          className="picker__hex"
          value={draft}
          placeholder="#RRGGBB"
          spellCheck={false}
          autoComplete="off"
          aria-label="Color en hexadecimal"
          autoFocus={claimFocus}
          onFocus={(event) => {
            // Al abrirlo desde el `+` el campo trae el color de antes, así que se ofrece
            // seleccionado: lo normal ahí es escribir otro entero, no editar un dígito.
            if (parseHex(event.target.value)) event.target.select();
          }}
          onChange={(event) => onDraft(event.target.value)}
          onBlur={() => {
            // Al soltar el campo, lo escrito se asienta en la forma en que se guarda. Así lo
            // que se ve y lo que hay en la base son lo mismo, y volver a entrar no ofrece un
            // `d4ff44` que ya no es lo que el proyecto tiene.
            const hex = parseHex(draft);
            if (hex) setDraft(hex);
          }}
        />
      )}

      {malformed && <p className="picker__note">Usa el formato #RRGGBB.</p>}
      {!malformed && warning && <p className="picker__note">{warning}</p>}
    </div>
  );
}
