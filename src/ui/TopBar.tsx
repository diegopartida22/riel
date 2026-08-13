import { Search, Settings, X } from "lucide-react";

export interface TopBarProps {
  query: string;
  onQuery: (query: string) => void;
  /** Recibe el rectángulo del `⚙︎` para anclar el popover. */
  onSettings: (anchor: DOMRect) => void;
  settingsOpen: boolean;
  ref?: React.Ref<HTMLInputElement>;
}

/**
 * La barra de 48px de la sección 3.4: la búsqueda a la izquierda y los ajustes a la derecha.
 *
 * El campo no lleva caja. Es el mismo criterio que el de captura del pie: encuadrar un campo
 * que ocupa todo el ancho de un panel de vidrio lo apaga, y aquí el icono de lupa ya dice
 * dónde se escribe. La hairline de abajo es lo único que separa la barra de la lista.
 */
export function TopBar({ query, onQuery, onSettings, settingsOpen, ref }: TopBarProps) {
  return (
    <header className="topbar">
      <Search className="topbar__glass" size={14} strokeWidth={1.75} aria-hidden />

      <input
        ref={ref}
        type="search"
        className="topbar__field"
        value={query}
        placeholder="Buscar"
        aria-label="Buscar tareas"
        spellCheck={false}
        autoComplete="off"
        /* ↓ desde aquí baja a la lista en vez de morirse en el campo. Es lo que hacen Spotlight
           y el buscador del Finder, y sin ello escribir y elegir con el teclado no se puede. */
        data-into-list
        onChange={(event) => onQuery(event.target.value)}
      />

      {/* La equis solo existe cuando hay algo que borrar: en reposo la barra es un icono y un
          texto, y nada más. Escape hace lo mismo sin tener que apuntarle. */}
      {query && (
        <button
          type="button"
          className="topbar__clear"
          aria-label="Limpiar la búsqueda"
          onClick={() => onQuery("")}
        >
          <X size={13} strokeWidth={2} aria-hidden />
        </button>
      )}

      <button
        type="button"
        className={`topbar__gear${settingsOpen ? " is-open" : ""}`}
        aria-label="Ajustes"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        data-menu-trigger
        onClick={(event) => onSettings(event.currentTarget.getBoundingClientRect())}
      >
        <Settings size={15} strokeWidth={1.75} aria-hidden />
      </button>
    </header>
  );
}
