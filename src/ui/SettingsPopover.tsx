import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  RETENTIONS,
  countSweepable,
  dbPath,
  exportName,
  snapshot,
  type Retention,
} from "../data";
import type { Editor } from "../state/editors";
import { notificationPermission, type Permission } from "../state/notifications";
import { ROW_TEXTS, type RowText } from "../state/rowText";
import { TRAY_GLYPHS, type TrayGlyph } from "../state/trayGlyph";
import type { Updates } from "../state/updates";
import { SYSTEM_VIEWS, type SystemKind } from "../state/views";
import { SYSTEM_ICONS } from "./Rail";

export interface SettingsPopoverProps {
  /** Rectángulo del `⚙︎` que lo abrió. */
  anchor: DOMRect;
  retention: Retention;
  onRetention: (retention: Retention) => void;
  startView: SystemKind;
  onStartView: (kind: SystemKind) => void;
  rowText: RowText;
  onRowText: (value: RowText) => void;
  trayGlyph: TrayGlyph;
  onTrayGlyph: (value: TrayGlyph) => void;
  /** Los editores de código instalados y el puesto (spec 13). */
  editors: Editor[];
  editor: Editor | null;
  onEditor: (id: string) => void;
  updates: Updates;
  /** Abre la hoja de importación, que vive en el área de contenido y no aquí dentro. */
  onImport: () => void;
  onClose: () => void;
}

const EDGE = 8;

/** El panel de Notificaciones de Ajustes del Sistema, para la nota de permiso denegado. */
const NOTIFICATIONS_PANE = "x-apple.systempreferences:com.apple.preference.notifications";

/**
 * Lo que contesta Rust sobre el arranque al iniciar sesión.
 *
 * `disponible` es falso corriendo en `tauri dev`, donde el binario vive suelto en `target/` sin
 * `.app` alrededor: registrarlo en `launchd` no deja puesta Riel, deja puesto el binario de
 * desarrollo, que al iniciar sesión arranca contra un servidor de Vite que no existe. Es un
 * estado que el usuario no puede cambiar pulsando, así que el interruptor no acepta el clic.
 */
interface Autostart {
  disponible: boolean;
  puesto: boolean;
}

const autostartState = () => invoke<Autostart>("autostart_state");

/** La salida manual cuando el actualizador no puede: bajar el `.dmg` a mano siempre funciona. */
const RELEASES = "https://github.com/diegopartida22/riel/releases/latest";

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
 * Las cinco del popover son listas cerradas de dos a cinco opciones, y como renglones con
 * palomita costaban quince líneas: el popover pasaba de los 580px del panel y la lista quedaba
 * tapada de arriba abajo. En fila cuestan una línea cada una, y de paso dejan de existir dos
 * gramáticas para lo mismo —la fila de glifos ya era esto, y al lado de los renglones parecía
 * pegada con cinta.
 *
 * El precio es que las etiquetas tienen que ser cortas, y dos de las cinco no caben en texto.
 * Ahí van dibujos —los iconos del riel, los glifos de la barra— y con ellos la leyenda de
 * `caption`: un dibujo de 15px se distingue de sus vecinos pero no se lee, y sin pasar el ratón
 * por cada uno no había forma de saber cuál está puesto.
 *
 * El grupo entero es una sola parada del tabulador y por dentro se recorre con las flechas,
 * que es como se comporta un control segmentado del sistema y lo que pide ARIA para un
 * `radiogroup`. Con cada opción tabulable, cruzar el popover costaba dieciocho tabuladores
 * para ocho cosas que tocar.
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
  /** `null` cuando todavía no se sabe: el arranque automático lo contesta `launchd`, y hasta
      entonces no hay nada marcado — mejor eso que marcar algo que quizá no es. */
  value: T | null;
  onPick: (value: T) => void;
  /** Escribe debajo el nombre de lo elegido. Solo para las dos filas que dibujan en vez de
      escribir; en las de texto repetiría palabra por palabra el botón que está al lado. */
  caption?: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
  const current = options.findIndex((option) => option.value === value);
  /** Sin nada marcado —el arranque automático tarda en contestar— entra por la primera. */
  const stop = current < 0 ? 0 : current;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    // Se para aquí: el panel de detrás también escucha flechas para recorrer la lista, y sin
    // esto una flecha en Ajustes movería además la fila enfocada debajo del popover.
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
 * El interruptor del arranque automático.
 *
 * Es la única preferencia booleana del popover, y un segmentado de «Sí / No» era pedirle al
 * lector que tradujera dos palabras a un estado que el control ya puede *tener*. Un interruptor
 * lo dice sin leer nada: la posición del pulgar es el valor. Las medidas son las de macOS —38×22
 * con pulgar de 18, y 150ms de recorrido— porque un interruptor con otras proporciones es de lo
 * primero que delata que un control está hecho a mano.
 *
 * Mientras `launchd` no conteste va apagado y sin aceptar clics: no hay posición para «todavía
 * no se sabe», y dejarlo pulsable antes de conocer el estado convertiría el primer clic en un
 * volado. Contesta en milisegundos.
 */
function Switch({
  label,
  value,
  disabled = false,
  onPick,
}: {
  label: string;
  value: boolean | null;
  /** Aparte de `value === null`: el estado se conoce, pero esta copia no puede cambiarlo. */
  disabled?: boolean;
  onPick: (value: boolean) => void;
}) {
  return (
    <div className="settings__row">
      <span className="settings__label">{label}</span>
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

/**
 * El popover del `⚙︎` (spec 8). Pequeño y colgado del icono, no una ventana aparte.
 */
export function SettingsPopover({
  anchor,
  retention,
  onRetention,
  startView,
  onStartView,
  rowText,
  onRowText,
  trayGlyph,
  onTrayGlyph,
  editors,
  editor,
  onEditor,
  updates,
  onImport,
  onClose,
}: SettingsPopoverProps) {
  /** Sacado del objeto para que TypeScript pueda estrechar la unión dentro del JSX. */
  const update = updates.state;
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [autostart, setAutostart] = useState<Autostart | null>(null);
  /** `null` mientras se consulta: sin saberlo, la nota de permiso denegado no se dibuja. */
  const [notify, setNotify] = useState<Permission | null>(null);
  const [busy, setBusy] = useState(false);
  /** El plazo pulsado que está esperando un sí, con lo que se llevaría por delante. */
  const [pruning, setPruning] = useState<{ retention: Retention; count: number } | null>(null);
  /** El último plazo pulsado. Recorrer la fila con las flechas dispara una cuenta por tecla, y
      sin esto la más lenta podría revivir la confirmación de un plazo ya abandonado. */
  const wanted = useRef<Retention>(retention);

  useEffect(() => {
    getVersion().then(setVersion, (cause) => console.error(cause));
    autostartState().then(setAutostart, (cause) => console.error(cause));
    notificationPermission().then(setNotify, (cause) => console.error(cause));
  }, []);

  // Se remide cuando cambia el alto: la nota de permisos y el estado de arranque llegan
  // asíncronos, y sin esto el popover quedaría anclado a la altura que tenía vacío.
  //
  // El alto se sujeta contra el borde de abajo igual que el ancho contra el de la derecha. El
  // popover cabe de sobra en su forma normal, pero las notas —permiso denegado, un fallo del
  // actualizador— se suman a lo que ya hay, y sin esto la última se dibujaba fuera del panel:
  // una ventana sin decoración no tiene dónde desbordarse, así que lo que se sale no se ve.
  // Subirlo lo mete entero; si ni así cupiera, el `max-height` del CSS lo deja recorrer.
  useLayoutEffect(() => {
    const own = box.current?.getBoundingClientRect();
    if (!own) return;
    setAt({
      top: Math.max(EDGE, Math.min(anchor.bottom + 6, window.innerHeight - own.height - EDGE)),
      left: Math.min(Math.max(EDGE, anchor.right - own.width), window.innerWidth - own.width - EDGE),
    });
  }, [anchor, version, autostart, notify, updates.state, pruning, editors]);

  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Element;
      // Igual que en el menú de la fila: el `⚙︎` cierra por su cuenta, y si además cerrara
      // aquí el clic siguiente lo reabriría y el botón nunca apagaría el popover.
      if (target.closest?.("[data-menu-trigger]")) return;
      if (!box.current?.contains(target)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Este Escape cierra el popover, no el panel.
      event.stopPropagation();
      onClose();
    };

    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [onClose]);

  const pickAutostart = async (next: boolean) => {
    if (!autostart?.disponible || next === autostart.puesto) return;
    // Optimista, y se corrige con lo que diga el sistema: la opción tiene que responder al
    // clic, pero quien manda sobre si el agente quedó puesto es `launchd`, no nosotros.
    setAutostart({ ...autostart, puesto: next });
    try {
      await (next ? enable() : disable());
    } catch (cause) {
      console.error(cause);
    }
    autostartState().then(setAutostart, (cause) => console.error(cause));
  };

  /**
   * Bajar el plazo de conservación borra completadas en el momento y eso no se deshace: el
   * barrido no pasa por la pila de ⌘Z. Es la única preferencia del popover que destruye datos,
   * así que es la única que pregunta — y solo cuando de verdad hay algo que perder. Subirlo,
   * poner «siempre» o bajarlo sin que caiga nada se guardan de una: una confirmación que sale
   * siempre se aprende a pulsar sin leerla, y entonces ya no protege de nada.
   *
   * Mientras espera el sí, la opción pulsada se dibuja marcada aunque no esté guardada. Es lo
   * que se está decidiendo, y dejar la marca en la vieja haría parecer que el clic no llegó.
   */
  const pickRetention = (next: Retention) => {
    setPruning(null);
    wanted.current = next;
    if (next === null || (retention !== null && next >= retention)) {
      onRetention(next);
      return;
    }

    void countSweepable(next).then(
      (count) => {
        if (wanted.current !== next) return;
        if (count === 0) onRetention(next);
        else setPruning({ retention: next, count });
      },
      (cause) => {
        // Sin poder contar no hay nada que enseñar, así que se guarda igual. Si además falla
        // la escritura, lo dice `changeRetention`: no hacen falta dos avisos para un fallo.
        console.error(cause);
        if (wanted.current === next) onRetention(next);
      },
    );
  };

  /**
   * El panel de guardar es una ventana del sistema: se lleva el foco, y sin levantar la
   * bandera el panel se cerraría por debajo mientras se elige la carpeta (spec 4).
   */
  const exportJson = async () => {
    if (busy) return;
    setBusy(true);
    await invoke("set_keep_open", { value: true }).catch((cause) => console.error(cause));
    try {
      const path = await save({
        defaultPath: exportName(),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path) await invoke("write_export", { path, contents: await snapshot() });
    } catch (cause) {
      console.error(cause);
    } finally {
      await invoke("set_keep_open", { value: false }).catch((cause) => console.error(cause));
      setBusy(false);
      onClose();
    }
  };

  return (
    <div
      ref={box}
      className="menu settings"
      role="dialog"
      aria-label="Ajustes"
      style={at ?? { top: -9999, left: -9999 }}
    >
      {/* Las cinco preferencias van seguidas y sin separadores entre ellas: cada una se lee
          entera en su renglón. Los grupos de después —notificaciones, datos, la app— se separan
          con su rótulo y no con una hairline: tres reglas en un popover de doscientos píxeles lo
          convertían en una reja, y una regla dice que hay un corte pero no de qué. El bloque de
          preferencias es el único sin rótulo porque es para lo que existe el popover; ponerle
          «PREFERENCIAS» encima sería rotular la caja entera desde dentro.

          El arranque automático es el único booleano de los cinco, y va con interruptor y no
          con un segmentado de «Sí / No»: es el control con el que el sistema dice esto, y un
          estado que el control puede *tener* no hace falta además escribirlo. */}
      <Switch
        label="Abrir al iniciar sesión"
        value={autostart ? autostart.puesto : null}
        disabled={autostart !== null && !autostart.disponible}
        onPick={(next) => void pickAutostart(next)}
      />

      {/* Solo en desarrollo, donde el binario corre suelto sin `.app`. Encenderlo ahí dejaba
          registrado `target/debug/riel`, y al iniciar sesión `launchd` arrancaba el binario de
          desarrollo contra un Vite que no estaba: la app se abría, pero no era esta. */}
      {autostart?.disponible === false && (
        <p className="settings__note">
          Esta copia corre desde el proyecto, no desde la app instalada. Solo la instalada puede
          abrirse al iniciar sesión.
        </p>
      )}

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
          del popover que puede no estar, y por eso va la última de las preferencias: así las
          cinco de siempre no cambian de sitio según la máquina. */}
      {editors.length > 1 && (
        <Choices
          label="Abrir carpetas en"
          options={editors.map((each) => ({ value: each.id, label: each.name, content: each.name }))}
          value={editor?.id ?? null}
          onPick={onEditor}
        />
      )}

      <Choices
        label="Conservar completadas"
        options={RETENTIONS.map((option) => ({ ...option, content: option.short }))}
        /* Ternario y no `??`: «siempre» es `null` como valor legítimo, y aunque hoy nunca llegue
           a `pruning` —alargar el plazo no pregunta— con `??` una futura confirmación de
           «siempre» se dibujaría marcando el plazo viejo. */
        value={pruning ? pruning.retention : retention}
        onPick={pickRetention}
      />

      {/* La misma forma que eliminar una tarea desde el `⋯`: primero qué se va a perder, luego
          el sí en rojo y la salida. Sin `autoFocus`, al revés que allí — allí la confirmación
          nace de un clic en «Eliminar», y aquí de recorrer una fila de opciones, donde robar
          el foco dejaría a quien navega con flechas fuera del grupo a media vuelta. */}
      {pruning && (
        <>
          <p className="settings__note">
            Conservar {RETENTIONS.find((option) => option.value === pruning.retention)?.label} borra
            ahora {pruning.count} {pruning.count === 1 ? "tarea completada" : "tareas completadas"},
            y eso no se deshace.
          </p>
          <button
            type="button"
            className="menu__item menu__item--danger"
            onClick={() => {
              onRetention(pruning.retention);
              setPruning(null);
            }}
          >
            Sí, borrar {pruning.count === 1 ? "1 tarea" : `${pruning.count} tareas`}
          </button>
          <button
            type="button"
            className="menu__item"
            onClick={() => {
              setPruning(null);
              wanted.current = retention;
            }}
          >
            Cancelar
          </button>
        </>
      )}

      {/* Solo cuando se sabe que está denegado. Mientras se consulta no hay nota, porque una
          advertencia que parpadea en cada apertura del popover es peor que ninguna. Y solo
          para `denied`: con `unavailable` el enlace no llevaría a ningún sitio, porque la app
          ni siquiera figura en la lista de Ajustes del Sistema. */}
      {notify === "denied" && (
        <>
          <h2 className="settings__section">Notificaciones</h2>
          <p className="settings__note">
            Las notificaciones están desactivadas, así que las tareas con hora no van a avisar.
          </p>
          <button type="button" className="menu__item" onClick={() => void openUrl(NOTIFICATIONS_PANE)}>
            Abrir Ajustes del Sistema
          </button>
        </>
      )}

      <h2 className="settings__section">Datos</h2>

      <button type="button" className="menu__item" disabled={busy} onClick={() => void exportJson()}>
        {/* Los puntos suspensivos son los de macOS: la acción no ocurre al pulsar, primero
            pregunta dónde guardar. Los otros tres renglones actúan de inmediato y por eso no
            los llevan. */}
        Exportar a JSON…
      </button>
      {/* Justo debajo del export y no en otro grupo: son la misma operación en los dos
          sentidos, y un export sin forma de volver a entrar no es un respaldo, es un archivo.
          Lleva puntos suspensivos por lo mismo que su gemelo — lo primero que hace es
          preguntar cuál. El resto del flujo no cabe aquí: el resumen de lo que trae el archivo
          y la elección entre combinar y reemplazar necesitan sitio para leerse, así que salen
          al área de contenido como el editor de proyecto. */}
      <button
        type="button"
        className="menu__item"
        onClick={() => {
          onImport();
          onClose();
        }}
      >
        Importar desde JSON…
      </button>
      <button
        type="button"
        className="menu__item"
        onClick={() => {
          void dbPath()
            .then(revealItemInDir)
            .catch((cause) => console.error(cause));
          onClose();
        }}
      >
        Mostrar los datos en Finder
      </button>

      {/* La versión es el rótulo del grupo y no una línea suelta al final: lo que cuelga de
          ella —actualizar, salir— son las dos cosas que se le hacen a la app misma, y las dos
          contestan a lo mismo que la versión, que es qué hay puesto. Colgando sola debajo de
          «Buscar actualizaciones» se leía como el número que ese botón acababa de encontrar. */}
      <h2 className="settings__section">Riel {version ?? "—"}</h2>

      {/* Al día —o sin haber podido preguntar— aquí no se dibuja nada, que es el estado en el
          que va a estar casi siempre. */}
      {update.stage === "disponible" && (
        <button type="button" className="menu__item" onClick={updates.install}>
          Actualizar a {update.version}
        </button>
      )}

      {/* Un renglón deshabilitado y no un texto suelto: ocupa exactamente lo mismo que el botón
          al que reemplaza, y así el popover no cambia de alto ni se reancla al pulsar. */}
      {(update.stage === "bajando" || update.stage === "lista") && (
        <button type="button" className="menu__item" disabled>
          {update.stage === "lista" ? (
            "Reiniciando…"
          ) : (
            <span>
              Bajando…
              {update.percent !== null && (
                <span className="settings__pct">{" "}{update.percent}%</span>
              )}
            </span>
          )}
        </button>
      )}

      {/* Preguntar a mano. Sin esto, adelantar el chequeo obligaba a salir de Riel y volver a
          abrirla: al abrir el panel se pregunta, pero solo si hace 24 h de la última respuesta.
          También es el único sitio donde la app puede decir que no hay nada — el chequeo
          silencioso se calla igual estando al día que sin haber podido preguntar. */}
      {(update.stage === "ninguna" ||
        update.stage === "aldia" ||
        update.stage === "incomunicada") && (
        <button type="button" className="menu__item" onClick={updates.check}>
          Buscar actualizaciones
        </button>
      )}

      {update.stage === "buscando" && (
        <button type="button" className="menu__item" disabled>
          Buscando…
        </button>
      )}

      {update.stage === "aldia" && <p className="settings__note">No hay una versión nueva.</p>}

      {/* Los dos fallos dicen lo mismo y por lo mismo (spec 11): qué pasó, que lo que había
          sigue puesto, y por dónde salir a mano. Cambia solo en qué se estaba haciendo. */}
      {(update.stage === "incomunicada" || update.stage === "fallo") && (
        <>
          <p className="settings__note">
            {update.stage === "fallo"
              ? "No se pudo instalar la actualización."
              : "No se pudo comprobar si hay una versión nueva."}{" "}
            {/* El número ya está en el rótulo del grupo, dos renglones más arriba: repetirlo
                aquí sería decirlo dos veces en cuatro palabras. Lo que hace falta decir es que
                sigue puesto, que es la primera pregunta de quien ve fallar un actualizador. */}
            La que tienes sigue puesta y funcionando.
          </p>
          <button type="button" className="menu__item" onClick={() => void openUrl(RELEASES)}>
            Bajarla a mano
          </button>
        </>
      )}

      {/* Sin Dock y sin ⌘Tab (spec 4), Riel no tiene menú de aplicación ni ⌘Q: sin este
          botón, pararla obligaba a ir al Monitor de Actividad. */}
      <button
        type="button"
        className="menu__item"
        onClick={() => void invoke("quit").catch((cause) => console.error(cause))}
      >
        Salir de Riel
      </button>
    </div>
  );
}
