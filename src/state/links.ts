/**
 * La gramática de `riel://` (spec 14).
 *
 * Es lo que deja que otra app —Atajos, Raycast, Alfred, un `open` en la terminal— escriba una
 * tarea en Riel o la abra donde haga falta. Todo lo que entra por aquí acaba en el mismo sitio
 * que lo escrito a mano: `texto` pasa por el parser del campo de captura, así que `mañana`,
 * `#proyecto` y `!!` significan exactamente lo mismo desde un atajo que desde el panel.
 *
 * ```
 * riel://nueva?texto=Renovar%20dominio%20mañana%20!!   crea la tarea, sin abrir el panel
 * riel://nueva?texto=…&notas=…                        con notas, que no se parsean
 * riel://buscar?q=dominio                             abre el panel con la búsqueda puesta
 * riel://hoy · riel://abrir?vista=hoy                 abre el panel en esa vista
 * riel://                                             abre el panel
 * ```
 */

import { invoke } from "@tauri-apps/api/core";

import { SYSTEM_VIEWS, type SystemKind } from "./views";

/** Con qué avisa Rust de que hay enlaces por recoger. El aviso no lleva datos: la cola sí. */
export const LINK_EVENT = "riel://enlace";

export type Link =
  | { kind: "nueva"; text: string; notes: string | null }
  | { kind: "vista"; view: SystemKind }
  | { kind: "buscar"; query: string }
  | { kind: "abrir" };

/** Vacía la cola de Rust. Un solo consumidor: dos atenderían dos veces el mismo enlace. */
export const takeLinks = () => invoke<string[]>("take_links");

/**
 * Lo que pide un enlace, o nulo si no pide nada que se sepa hacer.
 *
 * Nulo no es un error que enseñar: el panel ya está abierto para todo lo que no sea `nueva`
 * (lo abre Rust al recibirlo), así que un verbo mal escrito acaba en la lista de siempre, que
 * es el sitio menos malo donde acabar. Un mensaje de error por un enlace que se disparó desde
 * otra app saldría sin nada alrededor que explique de dónde vino.
 */
export function parseLink(raw: string): Link | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "riel:") return null;

  // `riel://nueva` y `riel:nueva` son lo mismo. Las dos formas se escriben, y la segunda es la
  // que sale de teclear el esquema a mano sin acordarse de las barras.
  const verb = (url.host || url.pathname.replace(/^\/+/, "")).toLowerCase();
  const get = (name: string) => url.searchParams.get(name)?.trim() ?? "";

  if (verb === "nueva") {
    const text = get("texto");
    // Sin texto no hay tarea. Crear una vacía sería peor que no hacer nada: quedaría una fila
    // sin título en una lista que nadie está mirando.
    return text ? { kind: "nueva", text, notes: get("notas") || null } : null;
  }

  if (verb === "buscar") {
    const query = get("q");
    return query ? { kind: "buscar", query } : { kind: "abrir" };
  }

  const named = SYSTEM_VIEWS.find((each) => each.kind === verb);
  if (named) return { kind: "vista", view: named.kind };

  if (verb === "abrir" || verb === "") {
    const wanted = SYSTEM_VIEWS.find((each) => each.kind === get("vista").toLowerCase());
    return wanted ? { kind: "vista", view: wanted.kind } : { kind: "abrir" };
  }

  return null;
}
