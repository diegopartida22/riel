-- La carpeta de un proyecto (spec 13).
--
-- Una columna y ningún índice: la ruta se lee con el proyecto y nunca se busca por ella. Nula
-- es lo normal — un proyecto es «Casa» o «Impuestos» tantas veces como es un repositorio.
--
-- Ruta absoluta y tal cual la devuelve el panel del sistema, sin `~` ni normalizar: es la que
-- hay que volver a darle a `open`, y una ruta que se guarda distinta de como se usa es una
-- ruta que hay que traducir en los dos sentidos. Abreviarla es cosa de la UI, que es donde el
-- ancho importa.
--
-- Sin comprobar que exista, ni aquí ni al guardarla. Una carpeta se renombra, se mueve o vive
-- en un disco que no está enchufado, y perder el vínculo por eso obligaría a volver a elegirla
-- cada vez que se conecta el disco. Se comprueba al abrir, que es cuando importa y cuando hay
-- a quién decírselo.

ALTER TABLE projects ADD COLUMN folder TEXT;
