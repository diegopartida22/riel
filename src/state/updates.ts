/**
 * El actualizador.
 *
 * Es lo único de Riel que sale a la red, y conviene ser explícito sobre hasta dónde: lee un
 * `latest.json` colgado de la última release del repo y, si anuncia una versión más alta que
 * la instalada, se baja el paquete y lo reemplaza. No manda nada —ni qué versión hay puesta,
 * ni cuántas tareas hay, ni un identificador—, porque una descarga de un archivo estático no
 * tiene dónde ponerlo. Lo que GitHub ve es lo mismo que vería si alguien abriera la página de
 * releases en Safari.
 *
 * Nada se instala solo. El chequeo es silencioso y lo único que produce es un renglón en
 * Ajustes; quien decide bajarlo es el usuario. Un panel de barra de menú que se reinicia solo
 * mientras se escribe una tarea es exactamente el tipo de cosa que hace desinstalar una app.
 *
 * La firma la verifica `tauri-plugin-updater` contra la llave pública de `tauri.conf.json`
 * antes de tocar el paquete instalado. Sin la llave privada —que no está en el repo— un
 * `latest.json` alterado no llega a ejecutarse.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

/** Cada cuánto se vuelve a preguntar. */
const EVERY_MS = 24 * 60 * 60 * 1000;

/** Cuánto se espera al `latest.json` antes de rendirse. Un chequeo de fondo no puede colgarse. */
const TIMEOUT_MS = 20_000;

/**
 * - `ninguna`: al día, o todavía sin respuesta. Para la UI son lo mismo: no se dibuja nada.
 * - `disponible`: hay versión nueva y espera un clic.
 * - `bajando`: `percent` es `null` mientras el servidor no diga cuánto pesa.
 * - `lista`: instalada; lo siguiente es el reinicio.
 * - `fallo`: se intentó y no se pudo. Solo aparece si el usuario pulsó, nunca de fondo.
 */
export type UpdateState =
  | { stage: "ninguna" }
  | { stage: "disponible"; version: string }
  | { stage: "bajando"; version: string; percent: number | null }
  | { stage: "lista"; version: string }
  | { stage: "fallo"; version: string };

export interface Updates {
  state: UpdateState;
  /** Baja, instala y reinicia. Sin efecto si no hay nada que instalar o si ya está en marcha. */
  install: () => void;
}

export function useUpdates(): Updates {
  const [state, setState] = useState<UpdateState>({ stage: "ninguna" });
  /** El objeto del plugin. No cabe en `useState`: lleva métodos y no sobrevive a un render. */
  const found = useRef<Update | null>(null);
  const checkedAt = useRef(0);
  const busy = useRef(false);
  /** Una consulta en vuelo. Sin esto, abrir el panel dos veces seguidas lanzaría dos. */
  const asking = useRef(false);

  useEffect(() => {
    const look = async () => {
      // Ya hay algo esperando, o se está bajando: preguntar otra vez no cambiaría nada y
      // podría reemplazar por debajo el objeto que `install` tiene apuntado.
      if (busy.current || asking.current || found.current) return;
      if (checkedAt.current && Date.now() - checkedAt.current < EVERY_MS) return;
      asking.current = true;

      try {
        const update = await check({ timeout: TIMEOUT_MS });
        // El reloj se sella con la respuesta, no con la pregunta: si se sellara antes, un
        // fallo gastaría el turno del día igual que un acierto.
        checkedAt.current = Date.now();
        if (!update) return;
        found.current = update;
        setState({ stage: "disponible", version: update.version });
      } catch (cause) {
        // Sin red, con el Wi-Fi de un café de por medio o con GitHub caído. Ninguna de las
        // tres es noticia: la app funciona igual y se vuelve a preguntar en la próxima
        // apertura, porque el reloj de arriba se quedó sin sellar. Un aviso aquí sería ruido
        // por algo que el usuario no pidió.
        console.error(cause);
      } finally {
        asking.current = false;
      }
    };

    // Sin bandera de «ya no estoy montado» a propósito. Este efecto vive en la raíz de la
    // app, que no se desmonta nunca; lo que sí pasa es que `StrictMode` lo monta dos veces en
    // desarrollo, y una bandera así tiraría justo la respuesta de la primera —la única que
    // llega, porque el reloj ya impide que la segunda pregunte— y en `tauri dev` no
    // aparecería nunca una actualización.
    void look();

    // Y de ahí en adelante, al abrir el panel. Un `setInterval` de 24 h era lo obvio y es lo
    // que no funciona: el panel vive cerrado y macOS estrangula los temporizadores de una
    // webview sin ventana visible —el mismo motivo por el que los avisos los lleva Rust—, así
    // que ese intervalo despertaría tarde y a saber cuándo. El panel, en cambio, se abre
    // decenas de veces al día, y el reloj de arriba se encarga de que solo una cuente.
    const unlisten = listen("riel://panel-abierto", () => void look());

    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  const install = useCallback(() => {
    const update = found.current;
    if (!update || busy.current) return;
    busy.current = true;
    setState({ stage: "bajando", version: update.version, percent: null });

    let total = 0;
    let got = 0;

    void update
      .downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          got += event.data.chunkLength;
          // Sin `Content-Length` no hay porcentaje que enseñar. Pasa cuando la descarga viene
          // troceada, y es mejor un renglón que dice «Bajando…» que una barra inventada.
          setState({
            stage: "bajando",
            version: update.version,
            percent: total ? Math.min(100, Math.round((got / total) * 100)) : null,
          });
        }
      })
      .then(async () => {
        setState({ stage: "lista", version: update.version });
        // El paquete ya está reemplazado en el disco, pero el proceso en memoria sigue siendo
        // el viejo. Hasta reiniciar no cambia nada de lo que se ve.
        await invoke("restart");
      })
      .catch((cause) => {
        console.error(cause);
        busy.current = false;
        // El objeto queda inservible después de un intento fallido —el paquete a medio bajar
        // ya no sirve—, así que se suelta y el próximo chequeo lo vuelve a encontrar entero.
        found.current = null;
        checkedAt.current = 0;
        setState({ stage: "fallo", version: update.version });
      });
  }, []);

  return { state, install };
}
