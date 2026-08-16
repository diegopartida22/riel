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
- Exportar e importar JSON. El export sin vuelta no es un respaldo, es un archivo: lo que
  hace que los datos sean del usuario es poder devolverlos.
- Tareas recurrentes (§12). Entraron después de la v1, y no por capricho: sin ellas lo que se
  repite se escribe a mano cada vez, que es justo lo que una lista tendría que ahorrar.
- La carpeta de un proyecto y el botón que la abre en el editor (§13).

Fuera de la v1, no lo construyas:

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
  la lista completa. Insertar siempre en el mismo hueco parte la distancia por dos cada vez, y
  un `double` se queda sin dígitos entre dos vecinos después de unos cincuenta arrastres al
  mismo sitio: cuando el hueco baja de `1e-6`, renumera la lista entera en pasos de 1024 y
  vuelve a insertar. Es la única escritura de la app que toca muchas filas, y pasa casi nunca.
- Completar una tarea padre completa sus subtareas. Completar todas las subtareas **no**
  completa la padre automáticamente.
- Borrar un proyecto deja sus tareas sin proyecto, no las borra. Confírmalo con el usuario
  en un diálogo antes de ejecutar.

---

## 3. Dirección de diseño

### 3.1 El principio que gobierna todo

**La app no tiene color de acento propio: usa el del sistema.** El que el usuario eligió en
Ajustes del Sistema → Apariencia, y no uno inventado por nosotros. En la vista de un proyecto
sigue mandando el proyecto — sus casillas, anillos de foco, selección y botón primario usan su
color — y en Hoy, Próximas, Todas y Completadas el acento es el del sistema, con el color de
proyecto solo en el punto de cada fila.

El azul de `#007AFF` ya no está prohibido, pero tampoco se escribe: si el acento sale azul es
porque el usuario lo puso azul. **Ningún hex de acento va escrito en el código.** Lo lee Rust de
`NSColor.controlAccentColor` y lo publica como `--system-accent-light` / `--system-accent-dark`;
el CSS elige entre los dos con la media query, igual que los colores de proyecto con su pareja
claro/oscuro. Resolverlo desde JavaScript al cambiar el modo es lo que hace parpadear el cambio,
y eso sigue prohibido (criterio 5).

`--ink-accent`, el grafito neutro, deja de ser el acento por defecto pero no desaparece: es el
respaldo cuando no se puede leer el del sistema, es lo que se usa donde el acento no viene a
cuento —el punto de versión nueva del `⚙︎` (§11)— y es a donde cae el anillo de foco cuando el
color de un proyecto no llega a 3:1 (§5). También es a lo que cae el acento entero mientras la
ventana no es la clave: macOS desatura los controles de acento de una ventana inactiva, y el
panel refleja ese estado con `data-window` (§4).

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
vistas del sistema se representan con iconos en `--ink-tertiary`, separadas de los
proyectos por una hairline.

Los iconos son de Hugeicons (`@hugeicons/core-free-icons`, MIT) y se importan siempre desde
`src/ui/icons.tsx`, nunca del paquete: el juego es una decisión de diseño, y cambiarlo tiene
que ser un archivo. Ahí también se fija el grosor del trazo, que se mide en píxeles ya
dibujados y no en unidades de la rejilla de 24, para que un icono de 11px y uno de 15px
pesen lo mismo.

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
- Las dos affordances no llevan hueco propio: ocupan el de la fecha, que se desvanece al
  entrar ellas. El hueco de la derecha mide lo que el más ancho de los dos, así que no se
  mueve nada al cruzarse y el título no paga 34px permanentes por algo que casi nunca está
  en pantalla. Encimarlas sin más no vale: en una tarea sin fecha taparían el título.

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

### 3.9 Ajustes del sistema que se obedecen

Cuatro media queries, y ninguna es opcional. macOS tiene las tres primeras en Accesibilidad, y
una app que presume de nativa las respeta sin que haya que pedírselo.

- `prefers-reduced-transparency: reduce` → **el vidrio se sustituye por un sólido**. El material
  lo pinta el sistema por debajo del webview y desde CSS no hay forma de apagarlo, así que lo que
  se hace es taparlo: un fondo opaco de borde a borde en `#root`, con el mismo radio que publica
  Rust para que no asome por fuera del arco. Las veladuras de encima siguen valiendo tal cual —
  un 5% de negro se lee igual sobre un gris fijo que sobre el vidrio.
- `prefers-reduced-motion: reduce` → sin transiciones (criterio 7).
- `prefers-color-scheme` → claro y oscuro, sin colores escritos a mano.
- Ventana inactiva → el acento cae al grafito (§4).

### 3.10 Nada que delate una webview

Un panel de la barra de menú que se comporta como una página se cae de nativo en un solo gesto.
Lo que se apaga, y por qué:

- **El menú contextual del navegador.** Aparece con el gesto más común de macOS y nombra cosas
  que aquí no existen. Se apaga en todas partes menos sobre un campo, donde WKWebView da el menú
  de texto del sistema —cortar, copiar, pegar, ortografía— y ese sí se espera. El menú del `⋯`
  de una fila es lo que sustituye al de la lista (§3.5).
- **La selección de texto fuera de los campos.** `user-select: none` en `body`, con la excepción
  de `input` y `textarea` — sin ella no se puede seleccionar con el ratón lo que uno acaba de
  escribir en la búsqueda. El cursor va con ello: la viga solo donde se escribe.
- **El rebote elástico de la página.** Al llegar al final, el vidrio se despega del borde y por
  debajo asoma el escritorio. Se apaga el del documento, no el de las listas: dentro de un
  `NSScrollView` macOS sí rebota, y quitarlo también ahí sería menos nativo y no más.
- **El arrastre de imágenes y el outline azul por defecto.** El anillo de foco es el de §5.

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
  sustituto** — se nota de inmediato que no es vidrio del sistema. Sí lo usan las superficies
  que viven *dentro* del webview, que no tienen otra: un menú, el popover de Ajustes. No las
  confundas — `backdrop-filter` no difumina el escritorio, solo lo que queda detrás dentro de
  la webview. Y **un solo nivel de blur**: lo que flota sobre el vidrio lleva su material, y
  sus renglones van sólidos o transparentes pero nunca con blur propio.
- **Ventana inactiva.** `FollowsWindowActiveState` desatura el material heredado por su cuenta,
  pero no alcanza a lo que pintamos nosotros —el interruptor, el anillo de foco, el cursor, la
  selección— ni a `NSGlassEffectView`, que no tiene estado de ventana. Rust pone
  `data-window="inactivo"` en la raíz y el acento cae al grafito neutro (§3.1). Los puntos de
  proyecto se quedan: son contenido y no controles, y macOS tampoco despinta el contenido de una
  ventana inactiva. Casi nunca se ve, porque perder el foco oculta el panel — se ve mientras hay
  un modal o el selector de fecha delante, que es cuando el panel sigue en pantalla sin ser la
  ventana que manda.
- `app.set_activation_policy(ActivationPolicy::Accessory)` en `setup`, y `LSUIElement: true`
  en el `Info.plist`, para que no aparezca en el Dock ni en el conmutador de apps.
- Escape cierra el panel. Si hay búsqueda activa, el primer Escape la limpia y el segundo cierra.
- Cerrar el panel no es salir de la app, y sin Dock ni ⌘Tab tampoco hay menú de aplicación ni
  ⌘Q: **«Salir de Riel» va en Ajustes**, o pararla obliga a ir al Monitor de Actividad. Es un
  comando propio en Rust y no `tauri-plugin-process` — el plugin trae permisos que no hacen
  falta para un botón. Antes de salir, `cleanup_before_exit`, o el glifo se queda en la barra.
- Mientras haya un panel del sistema abierto por la app —elegir dónde guardar el export, elegir
  qué archivo importar— el panel no se oculta aunque pierda el foco. Una ventana del sistema se
  lo lleva por definición, y sin la excepción el panel se cerraría por debajo justo mientras se
  contesta lo que él mismo preguntó.

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

Con una salvedad, porque la 3.2 deja elegir un hex manual que cueste leerse: si el color del
proyecto no llega a 3:1 contra el fondo del modo, el anillo —y solo el anillo— cae a
`--ink-accent`. Avisar y no bloquear vale para las casillas y los puntos; no puede valer para
lo único que dice dónde está el teclado.

`⌘F` busca en el título, en las notas y en el nombre del proyecto, sobre todo lo que hay
—pendiente y completado, tareas y subtareas— sin importar la vista en la que se esté. Buscar es
la salida de emergencia de «sé que la escribí y no sé dónde la puse», y una búsqueda que solo
mira la vista actual no sirve para eso. Lo que no casa por el título vale menos que lo que sí:
encontrar algo porque la palabra salía en un párrafo es una coincidencia peor.

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

Los avisos los da la app, no el sistema: con Riel cerrada no llega ninguno, y las horas que
pasaron mientras tanto no se disparan al volver a abrirla — un aluvión de notificaciones de
ayer al arrancar es peor que no haberlas tenido. Sacarlos del proceso pediría un agente propio
en `launchd` o `UNUserNotificationCenter` con la app registrada, que es una app de fondo dentro
de otra: fuera de la v1, y no un descuido. Por eso el arranque al iniciar sesión (§8) es lo que
hace que las notificaciones funcionen de verdad.

---

## 8. Ajustes

Un popover pequeño desde el `⚙︎`, no una ventana aparte:

- Abrir al iniciar sesión (`tauri-plugin-autostart`).
- Vista al abrir, texto de las tareas, icono de la barra y retención de completadas.
- Exportar e importar JSON, y un enlace a los datos en Finder.
- La versión, el renglón de la actualización cuando hay una (§11) y salir de Riel (§4).

«Pequeño» es una restricción y no un adjetivo: el popover cuelga de un panel de 440 × 580 y no
tiene dónde desbordarse, así que se sujeta contra los dos bordes y no solo contra el derecho.

Una preferencia es una línea: su nombre a la izquierda y sus opciones a la derecha, alineadas
todas al mismo borde. Ni un renglón con palomita por opción —las cinco costaban quince líneas y
tapaban la lista entera— ni el nombre encima de sus opciones, que gasta una línea para diez
píxeles de texto y deja medio popover en blanco al lado: apretaba a lo alto justo donde sobraba
a lo ancho.

Cuatro de las cinco son la misma forma, un segmentado; la quinta es booleana y va con
interruptor. Lo que no vale para ella es la palomita a la izquierda —la gramática de un menú
metida entre cuatro filas que ya eran tabla— pero un segmentado de «Sí / No» tampoco: pide leer
dos palabras para saber un estado que un interruptor puede simplemente *tener*, y es el control
con el que el sistema dice esto. Medidas del sistema y no aproximadas: 38 × 22 con pulgar de 18
y 150 ms de recorrido. Un interruptor con otras proporciones es de lo primero que delata que un
control está hecho a mano, y aquí todos lo están.

Mientras `launchd` no conteste va apagado y no acepta clics: no hay posición para «todavía no se
sabe», y dejarlo pulsable antes de conocer el estado convierte el primer clic en un volado.

Tres niveles de tinta y no dos: el nombre y el valor puesto en `--ink-primary`, las opciones sin
elegir en `--ink-secondary`. Un rótulo que no se pulsa no puede pesar lo mismo que algo que sí.
El elegido de un segmentado lleva fondo y nunca un anillo de color, y el interruptor encendido
lleva el acento **del sistema** y no el del proyecto: el popover se dibuja dentro del panel, así
que dentro de un proyecto heredaría su color, y ninguna de las cinco preferencias es de un
proyecto (§3.1). Para eso está `--accent-app`, que es el acento que el proyecto no sobreescribe. La vista al abrir se elige con los iconos del riel, que es donde ya se aprendieron, y el
icono de la barra con los glifos mismos a 18px, que es el tamaño al que macOS los dibuja: la
previsualización no es una versión del glifo, es el glifo.

Las opciones de cada preferencia van sobre una pista, como un segmentado del sistema, y el
elegido se levanta de ella en vez de hundirse. Un fondo suelto al 9% basta para distinguir dos
palabras, pero en una fila de cinco glifos no se lee como «este»; con la pista, además, los
cinco dejan de ser botones sueltos flotando sobre el menú. Sigue siendo una veladura sobre el
vidrio y no un panel opaco (§3.2), y sigue sin haber color de por medio.

Y donde las opciones son dibujos —la vista al abrir, el icono de la barra— debajo va el nombre
del elegido, alineado con ellas. Un glifo de 15px se distingue de sus vecinos pero no se lee, y
sin pasar el ratón por cada uno no había forma de saber cuál está puesto. No es una segunda
línea de opciones ni contradice lo de arriba: es el valor puesto dicho en palabras.

Todo lo del popover cuelga de una sola sangría —la de `.menu__item`, que es su relleno más el
hueco de la palomita— y eso incluye las notas y los rótulos de grupo. Cada grupo de opciones es
una parada del tabulador y por dentro se recorre con las flechas, como un control segmentado del
sistema: con cada opción tabulable, cruzar Ajustes costaba dieciocho tabuladores.

Los grupos se separan con su rótulo —versalitas mono, el mismo tratamiento que los encabezados
de la lista (§3.3)— y no con hairlines. Una regla dice que hay un corte pero no de qué, y tres
reglas en un popover de doscientos píxeles lo convierten en una reja; un rótulo separa igual y
además nombra. El bloque de preferencias es el único sin rótulo, porque es para lo que existe el
popover. **La versión es el rótulo de su grupo**, no una línea al final: lo que cuelga de ella
—actualizar, salir— son las dos cosas que se le hacen a la app misma. Colgando sola debajo de
«Buscar actualizaciones» se leía como el número que ese botón acababa de encontrar, que es justo
lo contrario de lo que es.

Importar va pegado a exportar, porque son la misma operación en los dos sentidos: un export sin
forma de volver a entrar no es un respaldo, es un archivo. Del popover sale solo la pregunta de
cuál —los puntos suspensivos son eso— y el resto ocupa el área de contenido como el editor de
proyecto, que es donde hay sitio para leer.

Va en tres tiempos que fallan por razones distintas, y solo el último escribe: validar el
archivo entero, cruzarlo con lo que hay, aplicar. Validar entero por delante es lo que evita
rechazar en la fila doscientos con las ciento noventa y nueve anteriores ya dentro, y el error
nombra el campo y no la línea —`tasks[12]: «title» está vacío`— porque un JSON que pasó por otra
herramienta viene en una sola línea y ahí «línea 1» no localiza nada. El nivel único de
subtareas (§2) se comprueba aquí también, contra el archivo y contra la base: el disparador lo
defiende igual, pero puede decir cuál es la tarea que sobra en vez de dejar salir un error de
SQLite.

El resumen antes de escribir no es una cortesía. Los dos modos hacen cosas incomparables
—combinar solo agrega, reemplazar borra las dos tablas— y elegir sin saber qué trae el archivo
es elegir a ciegas. Combinar no pisa lo que ya está por id, y eso es deliberado: un respaldo de
hace un mes no puede revivir el título viejo de una tarea que se editó ayer. Reemplazar pide un
segundo sí con la cifra de lo que se lleva por delante, como eliminar un proyecto.

Antes de escribir se guarda una copia en `Backups/`, dentro del directorio de datos, y también
al combinar: el deshacer de una importación no cabe en la pila de ⌘Z —son miles de filas y dos
tablas— así que el respaldo *es* el deshacer. Lo importado se corre detrás de lo que ya hay en
vez de conservar su `position` cruda; dos listas hechas por separado empiezan las dos cerca de
cero, y sin correrlas lo de fuera se intercala con lo propio en un orden que no es el de
ninguna de las dos. No hay transacción porque `tauri-plugin-sql` reparte las sentencias sobre un
pool y un BEGIN y su COMMIT pueden caer en conexiones distintas; lo que cubre un fallo a mitad
es esa copia.

Una tarea del archivo cuyo proyecto no venga con él entra sin proyecto y el resumen lo dice
antes de confirmar. Es el mismo resultado que borrar un proyecto (§2), así que rechazar el
archivo entero por eso sería más severo que la propia app; lo que no vale es enterarse al
terminar de que cuarenta tareas perdieron el suyo. El `parent_id` colgando sí rechaza: una
subtarea sin madre no tiene dónde entrar.

Retención de completadas: 30 días por defecto, con opciones 7 / 30 / 90 / siempre. Barrido de
completadas al arrancar y también al cambiar el plazo — bajar a 7 días y no ver ningún cambio
deja sin saber si se guardó.

Por eso mismo, **acortar el plazo pregunta antes**, con la cifra de lo que se lleva: el barrido
no pasa por la pila de ⌘Z, y es la única preferencia del popover que destruye datos. Solo
pregunta cuando de verdad hay algo que perder — alargarlo, poner «siempre» o acortarlo sin que
caiga nada se guardan de una. Una confirmación que sale siempre se aprende a pulsar sin leerla,
y entonces ya no protege de nada. Mientras espera el sí, la opción pulsada se dibuja marcada
aunque no esté guardada: es lo que se está decidiendo, y dejar la marca en la vieja haría
parecer que el clic no llegó.

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
9. Ningún hex de acento está escrito en el código: cambiar el acento en Ajustes del Sistema
   recolorea el panel abierto, sin reiniciar y sin parpadeo.
10. Con `prefers-reduced-transparency` activo no queda una sola superficie translúcida.
11. Nada delata que es una webview: sin menú contextual del navegador, sin rebote elástico de
    la página, sin selección de texto fuera de los campos, sin arrastre de imágenes.
12. En reposo, con el panel cerrado, el proceso se mantiene por debajo de 60 MB.

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
`~/.tauri/riel.key`. Perderla deja a todo el que tenga una versión anterior sin actualizaciones
automáticas para siempre: no hay forma de rotarla, porque la llave pública va compilada dentro
de los binarios que ya están instalados, y una release firmada con otra llave la rechazan todos.
Así que no puede haber una sola copia. Dos, cifradas y fuera de esta máquina —un gestor de
contraseñas y un disco que no viva enchufado sirven— y el mismo cuidado que una llave SSH: se
pierde una vez y ya no se recupera.

---

## 12. Tareas recurrentes

Añadido después de la v1. Una tarea que vuelve no es una lista de fechas por delante: es **una
fila con una regla**, y la siguiente nace al completar la de ahora. Guardar el año entero de un
«cada lunes» son cincuenta y dos filas que nadie pidió, y cambiar la hora obligaría a reescribir
las cincuenta y dos.

Dos columnas nuevas en `tasks`, y ningún disparador: una regla en una subtarea es inerte, no
corrompe nada.

```sql
ALTER TABLE tasks ADD COLUMN repeat TEXT;                             -- "mensual:1:17"
ALTER TABLE tasks ADD COLUMN repeat_from TEXT NOT NULL DEFAULT 'fecha';
```

La regla es una cadena y no un JSON: son cuatro formas cerradas, se leen de un vistazo en un
export y no hay nada que versionar.

```
diario:N                 cada N días
semanal:N:1,3,5          cada N semanas, esos días (1 lunes … 7 domingo)
mensual:N:17             cada N meses, el día 17
mensual:N:ultimo         cada N meses, el último día — que en un mes son 30 y en otro 31
anual:N                  cada N años
```

Reglas:

- **Solo en las raíces.** Una subtarea vuelve con su madre, entera y sin completar. Una regla
  propia en una hija la sacaría de su grupo.
- **Sin fecha no hay regla.** Es desde ella desde donde se cuenta, así que quitar la fecha
  quita la repetición, y ponerle una regla a una tarea sin fecha le pone la de hoy.
- **La regla se muda, no se copia.** Al completar, la fila nueva se lleva la regla y la vieja se
  queda tachada y quieta. Copiarla dejaría dos filas repitiendo lo mismo cada vez que se
  desmarcara una completada.
- `repeat_from` decide desde dónde se cuenta la vuelta: `fecha` para lo que cae en un día del
  calendario —los impuestos son el 17 aunque se paguen el 19— y `completada` para lo que cuenta
  desde que se hizo —regar las plantas cada tres días, contados desde el último riego.
- **La siguiente siempre es futura.** Una tarea abandonada tres meses no reaparece con la fecha
  del mes pasado: la regla avanza hasta pasar el día en que se completó. La hora se conserva.
- El día 31 no se pierde por febrero. `31 ene → 28 feb → 31 mar`: la regla recuerda el 31 y el
  mes corto solo lo recorta, no lo reescribe.
- Deshacer una tarea completada durante sus 3 segundos (§3.6) borra también la que nació y le
  devuelve la regla a la de antes.
- En la fila, un `↻` de 11px en `--ink-tertiary` junto a la prioridad. Antes de completarla es
  lo único que separa «esto se acabó» de «esto vuelve el mes que viene».
- En el detalle va pegada a la fecha, y la captura la entiende: `cada mes`, `cada 3 días`,
  `cada martes`, `cada 2 semanas`.

---

## 13. La carpeta de un proyecto

Añadido después de la v1. Un proyecto de Riel y una carpeta del disco son la misma cosa muchas
veces —«riel» es la lista de tareas y también el repositorio— y lo que se hace con la segunda es
siempre lo mismo: abrirla en el editor. Vinculadas, eso es un clic desde donde ya se está
mirando la lista.

Una columna, y ningún índice: la ruta se lee con el proyecto y nunca se busca por ella.

```sql
ALTER TABLE projects ADD COLUMN folder TEXT;
```

Reglas:

- **Se señala, no se teclea.** La ruta la pone el panel del sistema, que es lo único que
  garantiza que la que se guarda existía al elegirla. El renglón vive en el editor de proyecto,
  debajo del color: sin carpeta invita a ponerla, con una puesta la enseña —abreviada, con el
  `~` del usuario y comida por delante—, la abre en el Finder al pulsarla y la quita con la `✕`.
- **No se comprueba que siga estando**, ni al guardarla ni al importar. Una carpeta se renombra,
  se mueve o vive en un disco que no está enchufado, y romper el vínculo por eso obligaría a
  volver a elegirla cada vez. Se comprueba al abrir, que es cuando importa y cuando hay a quién
  decírselo: «La carpeta ya no está ahí. Vuelve a elegirla en el proyecto.»
- **El botón va en el encabezado de la vista del proyecto**, al otro extremo del nombre, y solo
  con las dos condiciones puestas: hay carpeta y hay editor instalado. Con la lista vacía el
  encabezado aparece solo si trae el botón — un proyecto recién creado es justo cuando hace
  falta abrir su carpeta.
- **Qué editores hay lo contesta Rust**, preguntándole a Launch Services por identificador de
  paquete: así cuenta igual el instalado por Homebrew o fuera de `/Applications`. La lista es
  cerrada, y eso es lo que valida lo que llega del webview antes de acabar en un `open -b`. No
  se usa `tauri-plugin-shell`: ejecutar programas desde JavaScript es justo lo que una app que
  no sale a la red no tiene por qué poder hacer.
- **Cuál se usa es una preferencia de la máquina**, en `localStorage` con el riel y la vista de
  arranque. Sale en Ajustes solo con dos o más instalados: con uno, un segmentado de una opción
  no es una elección, es un rótulo. Es la única fila del popover que puede no estar, así que va
  la última de las preferencias y las cinco de siempre no cambian de sitio según la máquina.
- Nada de git, ramas ni estado del repositorio. Eso es otra app.
