//! La base de datos: nombre y migraciones.
//!
//! El acceso a los datos vive en TypeScript (`src/data/`), que es para lo que está hecho
//! `tauri-plugin-sql`. Lo único que aporta Rust es el esquema: las migraciones se declaran
//! aquí para que corran antes de que el frontend pueda pedir una sola fila.

use tauri_plugin_sql::{Migration, MigrationKind};

/// El plugin resuelve las rutas relativas contra el directorio de datos de la app
/// (`~/Library/Application Support/com.riel.app` en macOS), que es donde pide el spec que
/// viva la base.
pub const URL: &str = "sqlite:riel.db";

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "esquema inicial",
            sql: include_str!("../migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "ajustes",
            sql: include_str!("../migrations/002_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "tareas recurrentes",
            sql: include_str!("../migrations/003_repeticion.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
