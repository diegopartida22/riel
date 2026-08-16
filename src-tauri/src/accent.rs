//! El acento del sistema.
//!
//! `NSColor.controlAccentColor` es lo que el usuario elige en Ajustes del Sistema → Apariencia,
//! y no hay forma fiable de leerlo desde CSS: `accent-color: auto` lo aplica a los `<input>`
//! nativos pero no lo expone como valor, y los controles de esta app están hechos a mano. Así
//! que lo lee Rust y lo publica como custom property.
//!
//! **Se resuelve dos veces, una por apariencia, y se publican las dos.** El color es dinámico:
//! bajo Aqua y bajo Dark Aqua no da el mismo hex. Resolverlo una sola vez dejaría el panel con
//! el acento del modo que hubiera al arrancar, y al cambiar el modo del sistema con el panel
//! abierto habría que releerlo desde JavaScript — que es justo lo que hace parpadear el cambio
//! y lo que el criterio 5 prohíbe. Publicando las dos, la elección la hace la media query, que
//! es lo mismo que ya hacen los colores de proyecto con su pareja claro/oscuro.

#[cfg(target_os = "macos")]
use tauri::{Manager, Runtime};

/// Los dos hex del acento, uno por apariencia.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Accent {
    pub light: String,
    pub dark: String,
}

/// Lee el acento del sistema bajo las dos apariencias.
///
/// Devuelve `None` cuando no hay nada que leer —fuera de macOS, o si AppKit no da el color— y
/// entonces el CSS se queda con el grafito de siempre, que es su valor por omisión.
#[cfg(target_os = "macos")]
pub fn current() -> Option<Accent> {
    use objc2_app_kit::{NSAppearance, NSAppearanceNameAqua, NSAppearanceNameDarkAqua};

    let aqua = NSAppearance::appearanceNamed(unsafe { NSAppearanceNameAqua })?;
    let dark_aqua = NSAppearance::appearanceNamed(unsafe { NSAppearanceNameDarkAqua })?;

    Some(Accent {
        light: resolve(&aqua)?,
        dark: resolve(&dark_aqua)?,
    })
}

#[cfg(not(target_os = "macos"))]
pub fn current() -> Option<Accent> {
    None
}

/// El acento resuelto bajo una apariencia concreta, en `#RRGGBB`.
///
/// `performAsCurrentDrawingAppearance` es lo que hace que `controlAccentColor` —que es un color
/// dinámico, no un valor— se concrete bajo la apariencia que le pasamos y no bajo la que tenga
/// la ventana en ese momento.
///
/// La conversión a sRGB no es opcional: `controlAccentColor` viene en un espacio catalogado y
/// pedirle sus componentes sin convertirlo antes lanza una excepción de Objective-C, que en
/// Rust es un aborto y no un `Err`.
///
#[cfg(target_os = "macos")]
fn resolve(appearance: &objc2_app_kit::NSAppearance) -> Option<String> {
    use std::cell::RefCell;

    use objc2_app_kit::{NSColor, NSColorSpace};

    let out: RefCell<Option<String>> = RefCell::new(None);

    let block = block2::StackBlock::new(|| {
        let accent = NSColor::controlAccentColor();
        *out.borrow_mut() = accent
            .colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())
            .map(|srgb| {
                let channel = |value: f64| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
                format!(
                    "#{:02x}{:02x}{:02x}",
                    channel(srgb.redComponent()),
                    channel(srgb.greenComponent()),
                    channel(srgb.blueComponent()),
                )
            });
    });

    // El bloque no escapa: `performAsCurrentDrawingAppearance` lo ejecuta y vuelve antes de
    // devolver, que es lo que deja sacar el resultado por la `RefCell`.
    appearance.performAsCurrentDrawingAppearance(&block);

    out.into_inner()
}

/// El JavaScript que publica el acento en el CSS.
///
/// Son dos propiedades y no una porque el color es dinámico (ver el encabezado del módulo):
/// `--system-accent-light` y `--system-accent-dark`, y quien elige entre las dos es la media
/// query de `tokens.css`. Si no hay acento que publicar no se escribe nada, y el `var()` de
/// `--accent` cae solo al grafito neutro.
///
/// Devuelve la cadena en vez de evaluarla porque los dos sitios que la usan tienen cosas
/// distintas en la mano: `on_page_load` una `Webview` y el observador una `WebviewWindow`.
pub fn css_script(accent: &Accent) -> String {
    format!(
        "document.documentElement.style.setProperty('--system-accent-light','{}');\
         document.documentElement.style.setProperty('--system-accent-dark','{}');",
        accent.light, accent.dark,
    )
}

/// Se queda escuchando el cambio de acento en Ajustes del Sistema y lo vuelve a publicar.
///
/// El aviso es `AppleColorPreferencesChangedNotification` del centro **distribuido**: lo emite
/// el sistema hacia todas las apps cuando alguien toca el selector de Apariencia. No sirve el
/// centro de notificaciones normal, que solo lleva las de dentro del proceso.
///
/// Sin esto el acento se quedaría en el que hubiera al arrancar. Que el panel se oculte al
/// perder el foco tapa *casi* todos los casos —cambiar el acento obliga a ir a Ajustes del
/// Sistema, que se lleva el foco, y al volver a abrirse el panel recarga en `on_page_load`—
/// pero no el del panel clavado con `KEEP_OPEN` ni el de desarrollo con `RIEL_NO_AUTOHIDE`.
#[cfg(target_os = "macos")]
pub fn watch<R: Runtime>(app: &tauri::AppHandle<R>) {
    use objc2_foundation::{ns_string, NSDistributedNotificationCenter, NSOperationQueue};

    let app = app.clone();

    let block = block2::RcBlock::new(move |_: std::ptr::NonNull<objc2_foundation::NSNotification>| {
        let Some(accent) = current() else {
            return;
        };
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.eval(&css_script(&accent));
        }
    });

    // SAFETY: se llama desde `setup`, en el hilo principal. El observador se registra para toda
    // la vida del proceso a propósito: no hay nada que desregistrar porque no hay un momento en
    // el que la app deje de querer saberlo.
    unsafe {
        let center = NSDistributedNotificationCenter::defaultCenter();
        // La cola principal explícitamente, y no `None`. `current()` entra en AppKit
        // —`NSAppearance`, `NSColor`— y eso es de hilo principal; con `None` el aviso se
        // entrega en el hilo que lo publica, que no es una promesa que valga la pena aceptar
        // para ahorrarse una línea.
        let observer = center.addObserverForName_object_queue_usingBlock(
            Some(ns_string!("AppleColorPreferencesChangedNotification")),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        );
        // El centro solo guarda una referencia débil al observador: sin esto se libera al
        // salir de la función y el aviso deja de llegar en silencio.
        std::mem::forget(observer);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn watch<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let _ = app;
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    /// Que `current()` devuelve dos hex bien formados y no aborta.
    ///
    /// Vale más de lo que parece: pedirle las componentes a `controlAccentColor` sin convertirlo
    /// antes a sRGB lanza una excepción de Objective-C, y una excepción de Objective-C en Rust
    /// es un aborto y no un `Err` — o sea que el fallo sería la app cerrándose al arrancar, no
    /// un acento que sale mal. Aquí se cae la prueba en vez de la app.
    #[test]
    fn lee_los_dos_acentos() {
        let Some(accent) = super::current() else {
            // Sin AppKit disponible no hay nada que comprobar, y eso ya lo cubre el `var()` de
            // CSS cayendo al grafito.
            return;
        };

        for hex in [&accent.light, &accent.dark] {
            assert_eq!(hex.len(), 7, "{hex} no mide lo que mide un #RRGGBB");
            assert!(hex.starts_with('#'), "{hex} no empieza por almohadilla");
            assert!(
                hex[1..].chars().all(|c| c.is_ascii_hexdigit()),
                "{hex} tiene algo que no es un dígito hexadecimal"
            );
        }
    }
}
