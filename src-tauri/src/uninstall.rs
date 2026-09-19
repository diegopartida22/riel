//! Desinstalar Riel (spec 20).
//!
//! Lo que no se puede hacer desde el webview y lo que la papelera no alcanza. Arrastrar el
//! `.app` a la papelera se lleva el programa y deja atrás todo lo que el programa escribió, y
//! de eso hay una pieza que no se queda quieta: el registro de `launchd` que pone el arranque
//! al iniciar sesión (spec 8). Apunta a una ruta absoluta dentro del paquete, así que con el
//! paquete borrado `launchd` sigue intentando abrir un ejecutable que ya no existe en cada
//! sesión, para siempre y sin decirlo. Es el único rastro que sigue *haciendo* algo, y es el
//! único que solo Riel puede quitar — de fuera hay que saber que existe y dónde vive.
//!
//! El resto se borra porque ya que se pregunta, se pregunta una vez: la caché, el almacén del
//! webview y las preferencias de ventana que macOS guarda por su cuenta.
//!
//! Y lo que no hace: no se borra a sí misma. Una app que se manda a la papelera mientras corre
//! es una promesa que se cumple a medias en cuanto algo sale mal a mitad, y en macOS el gesto
//! de quitar una app es arrastrarla — lo que hace falta no es hacerlo por el usuario sino
//! dejarle el paquete señalado en el Finder al salir.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt;

/// Los directorios que macOS crea a nombre del identificador de la app.
///
/// Van por nombre de carpeta y no por rutas escritas enteras para que el identificador sea el
/// único dato: si algún día cambia, cambia en `tauri.conf.json` y aquí no hay nada que tocar.
/// Los que no existan se saltan solos — `HTTPStorages` y `Saved Application State` no aparecen
/// hasta que algo los estrena.
const CARPETAS: &[&str] = &["Caches", "WebKit", "HTTPStorages"];

fn home<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().home_dir().ok()
}

/// Todo lo que el guion tiene que borrar, ya resuelto a rutas absolutas.
///
/// Se calcula aquí y no en el guion porque aquí es donde se sabe: el guion recibe rutas como
/// argumentos, nunca un patrón que expandir. Una desinstalación es el peor sitio posible para
/// que un `rm -rf` se coma algo por un comodín que casó de más.
fn rastros<R: Runtime>(app: &AppHandle<R>, datos: bool) -> Vec<PathBuf> {
    let id = &app.config().identifier;
    let mut rutas = Vec::new();

    if let Some(home) = home(app) {
        let library = home.join("Library");
        for carpeta in CARPETAS {
            rutas.push(library.join(carpeta).join(id));
        }
        rutas.push(
            library
                .join("Saved Application State")
                .join(format!("{id}.savedState")),
        );
        // El plist del arranque, por si `disable()` no pudo con él. Es el rastro que importa,
        // así que lleva dos caminos y no uno.
        rutas.push(
            library
                .join("LaunchAgents")
                .join(format!("{}.plist", app.package_info().name)),
        );
    }

    if datos {
        if let Ok(dir) = app.path().app_data_dir() {
            rutas.push(dir);
        }
    }

    rutas
}

/// Quita lo que Riel deja puesto y deja el paquete señalado en el Finder.
///
/// El orden importa: primero lo que se puede hacer en caliente —el registro de `launchd`, que
/// es del plugin y se quita con su propia API— y después todo lo demás, desde fuera y con este
/// proceso ya muerto.
///
/// Desde fuera porque el almacén del webview está abierto: borrar `~/Library/WebKit/<id>` bajo
/// un `WKWebView` vivo es pedirle que se caiga en medio de la operación que menos puede caerse.
/// Y las preferencias no las manda el archivo sino `cfprefsd`, que tiene su copia en memoria y
/// la vuelve a escribir al salir la app — borrar el plist en caliente lo resucita medio segundo
/// después, así que `defaults delete` tiene que llegar cuando ya no queda nadie de quien
/// copiarlas. Es el mismo `sh` huérfano que pide el relevo tras actualizar (spec 11), y por las
/// mismas razones: espera a ver morir este proceso y corre en grupo propio, o `launchd` se lo
/// llevaría por delante al terminar el trabajo cuando el arranque al iniciar sesión está puesto.
pub fn run<R: Runtime>(app: &AppHandle<R>, datos: bool) {
    // Lo primero y en caliente: si algo más fallara, esto es lo que no puede quedarse.
    let _ = app.autolaunch().disable();

    #[cfg(target_os = "macos")]
    despedir(app, rastros(app, datos));

    #[cfg(not(target_os = "macos"))]
    let _ = rastros(app, datos);
}

/// El guion que se queda cuando la app ya no está.
///
/// Los datos van como argumentos y no interpolados, para que una ruta con una comilla dentro no
/// acabe siendo parte del guion. La espera tiene tope, veinte segundos: si algo dejara este
/// proceso colgado, un `sh` dando vueltas para siempre no lo arregla nadie.
#[cfg(target_os = "macos")]
fn despedir<R: Runtime>(app: &AppHandle<R>, rastros: Vec<PathBuf>) {
    use std::os::unix::process::CommandExt;

    let guion = "n=0; \
                 while kill -0 \"$1\" 2>/dev/null && [ \"$n\" -lt 100 ]; do \
                     /bin/sleep 0.2; n=$((n+1)); \
                 done; \
                 dominio=\"$2\"; paquete=\"$3\"; shift 3; \
                 for ruta in \"$@\"; do /bin/rm -rf \"$ruta\"; done; \
                 /usr/bin/defaults delete \"$dominio\" >/dev/null 2>&1; \
                 if [ -n \"$paquete\" ]; then exec /usr/bin/open -R \"$paquete\"; fi";

    let mut orden = std::process::Command::new("/bin/sh");
    orden
        .arg("-c")
        .arg(guion)
        .arg("riel")
        .arg(std::process::id().to_string())
        .arg(&app.config().identifier)
        // Vacío cuando esta copia corre suelta, que es `tauri dev`: no hay paquete que señalar
        // y el guion se salta el último paso en vez de abrir el Finder en cualquier parte.
        .arg(
            crate::paquete()
                .map(|ruta| ruta.to_string_lossy().into_owned())
                .unwrap_or_default(),
        );

    for ruta in rastros {
        orden.arg(ruta);
    }

    let _ = orden.process_group(0).spawn();
}
