//! Los avisos de la sección 7 del spec.
//!
//! No los manda `tauri-plugin-notification`. Su cadena acaba en `mac-notification-sys`, que
//! publica por `NSUserNotification` — la API que Apple retiró —, así que en macOS 26 el
//! comando devuelve `Ok` y no entrega nada. Un fallo silencioso en la única parte de la app
//! que existe para interrumpirte es la peor clase de fallo, así que esto va contra
//! `UNUserNotificationCenter`, que es la API viva.
//!
//! De paso cambia quién lleva la hora. Antes la ponía un `setTimeout` en la webview, y con el
//! panel cerrado la webview es lo primero que macOS estrangula. Aquí cada tarea se registra
//! con su disparador y quien despierta es el sistema, que para eso está. La forma que pide el
//! spec no cambia: se borra el plan entero y se rehace sobre la ventana de 24 h.

use std::ptr::NonNull;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::{NSBundle, NSError, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
    UNNotificationRequest, UNNotificationSettings, UNNotificationSound,
    UNTimeIntervalNotificationTrigger, UNUserNotificationCenter,
};

/// Cuánto se espera a que el sistema conteste antes de rendirse. Los callbacks de
/// `UNUserNotificationCenter` llegan por otra cola, y un comando de Tauri que se quede
/// esperando para siempre cuelga el hilo que lo atiende.
const TIMEOUT: Duration = Duration::from_secs(3);

/// Un aviso ya resuelto: quién avisa, qué dice y dentro de cuánto.
///
/// Los segundos los calcula el frontend y no esta capa. Las fechas se guardan en ISO local
/// sin zona, y quien ya sabe leerlas —incluido el detalle de que una tarea sin hora es solo
/// un día— es la capa de datos en TypeScript. Aquí llegan resueltas para no tener dos
/// interpretaciones de la misma cadena.
#[derive(serde::Deserialize)]
pub struct Reminder {
    id: String,
    title: String,
    body: Option<String>,
    seconds: f64,
}

/// Sin identificador de paquete no hay avisos: `currentNotificationCenter` no devuelve un
/// centro degradado, levanta una excepción de Objective-C y se lleva el proceso por delante.
/// Es exactamente el caso de `tauri dev`, donde el binario corre suelto sin `.app`.
fn bundled() -> bool {
    NSBundle::mainBundle().bundleIdentifier().is_some()
}

fn center() -> Option<objc2::rc::Retained<UNUserNotificationCenter>> {
    bundled().then(UNUserNotificationCenter::currentNotificationCenter)
}

/// El estado del permiso. `unavailable` no es lo mismo que `denied`: quiere decir que en este
/// arranque no hay forma de avisar, y eso no es algo que el usuario pueda ir a arreglar a
/// Ajustes del Sistema.
pub fn permission() -> String {
    let Some(center) = center() else {
        return "unavailable".into();
    };

    let (tx, rx) = mpsc::channel();
    let handler = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        let status = unsafe { settings.as_ref() }.authorizationStatus();
        let _ = tx.send(status);
    });
    center.getNotificationSettingsWithCompletionHandler(&handler);

    match rx.recv_timeout(TIMEOUT) {
        Ok(UNAuthorizationStatus::Denied) => "denied",
        Ok(UNAuthorizationStatus::NotDetermined) => "default",
        Ok(_) => "granted",
        Err(_) => "unavailable",
    }
    .into()
}

/// Levanta la pregunta del sistema. Solo hace algo la primera vez: después, macOS contesta
/// con lo que ya se decidió sin volver a molestar.
pub fn request() -> bool {
    let Some(center) = center() else {
        return false;
    };

    let (tx, rx) = mpsc::channel();
    let handler = RcBlock::new(move |granted: Bool, error: *mut NSError| {
        // Un fallo aquí es mudo por naturaleza: el sistema no avisa de que no va a avisar.
        // `UNErrorDomain 1` quiere decir que el paquete no está firmado con una identidad
        // válida, que es el motivo por el que esto falla en un `.app` recién construido.
        if let Some(error) = unsafe { error.as_ref() } {
            eprintln!("[riel] permiso de avisos: {}", error.localizedDescription());
        }
        let _ = tx.send(granted.as_bool());
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
        &handler,
    );

    rx.recv_timeout(TIMEOUT).unwrap_or(false)
}

/// Rehace el plan entero: borra lo pendiente y registra lo que venga.
///
/// Borrar antes de escribir es lo que hace que mover una tarea de hora, completarla o
/// borrarla se note sin llevar cuenta de nada: el plan del sistema se reemplaza por el que
/// sale de la base, que es la única fuente que manda.
pub fn set_reminders(items: Vec<Reminder>) {
    let Some(center) = center() else {
        return;
    };

    center.removeAllPendingNotificationRequests();

    for item in items {
        // El sistema rechaza un intervalo de cero o negativo. Medio segundo es lo mismo que
        // «ya» para quien lo lee, y deja pasar el aviso que llega justo en la hora.
        let seconds = item.seconds.max(0.5);
        let trigger =
            UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(seconds, false);

        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&item.title));
        if let Some(body) = &item.body {
            content.setBody(&NSString::from_str(body));
        }
        content.setSound(Some(&UNNotificationSound::defaultSound()));

        // El identificador es el de la tarea: si el plan se rehace dos veces seguidas, la
        // misma tarea reemplaza su propio aviso en vez de duplicarlo.
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&item.id),
            &content,
            Some(&trigger),
        );
        center.addNotificationRequest_withCompletionHandler(&request, None);
    }
}
