/**
 * La casilla: círculo de 15px con borde de 1.5px, que al hover toma el color del proyecto de
 * su tarea y al completarse se llena con él y traza la palomita (spec 3.5 y 3.6).
 *
 * Es un `button` con `role="checkbox"` y no un `input`: la casilla nativa de macOS trae su
 * propio azul de sistema, y el criterio de aceptación 9 dice que ese azul no aparece en
 * ninguna superficie de la app.
 */
export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className="checkbox"
      onClick={() => onChange(!checked)}
    >
      <svg viewBox="0 0 15 15" aria-hidden="true">
        <circle className="checkbox__ring" cx="7.5" cy="7.5" r="6.75" />
        {/* `pathLength="1"` normaliza el largo del trazo: así el `stroke-dasharray` del CSS
            no depende de las medidas exactas de la palomita. */}
        <path className="checkbox__tick" pathLength={1} d="M4.3 7.8 6.6 10.1 10.8 5.3" />
      </svg>
    </button>
  );
}
