/**
 * La agenda del día (spec 15): los eventos del Calendario que caen hoy, encima de las tareas.
 *
 * Una lista de tareas de hoy sin el día delante miente por omisión: la tarde con tres juntas y
 * la tarde libre se ven exactamente igual, y lo que se decide mirando Hoy es qué cabe. Los
 * eventos se leen y no se tocan — no hay forma de crear, editar ni borrar uno desde aquí— y no
 * se guardan: cada apertura vuelve a preguntarle a EventKit, que es de donde también los lee
 * Calendario.app.
 *
 * Es opcional y viene apagada. Encenderla es lo que dispara la pregunta del sistema, por lo
 * mismo que con los avisos (spec 7): un permiso se entiende cuando ya se sabe para qué es.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import type { Permission } from "./notifications";

/** Un evento, ya reducido a lo que se dibuja. Las horas van en segundos desde epoch. */
export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  /** Sin hora que enseñar: de día entero, o empezado en un día anterior. */
  allDay: boolean;
}

/** Con qué avisa Rust de que el panel se acaba de abrir. Es cuando se vuelve a preguntar. */
const PANEL_OPENED = "riel://panel-abierto";

/** No es un dato, es una preferencia de esta máquina: va con el riel y la vista de arranque. */
const KEY = "riel:agenda";

/** Una sola lista vacía para todos los casos en que no hay nada: así React no repinta de más. */
const NONE: CalendarEvent[] = [];

export interface Agenda {
  /** Los de hoy, de día entero primero y después por hora. Vacío si está apagada o denegada. */
  events: CalendarEvent[];
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  /** El permiso del sistema. Nulo mientras se consulta, que son milisegundos. */
  permission: Permission | null;
}

const calendarPermission = () => invoke<Permission>("calendar_permission");

/** El principio y el final del día local, que es el rango que se le pide a EventKit. */
function span(day: string): { from: number; to: number } {
  const [year, month, date] = day.split("-").map(Number);
  return {
    from: new Date(year, month - 1, date).getTime() / 1000,
    // Pasa por `Date` a propósito, como `nextDay`: en marzo y en octubre el día no dura 24 h.
    to: new Date(year, month - 1, date + 1).getTime() / 1000,
  };
}

export function useAgenda(today: string): Agenda {
  const [enabled, setOn] = useState(() => localStorage.getItem(KEY) === "1");
  const [permission, setPermission] = useState<Permission | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>(NONE);

  /**
   * Se relee al abrir el panel y no con un temporizador, por lo mismo que los avisos y el
   * chequeo de actualizaciones (spec 7 y 11): con el panel cerrado la webview está estrangulada,
   * y un `setInterval` de un minuto no dispararía cuando toca sino todos juntos al volver. Abrir
   * el panel es además el único momento en que la agenda se ve, así que es cuando importa.
   *
   * El permiso se vuelve a consultar en cada pasada porque puede haber cambiado fuera: dárselo
   * en Ajustes del Sistema y volver a Riel tiene que enseñar los eventos sin reiniciar nada.
   * Está en las dependencias para que concederlo desde el interruptor traiga la lista en el
   * momento; volver a poner el mismo valor no repinta, así que no hay ciclo.
   */
  useEffect(() => {
    let alive = true;

    const load = async () => {
      const state = await calendarPermission();
      if (!alive) return;
      setPermission(state);
      if (!enabled || state !== "granted") {
        setEvents(NONE);
        return;
      }

      const { from, to } = span(today);
      const list = await invoke<CalendarEvent[]>("agenda", { from, to });
      if (alive) setEvents(list.length ? list : NONE);
    };

    const run = () => void load().catch((cause) => console.error(cause));
    run();
    const off = listen(PANEL_OPENED, run);

    return () => {
      alive = false;
      void off.then((stop) => stop()).catch((cause) => console.error(cause));
    };
  }, [enabled, today, permission]);

  /**
   * Encenderla es lo que pide el permiso. Queda encendida aunque lo denieguen: lo que dice el
   * interruptor es que se quiere ver la agenda, y apagarlo solo porque el sistema dijo que no
   * borraría la petición y dejaría la nota de Ajustes hablando de algo que ya nadie pidió.
   *
   * La pregunta del sistema es una ventana aparte y se lleva el foco, así que sin levantar la
   * bandera el panel se cerraría por debajo justo mientras se contesta (spec 4).
   */
  const setEnabled = useCallback((value: boolean) => {
    localStorage.setItem(KEY, value ? "1" : "0");
    setOn(value);
    if (!value) return;

    void (async () => {
      const state = await calendarPermission();
      // Denegado o no disponible: preguntar otra vez no abre nada y macOS contesta lo mismo.
      if (state !== "default") {
        setPermission(state);
        return;
      }

      await invoke("set_keep_open", { value: true }).catch((cause) => console.error(cause));
      try {
        await invoke<boolean>("request_calendar_permission");
      } finally {
        await invoke("set_keep_open", { value: false }).catch((cause) => console.error(cause));
      }
      setPermission(await calendarPermission());
    })().catch((cause) => console.error(cause));
  }, []);

  return { events, enabled, setEnabled, permission };
}
