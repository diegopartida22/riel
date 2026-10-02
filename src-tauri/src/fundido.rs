//! Aparecer y desaparecer como una ventana del sistema, y no como una que se enciende.
//!
//! Lo que había era `show()` y `hide()` a secas: la ventana estaba o no estaba, de un fotograma
//! al siguiente. Ningún popover de la barra de macOS hace eso —ni el de Wi‑Fi, ni el de Control,
//! ni Spotlight—: entran con un fundido muy corto y salen con uno un poco más largo, y es de lo
//! primero que se nota sin saber nombrarlo cuando falta. Un panel que se apaga de golpe se lee
//! como uno que se ha caído.
//!
//! **Es opacidad, no movimiento.** Nada se desliza ni crece, así que no hay nada que apagar con
//! «Reducir movimiento» (criterio 7): un fundido es justo lo que macOS deja cuando esa casilla
//! está puesta.
//!
//! **Lo anima AppKit y no el webview.** El vidrio lo pinta el sistema por debajo de la página,
//! y un fundido en CSS solo alcanzaría al contenido: el material aparecería entero y el texto
//! llegaría después, que es peor que no animar. `alphaValue` es de la ventana entera —vidrio,
//! sombra y página juntos— y `NSAnimationContext` lo lleva en el compositor, sin pasar por el
//! hilo del webview.
//!
//! **Se puede interrumpir.** Volver a abrir a media salida arranca el fundido de entrada desde
//! la opacidad en la que esté —es lo que hace el `animator()` por su cuenta— y la salida que
//! quedó a medias no llega a esconder nada: cada gesto lleva su número, y solo el último manda.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::{Runtime, WebviewWindow};

/// Lo que tarda en entrar. Corto a propósito: el criterio 1 pide el panel en pantalla en menos
/// de 100 ms, y un fundido que empieza en el acto y se completa a los 120 ya se está viendo
/// desde el primer fotograma.
const ENTRADA: f64 = 0.12;

/// Lo que tarda en salir. Un poco más que la entrada, que es la asimetría de los menús del
/// sistema: aparecer tiene que ser inmediato porque alguien lo está esperando, y desaparecer
/// puede tomarse su tiempo porque nadie espera nada de ello.
const SALIDA: f64 = 0.16;

/// El número del último gesto. Una salida solo esconde la ventana si al terminar sigue siendo
/// el último: si en medio se volvió a abrir, ese número ya cambió.
static GESTO: AtomicU64 = AtomicU64::new(0);

/// Qué ventanas están abiertas **de intención**, que no es lo mismo que visibles.
///
/// Durante los 160 ms de salida la ventana sigue en pantalla —`isVisible` dice que sí— y
/// preguntarle a ella si está abierta convertiría un clic en el icono a media salida en un
/// segundo cierre en vez de en una apertura. Lo que se quiere saber es qué se pidió por última
/// vez, y eso lo lleva esto.
static ABIERTAS: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn apuntar(label: &str, abierta: bool) {
    let Ok(mut abiertas) = ABIERTAS.lock() else {
        return;
    };
    abiertas.retain(|each| each != label);
    if abierta {
        abiertas.push(label.to_string());
    }
}

/// Si la última orden que recibió la ventana fue abrirse.
pub fn abierta<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    ABIERTAS
        .lock()
        .map(|abiertas| abiertas.iter().any(|each| each == window.label()))
        .unwrap_or(false)
}

/// Muestra la ventana con su fundido de entrada. Hace lo mismo que `show()` —que es quien la
/// pone delante—, así que se llama en su lugar y no además.
pub fn mostrar<R: Runtime>(window: &WebviewWindow<R>) {
    apuntar(window.label(), true);
    // Que cualquier salida que esté a medias se entere de que ya no es la última orden.
    GESTO.fetch_add(1, Ordering::SeqCst);

    #[cfg(target_os = "macos")]
    if let Some(ns_window) = mac::ns_window(window) {
        // Solo si de verdad no estaba en pantalla: a media salida ya tiene la opacidad por la
        // que va, y es desde ahí desde donde tiene que volver.
        if !ns_window.isVisible() {
            ns_window.setAlphaValue(0.0);
        }
        let _ = window.show();
        mac::animar(&ns_window, 1.0, ENTRADA, || {});
        return;
    }

    let _ = window.show();
}

/// Esconde la ventana con su fundido de salida. La ventana deja de ser «abierta» en el acto,
/// aunque siga viéndose unos milisegundos más.
pub fn ocultar<R: Runtime>(window: &WebviewWindow<R>) {
    apuntar(window.label(), false);
    let gesto = GESTO.fetch_add(1, Ordering::SeqCst) + 1;

    #[cfg(target_os = "macos")]
    if let Some(ns_window) = mac::ns_window(window) {
        if !ns_window.isVisible() {
            return;
        }
        let ventana = window.clone();
        mac::animar(&ns_window, 0.0, SALIDA, move || {
            // Otra orden llegó durante el fundido —volver a abrir— y es la que manda.
            if GESTO.load(Ordering::SeqCst) != gesto {
                return;
            }
            let _ = ventana.hide();
            // La opacidad vuelve a la normalidad con la ventana ya fuera: si algo la mostrara
            // por otro camino que no fuera `mostrar`, aparecería invisible.
            if let Some(ns_window) = mac::ns_window(&ventana) {
                ns_window.setAlphaValue(1.0);
            }
        });
        return;
    }

    let _ = gesto;
    let _ = window.hide();
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::{MainThreadMarker, Message};
    use objc2_app_kit::{NSAnimatablePropertyContainer, NSAnimationContext, NSWindow};
    use tauri::{Runtime, WebviewWindow};

    /// La `NSWindow` de una ventana, o nada fuera del hilo principal — que es donde corren el
    /// clic del icono, el atajo y los comandos que llegan aquí, pero que no hay que dar por hecho.
    pub fn ns_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<Retained<NSWindow>> {
        MainThreadMarker::new()?;
        let pointer = NonNull::new(window.ns_window().ok()?)?;
        // SAFETY: `ns_window()` devuelve la `NSWindow` viva de la ventana, y el marcador de
        // arriba ya demostró que estamos en el hilo principal.
        let ns_window: &NSWindow = unsafe { pointer.cast().as_ref() };
        Some(ns_window.retain())
    }

    /// Lleva la opacidad de la ventana a `alfa` en `duracion` segundos, y llama a `luego` al
    /// terminar — o al interrumpirse, que para AppKit es lo mismo.
    pub fn animar(
        ns_window: &NSWindow,
        alfa: f64,
        duracion: f64,
        luego: impl Fn() + 'static,
    ) {
        let objetivo = ns_window.retain();
        let cambios = RcBlock::new(move |contexto: NonNull<NSAnimationContext>| {
            // SAFETY: AppKit pasa el contexto vivo del grupo que se está armando.
            unsafe { contexto.as_ref() }.setDuration(duracion);
            objetivo.animator().setAlphaValue(alfa);
        });
        let fin = RcBlock::new(luego);
        NSAnimationContext::runAnimationGroup_completionHandler(&cambios, Some(&fin));
    }
}
