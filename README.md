# Riel

Tareas en la barra de menú de macOS. Un clic en el icono abre un panel de vidrio para
capturar, organizar y completar. Sin Dock, sin cuenta, sin red.

> **Estado: v0.1.0.** Primera release, solo para Apple Silicon. Lo que hay funciona; lo que
> falta está anotado abajo sin adornos.

## Qué hace

- Tareas con notas, fecha, hora, prioridad, proyecto y un nivel de subtareas.
- Proyectos con color, en un riel lateral que se colapsa a una columna de discos.
- Vistas Hoy, Próximas, Todas, Completadas y una por proyecto.
- Captura en lenguaje natural: `Renovar dominio mañana 10:00 #infra !!` crea la tarea con la
  fecha, la hora, el proyecto y la prioridad ya puestas, y el título limpio.
- Búsqueda difusa, reordenar arrastrando, export a JSON, arranque al iniciar sesión.

## Qué no hace, a propósito

No sale a la red. No hay cuenta, ni sincronización, ni nube, ni telemetría, ni actualizador
automático. Los datos son un archivo SQLite en `~/Library/Application Support/com.riel.app`,
y se pueden exportar a JSON desde Ajustes o abrir con cualquier cliente de SQLite.

Tampoco aparece en el Dock ni con ⌘Tab: es una app de barra de menú y vive ahí.

## Requisitos

macOS 13 o posterior. En macOS 26 el panel usa Liquid Glass; en 13–15, el material de
vibrancy heredado.

## Instalar

Baja `Riel_0.1.0_aarch64.dmg` de la
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
