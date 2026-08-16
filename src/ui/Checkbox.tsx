/**
 * La casilla: círculo de 15px con borde de 1.5px, que al hover toma el color del proyecto de
 * su tarea y al completarse se llena con él y traza la palomita (spec 3.5 y 3.6).
 *
 * Es un `button` con `role="checkbox"` y no un `input`: la casilla nativa se llena con el
 * acento del sistema, y esta tiene que llenarse con el color del proyecto de su tarea. Que la
 * app haya adoptado el acento del sistema (spec 3.1) no cambia nada aquí — el acento colorea
 * los controles de la app, y una casilla dice de qué proyecto es.
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
