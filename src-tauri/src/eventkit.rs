//! El almacén de EventKit, uno solo para todo el proceso.
//!
//! Es de donde leen las dos únicas cosas de la app que hablan con EventKit: la agenda del día
//! (spec 15) y el vínculo con Recordatorios (spec 16). Vive aquí y no una copia en cada una
//! porque un `EKEventStore` no es un objeto barato — Apple documenta su creación como algo que
//! tarda «a significant amount of time», que es abrir la conexión con el demonio del calendario
//! y montar su caché, y recomienda crear uno y conservarlo. Con uno por llamada, abrir el panel
//! con las dos funciones encendidas montaba y tiraba cinco.
//!
//! Lo que se conserva es el objeto, no lo que ha leído. Cada pasada empieza con `reset`, que
//! según Apple deja el almacén «as if you released the store and then created a new one»: es
//! exactamente lo que daba el almacén nuevo, sin volver a pagar la conexión. Y hace falta que
//! sea así, porque de la frescura depende la regla del vínculo (spec 16.2) — un recordatorio
//! servido de caché traería la `lastModifiedDate` de la pasada anterior, y con ella el árbitro
//! diría que nadie ha tocado nada.

use std::sync::{Mutex, OnceLock};

use objc2::rc::Retained;
use objc2::AnyThread;
use objc2_event_kit::EKEventStore;
use objc2_foundation::NSBundle;

/// Sin paquete no hay EventKit que valga: el permiso se concede a un identificador, y en
/// `tauri dev` el binario corre suelto. Es la misma puerta que la de los avisos.
pub fn bundled() -> bool {
    NSBundle::mainBundle().bundleIdentifier().is_some()
}

/// El almacén, con permiso para cruzar de hilo.
///
/// `Retained<EKEventStore>` no es `Send` porque EventKit no admite dos hilos a la vez sobre el
/// mismo almacén, y eso sigue siendo verdad: lo que lo vuelve seguro es que el único camino
/// hasta él pasa por el `Mutex` de `with`, así que nunca hay dos. Lo que EventKit no exige es
/// un hilo fijo, y menos mal: los comandos de Tauri se reparten sobre un grupo de hilos, así
/// que un almacén atado al que lo creó no serviría para el segundo comando.
struct Shared(Retained<EKEventStore>);

// SAFETY: el candado de `with` es lo que serializa el acceso; no hay ninguna otra referencia.
unsafe impl Send for Shared {}

/// Corre algo con el almacén delante, en exclusiva y con la caché recién tirada.
///
/// Devuelve `None` solo cuando no hay almacén que dar, que es el caso sin paquete. Quien llama
/// lo traduce a lo que ya decía antes de esto: una agenda vacía, ninguna lista, un error.
pub fn with<T>(body: impl FnOnce(&EKEventStore) -> T) -> Option<T> {
    static STORE: OnceLock<Option<Mutex<Shared>>> = OnceLock::new();

    let store = STORE
        .get_or_init(|| {
            bundled()
                .then(|| Mutex::new(Shared(unsafe { EKEventStore::init(EKEventStore::alloc()) })))
        })
        .as_ref()?;

    // Un candado envenenado se recoge y se sigue: lo único que esta app escribe en EventKit es
    // una casilla, y va con `commit` en la misma llamada. No hay ningún estado a medias que un
    // hilo caído pueda dejar detrás, así que rendirse aquí solo apagaría el vínculo para siempre.
    let store = store.lock().unwrap_or_else(|caught| caught.into_inner());
    unsafe { store.0.reset() };
    Some(body(&store.0))
}
