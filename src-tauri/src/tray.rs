//! Icono de la barra de menú.
//!
//! Imagen *template* monocroma: macOS la repinta según la barra y el modo de contraste,
//! así que nunca hay que mantener una variante clara y otra oscura. Dos pesos de glifo,
//! sin badge numérico: contorno cuando no hay nada vencido, relleno cuando sí.

use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

use crate::panel;

pub const TRAY_ID: &str = "riel";

const OUTLINE: &[u8] = include_bytes!("../icons/tray-outline.png");
const FILLED: &[u8] = include_bytes!("../icons/tray-filled.png");

/// Dónde quedó el icono la última vez que supimos de él, en píxeles físicos.
///
/// macOS no ofrece manera de preguntarle a un `NSStatusItem` su posición: solo la manda
/// dentro de los eventos. Y se mueve — cada vez que otra app agrega o quita un extra, o
/// cambia el ancho de los menús de la app al frente. Así que guardamos el último rect que
/// nos llegó y lo refrescamos con cada evento, incluido el `Enter` del hover.
static LAST_RECT: Mutex<Option<TrayRect>> = Mutex::new(None);

#[derive(Clone, Copy, Debug)]
pub struct TrayRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
}

impl TrayRect {
    pub fn center_x(&self) -> f64 {
        self.x + self.width / 2.0
    }
}

pub fn last_rect() -> Option<TrayRect> {
    *LAST_RECT.lock().expect("LAST_RECT nunca entra en pánico")
}

fn remember(event: &TrayIconEvent) {
    let rect = match event {
        TrayIconEvent::Click { rect, .. }
        | TrayIconEvent::Enter { rect, .. }
        | TrayIconEvent::Move { rect, .. }
        | TrayIconEvent::Leave { rect, .. } => rect,
        _ => return,
    };

    // Los eventos de macOS ya vienen en físicos, así que la escala es irrelevante aquí.
    let position = rect.position.to_physical::<f64>(1.0);
    let size = rect.size.to_physical::<f64>(1.0);

    *LAST_RECT.lock().expect("LAST_RECT nunca entra en pánico") = Some(TrayRect {
        x: position.x,
        y: position.y,
        width: size.width,
    });
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, "quit", "Salir de Riel", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(OUTLINE)?)
        .icon_as_template(true)
        // El clic izquierdo abre el panel; el menú queda en el derecho.
        .show_menu_on_left_click(false)
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Ambos tienen que correr antes de mover la ventana: los eventos son lo único
            // que dice dónde está el icono, y el panel se coloca respecto a él.
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            remember(&event);
            log_event(&event);

            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    panel::toggle(&window);
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Rastro de desarrollo para encontrar el icono cuando la barra está llena y el glifo no se
/// distingue a simple vista: basta pasar el cursor por encima. Si barres toda la barra y
/// esto no imprime nada, macOS no lo está dibujando porque no cupo.
fn log_event(event: &TrayIconEvent) {
    if !cfg!(debug_assertions) {
        return;
    }
    if let TrayIconEvent::Enter { rect, .. } = event {
        eprintln!("[riel] icono bajo el cursor, en {:?}", rect.position);
    }
}

/// Cambia el peso del glifo según haya o no tareas vencidas.
pub fn set_overdue<R: Runtime>(app: &AppHandle<R>, overdue: bool) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let bytes = if overdue { FILLED } else { OUTLINE };
        tray.set_icon(Some(Image::from_bytes(bytes)?))?;
        tray.set_icon_as_template(true)?;
    }
    Ok(())
}
