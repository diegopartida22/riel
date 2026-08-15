//! Icono de la barra de menú.
//!
//! Imagen *template* monocroma: macOS la repinta según la barra y el modo de contraste,
//! así que nunca hay que mantener una variante clara y otra oscura. Dos pesos de glifo,
//! sin badge numérico: contorno cuando no hay nada vencido, relleno cuando sí.
//!
//! Cuál de los cinco glifos se dibuja se elige en Ajustes. Los diez PNG los genera
//! `scripts/make-tray-icons.mjs` y viajan dentro del binario: son 3 KB en total, y buscarlos
//! en disco solo añadiría una forma de que el icono no aparezca.

use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

use crate::panel;

pub const TRAY_ID: &str = "riel";

/// Los glifos elegibles: nombre, contorno y relleno. El primero es el de omisión.
///
/// El nombre es el que manda el frontend y el que sale en Ajustes; que coincida con el del
/// archivo es a propósito, para que agregar un glifo sea una línea aquí y una allá.
const GLYPHS: &[(&str, &[u8], &[u8])] = &[
    (
        "casilla",
        include_bytes!("../icons/tray-casilla-outline.png"),
        include_bytes!("../icons/tray-casilla-filled.png"),
    ),
    (
        "palomita",
        include_bytes!("../icons/tray-palomita-outline.png"),
        include_bytes!("../icons/tray-palomita-filled.png"),
    ),
    (
        "lista",
        include_bytes!("../icons/tray-lista-outline.png"),
        include_bytes!("../icons/tray-lista-filled.png"),
    ),
    (
        "disco",
        include_bytes!("../icons/tray-disco-outline.png"),
        include_bytes!("../icons/tray-disco-filled.png"),
    ),
    (
        "cuadro",
        include_bytes!("../icons/tray-cuadro-outline.png"),
        include_bytes!("../icons/tray-cuadro-filled.png"),
    ),
];

/// Lo que el icono está enseñando: qué glifo y con qué peso.
///
/// Las dos cosas juntas y no en dos variables porque las dos deciden el mismo PNG: cambiar de
/// glifo tiene que conservar el peso, y cambiar de peso tiene que conservar el glifo.
static SHOWING: Mutex<(usize, bool)> = Mutex::new((0, false));

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
        // El de omisión. El elegido lo pone el frontend al arrancar, que es donde vive la
        // preferencia — igual que el peso, que también depende de datos que Rust no lee.
        .icon(Image::from_bytes(GLYPHS[0].1)?)
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

/// Vuelve a pintar el icono con lo que diga `SHOWING`.
fn paint<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let (glyph, overdue) = *SHOWING.lock().expect("SHOWING nunca entra en pánico");
    let (_, outline, filled) = GLYPHS[glyph];

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_icon(Some(Image::from_bytes(if overdue { filled } else { outline })?))?;
        // Cada `set_icon` pierde la bandera de template, y sin ella el glifo deja de
        // adaptarse a la barra clara, la oscura y el modo de contraste alto.
        tray.set_icon_as_template(true)?;
    }
    Ok(())
}

/// Cambia el peso del glifo según haya o no tareas vencidas.
pub fn set_overdue<R: Runtime>(app: &AppHandle<R>, overdue: bool) -> tauri::Result<()> {
    SHOWING.lock().expect("SHOWING nunca entra en pánico").1 = overdue;
    paint(app)
}

/// Cambia el glifo. Un nombre que no esté en la tabla deja el icono como estaba: quien lo
/// manda es el frontend leyendo `localStorage`, y ahí puede quedar el nombre de un glifo que
/// una versión posterior retiró.
pub fn set_glyph<R: Runtime>(app: &AppHandle<R>, name: &str) -> tauri::Result<()> {
    let Some(index) = GLYPHS.iter().position(|(id, _, _)| *id == name) else {
        return Ok(());
    };
    SHOWING.lock().expect("SHOWING nunca entra en pánico").0 = index;
    paint(app)
}
