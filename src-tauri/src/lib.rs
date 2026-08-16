mod accent;
mod db;
mod glass;
mod notify;
mod panel;
mod tray;

use tauri::Manager;

/// Mientras un panel nativo esté delante —el de guardar del exportador—, perder el foco no
/// puede cerrar el panel (spec 4). Lo levanta y lo baja el frontend, que es quien sabe
/// cuándo abre uno.
#[tauri::command]
fn set_keep_open(value: bool) {
    panel::set_keep_open(value);
}

/// El glifo de la barra cambia de peso con lo vencido (spec 4). Quien sabe si hay algo
/// vencido es la capa de datos, que vive en TypeScript.
#[tauri::command]
fn set_overdue(app: tauri::AppHandle, overdue: bool) -> Result<(), String> {
    tray::set_overdue(&app, overdue).map_err(|error| error.to_string())
}

/// El glifo de la barra, elegido en Ajustes (spec 4). Lo manda el frontend al arrancar y cada
/// vez que se cambia: la preferencia vive en `localStorage`, que Rust no puede leer.
#[tauri::command]
fn set_tray_glyph(app: tauri::AppHandle, glyph: String) -> Result<(), String> {
    tray::set_glyph(&app, &glyph).map_err(|error| error.to_string())
}

/// Escribe el export en la ruta que eligió el panel de guardar.
///
/// Es un comando propio y no `tauri-plugin-fs` a propósito: el plugin traería permiso para
/// leer y escribir el disco del usuario, y lo único que hace falta es volcar una cadena en
/// un archivo que acaba de elegir a mano.
#[tauri::command]
fn write_export(path: String, contents: String) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|error| error.to_string())
}

/// El tope de lo que se acepta importar.
///
/// Existe porque el archivo acaba entero en el webview como una cadena y de ahí en `JSON.parse`:
/// sin tope, elegir por error un archivo de varios giga cuelga el panel en vez de dar un error
/// que se pueda leer. Un export de Riel con cien mil tareas no llega a diez megas.
const MAX_IMPORT: u64 = 64 * 1024 * 1024;

/// Lee el archivo que eligió el panel de abrir, para la importación.
///
/// Contraparte de `write_export` y por lo mismo un comando propio: `tauri-plugin-fs` daría
/// permiso de lectura sobre el disco entero para leer un archivo que el usuario acaba de
/// señalar a mano.
#[tauri::command]
fn read_import(path: String) -> Result<String, String> {
    let size = std::fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();

    if size > MAX_IMPORT {
        return Err(format!(
            "el archivo pesa {} MB y el máximo son {} MB",
            size / (1024 * 1024),
            MAX_IMPORT / (1024 * 1024)
        ));
    }

    std::fs::read_to_string(path).map_err(|error| error.to_string())
}

/// Guarda una copia del estado actual antes de una importación, en `Backups/` dentro del
/// directorio de datos. Devuelve la ruta escrita, que es lo que la app enseña después.
///
/// No reusa `write_export` porque esta ruta no la elige nadie en un panel: la decide la app.
/// Dejar que el frontend mandara la ruta entera significaría que cualquier cadena acaba en un
/// `std::fs::write`; aquí solo llega el nombre del archivo, y lo que no sea un nombre se rechaza.
#[tauri::command]
fn write_backup(app: tauri::AppHandle, name: String, contents: String) -> Result<String, String> {
    if name.is_empty() || name.starts_with('.') || name.contains('/') || name.contains('\\') {
        return Err(format!("nombre de respaldo inválido: {name}"));
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("Backups");

    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

    let path = dir.join(name);
    std::fs::write(&path, contents).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// `granted`, `denied`, `default` o `unavailable` (spec 7). Lo consulta Ajustes para saber
/// si dibuja la nota del enlace a Preferencias del Sistema.
#[tauri::command]
fn notification_permission() -> String {
    notify::permission()
}

/// La pregunta del sistema, la primera vez que alguien le pone hora a una tarea.
#[tauri::command]
fn request_notification_permission() -> bool {
    notify::request()
}

/// Rehace el plan de avisos de las próximas 24 h. Lo llama el frontend al arrancar y cada
/// vez que algo puede haber movido una hora.
#[tauri::command]
fn set_reminders(items: Vec<notify::Reminder>) {
    notify::set_reminders(items);
}

/// Lo que se completó desde el botón de un banner y todavía no se ha aplicado a la base.
///
/// El botón también emite un evento, que es el camino normal. Esto cubre el otro: si el aviso
/// llega con la app recién arrancada, la pulsación puede ser anterior a que nadie escuche.
#[tauri::command]
fn take_completed() -> Vec<String> {
    notify::take_completed()
}

/// Cierra la app desde Ajustes.
///
/// Sin Dock y sin ⌘Tab (spec 4), una app de la barra no tiene ⌘Q ni menú de aplicación, así
/// que sin esto la única forma de pararla es el Monitor de Actividad. Es un comando propio y
/// no `tauri-plugin-process` por lo mismo que el export: el plugin trae también reiniciar y
/// permisos que no hacen falta para un botón.
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Vuelve a arrancar después de que el actualizador haya reemplazado el paquete.
///
/// Por lo mismo que `quit`: `tauri-plugin-process` haría exactamente esto y traería además
/// `exit` y su permiso. La diferencia con `quit` es `cleanup_before_exit`, que aquí sí hace
/// falta —desmonta el icono de la barra— para que el proceso viejo no deje un glifo huérfano
/// junto al del proceso nuevo.
#[tauri::command]
fn restart(app: tauri::AppHandle) {
    app.cleanup_before_exit();
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // `LaunchAgent` y no `AppleScript`: deja un plist en `~/Library/LaunchAgents` que se
        // puede leer, y no una entrada opaca escrita con Eventos de Sistema.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::URL, db::migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_keep_open,
            set_overdue,
            set_tray_glyph,
            write_export,
            read_import,
            write_backup,
            notification_permission,
            request_notification_permission,
            set_reminders,
            take_completed,
            quit,
            restart
        ])
        .setup(|app| {
            // Sin Dock y sin ⌘Tab. Tiene que correr aquí y no solo vía LSUIElement,
            // porque en `tauri dev` el binario no está empaquetado y no hay Info.plist.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app
                .get_webview_window("main")
                .expect("la ventana `main` está declarada en tauri.conf.json");

            let material = panel::apply_glass(&window)?;
            app.manage(material);
            // Antes del primer `show`: es lo que hace que el panel se vea también sobre una
            // app en pantalla completa, que es su propio espacio y no el del escritorio.
            panel::make_menu_bar_panel(&window);
            tray::build(app.handle())?;

            // Antes de que pueda llegar ningún aviso: un banner de una categoría que el
            // sistema todavía no conoce se dibuja sin su botón.
            #[cfg(target_os = "macos")]
            notify::install(app.handle());

            // El acento del sistema, que a partir de aquí se vuelve a publicar solo cada vez
            // que alguien lo cambie en Ajustes del Sistema.
            #[cfg(target_os = "macos")]
            accent::watch(app.handle());

            // En desarrollo el panel se muestra solo al arrancar: si hubiera que abrirlo
            // a mano desde la barra en cada recarga, iterar sobre la UI sería un castigo.
            if cfg!(debug_assertions) {
                panel::show(&window);
            }

            Ok(())
        })
        .on_page_load(|webview, _payload| {
            let material = *webview.state::<glass::Material>();
            glass::publish_to_css(&webview, material);

            // El acento del sistema va por aquí y no por `setup` por lo mismo que el material:
            // es el único momento con la página lista y antes del primer pintado, y así cubre
            // también las recargas de Vite.
            if let Some(accent) = accent::current() {
                let _ = webview.eval(&accent::css_script(&accent));
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(active) = event {
                // Antes de ocultar: mientras KEEP_OPEN esté en alto el panel sigue delante, y
                // es justo el caso en el que hay que verse inactivo.
                if let Some(panel) = window.get_webview_window("main") {
                    glass::publish_active_to_css(&panel, *active);
                }
                if !active {
                    panel::on_focus_lost(window);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
