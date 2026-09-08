//! Todo lo que tiene que ver con la ventana-panel: vidrio, posición y visibilidad.

use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::atomic::AtomicI32;

use tauri::{Emitter, Manager, Runtime, WebviewWindow, Window};

/// Mientras esto esté en alto, perder el foco no cierra el panel. Lo levanta cualquier
/// superficie que se dibuje fuera de la ventana — un diálogo modal, el selector de fecha —
/// porque abrirla le quita el foco a la ventana y el panel se cerraría solo.
static KEEP_OPEN: AtomicBool = AtomicBool::new(false);

pub fn set_keep_open(value: bool) {
    KEEP_OPEN.store(value, Ordering::SeqCst);
}

/// El vidrio lo pinta el sistema. Nosotros solo pedimos el material correcto y nos
/// quitamos de en medio: cualquier fondo opaco encima mata el efecto.
pub fn apply_glass<R: Runtime>(
    window: &WebviewWindow<R>,
    radius: f64,
) -> tauri::Result<crate::glass::Material> {
    let material = crate::glass::apply(window, radius)?;

    if cfg!(debug_assertions) {
        eprintln!(
            "[riel] vidrio de «{}»: {}",
            window.label(),
            material.as_str()
        );
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

/// El pid de la app que estaba delante cuando la captura rápida se llevó el teclado, o cero si
/// no hay ninguna a la que devolvérselo.
#[cfg(target_os = "macos")]
static ANTERIOR: AtomicI32 = AtomicI32::new(0);

/// Apunta quién tenía el teclado justo antes de que la captura rápida se lo lleve.
///
/// **Abrir la captura activa la app, y no hay forma de que no lo haga.** macOS entrega las
/// teclas a la app activa y no a la ventana que esté más arriba: una ventana flotante de una
/// app inactiva se dibuja entera, enseña su cursor parpadeando y no recibe una sola letra —lo
/// que se escribe se lo queda la app de detrás. Es también lo que hacen Spotlight, Alfred y
/// Raycast, que tampoco tienen otra. Quien activa es tao al darle el foco a la ventana; aquí
/// solo se anota a quién se lo estamos quitando.
///
/// `NonactivatingPanel` promete justo lo contrario y no lo cumple, y por eso costó verlo: lo
/// que esa máscara evita es que **un clic** en la ventana active la app, que es otra cosa —y es
/// la que sí hace falta aquí, porque sin ella la ventana no entra en el espacio de una app en
/// pantalla completa (ver [`make_menu_bar_panel`]).
///
/// Lo que sí se puede prometer es lo de después, y de eso va [`give_focus_back`]: al cerrarse
/// la ventana la activación vuelve a quien la tenía. macOS no lo hace por su cuenta —medido:
/// con la captura ya escondida, la app de delante seguía siendo Riel, que a esas alturas no
/// tiene ninguna ventana donde poner lo que se escriba.
#[cfg(target_os = "macos")]
pub fn remember_frontmost() {
    use objc2_app_kit::NSWorkspace;

    // Cero si ya éramos nosotros: entonces no hay nada que devolver, y lo que quedara apuntado
    // de una apertura anterior es justo lo que no hay que traer de vuelta.
    let anterior = NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map(|app| app.processIdentifier())
        .filter(|pid| *pid != std::process::id() as i32)
        .unwrap_or(0);

    ANTERIOR.store(anterior, Ordering::SeqCst);
}

/// Devuelve la activación a quien la tenía antes de abrirse la captura rápida.
///
/// Solo si el teclado sigue siendo nuestro: si la ventana se cerró porque el usuario se fue a
/// otra app, devolvérselo a la de antes se lo quitaría a la que acaba de pulsar.
#[cfg(target_os = "macos")]
pub fn give_focus_back() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationOptions, NSRunningApplication};

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let pid = ANTERIOR.swap(0, Ordering::SeqCst);
    if pid == 0 || !NSApplication::sharedApplication(mtm).isActive() {
        return;
    }

    // Un pid que ya no corre devuelve `None`, así que no hay que comprobar que siga vivo.
    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
        app.activateWithOptions(NSApplicationActivationOptions::empty());
    }
}

#[cfg(not(target_os = "macos"))]
pub fn remember_frontmost() {}

#[cfg(not(target_os = "macos"))]
pub fn give_focus_back() {}

pub fn show<R: Runtime>(window: &WebviewWindow<R>) {
    crate::pantalla::panel(window, crate::tray::last_rect());
    // Entre colocar y mostrar: el vidrio nuevo necesita saber sobre qué pantalla va a dibujar,
    // y no puede haber un fotograma de ventana transparente antes de que esté puesto. De la
    // segunda apertura en adelante no hace nada.
    crate::glass::ensure(
        window,
        crate::glass::material(window.app_handle()).corner_radius(),
    );
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
    // En desarrollo estorba: cada vez que tocas la terminal o el navegador el panel
    // desaparece y no puedes ni mirarlo.
    if std::env::var_os("RIEL_NO_AUTOHIDE").is_some() {
        return;
    }

    // La captura rápida (sección 18) es otra ventana y se oculta por su cuenta: no la sujeta
    // `KEEP_OPEN`, que es del panel, y ocultar el panel porque ella perdió el foco cerraría
    // dos cosas con un solo gesto.
    if window.label() == crate::captura::LABEL {
        crate::captura::hide(window.app_handle());
        return;
    }

    if KEEP_OPEN.load(Ordering::SeqCst) {
        return;
    }
    if let Some(panel) = window.get_webview_window("main") {
        hide(&panel);
    }
}
