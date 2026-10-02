//! La ventana de captura rápida (spec 18).
//!
//! Es la segunda ventana de la app y la única que se abre sin tocar la barra de menú. Reusa
//! entera la maquinaria del panel —`RielPanel`, el vidrio, la excepción de foco— porque lo
//! que se le pide es lo mismo: aparecer sobre lo que sea que haya delante, incluida una app
//! en pantalla completa, y llevarse el teclado. Lo único que cambia es dónde se coloca y con
//! qué arco.
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

/// Alto de la primera apertura, en puntos: el campo, la lista de Hoy con tres o cuatro filas y
/// el renglón de pistas. Solo vale una vez —la ventana se construye la primera vez que se pide y
/// a partir de ahí se queda—, así que no tiene que acertar: tiene que caer cerca para que el
/// primer pintado no dé un salto largo.
const HEIGHT: f64 = 300.0;

/// El suelo del ajuste de abajo: el campo, una lista vacía con su «Nada para hoy.» y las pistas.
/// Por debajo de esto no hay contenido que medir, así que un alto menor solo puede venir de un
/// pintado a medias.
const MIN_HEIGHT: f64 = 150.0;

/// Tope de crecimiento, en puntos. El campo con notas y chips, la lista con sus ocho filas y las
/// pistas; de ahí en adelante la lista hace su propio scroll.
const MAX_HEIGHT: f64 = 560.0;

/// El alto con el que se calcula dónde cae el borde de arriba, sea cual sea el que tenga la
/// ventana al abrirse.
///
/// La ventana ya no vuelve a un alto fijo en cada apertura: lleva la lista dentro, y la lista
/// mide lo que haya pendiente. Si el borde de arriba se calculara con el alto de cada vez, una
/// semana con seis tareas y otra con dos abrirían el campo en dos filas distintas de la pantalla,
/// y el campo es lo único que el ojo va a buscar al pulsar el atajo. Así que el techo se calcula
/// siempre con este, y lo que mida de más o de menos crece o encoge hacia abajo.
const ANCLA: f64 = 300.0;

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

    // Antes de nada, porque lo de abajo ya nos pone delante: a quién hay que devolverle el
    // teclado cuando esta ventana se vaya (spec 18.2).
    crate::panel::remember_frontmost();

    // Sin tocar el alto: es el que dejó la apertura anterior, y la página ya se volvió a medir
    // al cerrarse (ver `hide`), así que con la lista de siempre es el bueno. El borde de arriba
    // no depende de él (ver `ANCLA`).
    position(&window);

    // Entre colocar y mostrar, por lo mismo que en el panel: el vidrio nuevo necesita saber
    // sobre qué pantalla va a dibujar.
    crate::glass::ensure(&window, crate::glass::material(app).capture_radius());

    crate::fundido::mostrar(&window);
    // Y esto activa la app, que es lo que hace que las teclas lleguen aquí y no a lo que
    // hubiera delante. De ahí que el apunte de arriba tenga que ir antes.
    let _ = window.set_focus();
    crate::glass::refresh_shadow(&window);

    // Que se abrió, para que el campo se vacíe y vuelva a empezar. Va por un evento y no por
    // el foco de la ventana porque el foco también vuelve al cerrarse el diálogo del permiso
    // de avisos, y ahí no hay que borrar nada.
    let _ = app.emit_to(LABEL, "riel://captura-abierta", ());
    Ok(())
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    // Dos veces seguidas pasa —cerrar con Escape le devuelve el teclado a la app de antes, y
    // eso le quita el foco a esta, que es el otro camino por el que se cierra— y la segunda no
    // tiene nada que hacer.
    if !crate::fundido::abierta(&window) {
        return;
    }
    crate::fundido::ocultar(&window);
    // El teclado vuelve donde estaba. No hace nada si la ventana se cerró justamente porque el
    // usuario se fue a otra app: ahí el foco ya está donde tiene que estar.
    crate::panel::give_focus_back();
    // Que se cerró, para que la página vuelva a empezar ya y no al abrirse otra vez: así se
    // vuelve a medir con la ventana escondida, y la próxima apertura sale con su alto bueno en
    // vez de dar el salto en el primer fotograma.
    let _ = window.emit("riel://captura-cerrada", ());
}

/// Cierra la captura y abre el panel en una vista. Es el «ver todo» de la lista de la captura:
/// ahí se ven seis u ocho filas, y lo que no cabe está en el panel.
///
/// La vista llega del webview y se comprueba contra una lista cerrada antes de convertirla en
/// enlace, por lo mismo que los editores de la spec 13: lo que no está en la lista no existe.
pub fn to_panel<R: Runtime>(app: &AppHandle<R>, vista: &str) {
    if !matches!(vista, "hoy" | "proximas" | "todas") {
        return;
    }
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };

    // Sin devolver el teclado: se lo queda el panel, que es lo que se acaba de pedir. Lo que
    // quedara apuntado de la apertura se olvida, o al cerrar el panel más tarde no habría quién
    // lo reclamara y la próxima captura lo devolvería a una app que ya nadie estaba usando.
    crate::panel::forget_frontmost();
    crate::fundido::ocultar(&window);
    let _ = window.emit("riel://captura-cerrada", ());

    // Por el mismo camino que un `riel://` llegado de fuera (spec 14): es el que ya sabe abrir el
    // panel y llevarlo a una vista, y un segundo camino para lo mismo sería otro que mantener.
    if let Ok(url) = url::Url::parse(&format!("riel://{vista}")) {
        crate::deeplink::received(app, vec![url]);
    }
}

/// Ajusta el alto al del contenido. Lo pide el webview cuando aparecen o se van los chips y
/// el menú de comandos.
pub fn set_height<R: Runtime>(app: &AppHandle<R>, height: f64) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };

    let height = height.clamp(MIN_HEIGHT, MAX_HEIGHT).round();
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
/// La pantalla la decide el puntero, como en el panel. Aquí además no hay icono de barra del
/// que tirar — el atajo puede pulsarse mirando cualquiera de las dos pantallas, y la que se
/// está mirando es donde está el ratón.
///
/// El techo se calcula con [`ANCLA`] y no con el alto de la ventana, que cambia con la lista.
fn position<R: Runtime>(window: &WebviewWindow<R>) {
    crate::pantalla::centered(window, WIDTH, ANCLA, TOP_FRACTION);
}

/// El atajo que está registrado ahora mismo, que es el único que no cuenta como ocupado al
/// probar los demás: si sale que no se puede registrar es porque ya lo tenemos nosotros.
#[cfg(desktop)]
static PUESTO: std::sync::Mutex<Option<tauri_plugin_global_shortcut::Shortcut>> =
    std::sync::Mutex::new(None);

/// Registra el atajo global, suelta el anterior, o los suelta todos si no hay ninguno puesto.
///
/// Quien decide cuál es es el usuario desde Ajustes, y la preferencia vive en `localStorage`
/// como las demás de la máquina (spec 13): Rust no la puede leer, así que el webview se la
/// pasa al arrancar y cada vez que cambia. Con la app recién instalada no hay nada registrado
/// hasta que la página del panel corre — que es lo mismo que pasa con el icono de la barra.
#[cfg(desktop)]
pub fn set_shortcut<R: Runtime>(app: &AppHandle<R>, accel: Option<&str>) -> Result<(), String> {
    use std::str::FromStr;

    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

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

/// De las combinaciones que se le pasen, las que ninguna otra app tiene cogidas.
///
/// Es lo único que contesta esa pregunta: macOS no lleva un registro público de quién tiene qué
/// atajo global, así que la única forma de saberlo es pedirlo y ver si te lo dan. Se suelta
/// enseguida —lo que dura es una llamada— y por eso lo que se puede decir de una combinación
/// ocupada es eso, que lo está, y nunca por quién. Lo del sistema es la otra mitad y esa sí
/// tiene nombre (ver `atajos`).
///
/// El que ya está puesto no se prueba: registrarlo fallaría porque lo tenemos nosotros, y
/// contarlo como ajeno sería decirle a alguien que su propio atajo está cogido.
#[cfg(desktop)]
pub fn probe<R: Runtime>(app: &AppHandle<R>, accels: &[String]) -> Vec<String> {
    use std::str::FromStr;

    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let manager = app.global_shortcut();
    let nuestro = PUESTO.lock().ok().and_then(|puesto| *puesto);

    accels
        .iter()
        .filter(|accel| {
            let Ok(atajo) = Shortcut::from_str(accel) else {
                return false;
            };
            if Some(atajo) == nuestro {
                return true;
            }
            match manager.register(atajo) {
                Ok(()) => {
                    let _ = manager.unregister(atajo);
                    true
                }
                Err(_) => false,
            }
        })
        .cloned()
        .collect()
}

#[cfg(not(desktop))]
pub fn probe<R: Runtime>(app: &AppHandle<R>, accels: &[String]) -> Vec<String> {
    let _ = app;
    accels.to_vec()
}

#[cfg(not(desktop))]
pub fn set_shortcut<R: Runtime>(app: &AppHandle<R>, accel: Option<&str>) -> Result<(), String> {
    let _ = (app, accel);
    Ok(())
}
