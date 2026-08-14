# Riel

Tareas en la barra de menú de macOS. Un clic en el icono abre un panel de vidrio para
capturar, organizar y completar. Sin Dock, sin cuenta, sin red.

> **Estado: v0.1.1.** Solo para Apple Silicon. Lo que hay funciona; lo que
> falta está anotado abajo sin adornos.

## Qué hace

- Tareas con notas, fecha, hora, prioridad, proyecto y un nivel de subtareas.
- Proyectos con color, en un riel lateral que se colapsa a una columna de discos.
- Vistas Hoy, Próximas, Todas, Completadas y una por proyecto.
- Captura en lenguaje natural: `Renovar dominio mañana 10:00 #infra !!` crea la tarea con la
  fecha, la hora, el proyecto y la prioridad ya puestas, y el título limpio.
- Búsqueda difusa, reordenar arrastrando, export a JSON, arranque al iniciar sesión.
- Se actualiza sola desde las releases de este repo, cuando se lo pides.

## Qué no hace, a propósito

No hay cuenta, ni sincronización, ni nube, ni telemetría. Los datos son un archivo SQLite en
`~/Library/Application Support/com.riel.app`, y se pueden exportar a JSON desde Ajustes o
abrir con cualquier cliente de SQLite.

La única vez que Riel sale a la red es para preguntar si hay versión nueva: baja el
`latest.json` de las releases de este repo al arrancar, y como mucho una vez al día a partir
de ahí. No manda nada de vuelta —descargar un archivo estático no tiene dónde ponerlo—, así
que lo que GitHub ve es lo mismo que vería si abrieras la página de releases en Safari. Si
hay algo nuevo aparece un punto en el engranaje y un renglón en Ajustes; nada se instala sin
que lo pulses.

Tampoco aparece en el Dock ni con ⌘Tab: es una app de barra de menú y vive ahí.

## Requisitos

macOS 13 o posterior. En macOS 26 el panel usa Liquid Glass; en 13–15, el material de
vibrancy heredado.

## Instalar

Baja `Riel_0.1.1_aarch64.dmg` de la
[última release](https://github.com/diegopartida22/riel/releases/latest). Es solo para Apple
Silicon: en una Mac Intel no abre.

La app va firmada con una identidad de desarrollo de Apple, pero **no notarizada** —la
notarización pide una cuenta de desarrollador de pago—, así que macOS va a negarse a abrirla
la primera vez:

1. Arrastra `Riel.app` a Aplicaciones y ábrela con doble clic.
2. macOS dice que no puede comprobar que no contenga software malicioso. Acepta.
3. Ve a Ajustes del Sistema → Privacidad y seguridad, baja hasta el aviso de Riel y pulsa
   **Abrir de todos modos**.

Desde macOS 15 el atajo de clic derecho → Abrir ya no sirve para esto; hay que pasar por
Ajustes del Sistema. Desde la terminal, `xattr -dr com.apple.quarantine /Applications/Riel.app`
hace lo mismo de una vez.

Esto es solo la primera vez. Las actualizaciones las baja la propia app y no pasan por el
navegador, así que macOS no les pone la cuarentena y entran sin volver a preguntar nada.

### Sobre las notificaciones

En macOS 26, `UNUserNotificationCenter` no registra una app cuyo paquete no esté firmado con
un certificado emitido por Apple. Sin esa firma la app pide el permiso, el sistema contesta
que sí, y no entrega nada. La release sí está firmada, así que las tareas con hora avisan.
Lo que no avisa es `npm run tauri dev`: ahí el binario corre suelto, sin `.app` que firmar.

## Desarrollo

```bash
npm install
npm run tauri dev     # panel en caliente; sin notificaciones (el binario corre sin .app)
npm run tauri build   # genera Riel.app y el .dmg
```

El `.dmg` de la release se arma con la identidad puesta en el entorno, para que la app salga
firmada de una vez y no haya que refirmarla después:

```bash
APPLE_SIGNING_IDENTITY="Apple Development: tu@correo (EQUIPO)" npm run tauri build
```

### Cortar una release

```bash
export APPLE_SIGNING_IDENTITY="Apple Development: tu@correo (EQUIPO)"
npm run release -- 0.1.2              # sube la versión, compila, etiqueta y publica
npm run release -- 0.1.2 --dry-run    # todo lo local, sin tocar git ni GitHub
```

El script sube la versión en los tres archivos que tienen que decir lo mismo —`package.json`,
`tauri.conf.json` y `Cargo.toml`—, compila firmando con la identidad de Apple, comprueba con
`codesign` que la firma quedó puesta, arma el `latest.json` con la firma minisign del paquete
y crea la release con el `.dmg`, el `.app.tar.gz`, su `.sig` y el manifiesto. Necesita
[`gh`](https://cli.github.com) autenticado.

El `latest.json` no se escribe a mano: lleva dentro la firma del paquete, y si no cuadra con
la llave pública de `tauri.conf.json` la app rechaza la actualización sin explicar por qué.

La llave privada del actualizador vive en `~/.tauri/riel.key` y **no está en el repo**. Es la
única copia: si se pierde, hay que generar otra y publicar la pública nueva, y quien tenga
instalada una versión anterior se queda sin actualizaciones automáticas para siempre —tendría
que bajar el `.dmg` a mano una vez más—. Vale la pena tenerla respaldada donde guardes las
contraseñas.

Stack: Tauri v2 + React + TypeScript + Vite, SQLite vía `tauri-plugin-sql`.

```
src/            React: data (SQL), state (hooks), ui (primitivos), views (pantallas)
src-tauri/      Rust: bandeja, panel, vidrio, avisos, migraciones
CLAUDE.md       El spec. Es la fuente de verdad del diseño y del alcance.
```

## Diseño

[`CLAUDE.md`](CLAUDE.md) tiene la dirección completa: la paleta, la tipografía, el
comportamiento del panel y los criterios de aceptación. Dos reglas gobiernan el resto: la app
no tiene color de acento propio —lo presta el proyecto en contexto— y en ninguna superficie
aparece el azul de sistema de macOS.

## Apoyar

Es gratis y va a seguir siéndolo. Si te resulta útil y quieres invitar un café, hay un enlace
de GitHub Sponsors en la barra lateral del repositorio.

## Licencia

MIT. Ver [`LICENSE`](LICENSE).
