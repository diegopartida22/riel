//! La ventana de captura rápida (spec 18).
//!
//! Es la segunda ventana de la app y la única que se abre sin tocar la barra de menú. Reusa
//! entera la maquinaria del panel —`RielPanel`, el vidrio, la excepción de foco— porque lo
//! que se le pide es lo mismo: aparecer sobre lo que sea que haya delante, incluida una app
//! en pantalla completa, y llevarse el teclado sin activar la app. Lo único que cambia es
//! dónde se coloca y con qué arco.
//!
//! **Se construye la primera vez que se pide, no al arrancar.** Un segundo `WKWebView` vivo
//! desde el primer momento es memoria que el criterio 12 no tiene de dónde sacar, y la mayor
//! parte de los arranques —los de iniciar sesión— nunca la usan. A partir de la primera vez
//! se queda: reconstruirla en cada pulsación metería el arranque del webview entre el atajo y
//! el cursor, que es justo lo que la captura rápida existe para no tener.

use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

/// La etiqueta de la ventana. La misma que mira `capabilities/captura.json`.
pub const LABEL: &str = "captura";

/// Ancho de la ventana, en puntos.
///
/// 620 y no los 440 del panel: aquí no hay riel ni lista, hay un renglón de texto, y un
/// renglón que se lee de una pasada quiere ancho. Es también el ancho al que caben los tres
/// chips más largos del parser sin doblar a una segunda fila.
pub const WIDTH: f64 = 620.0;

/// Alto de arranque, en puntos: el campo y su renglón de pistas, sin chips y sin menú.
///
/// Cada apertura vuelve a este alto aunque la anterior hubiera crecido, y por eso el borde de
/// arriba cae siempre en la misma fila de la pantalla. Lo que crece, crece hacia abajo.
///
/// Es también el suelo del ajuste de abajo, así que tiene que ser el alto **medido** del
/// contenido en reposo y no uno holgado: de más, la ventana se abre con una banda de vidrio
/// vacío bajo el renglón de pistas y no hay forma de que encoja; de menos, se abre corta y da
/// un salto en el primer pintado. Medido con el `ResizeObserver` de `QuickCapture`.
const HEIGHT: f64 = 90.0;

/// Tope de crecimiento, en puntos. Es lo que mide el menú de comandos con sus grupos abiertos
/// más el campo y las pistas; de ahí en adelante la lista hace su propio scroll.
const MAX_HEIGHT: f64 = 505.0;

/// Dónde cae el borde superior dentro del área de trabajo, como fracción del hueco que sobra.
///
/// 0.30 y no 0.5, que es lo que hace Spotlight y lo que hace cualquier alerta del sistema:
/// una superficie centrada de verdad se lee como *baja*, porque el ojo pone el centro óptico
/// por encima del geométrico. Y deja sitio por debajo para que los chips y el menú crezcan sin
/// que la ventana tenga que saltar hacia arriba para seguir cabiendo.
const TOP_FRACTION: f64 = 0.30;

/// Abre o cierra la captura rápida. Es lo que cuelga del atajo global.
pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    // Construir una ventana y tocar `NSWindow` es cosa del hilo principal, y el atajo global
    // no promete llegar por él.
    let _ = app.run_on_main_thread(move || {
        let visible = handle
            .get_webview_window(LABEL)
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false);

        if visible {
            hide(&handle);
        } else if let Err(error) = show(&handle) {
            eprintln!("[riel] no se pudo abrir la captura rápida: {error}");
        }
    });
}

/// Deja la ventana en pantalla, con el foco y en su sitio.
pub fn show<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => build(app)?,
    };

    // Antes de colocar: el alto decide dónde cae el borde de arriba, y una apertura no puede
    // heredar el alto al que la dejó crecer la anterior.
    let _ = window.set_size(tauri::LogicalSize::new(WIDTH, HEIGHT));
    position(&window);

    // Entre colocar y mostrar, por lo mismo que en el panel: el vidrio nuevo necesita saber
    // sobre qué pantalla va a dibujar.
    crate::glass::ensure(&window, crate::glass::material(app).capture_radius());

    let _ = window.show();
    let _ = window.set_focus();
    crate::glass::refresh_shadow(&window);

    // Que se abrió, para que el campo se vacíe y vuelva a empezar. Va por un evento y no por
    // el foco de la ventana porque el foco también vuelve al cerrarse el diálogo del permiso
    // de avisos, y ahí no hay que borrar nada.
    let _ = app.emit_to(LABEL, "riel://captura-abierta", ());
    Ok(())
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

/// Ajusta el alto al del contenido. Lo pide el webview cuando aparecen o se van los chips y
/// el menú de comandos.
pub fn set_height<R: Runtime>(app: &AppHandle<R>, height: f64) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };

    let height = height.clamp(HEIGHT, MAX_HEIGHT).round();
    let _ = window.set_size(tauri::LogicalSize::new(WIDTH, height));
    // El alfa del contenido cambió de forma, y macOS cachea la sombra que derivó del anterior.
    crate::glass::refresh_shadow(&window);
}

fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("captura.html".into()))
        .title("Captura rápida")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .accept_first_mouse(true)
        .build()?;

    crate::panel::apply_glass(&window, crate::glass::material(app).capture_radius())?;
    crate::panel::make_menu_bar_panel(&window);
    Ok(window)
}

/// Centrada a lo ancho de la pantalla donde está el puntero, y anclada por arriba.
///
/// La pantalla la decide el puntero por lo mismo que en el panel: es lo único que habla del
/// mismo espacio de coordenadas que los monitores. Aquí además no hay icono de barra del que
/// tirar — el atajo puede pulsarse mirando cualquiera de las dos pantallas, y la que se está
/// mirando es donde está el ratón.
fn position<R: Runtime>(window: &WebviewWindow<R>) {
    let monitor = window
        .cursor_position()
        .ok()
        .and_then(|point| window.monitor_from_point(point.x, point.y).ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };

    let work = monitor.work_area();
    let left = work.position.x as f64;
    let top = work.position.y as f64;
    let width = work.size.width as f64;
    let height = work.size.height as f64;

    let x = left + (width - size.width as f64) / 2.0;
    let y = top + (height - size.height as f64).max(0.0) * TOP_FRACTION;

    let _ = window.set_position(tauri::PhysicalPosition::new(
        x.round() as i32,
        y.round() as i32,
    ));
}

/// Registra el atajo global, suelta el anterior, o los suelta todos si no hay ninguno puesto.
///
/// Quien decide cuál es es el usuario desde Ajustes, y la preferencia vive en `localStorage`
/// como las demás de la máquina (spec 13): Rust no la puede leer, así que el webview se la
/// pasa al arrancar y cada vez que cambia. Con la app recién instalada no hay nada registrado
/// hasta que la página del panel corre — que es lo mismo que pasa con el icono de la barra.
#[cfg(desktop)]
pub fn set_shortcut<R: Runtime>(app: &AppHandle<R>, accel: Option<&str>) -> Result<(), String> {
    use std::str::FromStr;
    use std::sync::Mutex;

    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    static PUESTO: Mutex<Option<Shortcut>> = Mutex::new(None);

    let pedido = match accel.map(str::trim).filter(|accel| !accel.is_empty()) {
        Some(accel) => {
            Some(Shortcut::from_str(accel).map_err(|_| "No se entiende ese atajo.".to_string())?)
        }
        None => None,
    };

    let manager = app.global_shortcut();
    let mut puesto = PUESTO
        .lock()
        .map_err(|_| "No se pudo cambiar el atajo. Vuelve a intentarlo.".to_string())?;

    if *puesto == pedido {
        return Ok(());
    }

    if let Some(anterior) = puesto.take() {
        let _ = manager.unregister(anterior);
    }

    if let Some(atajo) = pedido {
        let handle = app.clone();
        manager
            .on_shortcut(atajo, move |_app, _atajo, event| {
                // Solo al pulsar. Sin esto, el atajo abre la ventana al bajar la tecla y la
                // vuelve a cerrar al soltarla.
                if event.state == ShortcutState::Pressed {
                    toggle(&handle);
                }
            })
            .map_err(|_| "Ese atajo ya lo usa otra app. Prueba con otro.".to_string())?;
        if cfg!(debug_assertions) {
            eprintln!("[riel] atajo de captura: {}", accel.unwrap_or_default());
        }
        *puesto = Some(atajo);
    }

    Ok(())
}

#[cfg(not(desktop))]
pub fn set_shortcut<R: Runtime>(app: &AppHandle<R>, accel: Option<&str>) -> Result<(), String> {
    let _ = (app, accel);
    Ok(())
}
