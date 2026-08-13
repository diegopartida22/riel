import { useEffect, useState } from "react";

/**
 * Paso 1 del orden de construcción: el panel vacío, solo para confirmar que el vidrio
 * se ve como un popover nativo antes de escribir una línea de UI de verdad.
 *
 * La leyenda reacciona al modo claro/oscuro en vivo, que es el criterio de aceptación 5.
 */
export default function App() {
  const scheme = useColorScheme();

  return (
    <div className="probe">
      <strong>Riel</strong>
      <span>{scheme === "dark" ? "modo oscuro" : "modo claro"}</span>
    </div>
  );
}

function useColorScheme() {
  const [scheme, setScheme] = useState<"light" | "dark">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) => setScheme(event.matches ? "dark" : "light");
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return scheme;
}
