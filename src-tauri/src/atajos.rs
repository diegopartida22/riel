//! Qué atajos globales ya tiene puestos esta Mac (spec 18.7).
//!
//! Existe para que elegir el atajo de la captura rápida no sea a ciegas. Un atajo global que ya
//! usa otra cosa no da un error: se pone, y luego no pasa nada al pulsarlo, porque quien llegó
//! antes se lo queda. Enterarse de eso es enterarse tarde y sin nada que lo explique.
//!
//! Dos preguntas, y ninguna sale de esta máquina:
//!
//! 1. **Los del sistema**, leídos de `com.apple.symbolichotkeys`, que es donde macOS guarda los
//!    de Ajustes del Sistema → Teclado → Funciones rápidas. Se leen de la configuración de
//!    verdad y no de una tabla nuestra: quien haya movido Spotlight a ⌥Espacio tiene que verlo.
//! 2. **Los de otras apps**, probando a registrarlo y soltándolo enseguida. Es lo único que los
//!    contesta —no hay registro público de quién tiene qué— y por eso lo que se puede decir de
//!    ellos es que están ocupados, nunca por quién.
//!
//! Lo que sí sale de una tabla nuestra es el **nombre** de cada función del sistema, porque el
//! plist solo guarda un número. La tabla es corta a propósito: lo que no está nombrado se dice
//! «el sistema», que sigue siendo verdad. El aviso nunca se inventa; como mucho no da nombres.

use std::collections::HashMap;

/// Un atajo que ya está cogido, con quién lo tiene dicho en castellano.
#[derive(serde::Serialize)]
pub struct Ocupado {
    /// En la misma gramática que usa el webview para grabar: `control+alt+Space`.
    pub accel: String,
    /// Va detrás de «ya lo usa», así que lleva su artículo: «Spotlight», «el Dock».
    pub name: String,
}

/// Las teclas, del código virtual de Carbon al `code` del navegador.
///
/// Son los dos extremos de lo mismo y ninguno de los dos se puede cambiar, así que la tabla es
/// literal. Solo están las que un atajo puede llevar: las que el grabador del webview acepta.
#[cfg(target_os = "macos")]
const KEYS: &[(i64, &str)] = &[
    (0, "KeyA"), (1, "KeyS"), (2, "KeyD"), (3, "KeyF"), (4, "KeyH"), (5, "KeyG"),
    (6, "KeyZ"), (7, "KeyX"), (8, "KeyC"), (9, "KeyV"), (11, "KeyB"), (12, "KeyQ"),
    (13, "KeyW"), (14, "KeyE"), (15, "KeyR"), (16, "KeyY"), (17, "KeyT"),
    (18, "Digit1"), (19, "Digit2"), (20, "Digit3"), (21, "Digit4"), (22, "Digit6"),
    (23, "Digit5"), (24, "Equal"), (25, "Digit9"), (26, "Digit7"), (27, "Minus"),
    (28, "Digit8"), (29, "Digit0"), (30, "BracketRight"), (31, "KeyO"), (32, "KeyU"),
    (33, "BracketLeft"), (34, "KeyI"), (35, "KeyP"), (36, "Enter"), (37, "KeyL"),
    (38, "KeyJ"), (39, "Quote"), (40, "KeyK"), (41, "Semicolon"), (42, "Backslash"),
    (43, "Comma"), (44, "Slash"), (45, "KeyN"), (46, "KeyM"), (47, "Period"),
    (48, "Tab"), (49, "Space"), (50, "Backquote"), (51, "Backspace"), (53, "Escape"),
    (96, "F5"), (97, "F6"), (98, "F7"), (99, "F3"), (100, "F8"), (101, "F9"),
    (103, "F11"), (109, "F10"), (111, "F12"), (118, "F4"), (120, "F2"), (122, "F1"),
    (123, "ArrowLeft"), (124, "ArrowRight"), (125, "ArrowDown"), (126, "ArrowUp"),
];

/// Cómo se llama cada función del sistema. La clave es la que usa el propio plist.
///
/// Corta a propósito: solo las que alguien puede querer para abrir una ventana, que son las de
/// modificador y tecla normal. Lo que no esté aquí se dice «el sistema» y no se adivina — un
/// nombre inventado es peor que no dar ninguno.
#[cfg(target_os = "macos")]
const NAMES: &[(i64, &str)] = &[
    (7, "el menú"),
    (8, "el Dock"),
    (28, "la captura de pantalla"),
    (29, "la captura de pantalla"),
    (30, "la captura de una selección"),
    (31, "la captura de una selección"),
    (32, "Mission Control"),
    (33, "las ventanas de la app"),
    (52, "ocultar el Dock"),
    (60, "la fuente de entrada anterior"),
    (61, "la siguiente fuente de entrada"),
    (64, "Spotlight"),
    (65, "la búsqueda del Finder"),
    (79, "el espacio de la izquierda"),
    (81, "el espacio de la derecha"),
    (118, "el escritorio 1"),
    (119, "el escritorio 2"),
    (120, "el escritorio 3"),
    (121, "el escritorio 4"),
    (122, "el escritorio 5"),
    (123, "el escritorio 6"),
    (124, "el escritorio 7"),
    (125, "el escritorio 8"),
    (126, "el escritorio 9"),
    (127, "el escritorio 10"),
    (160, "Launchpad"),
    (162, "mostrar el escritorio"),
    (175, "el centro de notificaciones"),
    (179, "No molestar"),
    (184, "las opciones de captura"),
];

/// Los atajos del sistema que están puestos y encendidos.
///
/// Vacío si algo no sale: sin esto la app funciona igual, solo que eligiendo a ciegas. Un fallo
/// aquí no se enseña, por lo mismo que el del actualizador (spec 11).
#[cfg(target_os = "macos")]
pub fn system() -> Vec<Ocupado> {
    let Some(root) = read_defaults() else {
        return Vec::new();
    };
    let Some(hotkeys) = root.get("AppleSymbolicHotKeys").and_then(|v| v.as_object()) else {
        return Vec::new();
    };

    let keys: HashMap<i64, &str> = KEYS.iter().copied().collect();
    let names: HashMap<i64, &str> = NAMES.iter().copied().collect();
    let mut ocupados: Vec<Ocupado> = Vec::new();

    for (id, entry) in hotkeys {
        // Apagado en Ajustes del Sistema es libre: la combinación no la coge nadie.
        if entry.get("enabled").and_then(|v| v.as_bool()) != Some(true) {
            continue;
        }
        let Some(params) = entry
            .get("value")
            .and_then(|v| v.get("parameters"))
            .and_then(|v| v.as_array())
        else {
            continue;
        };
        // [carácter, tecla, modificadores]. El primero no sirve: es la letra ya compuesta.
        let (Some(code), Some(mask)) = (
            params.get(1).and_then(serde_json::Value::as_i64),
            params.get(2).and_then(serde_json::Value::as_i64),
        ) else {
            continue;
        };
        let Some(key) = keys.get(&code) else { continue };

        let id: i64 = id.parse().unwrap_or(-1);
        ocupados.push(Ocupado {
            accel: accel(mask, key),
            name: names.get(&id).copied().unwrap_or("el sistema").to_string(),
        });
    }

    ocupados
}

/// El plist de las funciones rápidas, ya en JSON.
///
/// Por `defaults` y no leyendo el archivo: quien manda sobre las preferencias es `cfprefsd`, y
/// el archivo del disco puede llevar minutos sin recibir el último cambio.
#[cfg(target_os = "macos")]
fn read_defaults() -> Option<serde_json::Value> {
    use std::process::{Command, Stdio};

    let mut leer = Command::new("/usr/bin/defaults")
        .args(["export", "com.apple.symbolichotkeys", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let salida = Command::new("/usr/bin/plutil")
        .args(["-convert", "json", "-o", "-", "-"])
        .stdin(Stdio::from(leer.stdout.take()?))
        .stderr(Stdio::null())
        .output()
        .ok()?;

    let _ = leer.wait();
    serde_json::from_slice(&salida.stdout).ok()
}

/// La máscara de `NSEvent` y una tecla, en la gramática del grabador del webview.
///
/// El orden importa: es el mismo en el que el webview arma la cadena, y las dos se comparan
/// como texto.
#[cfg(target_os = "macos")]
fn accel(mask: i64, key: &str) -> String {
    let mut partes: Vec<&str> = Vec::new();
    if mask & (1 << 18) != 0 {
        partes.push("control");
    }
    if mask & (1 << 19) != 0 {
        partes.push("alt");
    }
    if mask & (1 << 17) != 0 {
        partes.push("shift");
    }
    if mask & (1 << 20) != 0 {
        partes.push("super");
    }
    partes.push(key);
    partes.join("+")
}

#[cfg(not(target_os = "macos"))]
pub fn system() -> Vec<Ocupado> {
    Vec::new()
}
