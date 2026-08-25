//! Las sesiones de Claude Code (spec 17).
//!
//! De solo lectura, con una sola excepción que es todo el motivo de tener cuidado: la señal que
//! cierra un proceso. Dentro de `~/.claude` no se escribe nada — ni se borra un archivo huérfano,
//! ni se toca una transcripción, ni se limpia el disco— y de las transcripciones no se lee lo que
//! dicen los mensajes, solo `usage` y `model`. Una transcripción tiene todo lo que se ha escrito y
//! todo lo que Claude leyó del disco al escribirlo, y una app de tareas no tiene nada que hacer
//! ahí.
//!
//! Como la capa de EventKit, esta es tonta a propósito: sabe mirar quién está vivo, sumar números
//! y mandar una señal. Cómo se ordena, qué cuesta y qué se enseña lo decide el webview.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

/// El desfase que se tolera hacia atrás entre el sello del archivo y el del proceso.
///
/// `pbi_start_tvsec` viene truncado al segundo, así que el arranque real puede leerse hasta un
/// segundo *después* del que anotó el archivo aunque el orden verdadero sea el contrario.
const EARLY: f64 = 1.0;

/// Y hacia delante. El proceso arranca primero y escribe su `.json` después — medio segundo largo
/// en la práctica—, así que la ventana tiene que dar aire para un arranque lento. Un minuto lo da
/// de sobra sin dejar sitio a nada más: para colarse por aquí, un pid reciclado tendría que haber
/// arrancado en el mismo minuto que la sesión a la que suplanta.
const LATE: f64 = 60.0;

/// `~/.claude`. Nada de este archivo mira fuera de ahí.
fn root() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("HOME")?).join(".claude"))
}

/// Lo que Claude Code deja escrito en `sessions/<pid>.json` mientras corre, reducido a lo que
/// hace falta. El archivo trae más campos; los que no están aquí se ignoran solos.
#[derive(serde::Deserialize)]
struct Record {
    pid: i32,
    #[serde(rename = "sessionId")]
    session_id: String,
    cwd: String,
    /// Milisegundos desde epoch, que es como lo escribe quien lo escribe.
    #[serde(rename = "startedAt")]
    started_at: f64,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version: Option<String>,
    /// Desde dónde se lanzó: `claude-vscode`, la terminal… Es lo que hace falta saber antes de
    /// cerrarla, porque una sesión de VS Code deja un panel muerto detrás.
    #[serde(default)]
    entrypoint: Option<String>,
}

/// Una sesión viva, ya reducida a lo que se dibuja.
///
/// Las fechas van en segundos desde epoch por lo mismo que en la agenda: es lo que dan las dos
/// fuentes sin pasar por un formateador, y quien las convierte a hora local ya está en el webview
/// con el reloj del sistema delante.
///
/// Los cuatro contadores de tokens salen en crudo y sin convertir a dinero. El precio de lista es
/// una tabla que cambia, y sobre todo la estimación no es una factura (spec 17.4): eso se dice en
/// la etiqueta, y la etiqueta vive donde se dibuja.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    id: String,
    pid: i32,
    name: String,
    cwd: String,
    started: f64,
    entrypoint: Option<String>,
    version: Option<String>,
    /// Bytes residentes del proceso.
    memory: u64,
    /// Cuándo se escribió la última línea de la transcripción, que es cuánto lleva quieta. Nulo si
    /// la sesión se abrió y no llegó a escribir nada — que también es una respuesta.
    touched: Option<f64>,
    /// El `usage` del último mensaje del asistente: lo que ocupa la conversación ahora mismo, y
    /// no la suma de todo lo que ha pasado por ella.
    context: u64,
    input: u64,
    output: u64,
    cache_write: u64,
    cache_read: u64,
    model: Option<String>,
}

/// Las sesiones vivas. Vacío si no hay carpeta, que es lo que pasa sin Claude Code instalado.
pub fn live() -> Vec<Session> {
    let Some(root) = root() else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(root.join("sessions")) else {
        return Vec::new();
    };

    entries
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|kind| kind == "json"))
        .filter_map(|entry| {
            let text = fs::read_to_string(entry.path()).ok()?;
            let record: Record = serde_json::from_str(&text).ok()?;
            let started = record.started_at / 1000.0;

            // Las tres condiciones de la 17.2. Un `.json` se queda huérfano cuando el proceso se
            // fue de golpe, y macOS recicla los pid: sin cruzar la hora de arranque, un pid
            // reciclado se enseñaría como sesión de Claude y se podría cerrar como una.
            let memory = alive(record.pid, started)?;

            let transcript = transcript(&root, &record.cwd, &record.session_id);
            let touched = transcript.as_deref().and_then(modified);
            let counts = transcript.as_deref().map(usage).unwrap_or_default();

            Some(Session {
                // Sin nombre, la carpeta. Un renglón que dice «sesión sin nombre» no ubica nada.
                name: record.name.unwrap_or_else(|| short(&record.cwd)),
                id: record.session_id,
                pid: record.pid,
                cwd: record.cwd,
                started,
                entrypoint: record.entrypoint,
                version: record.version,
                memory,
                touched,
                context: counts.context,
                input: counts.input,
                output: counts.output,
                cache_write: counts.cache_write,
                cache_read: counts.cache_read,
                model: counts.model,
            })
        })
        .collect()
}

/// Si ese pid es de verdad esa sesión, y cuánta memoria residente ocupa.
///
/// `PROC_PIDTASKALLINFO` da las dos cosas de una: la hora de arranque real —que es el árbitro de
/// la 17.2— y el tamaño residente. Devuelve `None` si el proceso no está, si el núcleo contesta
/// otra cosa de la que se pidió, o si el arranque no cuadra con el del archivo.
fn alive(pid: i32, started: f64) -> Option<u64> {
    let mut info: libc::proc_taskallinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_taskallinfo>() as libc::c_int;

    let read = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTASKALLINFO,
            0,
            (&mut info as *mut libc::proc_taskallinfo).cast(),
            size,
        )
    };
    // No basta con que sea positivo: `proc_pidinfo` devuelve cuántos bytes escribió, y menos de
    // la estructura entera significa que lo que hay en `info` está a medias.
    if read != size {
        return None;
    }

    let real = info.pbsd.pbi_start_tvsec as f64;
    if started < real - EARLY || started > real + LATE {
        return None;
    }

    Some(info.ptinfo.pti_resident_size)
}

/// Dónde vive la transcripción de una sesión.
///
/// El nombre de la carpeta es la ruta con todo lo que no sea alfanumérico cambiado por un guion,
/// y eso lo decide otra app: derivarlo acierta hoy y no hay nada que garantice que siga
/// aciertando. Así que si el archivo no está donde se calculó, se buscan las carpetas una por
/// una. Son unas pocas decenas y la comprobación es un `stat` en cada una.
fn transcript(root: &Path, cwd: &str, id: &str) -> Option<PathBuf> {
    let projects = root.join("projects");
    let file = format!("{id}.jsonl");

    let slug: String = cwd
        .chars()
        .map(|each| if each.is_ascii_alphanumeric() { each } else { '-' })
        .collect();

    let direct = projects.join(&slug).join(&file);
    if direct.is_file() {
        return Some(direct);
    }

    fs::read_dir(projects)
        .ok()?
        .flatten()
        .map(|entry| entry.path().join(&file))
        .find(|path| path.is_file())
}

/// La fecha del archivo, en segundos desde epoch. Es cuándo se escribió la última línea, y por
/// tanto cuánto lleva quieta la sesión — que no es lo mismo que ociosa (spec 17.2), así que de
/// aquí sale el número y nunca la conclusión.
fn modified(path: &Path) -> Option<f64> {
    let stamp = fs::metadata(path).ok()?.modified().ok()?;
    Some(
        stamp
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs_f64(),
    )
}

#[derive(Default)]
struct Counts {
    context: u64,
    input: u64,
    output: u64,
    cache_write: u64,
    cache_read: u64,
    model: Option<String>,
}

/// Solo los campos que se leen de cada línea. Lo demás —el texto de los mensajes, los archivos
/// adjuntos, las herramientas— serde lo ignora sin llegar a construirlo.
#[derive(serde::Deserialize)]
struct Line {
    message: Option<Message>,
}

#[derive(serde::Deserialize)]
struct Message {
    #[serde(default)]
    model: Option<String>,
    usage: Option<Usage>,
}

#[derive(serde::Deserialize)]
struct Usage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
}

/// Los tokens de una transcripción: la suma de todo lo gastado, y el contexto del último mensaje.
///
/// Se lee línea a línea y no de golpe: una transcripción larga son ciento cuarenta megas, y la
/// mayor parte no son mensajes del asistente. El filtro por subcadena es lo que hace que el
/// analizador de JSON solo vea las líneas que llevan cuentas — un barrido de bytes descarta las
/// demás mucho antes de que nadie las interprete.
///
/// Es también donde se decide no fiarse de `iterations`, que dentro del mismo `usage` repite los
/// cuatro contadores: sumarlos también de ahí contaría cada mensaje dos veces.
fn usage(path: &Path) -> Counts {
    let Ok(file) = fs::File::open(path) else {
        return Counts::default();
    };

    let mut out = Counts::default();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if !line.contains("\"usage\"") {
            continue;
        }
        let Ok(Line {
            message: Some(message),
        }) = serde_json::from_str::<Line>(&line)
        else {
            continue;
        };
        let Some(usage) = message.usage else {
            continue;
        };

        out.input += usage.input_tokens;
        out.output += usage.output_tokens;
        out.cache_write += usage.cache_creation_input_tokens;
        out.cache_read += usage.cache_read_input_tokens;

        // El contexto se pisa en cada vuelta en vez de acumularse: lo que ocupa la conversación
        // ahora mismo es lo que entró en el último mensaje, no la suma de lo que entró en todos.
        out.context = usage.input_tokens
            + usage.cache_creation_input_tokens
            + usage.cache_read_input_tokens;
        if message.model.is_some() {
            out.model = message.model;
        }
    }
    out
}

/// El último tramo de una ruta, para nombrar una sesión que no traía nombre.
fn short(cwd: &str) -> String {
    cwd.rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or(cwd)
        .to_string()
}

/// Lo que ocupa `~/.claude`, en bytes.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Disk {
    /// `projects/`: las transcripciones, que es casi todo.
    transcripts: u64,
    /// `file-history/`: las copias que Claude guarda antes de editar un archivo.
    history: u64,
    /// Todo lo demás junto. Desglosarlo más sería enseñar la estructura interna de otra app.
    rest: u64,
    /// La ruta, para el enlace al Finder. Aquí no se borra nada (spec 17.5).
    path: String,
}

pub fn disk() -> Option<Disk> {
    let root = root()?;
    if !root.is_dir() {
        return None;
    }

    let transcripts = weigh(&root.join("projects"));
    let history = weigh(&root.join("file-history"));

    Some(Disk {
        transcripts,
        history,
        rest: weigh(&root).saturating_sub(transcripts + history),
        path: root.to_string_lossy().into_owned(),
    })
}

/// Suma recursiva del tamaño de un directorio.
///
/// Los enlaces simbólicos no se siguen y tampoco cuentan: lo que pesan es lo que pesa su destino,
/// que o está también aquí dentro —y entonces ya se contó— o está fuera y no es de esta cuenta.
/// `DirEntry::metadata` no los atraviesa, que es justo lo que hace falta.
fn weigh(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };

    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => weigh(&entry.path()),
            Ok(kind) if kind.is_file() => entry.metadata().map(|meta| meta.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

/// Cierra una sesión. Es lo único que esta capa hace hacia fuera.
///
/// Lo que llega del webview es el identificador de la sesión y no el pid, y eso es lo que hace
/// aceptable el botón: si el webview no puede nombrar un pid, no hay forma de que nombre uno
/// equivocado. Rust vuelve a leer `sessions/`, encuentra la entrada y comprueba otra vez las tres
/// condiciones de la 17.2 — entre que se dibujó la lista y se pulsó el botón, el proceso pudo
/// irse y su pid volver a repartirse.
///
/// `SIGTERM` y no `SIGKILL`: el proceso tiene que poder cerrar su transcripción antes de irse, y
/// esa transcripción es lo único que queda de la conversación.
pub fn close(id: &str) -> Result<(), String> {
    let missing = || "Esa sesión ya no está abierta.".to_string();

    let Some(root) = root() else {
        return Err(missing());
    };
    let Ok(entries) = fs::read_dir(root.join("sessions")) else {
        return Err(missing());
    };

    for entry in entries.flatten() {
        let Ok(text) = fs::read_to_string(entry.path()) else {
            continue;
        };
        let Ok(record) = serde_json::from_str::<Record>(&text) else {
            continue;
        };
        if record.session_id != id {
            continue;
        }

        if alive(record.pid, record.started_at / 1000.0).is_none() {
            return Err(missing());
        }

        return match unsafe { libc::kill(record.pid, libc::SIGTERM) } {
            0 => Ok(()),
            _ => Err("No se pudo cerrar la sesión. Ciérrala desde donde la abriste.".into()),
        };
    }

    Err(missing())
}
