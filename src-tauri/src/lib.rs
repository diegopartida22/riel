mod accent;
mod agenda;
mod atajos;
mod autostart;
mod captura;
mod claude;
mod db;
mod deeplink;
mod editor;
mod eventkit;
mod glass;
mod notify;
mod panel;
mod reminders;
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

/// Si esta copia puede abrirse al iniciar sesión, y si ya está puesta.
///
/// Lo pregunta Ajustes en vez de `isEnabled()` del plugin, que solo mira si el plist existe y
/// contesta que sí a uno que apunta al binario de desarrollo.
#[tauri::command]
fn autostart_state(app: tauri::AppHandle) -> autostart::Estado {
    autostart::estado(&app)
}

/// Los editores de código instalados (spec 13). Lo pregunta el frontend una vez al arrancar:
/// la lista solo cambia si se instala uno, y para eso hay que salir de la app.
#[tauri::command]
fn editors() -> Vec<editor::Editor> {
    editor::installed()
}

/// Abre la carpeta de un proyecto en el editor elegido. El error que devuelve es el que se
/// enseña tal cual, así que ya viene dicho en castellano.
#[tauri::command]
fn open_in_editor(editor: String, path: String) -> Result<(), String> {
    self::editor::open(&editor, &path)
}

/// Los `riel://` que han llegado y que todavía no se han atendido (spec 14).
///
/// Es una cola y no un evento con carga por el mismo motivo que las pulsaciones de un banner:
/// el enlace puede ser justo lo que arrancó la app, y entonces llega antes de que el webview
/// exista. El frontend la vacía al montar y cada vez que se le avisa.
#[tauri::command]
fn take_links() -> Vec<String> {
    deeplink::take()
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

/// El estado del permiso del Calendario, con el mismo vocabulario que el de los avisos.
#[tauri::command]
fn calendar_permission() -> String {
    agenda::permission()
}

/// La pregunta del sistema, la primera vez que se enciende la agenda en Ajustes.
///
/// Se pregunta ahí y no al arrancar por lo mismo que con los avisos (spec 7): un permiso se
/// entiende cuando ya se sabe para qué es, y una app de tareas que pide el calendario en su
/// primer arranque parece que va a hacer algo con él.
#[tauri::command]
fn request_calendar_permission() -> bool {
    agenda::request()
}

/// Los eventos de un rango, en segundos desde epoch. El rango lo calcula el webview, que es
/// quien sabe qué día está enseñando.
#[tauri::command]
fn agenda(from: f64, to: f64) -> Vec<agenda::Event> {
    agenda::events(from, to)
}

/// El estado del permiso de Recordatorios, con el mismo vocabulario que los otros dos.
#[tauri::command]
fn reminders_permission() -> String {
    reminders::permission()
}

/// La pregunta del sistema, al encender el vínculo en Ajustes. Por lo mismo que la agenda: se
/// pide donde se ve para qué es, y no en el primer arranque.
#[tauri::command]
fn request_reminders_permission() -> bool {
    reminders::request()
}

/// Las listas de Recordatorios, para elegir cuáles se vinculan.
#[tauri::command]
fn reminder_lists() -> Vec<reminders::List> {
    reminders::lists()
}

/// Los recordatorios sin completar de esas listas. Sin listas no devuelve nada: vincular
/// «ninguna» no puede querer decir «todas».
#[tauri::command]
fn fetch_reminders(lists: Vec<String>) -> Vec<reminders::Reminder> {
    reminders::fetch(&lists)
}

/// Recordatorios concretos, por identificador. Es como se sabe qué fue de los ya vinculados,
/// que por estar completados no salen entre los pendientes. `lists` no filtra nada: es por dónde
/// buscar si la búsqueda por identificador no contesta.
#[tauri::command]
fn reminders_by_id(ids: Vec<String>, lists: Vec<String>) -> Vec<reminders::Reminder> {
    reminders::by_id(&ids, &lists)
}

/// Lo único que Riel escribe fuera de su base: la casilla de un recordatorio vinculado.
/// Devuelve su nueva fecha de modificación, que es lo que evita que la pasada siguiente lea
/// esta escritura como un cambio venido de fuera.
#[tauri::command]
fn set_reminder_done(id: String, done: bool) -> Result<f64, String> {
    reminders::set_done(&id, done)
}

/// Las sesiones de Claude Code que están abiertas ahora mismo (spec 17).
///
/// Se pide cuando el apartado está a la vista y no al abrir el panel: leer las transcripciones
/// cuesta más que el presupuesto entero del criterio 1, y no hay ninguna razón para pagarlo al
/// abrir Hoy.
#[tauri::command]
fn claude_sessions() -> Vec<claude::Session> {
    claude::live()
}

/// Lo que ocupa `~/.claude`. Va en un comando aparte del de las sesiones porque tarda mucho más
/// —son varios miles de archivos— y así la lista se dibuja sin esperarlo (spec 17.5).
#[tauri::command]
fn claude_disk() -> Option<claude::Disk> {
    claude::disk()
}

/// Cierra una sesión. Lo que llega es su identificador y nunca un pid: Rust vuelve a mirar quién
/// es antes de mandar la señal (spec 17.3). El error que devuelve se enseña tal cual, así que ya
/// viene dicho en castellano.
#[tauri::command]
fn close_claude_session(id: String) -> Result<(), String> {
    claude::close(&id)
}

/// Pone —o quita— el atajo global que abre la captura rápida (spec 18).
///
/// El error vuelve dicho en castellano y se enseña tal cual en Ajustes, porque el caso normal
/// de fallo es el único que el usuario puede arreglar: la combinación ya la tiene otra app.
#[tauri::command]
fn set_capture_shortcut(app: tauri::AppHandle, accel: Option<String>) -> Result<(), String> {
    captura::set_shortcut(&app, accel.as_deref())
}

/// Qué atajos globales tiene ya puestos esta Mac, y para qué (spec 18.7).
///
/// Solo los del sistema, que son los que se pueden nombrar. Los de otras apps los contesta
/// `free_shortcuts`, que es la otra mitad de la misma pregunta.
#[tauri::command]
fn system_shortcuts() -> Vec<atajos::Ocupado> {
    atajos::system()
}

/// De las combinaciones que se le pasen, las que no tiene cogidas ninguna otra app.
#[tauri::command]
fn free_shortcuts(app: tauri::AppHandle, accels: Vec<String>) -> Vec<String> {
    captura::probe(&app, &accels)
}

/// Cierra la captura rápida. Lo pide ella misma al guardar o con Escape.
#[tauri::command]
fn close_capture(app: tauri::AppHandle) {
    captura::hide(&app);
}

/// Ajusta el alto de la captura rápida al de su contenido.
#[tauri::command]
fn resize_capture(app: tauri::AppHandle, height: f64) {
    captura::set_height(&app, height);
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
///
/// Y lo que no hace es `AppHandle::restart()`, que era lo que había aquí. Lo que hace Tauri en
/// macOS es un `spawn` del ejecutable de dentro del paquete y un `exit(0)` detrás — y el
/// paquete que arranca acaba de ser reemplazado, medio segundo antes, por el propio
/// actualizador. Medido en el registro del sistema al actualizar a la 0.4.0, con 50 ms entre
/// las dos líneas:
///
/// ```text
/// kernel (AppleSystemPolicy) ASP: Security policy would not allow process: 56821,
///                                 /Applications/Riel.app/Contents/MacOS/riel
/// lsd    (appinstallation)   com.riel.app: Building bundle record for app
/// ```
///
/// El proceso nuevo salió antes de que Launch Services terminara de registrar el paquete
/// recién puesto: la evaluación de Gatekeeper todavía no tenía veredicto para ese binario y el
/// núcleo denegó el `exec`. Sin dejar rastro para el usuario, que es lo peor de todo — la app
/// se cerraba para actualizar y ya no volvía.
///
/// Así que el relevo lo pide Launch Services y no nosotros: `open -a` es el mismo camino por el
/// que se abre la app desde el Finder, y es él quien espera a que el paquete esté evaluado y
/// registrado antes de arrancarlo. Y lo pide desde fuera, viendo morir antes a este proceso:
/// con la copia vieja todavía viva, Launch Services no abriría una segunda sino que traería al
/// frente la que ya está, y la que ya está es la que se está yendo.
#[tauri::command]
fn restart(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        relanzar();
        app.cleanup_before_exit();
        app.exit(0);
    }

    #[cfg(not(target_os = "macos"))]
    {
        app.cleanup_before_exit();
        app.restart();
    }
}

/// Le pide a Launch Services que vuelva a abrir el paquete, en cuanto este proceso ya no esté.
///
/// Los dos datos que necesita van como argumentos y no interpolados en el guion, para que una
/// ruta con una comilla dentro no acabe siendo parte del guion.
///
/// `process_group(0)` es lo que le permite sobrevivir a la app, y no es un detalle: cuando el
/// arranque al iniciar sesión (§8) está puesto, quien lanzó a Riel fue `launchd`, y al morir el
/// trabajo `launchd` mata lo que quede con el mismo grupo de procesos —para eso existe la clave
/// `AbandonProcessGroup`, que el plugin no escribe—. Heredando el grupo, el relevo moriría con
/// quien lo pidió justo en el caso normal. Con grupo propio, el `sh` se queda huérfano y lo
/// adopta `launchd` como a cualquier otro.
///
/// La espera tiene tope, veinte segundos. Si algo dejara este proceso colgado, lo que hace
/// `open` entonces es traer al frente la copia que sigue viva; un `sh` dando vueltas para
/// siempre no lo arregla nadie.
#[cfg(target_os = "macos")]
fn relanzar() {
    use std::os::unix::process::CommandExt;

    let Some(bundle) = paquete() else {
        return;
    };

    let guion = "n=0; \
                 while kill -0 \"$1\" 2>/dev/null && [ \"$n\" -lt 100 ]; do \
                     /bin/sleep 0.2; n=$((n+1)); \
                 done; \
                 exec /usr/bin/open -a \"$2\"";

    let _ = std::process::Command::new("/bin/sh")
        .arg("-c")
        .arg(guion)
        .arg("riel")
        .arg(std::process::id().to_string())
        .arg(&bundle)
        .process_group(0)
        .spawn();
}

/// El `.app` desde el que corre esta copia, o nada si corre suelta — que es el caso de
/// `tauri dev`, donde no hay actualizador y aquí no se llega.
#[cfg(target_os = "macos")]
fn paquete() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    // …/Riel.app/Contents/MacOS/riel → …/Riel.app
    let bundle = exe.parent()?.parent()?.parent()?;
    if bundle.extension()?.to_str()? != "app" {
        return None;
    }
    Some(bundle.to_path_buf())
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
            autostart_state,
            editors,
            open_in_editor,
            take_links,
            notification_permission,
            request_notification_permission,
            set_reminders,
            take_completed,
            calendar_permission,
            request_calendar_permission,
            agenda,
            reminders_permission,
            request_reminders_permission,
            reminder_lists,
            fetch_reminders,
            reminders_by_id,
            set_reminder_done,
            claude_sessions,
            claude_disk,
            close_claude_session,
            set_capture_shortcut,
            system_shortcuts,
            free_shortcuts,
            close_capture,
            resize_capture,
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

            // Antes que nada de lo que se ve: si el registro de `launchd` quedó apuntando a
            // otro ejecutable, este arranque es el único momento en que se sabe cuál es el
            // bueno. No hace nada en el caso normal.
            autostart::reparar(app.handle());

            let material = panel::apply_glass(&window, glass::Material::Popover.corner_radius())?;
            app.manage(material);

            // El atajo global de la captura rápida (spec 18). El plugin entra aquí y no en la
            // cadena del builder porque no existe fuera del escritorio, y porque así queda
            // claro que sin atajo puesto no registra nada: quién es lo dice el webview.
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
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
            let radius = if webview.label() == captura::LABEL {
                material.capture_radius()
            } else {
                material.corner_radius()
            };
            glass::publish_to_css(webview, material, radius);

            // El acento del sistema va por aquí y no por `setup` por lo mismo que el material:
            // es el único momento con la página lista y antes del primer pintado, y así cubre
            // también las recargas de Vite.
            if let Some(accent) = accent::current() {
                let _ = webview.eval(accent::css_script(&accent));
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(active) = event {
                // Antes de ocultar: mientras KEEP_OPEN esté en alto el panel sigue delante, y
                // es justo el caso en el que hay que verse inactivo.
                if let Some(propia) = window.get_webview_window(window.label()) {
                    glass::publish_active_to_css(&propia, *active);
                }
                if !active {
                    panel::on_focus_lost(window);
                }
            }
        })
        // `build` y no `run` para poder mirar los eventos del bucle. El único que interesa es
        // el de abajo, que es como llega un `riel://` (spec 14).
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(move |_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                deeplink::received(_app, urls);
            }
        });
}
