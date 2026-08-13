import { useEffect, useState } from "react";

import { runSelfTest, type Check } from "./data/selftest";

/**
 * Andamiaje del paso 2: el panel muestra si la capa de datos cumple las reglas de la
 * sección 2 del spec. Se cambia por la vista Hoy en el paso 4.
 */
export default function App() {
  const checks = useSelfTest();

  return (
    <div className="probe">
      <strong>Capa de datos</strong>
      {checks === null ? (
        <span>comprobando…</span>
      ) : (
        <ul className="checks">
          {checks.map((check) => (
            <li key={check.name} className={check.ok ? "ok" : "bad"}>
              <span aria-hidden>{check.ok ? "✓" : "✗"}</span>
              <span>
                {check.name}
                {check.detail && <em>{check.detail}</em>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useSelfTest() {
  const [checks, setChecks] = useState<Check[] | null>(null);

  useEffect(() => {
    let alive = true;
    runSelfTest().then((result) => {
      if (alive) setChecks(result);
    });
    return () => {
      alive = false;
    };
  }, []);

  return checks;
}
