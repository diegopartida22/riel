/**
 * El interruptor de las preferencias booleanas: el arranque automático, la agenda del día y el
 * vínculo con Recordatorios (spec 8, 15 y 16). También cada lista en la hoja de Recordatorios,
 * que es la misma pregunta repetida.
 *
 * Para todas, un segmentado de «Sí / No» era pedirle al lector que tradujera dos palabras a un
 * estado que el control ya puede *tener*. Un interruptor lo dice sin leer nada: la posición del
 * pulgar es el valor. Las medidas son las de macOS —38×22 con pulgar de 18, y 150ms de
 * recorrido— porque un interruptor con otras proporciones es de lo primero que delata que un
 * control está hecho a mano.
 *
 * `value` a `null` es «todavía no se sabe» y no acepta clics: no hay posición para eso, y
 * dejarlo pulsable antes de conocer el estado convierte el primer clic en un volado. Es el caso
 * del arranque automático mientras `launchd` no conteste, que son milisegundos.
 *
 * Vive aparte de Ajustes porque lo usan dos archivos, y un control que se copia es un control
 * que en la copia siguiente ya no mide lo mismo.
 */
export function Switch({
  label,
  hint,
  value,
  disabled = false,
  onPick,
}: {
  label: string;
  /** Un dato corto junto al nombre — el conteo de una lista. En mono, como todos (§3.3). */
  hint?: string;
  value: boolean | null;
  /** Aparte de `value === null`: el estado se conoce, pero esta copia no puede cambiarlo. */
  disabled?: boolean;
  onPick: (value: boolean) => void;
}) {
  return (
    <div className="settings__row">
      {/* El nombre en su propio `span` para que la hoja pueda cortarlo sin llevarse el conteo
          por delante: una lista de Recordatorios se llama como quiera su dueño. */}
      <span className="settings__label">
        <span className="settings__name">{label}</span>
        {hint !== undefined && <span className="settings__hint">{hint}</span>}
      </span>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-label={label}
        aria-checked={value ?? false}
        disabled={disabled || value === null}
        onClick={() => onPick(!value)}
      >
        <span className="switch__thumb" />
      </button>
    </div>
  );
}
