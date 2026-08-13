-- Esquema inicial. Es literalmente el de la sección 2 del spec, más los disparadores que
-- convierten sus reglas en invariantes de la base: lo que no se puede violar desde ningún
-- lado no se comprueba en JavaScript.
--
-- Las claves foráneas hacen falta para que `ON DELETE SET NULL` y `ON DELETE CASCADE`
-- signifiquen algo. `PRAGMA foreign_keys` es por conexión, así que no sirve ponerlo aquí;
-- lo activa sqlx por omisión en cada conexión del pool.

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,          -- hex "#RRGGBB"
  position    REAL NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  notes        TEXT,
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_id    TEXT REFERENCES tasks(id)    ON DELETE CASCADE,
  due_at       TEXT,                  -- ISO 8601 local
  has_time     INTEGER NOT NULL DEFAULT 0,
  priority     INTEGER NOT NULL DEFAULT 0,  -- 0 baja, 1 media, 2 alta
  completed_at TEXT,
  position     REAL NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_tasks_due       ON tasks(due_at)       WHERE completed_at IS NULL;
CREATE INDEX idx_tasks_project   ON tasks(project_id)   WHERE completed_at IS NULL;
CREATE INDEX idx_tasks_parent    ON tasks(parent_id);

-- Un solo nivel de subtareas. Al insertar solo puede fallar por colgar de una tarea que ya
-- es hija; una fila nueva todavía no tiene hijas.
CREATE TRIGGER tasks_un_solo_nivel_insert
BEFORE INSERT ON tasks
WHEN NEW.parent_id IS NOT NULL
 AND (NEW.parent_id = NEW.id
      OR (SELECT parent_id FROM tasks WHERE id = NEW.parent_id) IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'una subtarea no puede tener subtareas');
END;

-- Al mover una tarea bajo otra hay dos formas de anidar: que el destino ya sea hija, o que
-- la que se mueve ya tenga hijas propias.
CREATE TRIGGER tasks_un_solo_nivel_update
BEFORE UPDATE OF parent_id ON tasks
WHEN NEW.parent_id IS NOT NULL
 AND (NEW.parent_id = NEW.id
      OR (SELECT parent_id FROM tasks WHERE id = NEW.parent_id) IS NOT NULL
      OR EXISTS (SELECT 1 FROM tasks WHERE parent_id = NEW.id))
BEGIN
  SELECT RAISE(ABORT, 'una subtarea no puede tener subtareas');
END;

-- Completar una padre completa sus subtareas, en la misma transacción que el UPDATE que lo
-- disparó. Al revés no: completar todas las subtareas deja la padre como estaba, que es lo
-- que pide el spec.
--
-- `recursive_triggers` está apagado por omisión, así que el UPDATE de adentro no se vuelve a
-- disparar a sí mismo. Aunque estuviera encendido daría igual: las hijas no tienen hijas.
CREATE TRIGGER tasks_completar_subtareas
AFTER UPDATE OF completed_at ON tasks
WHEN OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
BEGIN
  UPDATE tasks
     SET completed_at = NEW.completed_at
   WHERE parent_id = NEW.id
     AND completed_at IS NULL;
END;
