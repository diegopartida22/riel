//! Todo lo que tiene que ver con la ventana-panel: vidrio, posición y visibilidad.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Emitter, Manager, Runtime, WebviewWindow, Window};
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

// La clase que acaba teniendo la ventana del panel.
//
// Hereda de `NSPanel` solo para poder decir que sí a `canBecomeKeyWindow`: la ventana no tiene
// barra de título, y sin barra ni `NSWindow` ni `NSPanel` aceptan ser la ventana clave. Sin
// esto el panel se dibuja pero no recibe una sola tecla — se veía sobre la app en pantalla
// completa y el texto que uno escribía se iba a la app de debajo.
#[cfg(target_os = "macos")]
objc2::define_class!(
    #[unsafe(super(objc2_app_kit::NSPanel))]
    #[thread_kind = objc2::MainThreadOnly]
    #[name = "RielPanel"]
    struct RielPanel;

    impl RielPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            true
        }
    }
);

/// Convierte la ventana en un panel de barra de menú: uno que existe en todos los espacios,
/// incluidos los de pantalla completa de otras apps.
///
/// El bug que arregla: con otra app en pantalla completa —que en macOS no es «una ventana
/// grande» sino un espacio aparte— el panel no aparecía. La app respondía al clic del icono,
/// cambiaba el glifo y se creía visible (`isVisible` en true, posición correcta, nivel
/// correcto), pero el WindowServer la daba por fuera de pantalla: se estaba dibujando en el
/// escritorio de siempre, en el otro espacio.
///
/// Hacen falta las cuatro piezas de abajo, y el orden importa poco pero la combinación no:
/// medido con `CGWindowListCopyWindowInfo`, quitar cualquiera de ellas devuelve la ventana a
/// `enpantalla no`.
///
/// **La clase.** Es lo que costó encontrar. `NonactivatingPanel` es la que de verdad mete la
/// ventana en el espacio activo, y AppKit solo acepta esa máscara si la ventana es una
/// `NSPanel`: puesta sobre la `NSWindow` que crea tao se ignora en silencio, sin error y sin
/// efecto. Por eso la ventana se rebautiza a [`RielPanel`] con `object_setClass` antes de
/// tocar la máscara. Cambiar la clase de un objeto vivo suena peor de lo que es —es lo que
/// hace también `tauri-nspanel`— porque `NSPanel` no añade estado propio: los ivars de la
/// `NSWindow` siguen donde estaban y el delegado de tao sigue en su sitio.
///
/// **El comportamiento de colección.** `CanJoinAllSpaces` mete la ventana en todos los
/// espacios a la vez, así que aparece en el que esté activo sin arrastrar consigo un cambio de
/// espacio; es lo que hacen los popovers de la barra del sistema, y por eso el de Wi‑Fi sí se
/// abre sobre una app en pantalla completa. `FullScreenAuxiliary` es el permiso para dibujarse
/// **encima** de un espacio de pantalla completa en vez de por debajo. `Stationary` la deja
/// quieta cuando el sistema desliza los espacios, para que no se vaya con la animación como si
/// fuera parte del escritorio de donde salió. `IgnoresCycle` la saca de ⌘` por lo mismo que la
/// app no sale en ⌘Tab (spec 4).
///
/// **El nivel.** Sube de `NSFloatingWindowLevel` (3, lo que pone `alwaysOnTop`) a
/// `NSStatusWindowLevel` (25), que es donde viven los propios elementos de la barra de menú.
/// Flotante alcanza para quedar sobre las ventanas normales, pero no sobre la barra revelada
/// ni sobre las superficies que el sistema dibuja en pantalla completa. El panel cuelga del
/// icono de la barra: su sitio es el de la barra.
///
/// **No ocultarse al desactivar.** Una `NSPanel` se esconde sola cuando su app deja de ser la
/// activa. Aquí eso rompería la excepción de la spec 4: el panel tiene que seguir en pantalla
/// mientras haya un modal o el selector de fecha delante, que son justo los que se llevan el
/// foco. Quién y cuándo se oculta lo decide `on_focus_lost`, no AppKit.
#[cfg(target_os = "macos")]
pub fn make_menu_bar_panel<R: Runtime>(window: &WebviewWindow<R>) {
    use std::ptr::NonNull;

    use objc2::runtime::AnyClass;
    use objc2_app_kit::{
        NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask,
    };

    let Ok(pointer) = window.ns_window() else {
        return;
    };
    let Some(pointer) = NonNull::new(pointer) else {
        return;
    };

    // SAFETY: `ns_window()` devuelve la `NSWindow` viva de la ventana, y esto se llama desde
    // `setup`, que corre en el hilo principal.
    unsafe {
        let class = <RielPanel as objc2::ClassType>::class();
        let object = pointer.cast::<objc2::runtime::AnyObject>().as_ptr();
        objc2::ffi::object_setClass(object.cast(), (class as *const AnyClass).cast());

        let ns_window: &NSWindow = pointer.cast().as_ref();
        ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
        ns_window.setHidesOnDeactivate(false);
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        ns_window.setLevel(NSStatusWindowLevel);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn make_menu_bar_panel<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window;
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
    let cursor = window.cursor_position().ok();

    let Some(monitor) = tray_monitor(window, tray, cursor)? else {
        return Ok(());
    };

    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let window_width = window.outer_size()?.width as f64;

    let start = work_area.position.x as f64;
    let end = start + work_area.size.width as f64;
    let left = start + EDGE_MARGIN * scale;
    let right = end - window_width - EDGE_MARGIN * scale;

    // Bajo qué punto se centra el panel, en orden de preferencia:
    //
    // 1. El centro del icono, siempre que caiga en esta pantalla. Es lo correcto y lo que se
    //    usa en el caso normal.
    // 2. El puntero, si el icono dice estar en otra pantalla —o sea, si su X vino mal por lo
    //    que se explica en `tray_monitor`— o si todavía no hay icono conocido. El clic acaba
    //    de ocurrir ahí, así que el panel aparece donde se hizo, que es lo que se espera
    //    aunque no quede centrado al milímetro.
    // 3. La esquina, si no hay ni lo uno ni lo otro: es donde el icono vive de todos modos.
    let center = tray
        .map(|rect| rect.center_x())
        .filter(|x| (start..=end).contains(x))
        .or(cursor.map(|point| point.x))
        .unwrap_or(right + window_width / 2.0);

    let position = tauri::PhysicalPosition::new(
        (center - window_width / 2.0).clamp(left, right.max(left)).round() as i32,
        (work_area.position.y as f64 + MENU_BAR_GAP * scale).round() as i32,
    );

    // Con dos pantallas, esta línea es la que dice si el icono y el puntero coinciden. Si el
    // panel vuelve a abrirse donde no toca, lo que hay que mirar es si el centro que se usó
    // salió del icono o del puntero.
    if cfg!(debug_assertions) {
        eprintln!(
            "[riel] icono {tray:?}, puntero {cursor:?}, área {work_area:?} ×{scale}, centro {center} → {position:?}"
        );
    }

    window.set_position(position)
}

/// En qué pantalla está el icono de la barra. La que importa es esa, no la de la ventana:
/// puede haber quedado oculta en otra desde la última vez que se abrió.
///
/// **El puntero manda, y el rect del icono es el suplente.** Parece al revés, pero el rect
/// del icono no es de fiar con varias pantallas. `tray-icon` lo convierte desde las
/// coordenadas de AppKit —origen abajo a la izquierda, Y hacia arriba— volteando la Y contra
/// `CGDisplayPixelsHigh(CGMainDisplayID())`, o sea el alto de la pantalla **principal**, y
/// aplicando después la escala de la pantalla **del icono**. Mientras las dos pantallas
/// tengan la misma escala las dos mitades concuerdan y el resultado sale bien; en cuanto una
/// es Retina y la otra no, no hay una sola escala que sirva para las dos y el punto que llega
/// no cae dentro de ninguna pantalla. `monitor_from_point` devuelve `None`, y lo que había
/// aquí antes caía a `primary_monitor()`: hacías clic en el icono de una pantalla y el panel
/// se abría en la otra.
///
/// El puntero no tiene ese problema, porque no pasa por esa conversión: lo da el mismo
/// runtime que da los monitores, así que los dos hablan del mismo espacio. Y un clic en el
/// icono deja el cursor encima del icono por definición, así que su pantalla es la del icono.
///
/// Solo hay un camino que llega aquí sin clic previo —el `show` de arranque en desarrollo— y
/// ahí tampoco hay rect todavía, así que el puntero sigue siendo lo mejor que hay.
fn tray_monitor<R: Runtime>(
    window: &WebviewWindow<R>,
    tray: Option<crate::tray::TrayRect>,
    cursor: Option<tauri::PhysicalPosition<f64>>,
) -> tauri::Result<Option<tauri::Monitor>> {
    if let Some(point) = cursor {
        if let Some(monitor) = window.monitor_from_point(point.x, point.y)? {
            return Ok(Some(monitor));
        }
    }

    if let Some(rect) = tray {
        if let Some(monitor) = window.monitor_from_point(rect.center_x(), rect.y)? {
            return Ok(Some(monitor));
        }
    }

    window.primary_monitor()
}

pub fn show<R: Runtime>(window: &WebviewWindow<R>) {
    position(window);
    let _ = window.show();
    let _ = window.set_focus();

    crate::glass::refresh_shadow(window);
    // Que el panel se abrió, para que el frontend pueda volver a su vista de siempre. Va por
    // aquí y no por el foco de la ventana: el panel de guardar del export también devuelve el
    // foco al cerrarse, y con eso la vista se recolocaría a media exportación.
    let _ = window.emit("riel://panel-abierto", ());
}

pub fn hide<R: Runtime>(window: &WebviewWindow<R>) {
    // Cerrar el panel baja la bandera. Aquí solo se llega por un cierre explícito —Escape, el
    // icono de la barra— porque `on_focus_lost` ya se rinde antes si está en alto; y si la
    // bandera sobreviviera al cierre, la siguiente apertura no volvería a ocultarse al perder
    // el foco. Un panel clavado en pantalla es peor que uno que se cierra de más.
    set_keep_open(false);
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
