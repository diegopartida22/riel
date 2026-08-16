-- Tareas recurrentes.
--
-- Dos columnas y ningún índice: la regla es un valor que se lee con la fila y no algo por lo
-- que se consulte. Nada busca «las que se repiten», porque en la lista una tarea recurrente es
-- una tarea normal con fecha — lo que la distingue pasa al completarla, no al leerla.
--
-- `repeat` guarda la regla en texto (`mensual:1:17`), con su formato explicado en
-- `src/data/repeat.ts`. Nulo es lo normal: la inmensa mayoría de las tareas no vuelven.
--
-- `repeat_from` dice desde dónde se cuenta la siguiente, y tiene valor por omisión porque las
-- filas que ya existen tienen que quedar en algo, y contar desde la fecha es lo que significa
-- una regla sin más contexto.
--
-- Sin disparador que impida una regla en una subtarea, al revés que con el nivel único (§2).
-- Ahí una fila mal puesta rompe un invariante; aquí es inerte: solo las raíces se completan
-- generando la siguiente, así que una regla colgada de una hija no hace nada. Defenderla con
-- un ABORT costaría dos disparadores y un error de SQLite por delante de un caso que la UI no
-- ofrece —solo las raíces tienen detalle— y que la importación ya nombra por su título.

ALTER TABLE tasks ADD COLUMN repeat TEXT;
ALTER TABLE tasks ADD COLUMN repeat_from TEXT NOT NULL DEFAULT 'fecha';
