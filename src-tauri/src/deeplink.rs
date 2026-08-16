//! El esquema `riel://` (spec 14): crear una tarea o abrir el panel desde fuera de la app.
//!
//! Aquí no se interpreta el enlace, solo se recoge. Lo que hay que hacer con él —parsear el
//! texto con el mismo parser del campo de captura, elegir una vista, escribir en la base— vive
//! entero en el webview, y duplicar la gramática en los dos lados es la forma segura de que
//! acaben discrepando.
//!
//! Nada de `tauri-plugin-deep-link`: en macOS el plugin escucha este mismo evento, que el
//! runtime ya emite solo con declarar el esquema en el `Info.plist`. Lo que añadiría son los
//! registros de Windows y Linux, que aquí no existen, y un permiso más.

use std::sync::Mutex;

use tauri::{Emitter, Manager};

/// Con qué se avisa al webview de que hay enlaces por recoger. Sin datos: el aviso es el
/// timbre y la cola es la carta.
pub const EVENT: &str = "riel://enlace";

/// Los enlaces que llegaron y que el webview todavía no ha recogido.
///
/// Hace falta la cola porque el caso normal es el que peor lo tiene: un `riel://` con Riel
/// cerrada arranca la app, y `application:openURLs:` llega antes de que el webview exista, así
/// que el evento se emitiría contra nadie. Con la cola el evento es solo un aviso y la verdad
/// está aquí; el frontend la vacía al montar y cada vez que se le avisa. Un solo consumidor,
/// que es lo que impide atender dos veces el mismo enlace.
static PENDING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Tope de la cola. Solo se llega si algo dispara enlaces en bucle contra una app que no los
/// está recogiendo; sin tope eso sería memoria creciendo sin fondo.
const MAX: usize = 64;

/// Un `riel://` que acaba de llegar. Lo llama el bucle de eventos con `RunEvent::Opened`.
pub fn received<R: tauri::Runtime>(app: &tauri::AppHandle<R>, urls: Vec<url::Url>) {
    let mut show = false;
    let mut any = false;

    {
        let Ok(mut queue) = PENDING.lock() else {
            return;
        };

        for url in urls {
            if url.scheme() != "riel" {
                continue;
            }

            // Crear una tarea no abre el panel, y es lo único que no lo abre: el enlace se
            // dispara desde otra app —un atajo, un lanzador— y lo que se quiere de ahí es que
            // la tarea quede escrita sin dejar de estar donde se estaba. Todo lo demás es
            // pedir mirar la lista, así que el panel se abre desde aquí y no esperando a que
            // el webview arranque y lo pida de vuelta.
            show |= url.host_str() != Some("nueva");

            if queue.len() < MAX {
                queue.push(url.into());
                any = true;
            }
        }
    }

    if !any {
        return;
    }

    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if show {
        crate::panel::show(&window);
    }
    let _ = window.emit(EVENT, ());
}

/// Vacía la cola. Lo llama el frontend, que es el único que la consume.
pub fn take() -> Vec<String> {
    PENDING
        .lock()
        .map(|mut queue| std::mem::take(&mut *queue))
        .unwrap_or_default()
}
