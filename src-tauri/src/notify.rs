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
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

use block2::{DynBlock, RcBlock};
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, AnyThread};
use objc2_foundation::{NSArray, NSBundle, NSError, NSSet, NSString, NSURL};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
    UNNotificationAction, UNNotificationActionOptions, UNNotificationAttachment,
    UNNotificationCategory, UNNotificationCategoryOptions, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNNotificationSettings, UNNotificationSound,
    UNTimeIntervalNotificationTrigger, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use tauri::Emitter;

/// Cuánto se espera a que el sistema conteste antes de rendirse. Los callbacks de
/// `UNUserNotificationCenter` llegan por otra cola, y un comando de Tauri que se quede
/// esperando para siempre cuelga el hilo que lo atiende.
const TIMEOUT: Duration = Duration::from_secs(3);

/// La categoría que lleva el botón. Va en cada aviso; sin ella el sistema no dibuja nada.
const CATEGORY: &str = "riel.recordatorio";

/// El identificador del botón, y lo que llega de vuelta en la respuesta.
const DONE: &str = "riel.completar";

/// El evento con el que el botón del banner llega al frontend, que es quien tiene la base.
const DONE_EVENT: &str = "aviso-completar";

/// Lo que se completó desde un banner y el frontend todavía no ha recogido.
///
/// La cola es la única fuente: el evento solo dice «hay algo que recoger». Separarlo así es lo
/// que evita aplicar dos veces la misma pulsación, y deja cubierto el caso en que el aviso sea
/// justo lo que arranca la app, cuando todavía no hay nadie escuchando eventos.
static PENDING: Mutex<Vec<String>> = Mutex::new(Vec::new());

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Un aviso ya resuelto: quién avisa, qué dice, con qué color y dentro de cuánto.
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
    /// El PNG del disco del proyecto, ya pintado por el frontend. Sin proyecto no hay disco,
    /// que es la regla de la sección 3.1: el color solo aparece donde hay proyecto.
    icon: Option<Vec<u8>>,
    seconds: f64,
}

/// Sin identificador de paquete no hay avisos: `currentNotificationCenter` no devuelve un
/// centro degradado, levanta una excepción de Objective-C y se lleva el proceso por delante.
/// Es exactamente el caso de `tauri dev`, donde el binario corre suelto sin `.app`.
fn bundled() -> bool {
    NSBundle::mainBundle().bundleIdentifier().is_some()
}

fn center() -> Option<Retained<UNUserNotificationCenter>> {
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

define_class!(
    /// Quien recoge lo que pasa con un aviso ya entregado.
    ///
    /// SEGURIDAD: hereda de `NSObject`, que no impone nada a sus subclases, y no implementa
    /// `Drop`.
    #[unsafe(super(NSObject))]
    #[name = "RielAvisos"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        /// Sin esto, un aviso que cae con el panel abierto y enfocado no se ve: el sistema da
        /// por hecho que si la app está delante ya se enteró. Aquí no es cierto — el panel
        /// puede estar abierto en otra vista, o en la lista de otro proyecto — así que el
        /// banner se pide igual.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &objc2_user_notifications::UNNotification,
            handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            handler.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        /// El botón «Completar» del banner. El identificador de la petición es el de la tarea,
        /// así que la respuesta ya trae todo lo que hace falta.
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            handler: &DynBlock<dyn Fn()>,
        ) {
            if response.actionIdentifier().to_string() == DONE {
                let id = response.notification().request().identifier().to_string();
                if let Ok(mut pending) = PENDING.lock() {
                    pending.push(id.clone());
                }
                if let Some(app) = APP.get() {
                    let _ = app.emit(DONE_EVENT, id);
                }
            }
            handler.call(());
        }
    }
);

/// Deja el delegado puesto y la categoría registrada. Se llama una vez, en el arranque.
///
/// Tiene que correr antes de que llegue ningún aviso: un banner de una categoría que el
/// sistema no conoce se dibuja sin botones, y sin delegado la pulsación no llega a ninguna
/// parte.
pub fn install(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());

    let Some(center) = center() else {
        return;
    };

    let action = UNNotificationAction::actionWithIdentifier_title_options(
        &NSString::from_str(DONE),
        &NSString::from_str("Completar"),
        // Ni destructivo ni de primer plano: completar se deshace, y abrir el panel para
        // tachar algo que ya tachaste desde el banner sería justo lo contrario del gesto.
        UNNotificationActionOptions::empty(),
    );
    let category = UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
        &NSString::from_str(CATEGORY),
        &NSArray::from_slice(&[&*action]),
        &NSArray::new(),
        UNNotificationCategoryOptions::empty(),
    );
    center.setNotificationCategories(&NSSet::from_slice(&[&*category]));

    let delegate = Delegate::alloc().set_ivars(());
    let delegate: Retained<Delegate> = unsafe { objc2::msg_send![super(delegate), init] };
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    // `delegate` es una propiedad **débil**: si esto se soltara aquí, el objeto moriría al
    // salir de la función y el centro se quedaría apuntando a nada. Vive lo que vive la app,
    // que es exactamente lo que se quiere de un delegado global.
    std::mem::forget(delegate);
}

/// Lo completado desde un banner que el frontend todavía no ha aplicado, y vacía la cola.
pub fn take_completed() -> Vec<String> {
    PENDING
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

/// Dónde se dejan los discos de color hasta que el sistema se los lleva.
fn attachments_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("riel-avisos")
}

/// El disco del proyecto como miniatura del banner.
///
/// El PNG tiene que estar en un archivo porque `UNNotificationAttachment` solo acepta una URL.
/// El sistema lo **mueve** a su propio almacén al registrar la petición, así que cada aviso
/// escribe el suyo y no hay nada que limpiar después del caso bueno.
fn attachment(id: &str, png: &[u8]) -> Option<Retained<UNNotificationAttachment>> {
    // El identificador viene de la base, pero acaba siendo un nombre de archivo: se filtra
    // antes de tocar el disco en vez de confiar en que siempre sea un UUID.
    let safe: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    if safe.is_empty() {
        return None;
    }

    let dir = attachments_dir();
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("{safe}.png"));
    std::fs::write(&path, png).ok()?;

    let url = NSURL::fileURLWithPath(&NSString::from_str(path.to_str()?));
    unsafe {
        UNNotificationAttachment::attachmentWithIdentifier_URL_options_error(
            &NSString::from_str(&safe),
            &url,
            None,
        )
    }
    .ok()
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

    // Los discos de un plan anterior que el sistema no llegó a llevarse — un aviso que se
    // canceló antes de sonar — se quedarían ahí para siempre.
    let _ = std::fs::remove_dir_all(attachments_dir());

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
        content.setCategoryIdentifier(&NSString::from_str(CATEGORY));

        // Sin disco el aviso sale igual, solo que sin miniatura: una tarea sin proyecto no
        // tiene color que enseñar, y fallar al escribir el PNG no puede costar el aviso.
        if let Some(disc) = item.icon.as_deref().and_then(|png| attachment(&item.id, png)) {
            content.setAttachments(&NSArray::from_slice(&[&*disc]));
        }

        // El identificador es el de la tarea: si el plan se rehace dos veces seguidas, la
        // misma tarea reemplaza su propio aviso en vez de duplicarlo. Y es lo que devuelve la
        // respuesta cuando alguien pulsa «Completar».
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&item.id),
            &content,
            Some(&trigger),
        );
        center.addNotificationRequest_withCompletionHandler(&request, None);
    }
}
