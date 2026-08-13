-- Los ajustes que cambian el comportamiento de la app (spec 8).
--
-- En SQLite y no en `localStorage`, donde vive el estado del riel: la retención decide qué
-- se borra en el barrido de arranque, y si el webview pierde su almacenamiento —basta con
-- que macOS le limpie los datos del sitio— un «siempre» se convertiría en «30 días» sin
-- avisar y el siguiente arranque borraría lo que se pidió conservar. Un ajuste destructivo
-- vive con los datos que destruye.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
