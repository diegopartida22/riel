-- El vínculo con los Recordatorios de Apple (spec 16).
--
-- Una tabla aparte y no dos columnas en `tasks`, por lo que pasa al borrar. Un recordatorio que
-- entró como tarea y cuya tarea se elimina en Riel volvería a entrar en la pasada siguiente:
-- sigue pendiente en su lista y ya no hay nadie que diga que se conoce. Con la fila aquí, el
-- vínculo sobrevive a la tarea y queda como lápida — se sabe que ese recordatorio ya pasó por
-- aquí y que no tiene que volver.
--
-- Y sin clave foránea a propósito, aunque `task_id` sea el id de una tarea. Un `ON DELETE SET
-- NULL` haría lo mismo que la lápida, pero también convertiría en lápidas todos los vínculos
-- cada vez que una importación en modo reemplazar vacía la tabla de tareas (spec 8) — y ahí las
-- tareas vuelven a entrar con sus mismos ids, así que los vínculos que sobreviven intactos
-- siguen valiendo. Un `task_id` que no apunte a ninguna fila se resuelve leyendo, que es donde
-- la diferencia entre «borrada» y «todavía no escrita» se puede mirar con calma.
--
-- `changed` es el `lastModifiedDate` del recordatorio la última vez que Riel lo miró, en
-- segundos desde epoch. Es el árbitro de los dos sentidos: si el de ahora no coincide, el
-- recordatorio cambió fuera y manda él; si coincide, lo que haya distinto es de este lado.
-- Cero es «nunca se ha mirado», que es lo que vale para una lápida.

CREATE TABLE reminder_links (
  reminder_id TEXT PRIMARY KEY,
  task_id     TEXT,
  changed     REAL NOT NULL DEFAULT 0
);

-- La única consulta que no entra por la clave: qué recordatorio hay que marcar al completar una
-- tarea. Pasa en el gesto más repetido de la app (§3.6), así que no puede ser un barrido.
CREATE INDEX idx_reminder_links_task ON reminder_links(task_id) WHERE task_id IS NOT NULL;
