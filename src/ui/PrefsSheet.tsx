import { useEffect, useRef, useState, type ReactNode } from "react";

import { RETENTIONS, countSweepable, type Retention } from "../data";
import { describe, fromEvent, useConflictos, type Atajo as AtajoState } from "../state/atajo";
import type { Editor } from "../state/editors";
import { HORIZONTES, type Horizonte } from "../state/horizonte";
import { ROW_TEXTS, type RowText } from "../state/rowText";
import { TRAY_GLYPHS, type TrayGlyph } from "../state/trayGlyph";
import { SYSTEM_VIEWS, type SystemKind } from "../state/views";
import { SYSTEM_ICONS } from "./Rail";

export interface PrefsSheetProps {
  retention: Retention;
  onRetention: (retention: Retention) => void;
  startView: SystemKind;
  onStartView: (kind: SystemKind) => void;
  rowText: RowText;
  onRowText: (value: RowText) => void;
  /** Hasta dónde llega la lista antes de plegar lo de más adelante (spec 19). */
  horizonte: Horizonte;
  onHorizonte: (value: Horizonte) => void;
  trayGlyph: TrayGlyph;
  onTrayGlyph: (value: TrayGlyph) => void;
  /** El atajo global que abre la captura rápida (spec 18). */
  atajo: AtajoState;
  /** Los editores de código instalados y el puesto (spec 13). */
  editors: Editor[];
  editor: Editor | null;
  onEditor: (id: string) => void;
  onClose: () => void;
}

/**
 * Lo que espera la cuenta de completadas tras la última tecla, antes de consultar.
 *
 * Los mismos 120 ms que el campo de búsqueda, y por lo mismo: cada pulsación es un `COUNT`
 * contra la base, y recorrer los cuatro plazos con las flechas los lanzaba todos para quedarse
 * con el último.
 */
const COUNT_MS = 120;

interface Choice<T> {
  value: T;
  /** Lo que se lee: el tooltip, y el nombre para quien no ve el glifo. */
  label: string;
  /** Lo que se ve: un texto corto o un icono. */
  content: ReactNode;
}

/**
 * Una preferencia: su nombre a la izquierda, sus opciones a la derecha.
 *
 * Las seis son listas cerradas de dos a cinco opciones, y como renglones con palomita costaban
 * quince líneas. En fila cuestan una línea cada una, y de paso dejan de existir dos gramáticas
 * para lo mismo —la fila de glifos ya era esto, y al lado de los renglones parecía pegada con
 * cinta.
 *
 * El precio es que las etiquetas tienen que ser cortas, y dos de las seis no caben en texto.
 * Ahí van dibujos —los iconos del riel, los glifos de la barra— y con ellos la leyenda de
 * `caption`: un dibujo de 15px se distingue de sus vecinos pero no se lee, y sin pasar el ratón
 * por cada uno no había forma de saber cuál está puesto.
 *
 * El grupo entero es una sola parada del tabulador y por dentro se recorre con las flechas,
 * que es como se comporta un control segmentado del sistema y lo que pide ARIA para un
 * `radiogroup`. Con cada opción tabulable, cruzar la hoja costaba veinte tabuladores para
 * siete cosas que tocar.
 */
function Choices<T>({
  label,
  options,
  value,
  onPick,
  caption = false,
}: {
  label: string;
  options: readonly Choice<T>[];
  value: T | null;
  onPick: (value: T) => void;
  /** Escribe debajo el nombre de lo elegido. Solo para las dos filas que dibujan en vez de
      escribir; en las de texto repetiría palabra por palabra el botón que está al lado. */
  caption?: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
  const current = options.findIndex((option) => option.value === value);
  const stop = current < 0 ? 0 : current;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    // Se para aquí: la lista de detrás también escucha flechas para recorrer las tareas, y sin
    // esto una flecha en la hoja movería además la fila enfocada debajo de ella.
    event.preventDefault();
    event.stopPropagation();
    const next = (stop + step + options.length) % options.length;
    onPick(options[next].value);
    row.current?.querySelectorAll("button")[next]?.focus();
  };

  return (
    <div className="settings__row">
      <span className="settings__label">{label}</span>
      <div className="settings__group">
        <div
          ref={row}
          className="settings__choices"
          role="radiogroup"
          aria-label={label}
          onKeyDown={onKeyDown}
        >
          {options.map((option, index) => (
            <button
              key={String(option.value)}
              type="button"
              className={`settings__choice${option.value === value ? " is-selected" : ""}`}
              role="radio"
              aria-checked={option.value === value}
              tabIndex={index === stop ? 0 : -1}
              /* Solo cuando dice algo que no esté ya a la vista: en «Una línea» el tooltip
                 repetiría el botón, y un globo que no informa es ruido. En un glifo, o en el
                 «7 d» que abrevia «7 días», sí es lo único que lo nombra. */
              title={option.content === option.label ? undefined : option.label}
              aria-label={option.label}
              onClick={() => onPick(option.value)}
            >
              {option.content}
            </button>
          ))}
        </div>
        {/* Oculto a los lectores de pantalla: la opción marcada ya se anuncia por su
            `aria-label`, y esto le sumaría el mismo nombre dos veces seguidas. */}
        {caption && current >= 0 && (
          <span className="settings__caption" aria-hidden>
            {options[current].label}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * El renglón que graba el atajo global de la captura rápida (spec 18).
 *
 * No es un booleano ni una lista cerrada, así que no es ninguna de las dos formas de arriba:
 * lo que hay que enseñar es una combinación que solo se conoce pulsándola. Por eso el control
 * *es* el valor —el atajo escrito en la fuente de datos, sobre la misma pista que un
 * segmentado— y pulsarlo lo pone a escuchar en vez de abrir una lista de teclas que nadie
 * quiere recorrer.
 *
 * Grabando, la hoja se queda con todas las teclas: sin eso, ⌘F escaparía a la búsqueda de
 * detrás y ⎋ cerraría el panel entero en vez de cancelar la grabación.
 *
 * Y debajo, solo mientras hace falta, lo que dice `useConflictos` (spec 18.7): si lo puesto ya
 * lo usa el sistema —que es lo que hace que el atajo no responda sin que nada lo explique— y
 * tres combinaciones libres para pulsar. Las sugerencias salen al grabar, que es cuando hay que
 * pensar una, y al haber choque, que es cuando hay que cambiarla.
 */
function Atajo({
  accel,
  error,
  onPick,
}: {
  accel: string | null;
  error: string | null;
  onPick: (accel: string | null) => void;
}) {
  const [grabando, setGrabando] = useState(false);
  const { owner, free } = useConflictos(accel);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!grabando) return;
    event.preventDefault();
    event.stopPropagation();

    // Arrepentirse sin cambiar nada, y quitarlo del todo. Las dos van antes de `fromEvent`
    // porque las dos son teclas sueltas, que es justo lo que un atajo no puede ser.
    if (event.key === "Escape") {
      setGrabando(false);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      setGrabando(false);
      onPick(null);
      return;
    }

    // Un modificador suelto no es un atajo todavía: se está a media combinación, así que se
    // sigue escuchando en vez de rechazarlo.
    const next = fromEvent(event);
    if (!next) return;

    setGrabando(false);
    onPick(next);
  };

  // Lo que se está grabando manda sobre todo lo demás: mientras se espera una tecla, un aviso
  // de lo de antes es de algo que ya se está cambiando.
  const choque = owner ? `${describe(accel)} ya lo usa ${owner}: macOS se queda con él.` : null;
  const aviso = grabando ? null : (error ?? choque);

  return (
    <>
      <div className="settings__row">
        <span className="settings__label">Atajo de captura</span>
        <button
          type="button"
          className={`settings__atajo${grabando ? " is-grabando" : ""}`}
          aria-label={`Atajo de captura: ${describe(accel)}`}
          onClick={() => setGrabando((antes) => !antes)}
          onBlur={() => setGrabando(false)}
          onKeyDown={onKeyDown}
        >
          {grabando ? "Pulsa el atajo…" : describe(accel)}
        </button>
      </div>

      {/* Solo mientras hace falta. Un renglón de instrucciones permanente debajo de un control
          que se usa una vez en la vida gasta el alto de la hoja en algo que ya se sabe. */}
      {grabando && <p className="settings__note">⌫ lo quita · ⎋ lo deja como estaba.</p>}
      {aviso && <p className="settings__note">{aviso}</p>}

      {/* Las libres, y solo cuando hay que elegir. El `onMouseDown` es lo que las hace
          pulsables mientras se graba: sin él, el botón pierde el foco antes del clic, la
          grabación se cancela y la sugerencia no llega a ponerse. */}
      {(grabando || aviso) && free.length > 0 && (
        <p className="settings__note settings__libres">
          <span className="settings__libres-label">Libres</span>
          {free.map((uno) => (
            <button
              key={uno}
              type="button"
              className="settings__libre"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setGrabando(false);
                onPick(uno);
              }}
            >
              {describe(uno)}
            </button>
          ))}
        </p>
      )}
    </>
  );
}

/**
 * Las preferencias de lista cerrada (spec 8), en el área de contenido y no dentro del popover.
 *
 * Es la misma decisión que la importación y las listas de Recordatorios, y por la misma razón:
 * del `⚙︎` sale solo la pregunta —un renglón que lleva aquí— y lo que necesita sitio para
 * leerse ocupa el área de contenido. Siete preferencias con su nombre, su control y la leyenda
 * de las dos que dibujan son unos trescientos píxeles: metidas en el popover lo estiraban hasta
 * los 545, que dentro de un panel de 580 ya no es «algo pequeño colgado de un botón» sino un
 * segundo panel tapando el primero.
 *
 * Aquí, además, el ancho no lo fija el popover: el área de contenido da cuarenta píxeles más,
 * que son justo los que les faltaban a los segmentados de cinco opciones.
 *
 * Lo que se queda en el popover es lo que se pulsa de paso —los interruptores, exportar,
 * salir—; lo que se viene a decidir con calma está aquí. Cada opción guarda al pulsarse, así
 * que el botón es «Listo» y no «Guardar», igual que en la hoja de Recordatorios.
 */
export function PrefsSheet({
  retention,
  onRetention,
  startView,
  onStartView,
  rowText,
  onRowText,
  horizonte,
  onHorizonte,
  trayGlyph,
  onTrayGlyph,
  atajo,
  editors,
  editor,
  onEditor,
  onClose,
}: PrefsSheetProps) {
  /**
   * El plazo pulsado que todavía no se ha guardado, y lo que se llevaría por delante.
   *
   * `count` en nulo es «todavía no se sabe»: el plazo se acaba de pulsar y la cuenta aún no ha
   * salido. Se dibuja marcado desde ese primer instante aunque no haya nada que confirmar —es
   * lo que se está decidiendo, y dejar la marca en el plazo viejo mientras tanto haría parecer
   * que el clic no llegó (spec 8).
   */
  const [pruning, setPruning] = useState<{ retention: Retention; count: number | null } | null>(
    null,
  );
  /** El último plazo pulsado. Recorrer la fila con las flechas dispara una cuenta por tecla, y
      sin esto la más lenta podría revivir la confirmación de un plazo ya abandonado. */
  const wanted = useRef<Retention>(retention);
  /** El temporizador de la cuenta, para poder cancelarla si sigue llegando otra tecla. */
  const counting = useRef<number | null>(null);

  /**
   * El plazo que ya tiene cuenta, que es el único que pregunta. Mientras `count` sea nulo el
   * plazo está marcado pero todavía no hay confirmación que dibujar.
   */
  const asking =
    pruning && pruning.count !== null
      ? { retention: pruning.retention, count: pruning.count }
      : null;

  // Un temporizador no puede sobrevivir a la hoja: cerrarla mientras la cuenta espera dejaría
  // un disparo tardío tocando un estado que ya no existe.
  useEffect(
    () => () => {
      if (counting.current !== null) clearTimeout(counting.current);
    },
    [],
  );

  /**
   * Bajar el plazo de conservación borra completadas en el momento y eso no se deshace: el
   * barrido no pasa por la pila de ⌘Z. Es la única preferencia que destruye datos, así que es
   * la única que pregunta — y solo cuando de verdad hay algo que perder. Subirlo, poner
   * «siempre» o bajarlo sin que caiga nada se guardan de una: una confirmación que sale siempre
   * se aprende a pulsar sin leerla, y entonces ya no protege de nada.
   */
  const pickRetention = (next: Retention) => {
    wanted.current = next;
    if (counting.current !== null) clearTimeout(counting.current);

    if (next === null || (retention !== null && next >= retention)) {
      setPruning(null);
      onRetention(next);
      return;
    }

    // La marca se mueve ya; la cuenta espera un respiro. Recorrer los cuatro plazos con las
    // flechas son cuatro pulsaciones en menos de medio segundo, y sin esto cada una lanzaba su
    // `COUNT` contra la base para que la siguiente lo descartara.
    setPruning({ retention: next, count: null });
    counting.current = window.setTimeout(() => {
      counting.current = null;
      void countSweepable(next).then(
        (count) => {
          if (wanted.current !== next) return;
          if (count === 0) {
            setPruning(null);
            onRetention(next);
          } else {
            setPruning({ retention: next, count });
          }
        },
        (cause) => {
          // Sin poder contar no hay nada que enseñar, así que se guarda igual. Si además falla
          // la escritura, lo dice `changeRetention`: no hacen falta dos avisos para un fallo.
          console.error(cause);
          if (wanted.current !== next) return;
          setPruning(null);
          onRetention(next);
        },
      );
    }, COUNT_MS);
  };

  return (
    <section className="editor" aria-label="Preferencias">
      <h2 className="editor__title">Preferencias</h2>

      {/* Las siete van seguidas y sin separadores: cada una se lee entera en su renglón, y una
          hairline entre dos diría que hay un corte pero no de qué. */}
      <div className="editor__prefs">
        {/* El atajo va primero porque no es una lista cerrada, y así no parte en dos las seis
            que sí lo son — que alineadas contra el mismo borde derecho se leen como una tabla. */}
        <Atajo accel={atajo.accel} error={atajo.error} onPick={atajo.set} />

        {/* El panel se abre y se cierra decenas de veces al día, y no siempre es Hoy lo que se
            quiere ver al abrirlo. Solo las cuatro del sistema: un proyecto fijado tendría que
            decidir a dónde caer cuando se borre, y eso sería un ajuste que cambia solo. */}
        <Choices
          label="Vista al abrir"
          options={SYSTEM_VIEWS.map(({ kind, label }) => {
            const Icon = SYSTEM_ICONS[kind];
            return { value: kind, label, content: <Icon size={15} aria-hidden /> };
          })}
          value={startView}
          onPick={onStartView}
          caption
        />

        {/* Un título largo cortado a la mitad obliga a abrir el detalle para saber de qué tarea
            se trata; uno entero gasta dos o tres renglones por fila y hace que quepan menos.
            Ninguna de las dos es la respuesta correcta para todo el mundo, así que se elige una
            vez y vale para toda la app. */}
        <Choices
          label="Texto de las tareas"
          options={ROW_TEXTS.map((option) => ({ ...option, content: option.label }))}
          value={rowText}
          onPick={onRowText}
        />

        {/* Hasta dónde llega la lista antes de plegar lo de más adelante (spec 19). Fin de mes
            de fábrica: es la frontera que ya se tiene en la cabeza, y a diferencia de «30 días»
            no se va corriendo hacia el mes siguiente conforme avanza este. */}
        <Choices
          label="Ver por delante"
          options={HORIZONTES.map((option) => ({ ...option, content: option.short }))}
          value={horizonte}
          onPick={onHorizonte}
        />

        {/* Los glifos y no sus nombres: «Cuadro» no dice qué va a salir en la barra, y lo que se
            está eligiendo es precisamente cómo se ve. El que importa no es el más bonito sino el
            que no se confunda con los vecinos que ya haya arriba, y eso solo se decide
            mirándolos.

            Máscara y no `img`: el PNG es una imagen *template* —negro y alfa— y en modo oscuro
            un negro sobre el vidrio oscuro no se vería. Pintar el alfa con la tinta de la app es
            lo mismo que hace macOS con la barra. */}
        <Choices
          label="Icono de la barra"
          options={TRAY_GLYPHS.map((option) => ({
            ...option,
            content: (
              <span
                className="settings__glifo"
                style={{
                  maskImage: `url(/tray/${option.value}.png)`,
                  WebkitMaskImage: `url(/tray/${option.value}.png)`,
                }}
              />
            ),
          }))}
          value={trayGlyph}
          onPick={onTrayGlyph}
          caption
        />

        {/* Con qué editor se abre la carpeta de un proyecto (spec 13). Solo con dos o más
            instalados: con uno, un segmentado de una opción no es una elección, es un rótulo, y
            con ninguno la preferencia decidiría sobre algo que no puede pasar. Es la única fila
            que puede no estar, y por eso va la última de las que se eligen mirando: así las de
            siempre no cambian de sitio según la máquina. */}
        {editors.length > 1 && (
          <Choices
            label="Abrir carpetas en"
            options={editors.map((each) => ({
              value: each.id,
              label: each.name,
              content: each.name,
            }))}
            value={editor?.id ?? null}
            onPick={onEditor}
          />
        )}

        <Choices
          label="Conservar completadas"
          options={RETENTIONS.map((option) => ({ ...option, content: option.short }))}
          /* Ternario y no `??`: «siempre» es `null` como valor legítimo, y aunque hoy nunca
             llegue a `pruning` —alargar el plazo no pregunta— con `??` una futura confirmación
             de «siempre» se dibujaría marcando el plazo viejo. */
          value={pruning ? pruning.retention : retention}
          onPick={pickRetention}
        />
      </div>

      {/* La misma forma que eliminar un proyecto: primero qué se va a perder, luego la salida y
          el sí en rojo. Sin `autoFocus`, al revés que allí — allí la confirmación nace de un
          clic en «Eliminar», y aquí de recorrer una fila de opciones, donde robar el foco
          dejaría a quien navega con flechas fuera del grupo a media vuelta. */}
      {asking && (
        <div className="editor__confirm">
          <p className="editor__confirm-text">
            Conservar {RETENTIONS.find((option) => option.value === asking.retention)?.label} borra
            ahora {asking.count} {asking.count === 1 ? "tarea completada" : "tareas completadas"}, y
            eso no se deshace.
          </p>
          <div className="editor__actions">
            <button
              type="button"
              className="editor__button"
              onClick={() => {
                setPruning(null);
                wanted.current = retention;
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="editor__button editor__button--danger"
              onClick={() => {
                onRetention(asking.retention);
                setPruning(null);
              }}
            >
              Borrar {asking.count === 1 ? "1 tarea" : `${asking.count} tareas`}
            </button>
          </div>
        </div>
      )}

      {/* Cada opción escribe al pulsarse, así que esto es una salida y no un «Guardar». */}
      <div className="editor__actions">
        <button type="button" className="editor__button editor__button--primary" onClick={onClose}>
          Listo
        </button>
      </div>
    </section>
  );
}
