/**
 * Las sesiones de Claude Code (spec 17).
 *
 * Rust lee y cuenta; aquí se decide qué se enseña, en qué orden y qué se estima. Es el mismo
 * reparto que con el Calendario y con Recordatorios: la capa nativa es tonta a propósito.
 *
 * Se pide al entrar al apartado y con el botón de recargar, nunca con un temporizador ni al abrir
 * el panel — contar `~/.claude` cuesta más que el presupuesto entero del criterio 1, y ahí no hay
 * nada que mirar. Lo único que avanza solo es el «hace 3 h 55 min», que sale del reloj sobre un
 * sello ya leído.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export interface Session {
  id: string;
  pid: number;
  name: string;
  cwd: string;
  /** Segundos desde epoch. */
  started: number;
  /** Desde dónde se lanzó: `claude-vscode`, la terminal… */
  entrypoint: string | null;
  version: string | null;
  /** Bytes residentes. */
  memory: number;
  /** Cuándo se escribió la última línea. Nulo si la sesión se abrió y no llegó a escribir nada. */
  touched: number | null;
  /** Lo que ocupa la conversación ahora mismo, no la suma de todo. */
  context: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  model: string | null;
}

export interface Disk {
  transcripts: number;
  history: number;
  rest: number;
  path: string;
}

/**
 * Por debajo de esto, la sesión se dibuja como la que se está usando: sube a `--ink-primary` y su
 * columna de la derecha dice «ahora» en vez de un «hace».
 *
 * Dos minutos y no treinta segundos porque lo que se mide es cuándo se escribió la última línea, y
 * entre dos líneas de una conversación viva pasa fácilmente un minuto — se está leyendo lo que
 * acaba de salir, o Claude está trabajando sin escribir todavía.
 */
const ACTIVE_S = 120;

/** Cada cuánto avanza el «hace». No relee nada: solo vuelve a pintar con el reloj de ahora. */
const TICK_MS = 30_000;

/**
 * Precio de lista de la API, en dólares por millón de tokens de entrada y de salida.
 *
 * Es una estimación y la app lo dice en la etiqueta (spec 17.4): quien paga una suscripción no
 * paga esto. Sirve para comparar una sesión con otra, no para cuadrar nada.
 *
 * Un modelo que no esté en la tabla no se estima — se enseñan los tokens y ya. Inventarle un
 * precio a un modelo que no se conoce es exactamente el error que la etiqueta no podría tapar.
 */
const PRICES: { match: RegExp; input: number; output: number }[] = [
  { match: /opus/, input: 15, output: 75 },
  { match: /sonnet/, input: 3, output: 15 },
  { match: /haiku/, input: 1, output: 5 },
];

/**
 * Lo que la caché cuesta respecto a la entrada normal, que es igual en todos los modelos:
 * escribirla sale un 25% más cara y leerla, una décima parte.
 */
const CACHE_WRITE = 1.25;
const CACHE_READ = 0.1;

/** Dólares estimados a precio de lista, o `null` si el modelo no está en la tabla. */
export function estimate(session: Session): number | null {
  const model = session.model?.toLowerCase();
  const price = model ? PRICES.find((each) => each.match.test(model)) : undefined;
  if (!price) return null;

  const million = 1_000_000;
  return (
    (session.input * price.input +
      session.cacheWrite * price.input * CACHE_WRITE +
      session.cacheRead * price.input * CACHE_READ +
      session.output * price.output) /
    million
  );
}

/** Cuándo se escribió por última vez, o cuándo arrancó si nunca llegó a escribir nada. */
export const lastSign = (session: Session) => session.touched ?? session.started;

export const isActive = (session: Session, now: number) =>
  session.touched !== null && now - session.touched < ACTIVE_S;

export interface Claude {
  sessions: Session[];
  disk: Disk | null;
  loading: boolean;
  /**
   * Si todavía se está recorriendo `~/.claude`. Va aparte de `loading` porque las dos preguntas
   * tardan órdenes de magnitud distintos (spec 17.5): la lista llega enseguida y el disco no, y
   * el bloque tiene que decir que está contando en vez de saltar de vacío a un número.
   */
  counting: boolean;
  /** El fallo de cerrar una sesión. Leer no falla de forma que valga la pena enseñar. */
  error: string | null;
  /** Segundos desde epoch, para el «hace». Avanza solo mientras el apartado está a la vista. */
  now: number;
  reload: () => void;
  close: (id: string) => Promise<void>;
}

/**
 * `open` es si el apartado está en pantalla. Cerrado no se lee nada y no corre ningún reloj: el
 * panel se abre y se cierra decenas de veces al día, y en casi todas no se pasa por aquí.
 */
export function useClaude(open: boolean): Claude {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [disk, setDisk] = useState<Disk | null>(null);
  const [loading, setLoading] = useState(false);
  const [counting, setCounting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((each) => each + 1), []);

  useEffect(() => {
    if (!open) return;
    let alive = true;

    setLoading(true);
    setCounting(true);
    setNow(Date.now() / 1000);

    // Las dos preguntas van sueltas y no en un `Promise.all`: el disco tarda un orden de magnitud
    // más —son varios miles de archivos— y esperarlo dejaría la lista en blanco mientras tanto.
    void invoke<Session[]>("claude_sessions")
      .then((found) => {
        if (!alive) return;
        // Por tiempo quieto de mayor a menor: lo que se está preguntando es qué se puede cerrar,
        // y lo que se puede cerrar va arriba. La que se está usando acaba la última.
        setSessions([...found].sort((a, b) => lastSign(a) - lastSign(b)));
      })
      .catch((cause) => console.error(cause))
      .finally(() => {
        if (alive) setLoading(false);
      });

    void invoke<Disk | null>("claude_disk")
      .then((found) => {
        if (alive) setDisk(found);
      })
      .catch((cause) => console.error(cause))
      .finally(() => {
        if (alive) setCounting(false);
      });

    return () => {
      alive = false;
    };
  }, [open, nonce]);

  useEffect(() => {
    if (!open) return;
    const ticker = window.setInterval(() => setNow(Date.now() / 1000), TICK_MS);
    return () => clearInterval(ticker);
  }, [open]);

  const close = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await invoke("close_claude_session", { id });
      } catch (cause) {
        setError(typeof cause === "string" ? cause : "No se pudo cerrar la sesión.");
      }
      // Se relee igual si falló: el fallo normal es que se fuera por su cuenta entre la lista y
      // el botón, y entonces lo que hay que enseñar es la lista sin ella.
      reload();
    },
    [reload],
  );

  return { sessions, disk, loading, counting, error, now, reload, close };
}
