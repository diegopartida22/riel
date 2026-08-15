import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { RETENTIONS, dbPath, exportName, snapshot, type Retention } from "../data";
import { notificationPermission, type Permission } from "../state/notifications";
import { ROW_TEXTS, type RowText } from "../state/rowText";
import { TRAY_GLYPHS, type TrayGlyph } from "../state/trayGlyph";
import type { Updates } from "../state/updates";
import { SYSTEM_VIEWS, type SystemKind } from "../state/views";
import { Check } from "./icons";

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
  updates: Updates;
  onClose: () => void;
}

const EDGE = 8;

/** El panel de Notificaciones de Ajustes del Sistema, para la nota de permiso denegado. */
const NOTIFICATIONS_PANE = "x-apple.systempreferences:com.apple.preference.notifications";

/** La salida manual cuando el actualizador no puede: bajar el `.dmg` a mano siempre funciona. */
const RELEASES = "https://github.com/diegopartida22/riel/releases/latest";

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
  updates,
  onClose,
}: SettingsPopoverProps) {
  /** Sacado del objeto para que TypeScript pueda estrechar la unión dentro del JSX. */
  const update = updates.state;
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  /** `null` mientras se consulta: sin saberlo, la nota de permiso denegado no se dibuja. */
  const [notify, setNotify] = useState<Permission | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion, (cause) => console.error(cause));
    isEnabled().then(setAutostart, (cause) => console.error(cause));
    notificationPermission().then(setNotify, (cause) => console.error(cause));
  }, []);

  // Se remide cuando cambia el alto: la nota de permisos y el estado de arranque llegan
  // asíncronos, y sin esto el popover quedaría anclado a la altura que tenía vacío.
  useLayoutEffect(() => {
    const own = box.current?.getBoundingClientRect();
    if (!own) return;
    setAt({
      top: anchor.bottom + 6,
      left: Math.min(Math.max(EDGE, anchor.right - own.width), window.innerWidth - own.width - EDGE),
    });
  }, [anchor, version, autostart, notify, updates.state]);

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

  const toggleAutostart = async () => {
    const next = !autostart;
    // Optimista, y se corrige con lo que diga el sistema: la casilla tiene que responder al
    // clic, pero quien manda sobre si el agente quedó puesto es `launchd`, no nosotros.
    setAutostart(next);
    try {
      await (next ? enable() : disable());
    } catch (cause) {
      console.error(cause);
    }
    isEnabled().then(setAutostart, (cause) => console.error(cause));
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
      <button
        type="button"
        className="menu__item"
        role="menuitemcheckbox"
        aria-checked={autostart === true}
        onClick={() => void toggleAutostart()}
      >
        <span className="menu__check">
          {autostart && <Check size={13} aria-hidden />}
        </span>
        Abrir al iniciar sesión
      </button>

      <div className="menu__rule" role="separator" />

      {/* El panel se abre y se cierra decenas de veces al día, y no siempre es Hoy lo que se
          quiere ver al abrirlo. Solo las cuatro del sistema: un proyecto fijado tendría que
          decidir a dónde caer cuando se borre, y eso sería un ajuste que cambia solo. */}
      <p className="settings__label">Vista al abrir</p>
      {SYSTEM_VIEWS.map(({ kind, label }) => (
        <button
          key={kind}
          type="button"
          className="menu__item"
          role="menuitemradio"
          aria-checked={kind === startView}
          onClick={() => onStartView(kind)}
        >
          <span className="menu__check">
            {kind === startView && <Check size={13} aria-hidden />}
          </span>
          {label}
        </button>
      ))}

      <div className="menu__rule" role="separator" />

      {/* Un título largo cortado a la mitad obliga a abrir el detalle para saber de qué tarea
          se trata; uno entero gasta dos o tres renglones por fila y hace que quepan menos.
          Ninguna de las dos es la respuesta correcta para todo el mundo, así que se elige una
          vez y vale para toda la app. */}
      <p className="settings__label">Texto de las tareas</p>
      {ROW_TEXTS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="menu__item"
          role="menuitemradio"
          aria-checked={option.value === rowText}
          onClick={() => onRowText(option.value)}
        >
          <span className="menu__check">
            {option.value === rowText && <Check size={13} aria-hidden />}
          </span>
          {option.label}
        </button>
      ))}

      <div className="menu__rule" role="separator" />

      {/* Una fila de glifos y no cinco renglones con sus nombres: «Cuadro» no dice qué va a
          salir en la barra, y lo que se está eligiendo es precisamente cómo se ve. El que
          importa no es el más bonito sino el que no se confunda con los vecinos que ya haya
          arriba, y eso solo se decide mirándolos. */}
      <p className="settings__label">Icono de la barra</p>
      <div className="settings__glyphs" role="radiogroup" aria-label="Icono de la barra">
        {TRAY_GLYPHS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`settings__glyph${option.value === trayGlyph ? " is-selected" : ""}`}
            role="radio"
            aria-checked={option.value === trayGlyph}
            title={option.label}
            aria-label={option.label}
            onClick={() => onTrayGlyph(option.value)}
          >
            {/* Máscara y no `img`: el PNG es una imagen *template* —negro y alfa— y en modo
                oscuro un negro sobre el vidrio oscuro no se vería. Pintar el alfa con la
                tinta de la app es lo mismo que hace macOS con la barra. */}
            <span
              className="settings__glyph-tinta"
              style={{
                maskImage: `url(/tray/${option.value}.png)`,
                WebkitMaskImage: `url(/tray/${option.value}.png)`,
              }}
            />
          </button>
        ))}
      </div>

      <div className="menu__rule" role="separator" />

      <p className="settings__label">Conservar completadas</p>
      {RETENTIONS.map((option) => (
        <button
          key={option.label}
          type="button"
          className="menu__item"
          role="menuitemradio"
          aria-checked={option.value === retention}
          onClick={() => onRetention(option.value)}
        >
          <span className="menu__check">
            {option.value === retention && <Check size={13} aria-hidden />}
          </span>
          {option.label}
        </button>
      ))}

      {/* Solo cuando se sabe que está denegado. Mientras se consulta no hay nota, porque una
          advertencia que parpadea en cada apertura del popover es peor que ninguna. Y solo
          para `denied`: con `unavailable` el enlace no llevaría a ningún sitio, porque la app
          ni siquiera figura en la lista de Ajustes del Sistema. */}
      {notify === "denied" && (
        <>
          <div className="menu__rule" role="separator" />
          <p className="settings__note">
            Las notificaciones están desactivadas, así que las tareas con hora no van a avisar.
          </p>
          <button type="button" className="menu__item" onClick={() => void openUrl(NOTIFICATIONS_PANE)}>
            <span className="menu__check" />
            Abrir Ajustes del Sistema
          </button>
        </>
      )}

      <div className="menu__rule" role="separator" />

      <button type="button" className="menu__item" disabled={busy} onClick={() => void exportJson()}>
        <span className="menu__check" />
        Exportar a JSON
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
        <span className="menu__check" />
        Mostrar los datos en Finder
      </button>

      <div className="menu__rule" role="separator" />

      {/* Sin Dock y sin ⌘Tab (spec 4), Riel no tiene menú de aplicación ni ⌘Q: sin este
          botón, pararla obligaba a ir al Monitor de Actividad. */}
      <button
        type="button"
        className="menu__item"
        onClick={() => void invoke("quit").catch((cause) => console.error(cause))}
      >
        <span className="menu__check" />
        Salir de Riel
      </button>

      <div className="menu__rule" role="separator" />

      {/* La actualización cuelga de la versión porque son la misma pregunta: qué hay puesto y
          qué hay disponible. Al día —o sin haber podido preguntar— aquí no se dibuja nada, que
          es el estado en el que va a estar casi siempre. */}
      {update.stage === "disponible" && (
        <button type="button" className="menu__item" onClick={updates.install}>
          <span className="menu__check" />
          Actualizar a {update.version}
        </button>
      )}

      {/* Un renglón deshabilitado y no un texto suelto: ocupa exactamente lo mismo que el botón
          al que reemplaza, y así el popover no cambia de alto ni se reancla al pulsar. */}
      {(update.stage === "bajando" || update.stage === "lista") && (
        <button type="button" className="menu__item" disabled>
          <span className="menu__check" />
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
          <span className="menu__check" />
          Buscar actualizaciones
        </button>
      )}

      {update.stage === "buscando" && (
        <button type="button" className="menu__item" disabled>
          <span className="menu__check" />
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
            Riel {version ?? "—"} sigue puesto y funcionando.
          </p>
          <button type="button" className="menu__item" onClick={() => void openUrl(RELEASES)}>
            <span className="menu__check" />
            Bajarla a mano
          </button>
        </>
      )}

      <p className="settings__version">Riel {version ?? "—"}</p>
    </div>
  );
}
