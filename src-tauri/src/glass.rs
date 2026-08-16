//! El vidrio del panel.
//!
//! Dos materiales, elegidos en runtime:
//!
//! - **Liquid Glass** (`NSGlassEffectView`, macOS 26+). Es lo que usan los paneles de la
//!   barra del propio sistema en Tahoe — Centro de Control, Wi-Fi, sonido. Refracta el
//!   fondo en los bordes y dibuja su propio filo especular, y por eso se ve más denso y
//!   más "pulido" que el material heredado.
//! - **`NSVisualEffectMaterial::Popover`** vía `window-vibrancy`, que es lo que pide la
//!   sección 4 del spec. Sigue siendo el camino correcto en macOS 13–15, donde el vidrio
//!   nuevo no existe.
//!
//! `NSGlassEffectView` es API pública (`API_AVAILABLE(macos(26.0))` en `NSGlassEffectView.h`
//! del SDK 26). Aun así se busca por nombre en el runtime en vez de enlazarse: así el mismo
//! binario corre en Tahoe y en macOS 13 sin `#[cfg]` de versión ni comprobar `NSAppKitVersion`.

use tauri::{Runtime, WebviewWindow};

/// Qué material acabó pintando el panel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Material {
    /// `NSGlassEffectView`, macOS 26+.
    Liquid,
    /// `NSVisualEffectView` con material `Popover`.
    Popover,
}

impl Material {
    /// El valor que ve el CSS en `document.documentElement.dataset.glass`.
    pub fn as_str(self) -> &'static str {
        match self {
            Material::Liquid => "liquid",
            Material::Popover => "popover",
        }
    }

    /// Radio de las esquinas del panel, en puntos.
    ///
    /// El spec (sección 3.4) pide 12, que es el radio de los popovers del sistema hasta
    /// macOS 15 — y por eso sigue siendo el del camino heredado. Tahoe los redondeó más:
    /// medido sobre un banner de notificación nativo, que es el mismo tipo de superficie
    /// flotante de vidrio y en la misma esquina de la pantalla, el arco de Apple ocupa unos
    /// 30 px físicos contra los 18 que daban 12 pt. De ahí sale el 20.
    pub fn corner_radius(self) -> f64 {
        match self {
            Material::Liquid => 20.0,
            Material::Popover => 12.0,
        }
    }
}

pub fn apply<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<Material> {
    #[cfg(target_os = "macos")]
    {
        let ns_view = window.ns_view()?;

        // SAFETY: `ns_view()` devuelve la `NSView` viva de la ventana, y `apply_glass` se
        // llama desde `setup`, que corre en el hilo principal.
        if unsafe { liquid::apply(ns_view, Material::Liquid.corner_radius()) } {
            return Ok(Material::Liquid);
        }

        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

        // `FollowsWindowActiveState` es lo que hace macOS con cualquier ventana: al dejar de
        // ser la clave, la vibrancy se desatura. Aquí casi no se ve, porque perder el foco
        // oculta el panel — se ve mientras KEEP_OPEN está en alto, que es cuando un modal o el
        // selector de fecha se llevan el foco y el panel sigue delante, y ahí desaturarse es
        // justamente lo correcto: la ventana que manda es la otra.
        //
        // El precio, y está medido: entre `show()` y `set_focus()` puede colarse un fotograma
        // con el material apagado. `show()` los llama seguidos, así que es un fotograma y no
        // un parpadeo — pero es el motivo por el que esto estuvo en `Active`.
        //
        // Esto solo alcanza al camino heredado. `NSGlassEffectView` no tiene un estado
        // equivalente, así que en Tahoe lo que refleja la ventana inactiva es el intercambio
        // de tokens de `data-window` (ver `publish_active_to_css`), que además vale para los
        // dos caminos.
        apply_vibrancy(
            window,
            NSVisualEffectMaterial::Popover,
            Some(NSVisualEffectState::FollowsWindowActiveState),
            Some(Material::Popover.corner_radius()),
        )
        .expect("la vibrancy de macOS requiere 10.10 o superior");

        Ok(Material::Popover)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(Material::Popover)
    }
}

/// Le pasa al CSS qué material ganó y con qué radio, para que no haya dos números que
/// mantener a mano. Va en `on_page_load` porque es el único momento con la página lista y
/// antes del primer pintado, y porque así también cubre las recargas de Vite.
pub fn publish_to_css<R: Runtime>(webview: &tauri::Webview<R>, material: Material) {
    let script = format!(
        "document.documentElement.dataset.glass='{}';\
         document.documentElement.style.setProperty('--panel-radius','{}px');",
        material.as_str(),
        material.corner_radius(),
    );
    let _ = webview.eval(&script);
}

/// Le dice al CSS si la ventana es la clave, para que el contenido refleje lo que el material
/// ya refleja por su cuenta.
///
/// macOS desatura los controles de acento de una ventana inactiva, y el material heredado se
/// desatura solo con `FollowsWindowActiveState`. Lo que no se desatura solo es lo que pintamos
/// nosotros — el interruptor, el anillo de foco, el cursor, la selección — ni el vidrio de
/// `NSGlassEffectView`, que no tiene estado de ventana. De eso se encarga esto: con
/// `data-window="inactivo"`, `tokens.css` cambia el acento por el grafito neutro.
///
/// Un atributo y no una clase por lo mismo que `data-glass`: lo mira solo el CSS.
pub fn publish_active_to_css<R: Runtime>(window: &WebviewWindow<R>, active: bool) {
    let value = if active { "activo" } else { "inactivo" };
    let _ = window.eval(&format!(
        "document.documentElement.dataset.window='{value}';"
    ));
}

/// Vuelve a calcular la sombra a partir de lo que hay pintado ahora mismo.
///
/// macOS deriva la sombra del alfa del contenido, pero la calcula una sola vez y la cachea.
/// Cuando `apply` corre, la ventana todavía no se ha mostrado y su contenido es un rectángulo
/// transparente, así que la sombra queda rectangular — y al aparecer el vidrio redondeado se
/// ve el contorno cuadrado asomando por las esquinas. Hay que llamar a esto **después** de
/// `show()`, que es cuando el contenido ya es el definitivo.
pub fn refresh_shadow<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        if let Ok(ns_view) = window.ns_view() {
            // SAFETY: `ns_view()` devuelve la `NSView` viva de la ventana, y esto se llama
            // desde `show()`, en el hilo principal.
            unsafe { liquid::refresh_shadow(ns_view) };
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

#[cfg(target_os = "macos")]
mod liquid {
    use std::ffi::c_void;
    use std::ptr::NonNull;

    use objc2::msg_send;
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::AnyClass;
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindowOrderingMode};

    /// # Safety
    ///
    /// `ns_view` tiene que ser la `NSView` viva de la ventana, en el hilo principal.
    pub unsafe fn refresh_shadow(ns_view: *mut c_void) {
        let Some(ns_view) = NonNull::new(ns_view) else {
            return;
        };
        unsafe {
            let view: &NSView = ns_view.cast().as_ref();
            if let Some(window) = view.window() {
                window.invalidateShadow();
            }
        }
    }

    /// `NSGlassEffectViewStyleRegular`. El otro, `Clear` (= 1), quita casi todo el difuminado
    /// y deja pasar el fondo entero: sirve para vidrio sobre fotos o video, no para una
    /// superficie que tiene que sostener texto de 11px.
    const STYLE_REGULAR: isize = 0;

    /// Mete una `NSGlassEffectView` por debajo del webview. Devuelve `false` si la clase no
    /// existe, que es exactamente el caso de macOS 25 y anteriores.
    ///
    /// # Safety
    ///
    /// `ns_view` tiene que ser la `NSView` viva de la ventana, y esto tiene que correr en el
    /// hilo principal.
    pub unsafe fn apply(ns_view: *mut c_void, radius: f64) -> bool {
        let Some(class) = AnyClass::get(c"NSGlassEffectView") else {
            return false;
        };
        let Some(ns_view) = NonNull::new(ns_view) else {
            return false;
        };

        unsafe {
            let host: &NSView = ns_view.cast().as_ref();
            let bounds = host.bounds();

            // `NSGlassEffectView` es subclase de `NSView`, así que tratarla como tal es
            // sólido: lo único que le pedimos de más son dos setters, y esos van por
            // `msg_send!`.
            let allocated: Allocated<NSView> = msg_send![class, alloc];
            let glass: Retained<NSView> = msg_send![allocated, initWithFrame: bounds];

            let _: () = msg_send![&*glass, setStyle: STYLE_REGULAR];
            let _: () = msg_send![&*glass, setCornerRadius: radius];

            // `cornerRadius` redondea lo que se *ve*, pero la vista sigue cubriendo su rect
            // entero con algo de alfa en las esquinas. macOS deriva la sombra del alfa, así
            // que sin esto la sombra sale rectangular y asoma un contorno cuadrado por fuera
            // del arco. Recortar la capa al mismo radio deja el alfa con la forma correcta.
            let _: () = msg_send![&*glass, setWantsLayer: true];
            let layer: *mut objc2::runtime::AnyObject = msg_send![&*glass, layer];
            if !layer.is_null() {
                let _: () = msg_send![layer, setCornerRadius: radius];
                let _: () = msg_send![layer, setMasksToBounds: true];
            }

            // Sin tinte, aunque la app sí tenga acento (sección 3.1): el acento colorea los
            // controles, y un `tintColor` aquí se lo daría a la superficie entera. Los popovers
            // del propio sistema tampoco tiñen su vidrio del acento elegido.

            glass.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );
            host.addSubview_positioned_relativeTo(&glass, NSWindowOrderingMode::Below, None);
        }

        true
    }
}
