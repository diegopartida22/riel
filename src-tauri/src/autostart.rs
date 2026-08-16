//! El arranque al iniciar sesión, y las dos mitades que le faltan al plugin.
//!
//! `tauri-plugin-autostart` escribe `~/Library/LaunchAgents/Riel.plist` con la ruta del
//! ejecutable que estaba corriendo cuando se encendió el interruptor, y su `is_enabled` solo
//! mira si ese archivo existe — nunca a dónde apunta. Las dos cosas juntas dan un fallo que
//! desde fuera parece cosa de macOS: encender el interruptor desde `tauri dev` deja registrado
//! `target/debug/riel`, así que al iniciar sesión `launchd` arranca el binario de desarrollo
//! —con su `devUrl` apuntando a un Vite que no está corriendo— mientras Ajustes sigue diciendo
//! que sí. No es que no abra: abre otra cosa.
//!
//! Lo mismo pasa, más despacio, con la app movida de carpeta después de registrarla.
//!
//! Aquí van las dos piezas que cierran el hueco: que una copia sin empaquetar no pueda escribir
//! el plist, y que el arranque reescriba el que apunte a otro sitio.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt;

/// Lo que Ajustes necesita saber del arranque automático.
///
/// Dos campos y no uno: «apagado» y «esta copia no puede registrarse» se dibujan distinto —el
/// segundo no es un estado que el usuario pueda cambiar pulsando— y con un solo booleano el
/// interruptor de `tauri dev` invitaba a un clic que no iba a hacer nada bueno.
#[derive(serde::Serialize)]
pub struct Estado {
    /// Falso corriendo suelto en desarrollo: solo la copia instalada puede pedir abrirse sola.
    pub disponible: bool,
    pub puesto: bool,
}

/// La ruta del ejecutable **dentro de un `.app`**, o nada si esta copia corre suelta.
#[cfg(target_os = "macos")]
fn ejecutable_empaquetado() -> Option<String> {
    let exe = std::env::current_exe().ok()?.canonicalize().ok()?;
    let path = exe.to_str()?.to_owned();
    path.contains(".app/Contents/MacOS/").then_some(path)
}

#[cfg(not(target_os = "macos"))]
fn ejecutable_empaquetado() -> Option<String> {
    std::env::current_exe()
        .ok()?
        .canonicalize()
        .ok()?
        .to_str()
        .map(str::to_owned)
}

pub fn estado<R: Runtime>(app: &AppHandle<R>) -> Estado {
    Estado {
        disponible: ejecutable_empaquetado().is_some(),
        puesto: app.autolaunch().is_enabled().unwrap_or(false),
    }
}

/// El plist que escribe el plugin, que lo nombra con el nombre del paquete.
fn plist<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    Some(
        app.path()
            .home_dir()
            .ok()?
            .join("Library")
            .join("LaunchAgents")
            .join(format!("{}.plist", app.package_info().name)),
    )
}

/// Reescribe el registro cuando apunta a otro ejecutable.
///
/// Corre en cada arranque y casi siempre no hace nada: leer medio kilobyte y comparar una
/// cadena. Sin plist no hay nada que reparar —eso es «apagado»— y desde una copia sin
/// empaquetar no se toca nada, que es justo la regla que faltaba.
pub fn reparar<R: Runtime>(app: &AppHandle<R>) {
    let Some(exe) = ejecutable_empaquetado() else {
        return;
    };
    let Some(file) = plist(app) else {
        return;
    };
    let Ok(registrado) = std::fs::read_to_string(&file) else {
        return;
    };
    if registrado.contains(&exe) {
        return;
    }

    // Borrar y volver a poner, que es lo único que expone el plugin. Lo escribe él para que el
    // formato del plist siga siendo suyo: duplicarlo aquí sería tener dos versiones del mismo
    // archivo esperando a divergir.
    let manager = app.autolaunch();
    match manager.disable().and_then(|()| manager.enable()) {
        Ok(()) => eprintln!("[riel] arranque automático rehecho: ahora apunta a {exe}"),
        Err(error) => eprintln!("[riel] no se pudo rehacer el arranque automático: {error}"),
    }
}
