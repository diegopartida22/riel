//! Abrir la carpeta de un proyecto en un editor de código (spec 13).
//!
//! Dos cosas, y ninguna de las dos se puede hacer desde el webview: saber qué editores hay
//! instalados, y arrancar uno con una carpeta. `tauri-plugin-shell` haría lo segundo, pero a
//! cambio de permiso para ejecutar programas desde JavaScript, que es exactamente lo que una
//! app que no sale a la red no tiene por qué poder hacer. Aquí lo único que cruza es un
//! identificador de una lista cerrada y una ruta que ya está guardada en la base.

use serde::Serialize;

/// Un editor instalado en esta máquina.
#[derive(Clone, Debug, Serialize)]
pub struct Editor {
    /// El identificador de paquete, que es con lo que `open` lo encuentra esté donde esté.
    pub id: String,
    /// El nombre corto, que es el que cabe en la fila de opciones de Ajustes.
    pub name: String,
}

/// Los editores que Riel sabe abrir, en el orden en que se prefieren cuando hay varios y
/// todavía no se ha elegido ninguno.
///
/// Es una lista cerrada por dos razones. La primera es que el nombre corto lo ponemos nosotros:
/// «VS Code» no es como se llama la app, es como se la nombra, y en una fila de cinco opciones
/// «Visual Studio Code» no cabe. La segunda es que valida: el identificador llega desde el
/// webview, y esto es lo que impide que lo que acabe en `open -b` sea cualquier cosa.
///
/// Se busca por identificador de paquete y no por nombre de archivo porque una app se renombra
/// y se mueve, y el identificador no cambia. Añadir uno es una línea.
///
/// Xcode no está, y no es un olvido: lo tiene puesto medio macOS, así que saldría en la lista
/// de casi todo el mundo obligando a elegir en Ajustes a quien solo usa un editor de verdad —
/// y con una carpeta suelta no hace lo que se espera de un editor.
const CONOCIDOS: &[(&str, &str)] = &[
    ("com.microsoft.VSCode", "VS Code"),
    ("com.todesktop.230313mzl4w4u92", "Cursor"),
    ("com.exafunction.windsurf", "Windsurf"),
    ("dev.zed.Zed", "Zed"),
    ("com.microsoft.VSCodeInsiders", "VS Code Insiders"),
    ("com.sublimetext.4", "Sublime Text"),
    ("com.jetbrains.WebStorm", "WebStorm"),
    ("com.jetbrains.intellij", "IntelliJ"),
];

/// Los de la lista que de verdad están puestos.
///
/// Se pregunta a `NSWorkspace` y no se mira en `/Applications`: una app instalada por Homebrew,
/// puesta en una carpeta propia o en el directorio del usuario cuenta igual, y el registro de
/// Launch Services las conoce todas.
#[cfg(target_os = "macos")]
pub fn installed() -> Vec<Editor> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::NSString;

    let workspace = NSWorkspace::sharedWorkspace();

    CONOCIDOS
        .iter()
        .filter(|(id, _)| {
            workspace
                .URLForApplicationWithBundleIdentifier(&NSString::from_str(id))
                .is_some()
        })
        .map(|(id, name)| Editor {
            id: (*id).to_string(),
            name: (*name).to_string(),
        })
        .collect()
}

#[cfg(not(target_os = "macos"))]
pub fn installed() -> Vec<Editor> {
    Vec::new()
}

/// Abre una carpeta en un editor. El error es el que se le enseña al usuario, así que dice qué
/// pasó y no en qué llamada pasó (spec 3.8).
pub fn open(editor: &str, path: &str) -> Result<(), String> {
    let known = CONOCIDOS
        .iter()
        .find(|(id, _)| *id == editor)
        .ok_or_else(|| "Ese editor no está en la lista de los que Riel sabe abrir.".to_string())?;

    // Antes de arrancar nada: una carpeta que se movió o se borró haría que el editor abriera
    // una ventana vacía sin decir por qué, y el vínculo se quedaría igual de roto para la
    // próxima. Dicho aquí, se puede volver a elegir.
    if !std::path::Path::new(path).is_dir() {
        return Err("La carpeta ya no está ahí. Vuelve a elegirla en el proyecto.".to_string());
    }

    // `open -b` y no el ejecutable del editor: es lo que hace el sistema al abrir un archivo,
    // así que reusa la ventana que ya esté abierta en vez de arrancar una segunda copia.
    let status = std::process::Command::new("/usr/bin/open")
        .arg("-b")
        .arg(editor)
        .arg(path)
        .status()
        .map_err(|_| format!("No se pudo abrir {}.", known.1))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("No se pudo abrir {}.", known.1))
    }
}
