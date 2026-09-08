//! En qué pantalla se abre cada ventana, y dónde exactamente dentro de ella.
//!
//! Vive aparte porque las dos ventanas de la app se hacen la misma pregunta —el panel para
//! colgarse del icono de la barra, la captura rápida para centrarse (spec 18.2)— y la
//! respuesta no se puede pedir por el camino de siempre.
//!
//! **Por qué no vale `cursor_position()` + `monitor_from_point()`.** Es lo que había, y con
//! dos pantallas de distinta densidad contesta mal. Las tres piezas, leídas en el código de
//! tao 0.35:
//!
//! - `cursor_position()` toma `NSEvent.mouseLocation` —puntos de Cocoa, origen abajo a la
//!   izquierda— voltea la Y contra el alto de la pantalla **principal** y multiplica las dos
//!   coordenadas por la escala de la pantalla **principal**.
//! - `monitor_from_point(x, y)` no deshace nada de eso: pasa el par tal cual a
//!   `CGRectContainsPoint` contra `CGDisplayBounds`, que está en **puntos**.
//! - `Monitor::position()` escala el origen de cada pantalla por la escala **de esa
//!   pantalla**, así que en un arreglo mixto los rectángulos que devuelve se solapan: no hay
//!   un espacio de coordenadas físico común del que hablar.
//!
//! O sea que el punto se compara al doble de su valor contra un rectángulo que no está
//! doblado. Con una sola pantalla Retina cuela casi siempre —el doble de un punto de dentro
//! suele seguir cayendo dentro— y por eso esto no se veía. Con la principal Retina y una
//! externa a su derecha, el puntero en la mitad derecha de la principal da un valor que cae
//! dentro de la externa, y el puntero en la mitad derecha de la externa da uno que se sale de
//! todo. Lo primero abre el panel en la pantalla de al lado; lo segundo devuelve `None`, y de
//! ahí se caía a `primary_monitor()` — que es el síntoma que se reporta: haces clic en el
//! icono de la pantalla donde estás y el panel aparece en la principal.
//!
//! **Lo que se hace en su lugar.** Preguntarle a AppKit, que es de donde salen los dos datos
//! y donde no hay conversión que equivocar: `NSEvent::mouseLocation` para el puntero,
//! `NSScreen::screens` para las pantallas, `visibleFrame` para el área de trabajo y
//! `setFrameOrigin:` para colocar. Todo en puntos de Cocoa y en el mismo espacio, de punta a
//! punta. Es además menos código que la corrección que había que hacerle al plugin.
//!
//! El eje Y deja de ser un caso especial de paso. En Cocoa el origen está abajo, así que
//! «pegado bajo la barra de menú» es `visibleFrame.maxY - alto`, sin voltear nada y sin la
//! fórmula del plugin —pensada para la barra de tareas de Windows— que dejaba el panel medio
//! metido detrás de la barra.

#[cfg(target_os = "macos")]
mod mac {
    use std::ptr::NonNull;

    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSEvent, NSScreen, NSWindow};
    use objc2_foundation::{NSPoint, NSRect};
    use tauri::{Runtime, WebviewWindow};

    /// Aire entre el área de trabajo y el borde superior del panel, en puntos.
    ///
    /// Cero, porque es lo que hace el sistema: medido sobre el popover de Wi‑Fi, su borde
    /// superior cae en la misma fila donde arranca el área de trabajo — la misma en la que se
    /// apoya el borde de una ventana maximizada. Los popovers de la barra van al ras; la
    /// separación que uno cree ver es el alto de la barra misma, no un margen.
    const MENU_BAR_GAP: f64 = 0.0;

    /// Margen mínimo contra los bordes laterales de la pantalla, en puntos.
    const EDGE_MARGIN: f64 = 8.0;

    /// Si un punto de Cocoa cae dentro de un rectángulo de Cocoa.
    ///
    /// Escrito a mano y no con `CGRectContainsPoint` para no arrastrar otra caja por tres
    /// comparaciones. El borde derecho y el de arriba quedan fuera a propósito: son el borde
    /// izquierdo y el de abajo de la pantalla de al lado, y un punto no puede estar en dos.
    fn contains(rect: NSRect, point: NSPoint) -> bool {
        point.x >= rect.origin.x
            && point.x < rect.origin.x + rect.size.width
            && point.y >= rect.origin.y
            && point.y < rect.origin.y + rect.size.height
    }

    /// La pantalla que contiene un punto, o la principal si no lo contiene ninguna.
    ///
    /// «Ninguna» pasa de verdad: dos pantallas de distinto alto dejan huecos en los que el
    /// puntero no puede estar pero un cálculo sí puede caer, y una recién desconectada deja
    /// coordenadas que ya no son de nadie.
    ///
    /// La principal es `screens()[0]`, que en AppKit es la que lleva la barra de menú — y no
    /// `mainScreen()`, que es la de la ventana con el teclado y por tanto cambia sola.
    fn screen_at(point: NSPoint, mtm: MainThreadMarker) -> Option<Retained<NSScreen>> {
        let screens = NSScreen::screens(mtm);

        for index in 0..screens.count() {
            let screen = screens.objectAtIndex(index);
            if contains(screen.frame(), point) {
                return Some(screen);
            }
        }

        (screens.count() > 0).then(|| screens.objectAtIndex(0))
    }

    /// Corre `body` con la `NSWindow` viva de la ventana y su pantalla, o no corre.
    ///
    /// Junta las cuatro comprobaciones que las dos colocaciones necesitan igual —hilo
    /// principal, puntero, ventana, pantalla— para que cada una se quede solo con su
    /// aritmética.
    fn place<R: Runtime>(
        window: &WebviewWindow<R>,
        body: impl FnOnce(&NSWindow, &NSScreen, NSPoint),
    ) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Ok(pointer) = window.ns_window() else {
            return;
        };
        let Some(pointer) = NonNull::new(pointer) else {
            return;
        };

        // El puntero antes que nada: es lo que decide la pantalla, y se lee una sola vez para
        // que la que se elige y la que se usa para centrar no puedan ser distintas.
        let mouse = NSEvent::mouseLocation();
        let Some(screen) = screen_at(mouse, mtm) else {
            return;
        };

        // SAFETY: `ns_window()` devuelve la `NSWindow` viva de la ventana, y `MainThreadMarker`
        // ya demostró que estamos en el hilo principal.
        let ns_window: &NSWindow = unsafe { pointer.cast().as_ref() };
        body(ns_window, &screen, mouse);
    }

    /// El panel, centrado bajo el icono de la barra y pegado al borde del área de trabajo.
    ///
    /// **Bajo qué punto se centra**, en orden de preferencia:
    ///
    /// 1. El centro del icono. Es lo correcto y lo que se usa en el caso normal.
    /// 2. El puntero, si todavía no hay icono conocido —solo el `show` de arranque en
    ///    desarrollo llega aquí sin clic previo— o si el icono dice estar fuera de esta
    ///    pantalla. El clic acaba de ocurrir ahí, así que el panel aparece donde se hizo.
    ///
    /// El rect del icono llega en el espacio de `tray-icon`, que son puntos de Cocoa
    /// multiplicados por la escala de la pantalla donde está el icono. Esa pantalla es esta:
    /// un clic en el icono deja el cursor encima del icono por definición. Así que se deshace
    /// la escala y se comprueba que lo que sale caiga dentro; si no cae, el rect vino de otra
    /// pantalla —el icono se movió, o el evento es viejo— y manda el puntero.
    pub fn panel<R: Runtime>(window: &WebviewWindow<R>, tray: Option<crate::tray::TrayRect>) {
        place(window, |ns_window, screen, mouse| {
            let visible = screen.visibleFrame();
            let frame = ns_window.frame();
            let scale = screen.backingScaleFactor();

            let center = tray
                .map(|rect| rect.center_x() / scale)
                .filter(|x| *x >= visible.origin.x && *x < visible.origin.x + visible.size.width)
                .unwrap_or(mouse.x);

            let left = visible.origin.x + EDGE_MARGIN;
            let right = visible.origin.x + visible.size.width - frame.size.width - EDGE_MARGIN;

            let x = (center - frame.size.width / 2.0).clamp(left, right.max(left));
            // En Cocoa el origen está abajo, así que «pegado bajo la barra» es el techo del
            // área de trabajo menos el alto de la ventana.
            let y = visible.origin.y + visible.size.height - frame.size.height - MENU_BAR_GAP;

            if cfg!(debug_assertions) {
                eprintln!(
                    "[riel] icono {tray:?} ×{scale}, puntero {mouse:?}, área {visible:?}, centro {center} → ({x}, {y})"
                );
            }

            ns_window.setFrameOrigin(NSPoint::new(x.round(), y.round()));
        });
    }

    /// La captura rápida: centrada a lo ancho de la pantalla donde está el puntero y anclada
    /// por arriba a `top_fraction` de lo que sobra (spec 18.2).
    ///
    /// El alto llega por parámetro y no se lee de la ventana a propósito: quien llama acaba de
    /// pedir el alto de arranque, y `set_size` no promete que la `NSWindow` ya lo tenga cuando
    /// esto corre. Leer `frame()` aquí colocaría la ventana según el alto al que la dejó
    /// crecer la apertura anterior, que es justo lo que la spec dice que no puede pasar.
    pub fn centered<R: Runtime>(window: &WebviewWindow<R>, size: (f64, f64), top_fraction: f64) {
        place(window, |ns_window, screen, _| {
            let visible = screen.visibleFrame();
            let (width, height) = size;

            let x = visible.origin.x + (visible.size.width - width) / 2.0;
            // El borde de arriba baja una fracción del hueco; el origen de Cocoa está abajo,
            // así que a ese techo hay que restarle el alto.
            let top = visible.origin.y + visible.size.height
                - (visible.size.height - height).max(0.0) * top_fraction;

            ns_window.setFrameOrigin(NSPoint::new(x.round(), (top - height).round()));
        });
    }
}

#[cfg(target_os = "macos")]
pub use mac::{centered, panel};

// ── Fuera de macOS ─────────────────────────────────────────────────────────────────────
//
// La app es de la barra de menú de macOS y no se compila para nada más, pero el resto del
// árbol sí tiene sus `cfg` puestos y esto los sigue: el plugin coloca lo que puede y la Y no
// necesita corrección donde la barra no está arriba.

#[cfg(not(target_os = "macos"))]
pub fn panel<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    tray: Option<crate::tray::TrayRect>,
) {
    use tauri_plugin_positioner::{Position, WindowExt};

    let _ = tray;
    if window.move_window_constrained(Position::TrayCenter).is_err() {
        let _ = window.move_window_constrained(Position::TopRight);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn centered<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    size: (f64, f64),
    top_fraction: f64,
) {
    use tauri_plugin_positioner::{Position, WindowExt};

    let _ = (size, top_fraction);
    let _ = window.move_window_constrained(Position::Center);
}
