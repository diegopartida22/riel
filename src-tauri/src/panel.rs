//! Todo lo que tiene que ver con la ventana-panel: vidrio, posición y visibilidad.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Manager, Runtime, WebviewWindow, Window};
use tauri_plugin_positioner::{Position, WindowExt};

/// Mientras esto esté en alto, perder el foco no cierra el panel. Lo levanta cualquier
/// superficie que se dibuje fuera de la ventana — un diálogo modal, el selector de fecha —
/// porque abrirla le quita el foco a la ventana y el panel se cerraría solo.
static KEEP_OPEN: AtomicBool = AtomicBool::new(false);

pub fn set_keep_open(value: bool) {
    KEEP_OPEN.store(value, Ordering::SeqCst);
}

/// El vidrio lo pinta el sistema. Nosotros solo pedimos el material correcto y nos
/// quitamos de en medio: cualquier fondo opaco encima mata el efecto.
pub fn apply_glass<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<crate::glass::Material> {
    let material = crate::glass::apply(window)?;

    if cfg!(debug_assertions) {
        eprintln!("[riel] vidrio: {}", material.as_str());
    }

    Ok(material)
}

/// Aire entre el área de trabajo y el borde superior del panel, en puntos.
///
/// Cero, porque es lo que hace el sistema: medido sobre el popover de Wi‑Fi en esta máquina,
/// su borde superior cae en la misma fila donde arranca el área de trabajo — la misma en la
/// que se apoya el borde de una ventana maximizada. Los popovers de la barra van al ras; la
/// separación que uno cree ver es el alto de la barra misma, no un margen.
///
/// El Centro de Control **no** sirve de referencia para esto: es un contenedor con relleno
/// interno, y su primer módulo arranca en y = 45 pt. Medir ese módulo da 11 pt de falso aire.
const MENU_BAR_GAP: f64 = 0.0;

/// Margen mínimo contra los bordes laterales de la pantalla, en puntos.
const EDGE_MARGIN: f64 = 8.0;

/// Coloca el panel centrado bajo el icono de la barra, en dos tiempos.
fn position<R: Runtime>(window: &WebviewWindow<R>) {
    // Primero el plugin, que es lo que pide la sección 4 del spec.
    if let Err(error) = window.move_window_constrained(Position::TrayCenter) {
        if cfg!(debug_assertions) {
            eprintln!("[riel] {error}; el panel va a la esquina");
        }
        let _ = window.move_window_constrained(Position::TopRight);
    }

    // Y después la corrección de altura, sin la cual el panel queda detrás de la barra.
    if let Err(error) = align_below_menu_bar(window) {
        eprintln!("[riel] no se pudo alinear el panel bajo la barra: {error}");
    }
}

/// La matemática del plugin está pensada para la barra de tareas de Windows: en el eje Y
/// calcula `tray_y - alto_de_ventana`, que en macOS siempre sale negativo porque el icono
/// está arriba, y entonces lo aplasta contra `tray_y` — o sea 0. El panel quedaría con sus
/// primeros puntos detrás de la barra de menú.
///
/// Lo ideal sería corregir solo la Y y conservar la X que ya dejó el plugin, pero
/// `outer_position()` no refleja un `set_position()` recién emitido: la escritura se encola
/// en el bucle de eventos y la lectura devuelve el valor anterior. Medido en esta máquina:
/// leer daba (1072, 252), se escribía (1000, 200) con éxito, y la relectura seguía dando
/// (1072, 252). Así que la X se reconstruye con la misma fórmula del plugin — centro del
/// icono menos medio panel, acotado contra los bordes — y se reescribe la posición entera.
///
/// Si `tauri-plugin-positioner` llega a corregir su eje Y en macOS, esta función se borra
/// completa y `position` se queda solo con la llamada al plugin.
fn align_below_menu_bar<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    let tray = crate::tray::last_rect();

    // El monitor que importa es el que tiene el icono, no el que tenga la ventana: puede
    // estar oculta en otra pantalla desde la última vez que se abrió.
    let monitor = match tray {
        Some(rect) => window.monitor_from_point(rect.center_x(), rect.y)?,
        None => None,
    };
    let Some(monitor) = monitor.or(window.primary_monitor()?) else {
        return Ok(());
    };

    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let window_width = window.outer_size()?.width as f64;

    let left = work_area.position.x as f64 + EDGE_MARGIN * scale;
    let right = work_area.position.x as f64 + work_area.size.width as f64
        - window_width
        - EDGE_MARGIN * scale;

    // Sin icono conocido — solo puede pasar en el primer arranque, antes de que llegue
    // ningún evento del tray — el mejor lugar es la esquina donde el icono vive de todos
    // modos.
    let x = match tray {
        Some(rect) => rect.center_x() - window_width / 2.0,
        None => right,
    };

    let position = tauri::PhysicalPosition::new(
        x.clamp(left, right.max(left)).round() as i32,
        (work_area.position.y as f64 + MENU_BAR_GAP * scale).round() as i32,
    );

    window.set_position(position)
}

pub fn show<R: Runtime>(window: &WebviewWindow<R>) {
    position(window);
    let _ = window.show();
    let _ = window.set_focus();
    crate::glass::refresh_shadow(window);
}

pub fn hide<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.hide();
}

pub fn toggle<R: Runtime>(window: &WebviewWindow<R>) {
    if window.is_visible().unwrap_or(false) {
        hide(window);
    } else {
        show(window);
    }
}

pub fn on_focus_lost<R: Runtime>(window: &Window<R>) {
    if KEEP_OPEN.load(Ordering::SeqCst) {
        return;
    }
    // En desarrollo estorba: cada vez que tocas la terminal o el navegador el panel
    // desaparece y no puedes ni mirarlo.
    if std::env::var_os("RIEL_NO_AUTOHIDE").is_some() {
        return;
    }
    if let Some(panel) = window.get_webview_window("main") {
        hide(&panel);
    }
}
