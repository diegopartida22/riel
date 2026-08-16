//! La agenda del día (spec 15): los eventos del Calendario que caen hoy, de solo lectura.
//!
//! Se leen con EventKit, que es el mismo sitio del que los lee Calendario.app. No sale nada de
//! la máquina y no se escribe nada: esta capa solo sabe preguntar el permiso y traer los
//! eventos de un rango. Lo que se enseña de ellos, y cómo, lo decide el webview.

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2::{sel, AnyThread};
use objc2_event_kit::{
    EKAuthorizationStatus, EKCalendarType, EKEntityType, EKEvent, EKEventStatus, EKEventStore,
    EKParticipantStatus,
};
use objc2_foundation::{NSBundle, NSDate, NSError, NSObjectProtocol};

/// Lo mismo que en los avisos: los callbacks llegan por otra cola y un comando de Tauri que
/// espere para siempre cuelga el hilo que lo atiende.
const TIMEOUT: Duration = Duration::from_secs(30);

/// Un evento, ya reducido a lo que se dibuja.
///
/// Las fechas van en segundos desde epoch y no en ISO: es lo que da `NSDate` sin pasar por un
/// formateador, y quien las tiene que convertir a la hora local ya está en el webview con el
/// reloj del sistema delante. Dos interpretaciones de la misma cadena es justo lo que se evita.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    id: String,
    title: String,
    start: f64,
    end: f64,
    all_day: bool,
}

/// Sin paquete no hay EventKit que valga: el permiso se concede a un identificador, y en
/// `tauri dev` el binario corre suelto. Es la misma puerta que la de los avisos.
fn bundled() -> bool {
    NSBundle::mainBundle().bundleIdentifier().is_some()
}

fn store() -> Option<Retained<EKEventStore>> {
    bundled().then(|| unsafe { EKEventStore::init(EKEventStore::alloc()) })
}

/// El estado del permiso, con el mismo vocabulario que el de los avisos (spec 7): `granted`,
/// `denied`, `default` o `unavailable`.
pub fn permission() -> String {
    if !bundled() {
        return "unavailable".into();
    }

    match unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) } {
        EKAuthorizationStatus::NotDetermined => "default",
        EKAuthorizationStatus::FullAccess => "granted",
        // `WriteOnly` es poder crear eventos sin poder leerlos, que para esto es no tener nada.
        // `Restricted` y `Denied` tampoco se arreglan desde aquí, pero sí desde Ajustes del
        // Sistema, que es lo que la nota de Ajustes ofrece abrir.
        _ => "denied",
    }
    .into()
}

/// Levanta la pregunta del sistema. Solo hace algo la primera vez.
///
/// Dos caminos porque la app se instala desde macOS 13: `requestFullAccessToEvents` llegó en la
/// 14 y en la 13 no existe el selector — llamarlo ahí no devuelve un error, levanta una
/// excepción de Objective‑C y se lleva el proceso. Así que se pregunta antes si lo entiende.
pub fn request() -> bool {
    let Some(store) = store() else {
        return false;
    };

    let (tx, rx) = mpsc::channel();
    let handler = RcBlock::new(move |granted: Bool, error: *mut NSError| {
        if let Some(error) = unsafe { error.as_ref() } {
            eprintln!("[riel] permiso del calendario: {}", error.localizedDescription());
        }
        let _ = tx.send(granted.as_bool());
    });

    let block = RcBlock::as_ptr(&handler);
    if store.respondsToSelector(sel!(requestFullAccessToEventsWithCompletion:)) {
        unsafe { store.requestFullAccessToEventsWithCompletion(block) };
    } else {
        #[allow(deprecated)]
        unsafe {
            store.requestAccessToEntityType_completion(EKEntityType::Event, block)
        };
    }

    rx.recv_timeout(TIMEOUT).unwrap_or(false)
}

/// Los eventos entre dos instantes, en segundos desde epoch.
///
/// Se quedan fuera tres cosas, y ninguna es un descuido: los calendarios de cumpleaños y los
/// suscritos —festivos, calendarios de equipos, lo que uno no puso ahí a mano— porque son
/// eventos de día entero que llenarían la agenda todos los días con lo mismo; los eventos
/// cancelados, que ya no son el día de nadie; y aquellos a los que uno contestó que no.
pub fn events(from: f64, to: f64) -> Vec<Event> {
    if permission() != "granted" {
        return Vec::new();
    }
    let Some(store) = store() else {
        return Vec::new();
    };

    let start = NSDate::dateWithTimeIntervalSince1970(from);
    let end = NSDate::dateWithTimeIntervalSince1970(to);
    let predicate =
        unsafe { store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None) };

    let mut out: Vec<Event> = unsafe { store.eventsMatchingPredicate(&predicate) }
        .iter()
        .filter(|event| keep(event))
        .filter_map(|event| {
            let start = unsafe { event.startDate() };
            let end = unsafe { event.endDate() };
            let title = unsafe { event.title() }.to_string();
            if title.trim().is_empty() {
                return None;
            }

            let start = start.timeIntervalSince1970();
            Some(Event {
                // Con la hora pegada, y no el identificador a secas: en una serie que se repite
                // todas las ocurrencias comparten `eventIdentifier`, así que dos del mismo día
                // llegarían con la misma clave. Sin identificador —pasa en calendarios raros—
                // queda la hora y el título, que dentro de un día bastan para no repetirse.
                id: match unsafe { event.eventIdentifier() } {
                    Some(id) => format!("{id}:{start}"),
                    None => format!("{start}:{title}"),
                },
                title,
                start,
                end: end.timeIntervalSince1970(),
                // Lo de varios días cuenta como día entero desde el segundo: su hora de inicio
                // es la de otro día, y enseñarla aquí sería poner en la agenda de hoy una hora
                // que no es de hoy. Sin hora que enseñar, se lee como lo que es — algo que
                // ocupa el día — y se ordena con los demás de día entero.
                all_day: unsafe { event.isAllDay() } || start < from,
            })
        })
        .collect();

    // Por hora, y los de día entero primero: es el orden en que se lee un día.
    out.sort_by(|a, b| {
        b.all_day
            .cmp(&a.all_day)
            .then(a.start.total_cmp(&b.start))
            .then(a.title.cmp(&b.title))
    });
    out
}

/// Si el evento pinta algo en la agenda de hoy.
fn keep(event: &EKEvent) -> bool {
    if unsafe { event.status() } == EKEventStatus::Canceled {
        return false;
    }

    if let Some(calendar) = unsafe { event.calendar() } {
        let kind = unsafe { calendar.r#type() };
        if kind == EKCalendarType::Birthday || kind == EKCalendarType::Subscription {
            return false;
        }
    }

    // Contestar que no a una invitación es decir que ese rato no es tuyo. Dejarla en la agenda
    // sería enseñar como día lo que uno ya declinó.
    if let Some(attendees) = unsafe { event.attendees() } {
        for attendee in attendees.iter() {
            if unsafe { attendee.isCurrentUser() }
                && unsafe { attendee.participantStatus() } == EKParticipantStatus::Declined
            {
                return false;
            }
        }
    }

    true
}
