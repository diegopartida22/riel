import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useRef, useState, type KeyboardEvent } from "react";

import { estimate, isActive, type Claude, type Session } from "../state/claude";
import { shortPath } from "../state/editors";
import { EmptyState } from "../ui/EmptyState";
import { GroupHeader } from "../ui/GroupHeader";
import { Folder, Refresh } from "../ui/icons";
import { Meter } from "../ui/Meter";

const pad = (value: number) => String(value).padStart(2, "0");

/** `09:15`, en 24 h como el resto de la app. */
function hour(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * `363 MB`, `1.5 GB`. En unidades de mil y no de 1024, que es como las cuenta el Finder desde
 * hace años: enseñar 1.4 GiB al lado de lo que el sistema llama 1.5 GB confundiría más de lo que
 * precisa.
 */
function bytes(value: number): string {
  if (value < 1_000_000) return `${Math.round(value / 1000)} kB`;
  if (value < 1_000_000_000) return `${Math.round(value / 1_000_000)} MB`;
  return `${(value / 1_000_000_000).toFixed(1)} GB`;
}

/** `68k`, `1.2M`. El número exacto no dice nada que el orden de magnitud no diga mejor. */
function tokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/**
 * Cuánto lleva quieta: `12 min`, `3 h 55 min`, `2 d`.
 *
 * Nunca dice «inactiva» ni «ociosa». La fecha del archivo es la mejor señal que hay y no es una
 * certeza —una sesión que lleva ocho minutos sin escribir puede estar esperando a que termine
 * una compilación (spec 17.2)— así que la app enseña el número y no saca la conclusión.
 */
function since(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  return `${Math.floor(hours / 24)} d`;
}

/** `opus-5`. El prefijo del proveedor y el sello de fecha no distinguen nada en esta lista. */
const modelName = (model: string) => model.replace(/^claude-/, "").replace(/-\d{8}$/, "");

/** `$4.80`, y por debajo del centavo un `<$0.01` en vez de un `$0.00` que parecería gratis. */
function money(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** Desde dónde se lanzó, dicho para leerse dentro de una confirmación. */
const OWNERS: Record<string, string> = {
  "claude-vscode": "VS Code",
  "claude-jetbrains": "JetBrains",
};

/**
 * El apartado de las sesiones de Claude Code (spec 17).
 *
 * Contesta una sola pregunta —qué tengo abierto y qué de eso no está haciendo nada— y no es un
 * monitor de procesos. Se lee al entrar y con el botón de recargar, nunca al abrir el panel.
 *
 * Las filas se parecen a las de una tarea y no lo son, igual que las de la agenda: sin casilla,
 * sin manija de arrastre y sin punto de proyecto. Una sesión no se completa ni se reordena, y
 * darle esos gestos sería prometer tres cosas que ninguna funciona. Lo que una fila de tarea gasta
 * a la izquierda en su casilla, esta lo gasta en la hora de arranque.
 */
export function ClaudeSessions({ claude }: { claude: Claude }) {
  const { sessions, disk, loading, counting, error, now, reload, close } = claude;
  const [confirming, setConfirming] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  /**
   * ↑↓ recorre las filas y nada más. Espacio y ⏎ no se tocan: aquí no hay nada que completar ni
   * que editar, y una tecla que promete algo y no lo hace es peor que una que no está.
   *
   * El recorrido se lee del DOM y no de las props, por lo mismo que en la lista de tareas: es lo
   * único que da el orden que de verdad se ve.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const rows = Array.from(box.current?.querySelectorAll<HTMLElement>("[data-session]") ?? []);
    if (!rows.length) return;

    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const at = rows.indexOf((event.target as HTMLElement).closest<HTMLElement>("[data-session]")!);
    const next = at < 0 ? (step === 1 ? 0 : rows.length - 1) : at + step;
    rows[Math.min(Math.max(next, 0), rows.length - 1)]?.focus();
  };

  const total = sessions.reduce((sum, each) => sum + each.memory, 0);

  /**
   * La vara de las dos barras de cada fila: la sesión más grande del momento en cada cosa.
   *
   * Es una escala relativa y no una fracción de un tope, y eso es a propósito. El contexto no
   * tiene denominador que se pueda saber: la transcripción guarda el `usage` y el modelo, y de
   * ahí no sale cuál es la ventana —`claude-opus-5` es el mismo nombre con 200k que con 1M— así
   * que dibujar `68k / 200k` sería inventarse la mitad del dato. Y la memoria residente contra
   * la RAM de la máquina da fracciones de un dos por ciento, que a lo ancho de una fila no es
   * una barra sino una raya.
   *
   * Contra la mayor sí se contesta lo que este apartado pregunta: cuál de las que hay abiertas
   * es la que pesa. Por eso las barras solo salen con dos sesiones o más — con una, la vara es
   * ella misma, las dos barras salen llenas y «lleno» se lee como un tope alcanzado que aquí no
   * existe. Y por eso el número de al lado siempre es el absoluto: la barra compara, la cifra
   * dice cuánto.
   */
  const scale =
    sessions.length > 1
      ? {
          memory: Math.max(...sessions.map((each) => each.memory)),
          context: Math.max(...sessions.map((each) => each.context)),
        }
      : null;

  return (
    <div className="view" ref={box} onKeyDown={onKeyDown}>
      {error && <p className="notice notice--error">{error}</p>}

      <GroupHeader
        action={
          <button
            type="button"
            className="group-header__tool"
            title="Volver a leer"
            aria-label="Volver a leer"
            onClick={reload}
          >
            <Refresh size={12} aria-hidden />
          </button>
        }
      >
        {/* El recuento y la memoria juntos, que es la respuesta corta a la pregunta del
            apartado. Mientras se lee por primera vez no dice «0 sesiones»: cero es una
            respuesta, y darla antes de saberla es mentir durante medio segundo. */}
        {loading && !sessions.length
          ? "Sesiones"
          : `${sessions.length} ${sessions.length === 1 ? "sesión" : "sesiones"} · ${bytes(total)} de memoria`}
      </GroupHeader>

      {!loading && sessions.length === 0 ? (
        <EmptyState message="No hay ninguna sesión abierta." />
      ) : (
        <ul className="claude">
          {sessions.map((session) => (
            <Row
              key={session.id}
              session={session}
              now={now}
              scale={scale}
              confirming={confirming === session.id}
              onAsk={() => setConfirming(session.id)}
              onCancel={() => setConfirming(null)}
              onClose={() => {
                setConfirming(null);
                void close(session.id);
              }}
            />
          ))}
        </ul>
      )}

      {(disk || counting) && (
        <>
          <GroupHeader
            action={
              disk && (
                <button
                  type="button"
                  className="group-header__tool"
                  title="Ver en el Finder"
                  aria-label="Ver en el Finder"
                  onClick={() =>
                    void revealItemInDir(disk.path).catch((cause) => console.error(cause))
                  }
                >
                  <Folder size={12} aria-hidden />
                </button>
              )
            }
          >
            Disco
          </GroupHeader>

          {/* Recorrer `~/.claude` son varios miles de archivos, así que el bloque dice que está
              contando en vez de saltar de vacío a un número (spec 17.5). */}
          {disk ? <DiskBlock disk={disk} /> : <p className="claude-note">Contando…</p>}
        </>
      )}
    </div>
  );
}

interface RowProps {
  session: Session;
  now: number;
  /** La sesión más grande del momento, o nulo si solo hay una y no hay con qué comparar. */
  scale: { memory: number; context: number } | null;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onClose: () => void;
}

function Row({ session, now, scale, confirming, onAsk, onCancel, onClose }: RowProps) {
  const active = isActive(session, now);
  const cost = estimate(session);
  const spent = session.input + session.output + session.cacheWrite + session.cacheRead;
  const owner = session.entrypoint ? OWNERS[session.entrypoint] : undefined;
  const quiet = session.touched === null ? null : since(now - session.touched);
  const model = session.model ? modelName(session.model) : null;

  return (
    <li className={`claude__slot${active ? " is-now" : ""}`}>
      <div className="claude__row" data-session={session.id} tabIndex={0}>
        <span className="claude__time">{hour(session.started)}</span>

        <div className="claude__body">
          {/* Renglones y no un solo bloque. En 440px menos el riel quedan menos de cuatro
              centímetros de fila, y con el nombre, las cifras y el «hace» en el mismo renglón el
              nombre se quedaba sin ancho y se partía letra a letra. Arriba va lo que contesta la
              pregunta del apartado —cuál es y cuánto lleva quieta—; debajo, dónde vive; después
              lo que ocupa ahora, con su barra; y al pie lo que lleva gastado. */}
          <div className="claude__line">
            <span className="claude__name">{session.name}</span>

            {/* El «hace» y el botón comparten hueco, como la fecha y el `⋯` de una fila de tarea
                (spec 3.5): el ancho lo fija el más ancho de los dos, así que al pasar el puntero
                no se mueve nada. */}
            <span className="claude__when">
              <span className="claude__idle">
                {active ? "ahora" : quiet === null ? "sin usar" : `hace ${quiet}`}
              </span>
              <button type="button" className="claude__close" onClick={onAsk}>
                Cerrar
              </button>
            </span>
          </div>

          {/* La ruta y el modelo, y el presupuesto de la ruta descontando lo que ocupa el
              modelo: con 34 caracteres fijos para la carpeta, una ruta larga empujaba al modelo
              fuera del renglón y lo dejaba en `o…`, que no nombra nada. La carpeta se come por
              delante y sigue diciendo dónde está aunque le falten dos tramos; el modelo cortado
              no dice nada en absoluto. */}
          <p className="claude__where">
            {[shortPath(session.cwd, session.model ? 26 : 34), model].filter(Boolean).join(" · ")}
          </p>

          {/* Lo que la sesión ocupa ahora mismo, que es lo que decide si se cierra. Con barra,
              cada cifra se lleva su renglón: la barra va delante porque es lo que se lee de un
              vistazo y la cifra a la derecha, para que caiga en el mismo sitio en todas las
              filas — que es justo para lo que existe la fuente de datos (spec 3.3).

              Sin barra —una sola sesión, nada con qué comparar— las dos se juntan en un
              renglón contra sus dos bordes, como el de abajo. Sueltas y alineadas a la derecha
              se quedaban colgando de media fila vacía: sin la barra delante, el renglón no
              tenía quién ocupara su izquierda. */}
          {scale ? (
            <>
              <Gauge value={bytes(session.memory)} fill={session.memory / scale.memory} />
              <Gauge
                value={tokens(session.context)}
                unit="ctx"
                fill={session.context / scale.context}
              />
            </>
          ) : (
            <div className="claude__totals">
              <span className="claude__value">{bytes(session.memory)}</span>
              <span className="claude__value">
                {tokens(session.context)}
                <span className="claude__unit"> ctx</span>
              </span>
            </div>
          )}

          {/* Y al pie lo gastado, que no es de ahora y no lleva barra: el contexto y la memoria
              se comparan entre sesiones vivas, el gasto es un acumulado que solo crece. Los dos
              contra sus bordes, así que el costo no se pierde por la derecha. */}
          {spent > 0 && (
            <div className="claude__totals">
              <span className="claude__value">
                {tokens(spent)}
                <span className="claude__unit"> tok</span>
              </span>
              {/* El costo nunca sale sin el rótulo: es una estimación a precio de lista, y quien
                  paga una suscripción no paga esto (spec 17.4). */}
              <span className="claude__value">
                {cost === null ? (
                  <span className="claude__unit">sin precio</span>
                ) : (
                  <>
                    {money(cost)}
                    <span className="claude__unit"> estimado</span>
                  </>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      {confirming && (
        <div className="claude__confirm">
          <p className="editor__confirm-text">
            Se cierra «{session.name}»
            {quiet === null ? "" : `, que lleva ${quiet} sin escribir`}. La transcripción se queda
            en el disco: <code>claude --resume</code> la recupera.
            {owner && ` La abriste desde ${owner}, así que su panel se va a quedar enseñando una sesión muerta.`}
          </p>
          <div className="editor__actions">
            <button type="button" className="editor__button" onClick={onCancel}>
              Cancelar
            </button>
            <button
              type="button"
              className="editor__button editor__button--danger"
              onClick={onClose}
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Un renglón de la fila: la barra a la izquierda y su cifra contra el borde derecho. */
function Gauge({ value, unit, fill }: { value: string; unit?: string; fill: number }) {
  return (
    <div className="claude__gauge">
      <Meter fill={fill} />
      <span className="claude__value">
        {value}
        {unit && <span className="claude__unit"> {unit}</span>}
      </span>
    </div>
  );
}

/**
 * El disco (spec 17.5): `~/.claude` entero, con las dos piezas que explican el tamaño y el resto
 * junto. Una sola barra apilada y debajo su leyenda, porque lo que se está preguntando aquí es
 * de qué es el giga y medio — y eso es una proporción, no tres números sueltos.
 *
 * Un solo color, el de la app, en tres densidades, y la leyenda nombra cada parte con su cifra:
 * el color no llega a decir nada por su cuenta y no tiene por qué. El hueco de 1px entre partes
 * es lo que las separa cuando la densidad no alcanza — la de «Resto» son quince megas de mil
 * setecientos, y a esa escala su trozo es una raya.
 *
 * No hay botón de borrar y no lo va a haber: lo que hay ahí dentro es de otra app y tiene años
 * encima. Se enseña el número y se abre la puerta.
 */
function DiskBlock({ disk }: { disk: { transcripts: number; history: number; rest: number } }) {
  const parts = [
    { key: "transcripts", label: "Transcripciones", value: disk.transcripts },
    { key: "history", label: "Historial de archivos", value: disk.history },
    { key: "rest", label: "Resto", value: disk.rest },
  ];
  const total = parts.reduce((sum, each) => sum + each.value, 0);

  return (
    <>
      <div className="claude__gauge claude__gauge--disk">
        <div className="stack" aria-hidden>
          {parts.map((part, index) => (
            <span
              key={part.key}
              className={`stack__part stack__part--${index + 1}`}
              style={{ flexGrow: part.value }}
            />
          ))}
        </div>
        <span className="claude__value">{bytes(total)}</span>
      </div>

      <dl className="claude-disk">
        {parts.map((part, index) => (
          <div className="claude-disk__row" key={part.key}>
            <dt>
              <span className={`stack__swatch stack__part--${index + 1}`} aria-hidden />
              {part.label}
            </dt>
            <dd>{bytes(part.value)}</dd>
          </div>
        ))}
      </dl>

      {/* Se enseña el número y se abre la puerta; borrar es cosa de otra app (spec 17.5). */}
      <p className="claude-note">Riel no borra nada de aquí. Lo que sobre se quita desde el Finder.</p>
    </>
  );
}
