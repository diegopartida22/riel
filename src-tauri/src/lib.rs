mod glass;
mod panel;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_opener::init())
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
            tray::build(app.handle())?;

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
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(false) = event {
                panel::on_focus_lost(window);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
