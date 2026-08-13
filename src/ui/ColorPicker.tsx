import { Plus } from "lucide-react";
import { useState } from "react";

import { HEX, PALETTE, contrastWarning, curatedOf, tint } from "../design/palette";

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
    if (HEX.test(text)) onChange(text);
  };

  const malformed = manual && draft.length > 0 && !HEX.test(draft);
  // El aviso es para el hex a mano y solo para él (spec 3.2). Un color curado se juzgaría por
  // el par equivocado: en oscuro no se pinta con este valor sino con su variante aclarada, y
  // Ámbar —2.95:1 contra el blanco— saldría avisado por un problema que no tiene.
  const warning = manual && HEX.test(value) && !curatedOf(value) ? contrastWarning(value) : null;

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
            />
          );
        })}

        <button
          type="button"
          className={`picker__more${manual ? " is-selected" : ""}`}
          title="Otro color"
          aria-label="Otro color"
          aria-pressed={manual}
          onClick={openManual}
        >
          <Plus size={13} strokeWidth={2} aria-hidden />
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
          maxLength={7}
          aria-label="Color en hexadecimal"
          autoFocus={claimFocus}
          onChange={(event) => onDraft(event.target.value.trim())}
        />
      )}

      {malformed && <p className="picker__note">Usa el formato #RRGGBB.</p>}
      {!malformed && warning && <p className="picker__note">{warning}</p>}
    </div>
  );
}
