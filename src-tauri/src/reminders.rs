//! Los Recordatorios de Apple (spec 16): el vínculo de ida y vuelta con las listas elegidas.
//!
//! Esta capa es tonta a propósito, como la de la agenda (§15): sabe preguntar el permiso, traer
//! recordatorios y marcar uno como hecho. Nada más. Qué entra, qué gana cuando los dos lados
//! cambiaron y qué no se toca nunca lo decide TypeScript, que es donde está la base.
//!
//! Lo único que Riel escribe fuera de su propia base es una casilla: `isCompleted`. No crea
//! recordatorios, no los borra, y no les cambia el título, las notas ni la fecha. Un vínculo
//! que además escribiera de vuelta el texto haría que un error de Riel se llevara por delante
//! la lista de otra app — y de las dos, la que lleva años ahí no es esta.
//!
//! Ojo con el nombre: `notify::Reminder` es un aviso programado del sistema (§7) y no tiene
//! nada que ver con esto. Son dos cosas que en castellano se llaman igual.

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2::{sel, AnyThread};
use objc2_event_kit::{
    EKAuthorizationStatus, EKCalendar, EKEntityType, EKEventStore, EKReminder,
};
use objc2_foundation::{
    NSArray, NSBundle, NSDateComponentUndefined, NSError, NSInteger, NSObjectProtocol, NSPredicate,
    NSString,
};

/// Lo mismo que en los avisos y la agenda: los callbacks llegan por otra cola y un comando de
/// Tauri que espere para siempre cuelga el hilo que lo atiende.
const TIMEOUT: Duration = Duration::from_secs(30);

/// Una lista de Recordatorios, que es lo que se elige en la hoja.
#[derive(serde::Serialize)]
pub struct List {
    id: String,
    title: String,
}

/// La fecha de un recordatorio, en piezas y no en cadena.
///
/// EventKit la guarda como `NSDateComponents` justamente porque puede ser un día suelto sin
/// hora, que es la misma distinción que `has_time` (spec 2). Armar aquí una cadena ISO
/// obligaría a elegir un huso para algo que no lo tiene; pasando las piezas, quien la escribe
/// es el mismo código que ya escribe todas las demás fechas de la app.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Due {
    year: NSInteger,
    month: NSInteger,
    day: NSInteger,
    /// Nula si el recordatorio es de un día sin hora. Es lo que decide `has_time`.
    hour: Option<NSInteger>,
    /// Sin `hour` no significa nada. Con hora puesta y minuto sin poner, cero.
    minute: NSInteger,
}

/// Un recordatorio, ya reducido a lo que Riel sabe guardar.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    id: String,
    /// El identificador de su lista, para poder contar por lista en la hoja.
    list: String,
    title: String,
    notes: Option<String>,
    due: Option<Due>,
    /// Ya traducida a la escala de Riel: 0 baja, 1 media, 2 alta.
    priority: u8,
    completed: bool,
    /// `lastModifiedDate` en segundos desde epoch, o 0 si no lo trae.
    ///
    /// Es el árbitro de la sincronización: si no coincide con lo que Riel apuntó la última vez,
    /// el recordatorio cambió fuera y manda él. Sin esto no habría forma de distinguir «lo
    /// completaron en el iPhone» de «Riel lo completó y el empuje todavía no ha llegado».
    changed: f64,
    /// Si repite. Los que repiten se quedan fuera del vínculo, y la hoja lo dice.
    repeats: bool,
}

/// Sin paquete no hay EventKit que valga: el permiso se concede a un identificador, y en
/// `tauri dev` el binario corre suelto. Es la misma puerta que la de los avisos y la agenda.
fn bundled() -> bool {
    NSBundle::mainBundle().bundleIdentifier().is_some()
}

fn store() -> Option<Retained<EKEventStore>> {
    bundled().then(|| unsafe { EKEventStore::init(EKEventStore::alloc()) })
}

/// El estado del permiso, con el mismo vocabulario que los avisos y la agenda (spec 7):
/// `granted`, `denied`, `default` o `unavailable`.
pub fn permission() -> String {
    if !bundled() {
        return "unavailable".into();
    }

    match unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Reminder) } {
        EKAuthorizationStatus::NotDetermined => "default",
        EKAuthorizationStatus::FullAccess => "granted",
        // En recordatorios no existe el acceso de solo escritura: o hay acceso entero o no hay.
        _ => "denied",
    }
    .into()
}

/// Levanta la pregunta del sistema. Solo hace algo la primera vez.
///
/// Dos caminos por lo mismo que en la agenda: `requestFullAccessToReminders` llegó en macOS 14
/// y la app se instala desde la 13, donde el selector no existe — llamarlo ahí no devuelve un
/// error, levanta una excepción de Objective‑C y se lleva el proceso.
pub fn request() -> bool {
    let Some(store) = store() else {
        return false;
    };

    let (tx, rx) = mpsc::channel();
    let handler = RcBlock::new(move |granted: Bool, error: *mut NSError| {
        if let Some(error) = unsafe { error.as_ref() } {
            eprintln!("[riel] permiso de recordatorios: {}", error.localizedDescription());
        }
        let _ = tx.send(granted.as_bool());
    });

    let block = RcBlock::as_ptr(&handler);
    if store.respondsToSelector(sel!(requestFullAccessToRemindersWithCompletion:)) {
        unsafe { store.requestFullAccessToRemindersWithCompletion(block) };
    } else {
        #[allow(deprecated)]
        unsafe {
            store.requestAccessToEntityType_completion(EKEntityType::Reminder, block)
        };
    }

    rx.recv_timeout(TIMEOUT).unwrap_or(false)
}

/// Las listas de Recordatorios, por orden alfabético.
///
/// El orden que se ve en Recordatorios.app lo pone el usuario arrastrando y EventKit no lo
/// publica, así que cualquier orden que se invente aquí va a ser otro. Alfabético al menos es
/// el mismo cada vez que se abre la hoja.
pub fn lists() -> Vec<List> {
    if permission() != "granted" {
        return Vec::new();
    }
    let Some(store) = store() else {
        return Vec::new();
    };

    let mut out: Vec<List> = unsafe { store.calendarsForEntityType(EKEntityType::Reminder) }
        .iter()
        .map(|calendar| List {
            id: unsafe { calendar.calendarIdentifier() }.to_string(),
            title: unsafe { calendar.title() }.to_string(),
        })
        .collect();

    out.sort_by(|a, b| a.title.cmp(&b.title));
    out
}

/// Los recordatorios **sin completar** de esas listas.
///
/// Sin completar y no todos: la lista de completados de una cuenta con años encima puede tener
/// miles de filas, y de ellas solo importan las que Riel ya tiene vinculadas — que se preguntan
/// una a una con `by_id`, que es una búsqueda por clave y no un barrido.
pub fn fetch(lists: &[String]) -> Vec<Reminder> {
    if lists.is_empty() || permission() != "granted" {
        return Vec::new();
    }
    let Some(store) = store() else {
        return Vec::new();
    };

    let Some(calendars) = calendars_of(&store, lists) else {
        return Vec::new();
    };

    let predicate = unsafe {
        store.predicateForIncompleteRemindersWithDueDateStarting_ending_calendars(
            None,
            None,
            Some(&calendars),
        )
    };

    matching(&store, &predicate)
}

/// Recordatorios concretos, por identificador. Los que ya no estén no salen en la respuesta.
///
/// Es lo que cubre la vuelta: un recordatorio que se completó en el iPhone deja de aparecer
/// entre los pendientes de `fetch`, y sin preguntar por él directamente sería indistinguible de
/// uno borrado. Es una búsqueda por clave, así que preguntar por los vinculados en cada pasada
/// no cuesta nada aunque sean unos cuantos cientos.
///
/// `lists` es el respaldo y no el filtro. Apple documenta la búsqueda por identificador como
/// perezosa para los recordatorios —puede contestar nada mientras nadie los haya traído antes—
/// y en el sistema donde eso pasara, la vuelta dejaría de funcionar en silencio, que es la peor
/// forma de fallar. Cuando no aparece **ninguno** de los pedidos, se barre la lista entera,
/// completados incluidos, y se cruza con lo que se preguntaba. Ninguno de muchos es la firma de
/// una API que no contesta; que falte uno es simplemente que lo borraron, y eso no dispara nada.
pub fn by_id(ids: &[String], lists: &[String]) -> Vec<Reminder> {
    if ids.is_empty() || permission() != "granted" {
        return Vec::new();
    }
    let Some(store) = store() else {
        return Vec::new();
    };

    let found: Vec<Reminder> = ids
        .iter()
        .filter_map(|id| find(&store, id))
        .filter_map(|reminder| describe(&reminder))
        .collect();

    if !found.is_empty() || lists.is_empty() {
        return found;
    }

    let Some(calendars) = calendars_of(&store, lists) else {
        return found;
    };
    let predicate = unsafe { store.predicateForRemindersInCalendars(Some(&calendars)) };
    let wanted: Vec<&str> = ids.iter().map(String::as_str).collect();

    matching(&store, &predicate)
        .into_iter()
        .filter(|reminder| wanted.contains(&reminder.id.as_str()))
        .collect()
}

/// Los calendarios de esas listas, o nada si no queda ninguno.
///
/// Una lista que ya no existe —se borró en Recordatorios— simplemente no aporta calendario. Sin
/// ninguno no se devuelve un arreglo vacío sino nada: para EventKit, «ningún calendario» y «sin
/// filtro de calendario» se escriben igual, y el segundo busca en *todos*.
fn calendars_of(store: &EKEventStore, lists: &[String]) -> Option<Retained<NSArray<EKCalendar>>> {
    let found: Vec<Retained<EKCalendar>> = lists
        .iter()
        .filter_map(|id| unsafe { store.calendarWithIdentifier(&NSString::from_str(id)) })
        .collect();

    (!found.is_empty()).then(|| NSArray::from_retained_slice(&found))
}

/// La búsqueda de EventKit es asíncrona y contesta por otra cola; esto la vuelve a poner en
/// línea, con el mismo tope que el resto de la app.
fn matching(store: &EKEventStore, predicate: &NSPredicate) -> Vec<Reminder> {
    let (tx, rx) = mpsc::channel();
    let handler = RcBlock::new(move |found: *mut NSArray<EKReminder>| {
        let mut out = Vec::new();
        if let Some(found) = unsafe { found.as_ref() } {
            for reminder in found.iter() {
                if let Some(one) = describe(&reminder) {
                    out.push(one);
                }
            }
        }
        let _ = tx.send(out);
    });

    unsafe { store.fetchRemindersMatchingPredicate_completion(predicate, &handler) };
    rx.recv_timeout(TIMEOUT).unwrap_or_default()
}

/// Marca o desmarca un recordatorio. Devuelve su nuevo `lastModifiedDate`.
///
/// La devolución no es un detalle: sin ella, la marca que acaba de poner Riel se leería en la
/// pasada siguiente como un cambio venido de fuera, y el vínculo se pasaría la vida
/// reconciliando su propia escritura.
///
/// El recordatorio se vuelve a buscar aquí en vez de recibirlo ya cargado porque EventKit
/// levanta una excepción al guardar un objeto que salió de otra instancia del almacén, y cada
/// llamada abre la suya.
pub fn set_done(id: &str, done: bool) -> Result<f64, String> {
    if permission() != "granted" {
        return Err("Riel no tiene acceso a Recordatorios.".into());
    }
    let Some(store) = store() else {
        return Err("Recordatorios no está disponible en esta copia.".into());
    };
    let Some(reminder) = find(&store, id) else {
        return Err("Ese recordatorio ya no está en Recordatorios.".into());
    };

    // Sin cambio no se guarda: `saveReminder` sobre algo que ya estaba así mueve la fecha de
    // modificación por nada, y esa fecha es justo el árbitro de la próxima pasada.
    if unsafe { reminder.isCompleted() } != done {
        unsafe { reminder.setCompleted(done) };
        unsafe { store.saveReminder_commit_error(&reminder, true) }
            .map_err(|error| error.localizedDescription().to_string())?;
    }

    Ok(stamp(&reminder))
}

fn find(store: &EKEventStore, id: &str) -> Option<Retained<EKReminder>> {
    unsafe { store.calendarItemWithIdentifier(&NSString::from_str(id)) }?
        // `calendarItemWithIdentifier` contesta con recordatorios *y* con eventos, así que el
        // identificador de un evento colado en la tabla de vínculos se cae aquí y no más tarde.
        .downcast::<EKReminder>()
        .ok()
}

fn stamp(reminder: &EKReminder) -> f64 {
    unsafe { reminder.lastModifiedDate() }
        .map(|date| date.timeIntervalSince1970())
        .unwrap_or(0.0)
}

fn describe(reminder: &EKReminder) -> Option<Reminder> {
    let title = unsafe { reminder.title() }.to_string().trim().to_string();
    if title.is_empty() {
        return None;
    }

    // Sin lista no hay forma de saber si es de las elegidas. No debería pasar nunca.
    let list = unsafe { reminder.calendar() }?;

    Some(Reminder {
        id: unsafe { reminder.calendarItemIdentifier() }.to_string(),
        list: unsafe { list.calendarIdentifier() }.to_string(),
        title,
        notes: unsafe { reminder.notes() }
            .map(|notes| notes.to_string())
            .filter(|notes| !notes.trim().is_empty()),
        due: due_of(reminder),
        // RFC 5545, que es la escala de EventKit: 1‑4 alta, 5 media, 6‑9 baja, 0 sin poner.
        // Las tres de Riel salen de ahí sin inventar nada.
        priority: match unsafe { reminder.priority() } {
            1..=4 => 2,
            5 => 1,
            _ => 0,
        },
        completed: unsafe { reminder.isCompleted() },
        changed: stamp(reminder),
        repeats: unsafe { reminder.hasRecurrenceRules() },
    })
}

fn due_of(reminder: &EKReminder) -> Option<Due> {
    let parts = unsafe { reminder.dueDateComponents() }?;
    let set = |value: NSInteger| (value != NSDateComponentUndefined).then_some(value);

    Some(Due {
        year: set(parts.year())?,
        month: set(parts.month())?,
        day: set(parts.day())?,
        hour: set(parts.hour()),
        minute: set(parts.minute()).unwrap_or(0),
    })
}
