import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { dbPath, exportName, snapshot } from "../data";
import { notificationPermission, type Permission } from "../state/notifications";
import type { Updates } from "../state/updates";
import { ChevronRight } from "./icons";
import { Switch } from "./Switch";

export interface SettingsPopoverProps {
  /** Rectángulo del `⚙︎` que lo abrió. */
  anchor: DOMRect;
  /** Abre la hoja de preferencias, que vive en el área de contenido como la de importación. */
  onPrefs: () => void;
  /** La agenda del día en Hoy y el permiso del Calendario (spec 15). */
  agenda: boolean;
  onAgenda: (value: boolean) => void;
  calendar: Permission | null;
  /** El vínculo con Recordatorios y su permiso (spec 16). */
  reminders: boolean;
  onReminders: (value: boolean) => void;
  remindersPermission: Permission | null;
  /** Cuántas listas están vinculadas, para no mandar a elegir a quien ya eligió. */
  reminderLists: number;
  /** Abre la hoja de listas, que vive en el área de contenido como la de importación. */
  onPickLists: () => void;
  updates: Updates;
  /** Abre la hoja de importación, que vive en el área de contenido y no aquí dentro. */
  onImport: () => void;
  onClose: () => void;
}

const EDGE = 8;

/** El panel de Notificaciones de Ajustes del Sistema, para la nota de permiso denegado. */
const NOTIFICATIONS_PANE = "x-apple.systempreferences:com.apple.preference.notifications";

/** El de Privacidad → Calendarios, para lo mismo con la agenda (spec 15). */
const CALENDAR_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars";

/** Y el de Privacidad → Recordatorios (spec 16). */
const REMINDERS_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders";

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

/**
 * El popover del `⚙︎` (spec 8). Pequeño y colgado del icono, no una ventana aparte.
 */
export function SettingsPopover({
  anchor,
  onPrefs,
  agenda,
  onAgenda,
  calendar,
  reminders,
  onReminders,
  remindersPermission,
  reminderLists,
  onPickLists,
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
  }, [
    anchor,
    version,
    autostart,
    notify,
    updates.state,
    agenda,
    calendar,
    reminders,
    remindersPermission,
    reminderLists,
  ]);

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
      {/* Lo que queda aquí es lo que se pulsa de paso: encender algo, sacar los datos, salir.
          Lo que se viene a decidir mirando —las siete de lista cerrada— vive en su hoja, y de
          ellas sale un renglón más abajo. Es la misma partición que ya tenían la importación y
          las listas de Recordatorios: del `⚙︎` sale la pregunta y el resto ocupa el área de
          contenido (spec 8).

          Los tres booleanos van primero y juntos, con interruptor y no con un segmentado de
          «Sí / No»: es el control con el que el sistema dice esto, y un estado que el control
          puede *tener* no hace falta además escribirlo. Los grupos de después —notificaciones,
          datos, la app— se separan con su rótulo y no con una hairline: una regla dice que hay
          un corte pero no de qué. El bloque de arriba es el único sin rótulo porque es para lo
          que existe el popover; ponerle «PREFERENCIAS» encima sería rotular la caja desde
          dentro, y además ya no es lo que es. */}
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

      {/* La agenda del día en Hoy (spec 15). Apagada de fábrica: encenderla es lo que levanta la
          pregunta del Calendario, y un permiso que se pide sin que nadie lo haya pedido es justo
          lo que hace desconfiar de una app que dice no salir de la máquina. El nombre dice de
          dónde salen los eventos para que el diálogo del sistema no llegue de sorpresa.

          No acepta clics mientras no se sepa el permiso —milisegundos— ni corriendo desde el
          proyecto: sin `.app` no hay identificador al que conceder nada y EventKit no contesta.
          Es el mismo caso que la nota de aquí arriba, así que no lleva una segunda. */}
      <Switch
        label="Eventos del calendario"
        value={agenda}
        disabled={calendar === null || calendar === "unavailable"}
        onPick={onAgenda}
      />

      {/* Solo con la agenda encendida. Apagada, el permiso no hace falta, y una advertencia
          sobre algo que nadie está pidiendo es ruido. */}
      {agenda && calendar === "denied" && (
        <>
          <p className="settings__note">
            Riel no tiene acceso al Calendario, así que la agenda de hoy sale vacía.
          </p>
          <button type="button" className="menu__item" onClick={() => void openUrl(CALENDAR_PANE)}>
            Abrir Ajustes del Sistema
          </button>
        </>
      )}

      {/* El vínculo con Recordatorios (spec 16). Apagado de fábrica, y por lo mismo que la
          agenda: encenderlo es lo que levanta la pregunta del sistema. El nombre dice con qué se
          vincula y no lo que hace — «Sincronizar» prometería los dos sentidos enteros, y de
          vuelta solo sale la casilla. Eso lo explica la hoja, que es donde se elige. */}
      <Switch
        label="Recordatorios de Apple"
        value={reminders}
        disabled={remindersPermission === null || remindersPermission === "unavailable"}
        onPick={onReminders}
      />

      {/* Elegir listas es lo que hace que el vínculo haga algo: encendido y sin ninguna, no
          entra nada. Por eso el renglón sale en cuanto se enciende y no solo cuando se pide, y
          por eso dice cuántas hay puestas — encendido sin listas se lee como roto. */}
      {reminders && remindersPermission === "granted" && (
        <button
          type="button"
          className="menu__item menu__item--lleva"
          onClick={() => {
            onPickLists();
            onClose();
          }}
        >
          <span>
            {reminderLists === 0
              ? "Elegir listas…"
              : `${reminderLists} ${reminderLists === 1 ? "lista vinculada" : "listas vinculadas"}…`}
          </span>
          {/* Lo que lo devuelve a la columna de la derecha, donde los tres de arriba llevan su
              interruptor: sin él se leía como un renglón de menú suelto entre ellos y no como lo
              que cuelga del interruptor de justo encima. El `›` es además lo que dice que no
              decide nada aquí: lleva a la hoja, que es donde se elige (spec 16.6). */}
          <ChevronRight size={12} className="menu__lleva" aria-hidden />
        </button>
      )}

      {reminders && remindersPermission === "denied" && (
        <>
          <p className="settings__note">
            Riel no tiene acceso a Recordatorios, así que no puede traer nada ni marcar nada.
          </p>
          <button type="button" className="menu__item" onClick={() => void openUrl(REMINDERS_PANE)}>
            Abrir Ajustes del Sistema
          </button>
        </>
      )}

      {/* Lo que se viene a decidir con calma vive en la hoja, no aquí (spec 8): del `⚙︎` sale
          solo la pregunta, como con la importación y las listas de Recordatorios. Las siete
          preferencias de lista cerrada estiraban el popover hasta los 545px dentro de un panel
          de 580, y eso ya no es algo pequeño colgado de un botón sino un segundo panel tapando
          el primero. Lo que se queda arriba es lo que se pulsa de paso.

          Debajo de las listas de Recordatorios y no encima: aquel cuelga del interruptor que
          tiene justo arriba, y meterse en medio los separaría. */}
      <button
        type="button"
        className="menu__item menu__item--lleva"
        onClick={() => {
          onPrefs();
          onClose();
        }}
      >
        <span>Preferencias…</span>
        <ChevronRight size={12} className="menu__lleva" aria-hidden />
      </button>

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
