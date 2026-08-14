# Spec: app de tareas para la barra de menú de macOS

App nativa de macOS que vive en la barra de menú. Un clic en el icono abre un panel
translúcido para capturar, organizar y completar tareas. Sin Dock, sin ventana principal,
sin cuenta de usuario. Todo local: la única red que toca es la del actualizador (§11).

Stack: **Tauri v2 + React + TypeScript + Vite**. SQLite local.

Este documento es la fuente de verdad. Si algo no está aquí, pregunta antes de inventarlo.

---

## 1. Alcance de la v1

Dentro:

- Tareas con título, notas opcionales, fecha opcional, prioridad, proyecto y subtareas.
- Proyectos con color.
- Vistas: Hoy, Próximas, Todas, Completadas, y una vista por proyecto.
- Búsqueda difusa.
- Reordenar con drag & drop.
- Notificaciones nativas para tareas con hora.
- Arranque al iniciar sesión.

Fuera de la v1, no lo construyas:

- Tareas recurrentes.
- Sincronización, cuentas, nube.
- Subtareas anidadas más allá de un nivel.
- Atajo global de teclado.
- Adjuntos, etiquetas, colaboración.

---

## 2. Modelo de datos

SQLite vía `tauri-plugin-sql`, en el directorio de datos de la app.

```sql
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
```

Reglas:

- **Un solo nivel de subtareas.** Una tarea con `parent_id` no puede tener hijas. Valida
  en la capa de datos, no solo en la UI.
- `has_time = 0` significa que `due_at` representa solo el día; ignora la hora al mostrar.
- `position` es float para permitir reordenar insertando entre dos valores sin reescribir
  la lista completa.
- Completar una tarea padre completa sus subtareas. Completar todas las subtareas **no**
  completa la padre automáticamente.
- Borrar un proyecto deja sus tareas sin proyecto, no las borra. Confírmalo con el usuario
  en un diálogo antes de ejecutar.

---

## 3. Dirección de diseño

### 3.1 El principio que gobierna todo

**La app no tiene color de acento propio.** El acento lo presta el proyecto en contexto:
en la vista de un proyecto, sus casillas, anillos de foco, selección y botón primario usan
el color de ese proyecto. En Hoy, Próximas, Todas y Completadas — donde conviven varios
proyectos — el acento cae a `--ink-accent`, un grafito neutro, y el color aparece
únicamente en el punto de proyecto de cada fila.

Consecuencia: **nunca uses el azul de sistema de macOS**. No hay `#007AFF` en esta app.

### 3.2 Color

El vidrio real lo pinta el sistema, no nosotros. Por eso casi toda la paleta son capas con
alfa sobre la vibrancy — nada de paneles opacos encima, eso mata el efecto. Define tokens
en `:root` y sobreescríbelos en `@media (prefers-color-scheme: dark)`.

```
                         claro                dark
--ink-primary            #1C1C1E ／ 92%       #FFFFFF ／ 92%
--ink-secondary          #1C1C1E ／ 55%       #FFFFFF ／ 58%
--ink-tertiary           #1C1C1E ／ 32%       #FFFFFF ／ 36%
--ink-accent             #3A3A3C              #E8E8EA
--layer-hover            #000000 ／ 5%        #FFFFFF ／ 7%
--layer-selected         #000000 ／ 9%        #FFFFFF ／ 12%
--hairline               #000000 ／ 10%       #FFFFFF ／ 12%
--field-bg               #FFFFFF ／ 55%       #000000 ／ 22%
--danger                 #C4483C              #E8695C
```

Los 8 colores curados de proyecto. Cada uno lleva par claro/dark; sobre vidrio oscuro las
versiones claras se apagan, así que se aclaran ligeramente.

```
Cobalto    #3B6FE0  →  #6C97F0
Turquesa   #1D9E9E  →  #3FBEBE
Jade       #2E9E5B  →  #4FBE7C
Ámbar      #C98A16  →  #E0A93A
Ladrillo   #C4483C  →  #E06B5F
Carmín     #D2467E  →  #EA6E9D
Violeta    #7C5CE0  →  #9E85EE
Grafito    #6B7280  →  #98A0AC
```

El selector de color del proyecto muestra estos 8 como discos, más un botón `+` al final
que abre un campo de hex manual (`#RRGGBB`, valida el formato y rechaza lo que no parsee).
Si el hex manual tiene un contraste menor a 3:1 contra `--ink-primary` en cualquiera de los
dos modos, muéstralo igual pero avisa en línea: "Este color va a costar leerse en modo
oscuro." No lo bloquees — es su decisión.

### 3.3 Tipografía

Dos roles, deliberados:

- **Interfaz**: la fuente del sistema, `-apple-system, BlinkMacSystemFont`. En una app que
  debe pasar por nativa, cualquier otra cosa la delata.
- **Datos**: `ui-monospace, "SF Mono", monospace` con `font-variant-numeric: tabular-nums`,
  para fechas, horas, contadores y encabezados de día. Esto es lo que le da personalidad de
  herramienta y no de app genérica de listas: las fechas quedan alineadas en columna y la
  lista no baila cuando cambian los números.

Escala, ceñida a propósito:

```
título de fila       13px / 1.35 / peso 400
notas y metadatos    11px / 1.4  / peso 400  → --ink-secondary
fecha y hora         11px mono   / peso 500  / tracking 0.02em
encabezado de grupo  10px mono   / peso 600  / mayúsculas / tracking 0.08em → --ink-tertiary
nombre de proyecto   12px / peso 500
```

### 3.4 Layout

Panel de **440 × 580**, no redimensionable, esquinas de 12px.

```
┌──────────────────────────────────────────────┐
│ ⌕ Buscar                                 ⚙︎  │  48px
├──────┬───────────────────────────────────────┤
│      │  HOY                                  │
│ ●    │  ○  Revisar PR de auth        mié 12  │
│ ●    │     ○ dejar comentarios               │
│ ●    │  ○  Llamar al banco        !  14:30   │
│ ●    │                                       │
│ ●    │  PRÓXIMAS                             │
│      │  ○  Renovar dominio           vie 14  │
│ ⊕    │                                       │
├──────┼───────────────────────────────────────┤
│      │  + Nueva tarea                        │  44px
└──────┴───────────────────────────────────────┘
   ↑ riel de proyectos, colapsado a 44px
```

**El riel es el elemento firma de la app.** Colapsado (por defecto) es una columna de
discos de color: los proyectos son reconocibles solo por su color, sin texto. Expandido a
148px muestra los nombres junto a los discos, más las vistas Hoy / Próximas / Todas /
Completadas arriba. El estado de expansión persiste. En el riel colapsado, las cuatro
vistas del sistema se representan con iconos de Lucide en `--ink-tertiary`, separadas de
los proyectos por una hairline.

Al hacer hover sobre un disco colapsado, aparece un tooltip nativo con el nombre y el
conteo de pendientes.

### 3.5 La fila de tarea

```
○  Revisar el PR de autenticación        ●  mié 12
   └ checkbox    título                proyecto  fecha
```

- Checkbox: círculo de 15px, borde `--ink-tertiary` de 1.5px. Al hover, el borde toma el
  color del proyecto de esa tarea.
- Prioridad: **alta** muestra un `!` en el color del proyecto antes de la fecha. **Media**
  muestra el `!` en `--ink-tertiary`. **Baja no muestra nada.** Esto es intencional — es lo
  que evita que la lista se vuelva un semáforo.
- Fecha: en mono. Vencida → `--danger`. Hoy → `--ink-primary`. Futura → `--ink-secondary`.
  Formato corto en español: `mié 12`, `14:30` si es hoy con hora, `12 ago` si es de otro mes.
- Punto de proyecto: 6px, solo en vistas mixtas. Dentro de un proyecto es redundante, ocúltalo.
- Subtareas: indentadas 22px, título a 12px, sin punto de proyecto ni fecha propia.
- Hover: fondo `--layer-hover`, radio 6px, y aparecen dos affordances a la derecha —
  un `⋯` para el menú contextual y una manija de arrastre. Antes del hover no hay nada:
  la fila en reposo es solo texto.

### 3.6 Completar una tarea

Este es el gesto que más se repite en la app, así que es donde vale gastar el detalle:

1. La casilla se llena con el color del proyecto y dibuja la palomita en 180ms.
2. El tachado del título se traza de izquierda a derecha en 220ms — `clip-path`, no un
   `text-decoration` que aparece de golpe.
3. La fila baja a 45% de opacidad.
4. A los 3 segundos colapsa su altura en 200ms y sale de la lista.
5. Durante esos 3 segundos, un clic en la casilla lo revierte todo. El deshacer tiene que
   sentirse instantáneo.

Todo esto respeta `prefers-reduced-motion: reduce`: sin trazado, sin colapso animado, la
fila simplemente desaparece tras los 3 segundos.

### 3.7 Estados vacíos

Un estado vacío es una invitación a actuar, no un dibujo. Sin ilustraciones, sin frases
motivacionales.

- Hoy sin nada: "Nada para hoy." + "Agregar tarea" como botón de texto.
- Proyecto vacío: "Este proyecto está vacío."
- Búsqueda sin resultados: "Sin resultados para «renovar»."
- Primer arranque: una sola línea en el campo de captura con el placeholder "¿Qué hay que
  hacer?" y el foco puesto ahí.

### 3.8 Copy

Sentence case en todo. Verbos en infinitivo para acciones ("Agregar tarea", "Eliminar
proyecto"). El nombre de una acción no cambia entre el botón y su resultado. Los errores
dicen qué pasó y qué hacer, sin disculparse.

---

## 4. Comportamiento de la ventana

- Un clic en el icono de la barra abre o cierra el panel, posicionado bajo el icono con
  `tauri-plugin-positioner` (`TrayCenter`).
- El panel se oculta al perder el foco (`WindowEvent::Focused(false)`), **excepto** si hay
  un diálogo modal abierto o el selector de fecha desplegado.
- `decorations: false`, `transparent: true`, `shadow: true`, `alwaysOnTop: true`,
  `resizable: false`, `skipTaskbar: true`.
- Vibrancy con `window-vibrancy`: material `NSVisualEffectMaterial::Popover`, estado
  `FollowsWindowActiveState`, con radio de 12. **No uses `backdrop-filter` de CSS como
  sustituto** — se nota de inmediato que no es vidrio del sistema.
- `app.set_activation_policy(ActivationPolicy::Accessory)` en `setup`, y `LSUIElement: true`
  en el `Info.plist`, para que no aparezca en el Dock ni en el conmutador de apps.
- Escape cierra el panel. Si hay búsqueda activa, el primer Escape la limpia y el segundo cierra.

### Icono de la barra

Imagen *template* monocroma (`.icon_as_template(true)`), 22×22 @2x, para que se adapte sola
a la barra clara y oscura y al modo de contraste alto. Dos estados:

- **Contorno**: sin nada vencido.
- **Relleno**: hay al menos una tarea vencida.

Sin badge numérico. El cambio de peso del glifo es suficiente y no ensucia la barra.

---

## 5. Teclado

No es una app keyboard-first, pero lo básico tiene que estar:

```
↑ ↓          moverse entre tareas
Espacio      completar / descompletar la tarea enfocada
⏎            editar el título en línea
⌘⏎           guardar y crear otra debajo
⌘F           enfocar la búsqueda
⌘N           enfocar el campo de nueva tarea
⌘1..4        Hoy / Próximas / Todas / Completadas
Esc          limpiar búsqueda, luego cerrar
⌘Z           deshacer la última acción destructiva
```

Anillo de foco visible siempre: 2px del color de acento en contexto, con 2px de offset.
Nunca `outline: none` sin reemplazo.

---

## 6. Captura de tareas

El campo inferior acepta texto plano y lo parsea al vuelo, mostrando los tokens detectados
como chips debajo del campo antes de confirmar:

- `hoy`, `mañana`, `lun`…`dom`, `12 ago`, `14:30` → fecha y hora
- `#proyecto` → asigna proyecto (autocompletado al escribir `#`)
- `!` / `!!` → prioridad media / alta

Ejemplo: `Renovar dominio mañana 10:00 #infra !!` crea la tarea con todo asignado y deja el
título limpio en "Renovar dominio". Si el parseo se equivoca, un clic en el chip lo quita y
el texto vuelve al título.

Usa `chrono-node` o equivalente en español, o escribe el parser a mano — es un dominio
acotado y un parser propio de ~80 líneas es más predecible que una librería que adivina.

---

## 7. Notificaciones

`tauri-plugin-notification`. Solo para tareas con `has_time = 1`, a la hora exacta. Pide
permiso la primera vez que el usuario le pone hora a una tarea, no en el primer arranque.
Si se deniega, muestra una nota discreta en Ajustes con un enlace a Preferencias del Sistema.

Programa las notificaciones al arrancar la app y cada vez que cambie una fecha. No dejes un
`setTimeout` por tarea corriendo indefinidamente — recalcula sobre una ventana de 24h.

---

## 8. Ajustes

Un popover pequeño desde el `⚙︎`, no una ventana aparte:

- Abrir al iniciar sesión (`tauri-plugin-autostart`).
- Retención de completadas: 30 días por defecto, con opciones 7 / 30 / 90 / siempre.
- Exportar a JSON.
- Versión y un enlace a los datos en Finder.
- El renglón de la actualización, cuando hay una (§11).

Barrido de completadas al arrancar: borra lo que exceda la retención configurada.

---

## 9. Criterios de aceptación

La v1 está lista cuando:

1. El panel abre bajo el icono en menos de 100ms y el vidrio se ve idéntico al de un
   popover nativo del sistema, en claro y en oscuro.
2. La app no aparece en el Dock ni con ⌘Tab.
3. `Renovar dominio mañana 10:00 #infra !!` crea la tarea correcta de una sola pasada.
4. Completar una tarea se ve fluido y se puede deshacer durante 3 segundos.
5. Cambiar el modo claro/oscuro del sistema con el panel abierto reacomoda los colores sin
   reiniciar y sin parpadeo.
6. Reordenar por drag & drop persiste tras cerrar y reabrir.
7. Con `prefers-reduced-motion` activo no hay una sola animación de movimiento.
8. Navegar toda la app solo con teclado deja siempre un foco visible.
9. Ninguna superficie de la UI usa el azul de sistema de macOS.
10. En reposo, con el panel cerrado, el proceso se mantiene por debajo de 60 MB.

---

## 10. Orden de construcción

Trabaja en este orden y verifica visualmente en cada paso antes de seguir:

1. Andamiaje de Tauri v2 + tray + panel posicionado + vibrancy + activation policy.
   **Para aquí y confirma que el vidrio se ve bien antes de escribir una línea de UI.**
2. Esquema de SQLite, migraciones y capa de acceso a datos con las reglas de la sección 2.
3. Tokens de diseño en CSS y los primitivos: fila, checkbox, punto de proyecto, chip de fecha.
4. Vista Hoy funcionando de punta a punta: leer, crear, completar.
5. Riel de proyectos, colapsado y expandido, con el selector de color.
6. Las vistas restantes y la búsqueda.
7. Parser de captura.
8. Drag & drop.
9. Notificaciones, ajustes, autostart.
10. Pasada de pulido contra los diez criterios de aceptación.

Toma capturas de pantalla y critica tu propio trabajo en los pasos 4, 5 y 10. Un panel de
vidrio con espaciados de 1px de más se ve mal de una forma difícil de nombrar y fácil de ver.

---

## 11. Actualizaciones

Añadido después de la v1. Es lo único que rompe el «todo local» del encabezado, así que hay
que ser preciso sobre hasta dónde llega.

`tauri-plugin-updater` contra un archivo estático colgado de las releases de GitHub:
`https://github.com/diegopartida22/riel/releases/latest/download/latest.json`. Sin servidor,
sin servicio de terceros, sin coste.

Lo que sale por la red es una petición GET a ese archivo y, si hay versión nueva y el usuario
pulsa, la descarga del paquete. **No se manda nada**: ni la versión instalada, ni un
identificador, ni un contador. Una descarga de un archivo estático no tiene dónde ponerlo, y
así tiene que seguir siendo — cualquier cosa que convierta esto en una petición con parámetros
es telemetría con otro nombre.

Reglas:

- **Nada se instala solo.** El chequeo es silencioso; instalar es siempre una decisión del
  usuario. Un panel de barra de menú que se reinicia solo mientras se escribe una tarea es
  exactamente lo que hace desinstalar una app.
- **El aviso es un punto de 5px en el `⚙︎`**, en `--ink-accent` aunque se esté dentro de un
  proyecto: la actualización no es del proyecto que se está mirando. Nada de banners sobre la
  lista, nada de badges numéricos.
- **Cuándo se pregunta**: al arrancar, y al abrir el panel si han pasado 24 h desde la última
  vez. No un `setInterval` de 24 h — la webview vive con el panel cerrado y macOS estrangula
  sus temporizadores, igual que con los avisos de §7.
- **Un fallo de red no se enseña.** Sin red, o con GitHub caído, la app funciona igual y se
  vuelve a preguntar en la próxima apertura. Solo se muestra un error si el usuario pulsó, y
  dice qué pasó y qué hacer (§3.8): que la versión de siempre sigue puesta, y el enlace para
  bajarla a mano.
- La firma minisign la verifica el plugin contra `pubkey` antes de reemplazar nada. Un GitHub
  comprometido no basta para colar un binario: harían falta también las llaves.

Reiniciar después de instalar es un comando propio en Rust y no `tauri-plugin-process`, por lo
mismo que `quit` (§4): el plugin traería permisos que no hacen falta para un botón. Lo que sí
hace falta es `cleanup_before_exit`, o el proceso viejo deja su glifo en la barra junto al del
nuevo.

Las releases las corta `npm run release -- X.Y.Z`. La llave privada vive fuera del repo, en
`~/.tauri/riel.key`, y es la única copia: perderla deja a todo el que tenga una versión
anterior sin actualizaciones automáticas para siempre.
