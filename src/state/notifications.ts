/**
 * Las notificaciones de la sección 7 del spec: solo para tareas con hora, a la hora exacta.
 *
 * La hora la lleva el sistema, no esta capa. Un `setTimeout` por tarea dentro de la webview
 * era lo natural en JavaScript y es justo lo que no funciona aquí: el panel vive cerrado, y
 * una webview sin ventana visible es lo primero que macOS estrangula. Lo que se manda a Rust
 * es el plan entero —cada tarea con sus segundos— y `UNUserNotificationCenter` se encarga de
 * despertar.
 *
 * La forma que pide el spec no cambia: nada de temporizadores colgados indefinidamente, sino
 * un recálculo periódico sobre una ventana de 24 h. Cada pasada reemplaza el plan completo,
 * que es lo que hace que cambiar una hora, completar o borrar se noten sin llevar cuentas.
 */

import { invoke } from "@tauri-apps/api/core";

import { localIso, tasksWithTimeBetween, type Project, type Task } from "../data";
import { curatedOf } from "../design/palette";

const MINUTE = 60 * 1000;

/** La ventana del spec. */
const WINDOW_MS = 24 * 60 * MINUTE;

/** Cada cuánto se rehace el plan. */
const RESCAN_MS = 10 * MINUTE;

/**
 * Cuánto se tolera llegar tarde. Si el equipo durmió tres horas, la tarea de las 14:00 se
 * registraría a las 17:00: avisar entonces no informa de nada y además miente sobre la hora.
 * Por debajo de este margen —un aviso con dos minutos de retraso— sí sirve, y se entrega en
 * cuanto la app vuelve.
 */
const GRACE_MS = 5 * MINUTE;

/**
 * - `granted` / `denied`: lo que contestó el sistema.
 * - `default`: todavía no se ha preguntado.
 * - `unavailable`: este arranque no puede avisar. Pasa en `tauri dev`, donde el binario corre
 *   suelto sin `.app`, y no es algo que se arregle en Ajustes del Sistema.
 */
export type Permission = "granted" | "denied" | "default" | "unavailable";

export const notificationPermission = () => invoke<Permission>("notification_permission");

/** Con qué avisa Rust de que alguien pulsó «Completar» en un banner. */
export const DONE_EVENT = "aviso-completar";

/** Lo completado desde un banner que todavía no se ha aplicado a la base. Vacía la cola. */
export const takeCompleted = () => invoke<string[]>("take_completed");

/** El último mapa con el que se armó el plan, para poder rearmarlo desde fuera del ciclo. */
let context: Map<string, Project> = new Map();
let ticker: number | null = null;

/**
 * La huella de lo último que se le mandó a Rust, o `EMPTY` si lo último fue vaciar el plan.
 *
 * Existe porque el plan se revisa mucho más de lo que cambia. Quien dispara la revisión es la
 * lista que se está viendo, y esa lista cambia también al navegar entre vistas y al escribir en
 * la búsqueda — dos cosas que no mueven ninguna hora. Sin la huella, cruzar el riel de Hoy a
 * Todas borraba y volvía a registrar en el sistema el plan entero de las próximas 24 h.
 *
 * Depender de la lista visible sigue siendo más ancho de lo necesario, y es a propósito: de más
 * cuesta una consulta con índice, y de menos costaría un aviso que no llega.
 */
let sent: string | null = null;

/** Lo que vale la huella cuando lo último que se mandó fue un plan vacío. */
const EMPTY = "\u0000vacío";

/**
 * Todo lo que entra en un aviso menos los segundos, que cambian con el reloj y no con los
 * datos: de ponerlos aquí, la huella nunca coincidiría consigo misma. Que el plan se vuelva a
 * mandar con los segundos frescos es justo lo que hace el repaso de los diez minutos.
 *
 * El icono tampoco entra —son unos cuantos kilobytes de PNG por tarea— pero sí lo que lo
 * determina: el color del proyecto y el modo claro/oscuro.
 */
function fingerprint(upcoming: Task[], projectsById: Map<string, Project>, night: boolean): string {
  const rows = upcoming.map((task) => {
    const project = task.projectId ? projectsById.get(task.projectId) : undefined;
    return [task.id, task.title, task.dueAt, project?.name ?? "", project?.color ?? ""];
  });
  return JSON.stringify([night, rows]);
}

/**
 * Pide el permiso, si hace falta. Se llama la primera vez que alguien le pone hora a una
 * tarea y no en el primer arranque, como pide el spec: el permiso se entiende cuando ya se
 * sabe para qué es.
 *
 * `keepOpen` existe porque la pregunta del sistema le quita el foco a la ventana, y sin
 * levantar la bandera el panel se cerraría justo debajo (spec 4).
 */
export async function ensurePermission(
  keepOpen: (value: boolean) => Promise<void>,
): Promise<boolean> {
  const state = await notificationPermission();
  if (state === "granted") return true;
  // Denegado o no disponible: preguntar otra vez no abre nada y macOS contesta lo mismo.
  if (state !== "default") return false;

  await keepOpen(true);
  let granted = false;
  try {
    granted = await invoke<boolean>("request_notification_permission");
  } finally {
    await keepOpen(false);
  }

  // La tarea que provocó la pregunta se guardó antes de preguntar, y la pasada de `schedule`
  // que disparó ese cambio se fue en vacío porque todavía no había permiso. Sin este rearme
  // el aviso esperaría al repaso de los diez minutos, que es justo lo que rompe el caso de
  // «ponle hora dentro de cinco».
  if (granted) await schedule(context, true);
  return granted;
}

/**
 * La segunda línea del aviso: la misma que lleva la fila en la lista, hora y proyecto.
 *
 * La hora va aunque parezca redundante en un aviso que suena a esa hora. El sello que pone
 * macOS es el de la entrega, no el de la tarea, y no son lo mismo: con el margen de gracia un
 * aviso de las 14:30 puede llegar a las 14:33, y horas después, en el Centro de
 * Notificaciones, es lo único que dice para cuándo era.
 *
 * Todo en una línea y no en tres campos: los títulos largos ya envuelven a dos renglones, y
 * un banner que se pasa de alto se corta por abajo, que es justo donde va lo que ubica.
 */
const body = (task: Task, project: Project | undefined): string | undefined => {
  const hour = task.dueAt?.slice(11, 16);
  if (!hour) return project?.name;
  return project ? `${hour} · ${project.name}` : hour;
};

/**
 * Lado del PNG del disco. El banner lo enseña a unos 38 pt, así que 128 va sobrado incluso en
 * pantalla Retina y el círculo no se ve dentado.
 */
const DISC = 128;

/** Un PNG por color y modo. Son ocho colores y dos modos: la caché no crece. */
const discs = new Map<string, number[]>();

/**
 * El punto de proyecto de la fila, convertido en la miniatura del banner.
 *
 * Es la única forma de que el color entre en un aviso, y la sección 3.1 dice exactamente
 * dónde puede aparecer: donde hay proyecto y en ningún otro sitio. Una tarea suelta no lleva
 * disco, igual que su fila no lleva punto.
 *
 * Se pinta aquí y no en Rust porque la pareja claro/oscuro de cada color ya vive en la
 * paleta, y tener esa tabla en dos idiomas sería tener dos tablas que se desincronizan.
 */
function disc(hex: string, night: boolean): number[] | undefined {
  const curated = curatedOf(hex);
  // Un hex escrito a mano no tiene pareja oscura: se usa igual en los dos modos, como en la UI.
  const paint = (night ? curated?.dark : curated?.light) ?? hex;

  const cached = discs.get(paint);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = DISC;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  // Fondo transparente: el sistema recorta la miniatura a su gusto, y un disco sobre nada se
  // apoya en el material del banner en vez de traer su propio cuadro de color.
  //
  // Y pequeño dentro de su cuadro. La ranura de miniatura del banner es grande, y un disco
  // que la llene sale más pesado que el propio icono de la app —que ya lleva tres discos— y
  // deja de leerse como el punto de la fila para leerse como una mancha. Es la misma razón
  // por la que el punto de la lista son 6 px junto a texto de 13: el color ubica, no grita.
  ctx.fillStyle = paint;
  ctx.beginPath();
  ctx.arc(DISC / 2, DISC / 2, DISC * 0.25, 0, Math.PI * 2);
  ctx.fill();

  const base64 = canvas.toDataURL("image/png").split(",")[1];
  const bytes = Array.from(atob(base64), (char) => char.charCodeAt(0));
  discs.set(paint, bytes);
  return bytes;
}

/**
 * Rehace el plan. Idempotente: llamarla de más solo vuelve a mandar la misma lista.
 *
 * `force` es lo que separa las dos formas de llegar aquí. Sin él, la pasada se para en cuanto
 * ve que lo que saldría es idéntico a lo último que salió: es el caso de las revisiones, que
 * son casi todas. Con él, la pasada llega hasta el final aunque nada haya cambiado — lo piden
 * el repaso de los diez minutos, porque los segundos sí se han movido, y el rearme de después
 * de conceder el permiso, porque lo que cambió no está en las tareas sino en el sistema.
 */
export async function schedule(projectsById: Map<string, Project>, force = false): Promise<void> {
  context = projectsById;

  const now = new Date();
  const upcoming = await tasksWithTimeBetween(
    localIso(new Date(now.getTime() - GRACE_MS)),
    localIso(new Date(now.getTime() + WINDOW_MS)),
  );

  // El modo se lee en cada pasada y no una vez: cambiar claro/oscuro con el panel abierto
  // tiene que reacomodar también lo que está registrado para dentro de un rato (criterio 5).
  const night = window.matchMedia("(prefers-color-scheme: dark)").matches;

  const print = fingerprint(upcoming, projectsById, night);
  if (!force && print === sent) return;

  // Sin permiso no hay plan, y además se limpia lo que hubiera: revocarlo desde Ajustes del
  // Sistema tiene que apagar los avisos que quedaran registrados de antes. Una vez, no en cada
  // pasada: con el permiso denegado el plan que corresponde es el vacío, y volver a mandarlo
  // vacío cada vez que se toca una tarea es la misma llamada de más que la huella evita arriba.
  if ((await notificationPermission()) !== "granted") {
    if (sent !== EMPTY) {
      await invoke("set_reminders", { items: [] });
      sent = EMPTY;
    }
    return;
  }

  const items = upcoming.map((task) => {
    const project = task.projectId ? projectsById.get(task.projectId) : undefined;
    return {
      id: task.id,
      title: task.title,
      body: body(task, project),
      icon: project ? disc(project.color, night) : undefined,
      // El `T` del ISO local no lleva zona, y `new Date` lo interpreta en la del equipo, que es
      // exactamente lo que significa la fecha guardada.
      seconds: (new Date(task.dueAt!).getTime() - Date.now()) / 1000,
    };
  });

  await invoke("set_reminders", { items });
  sent = print;
}

/**
 * Arranca el ciclo. Devuelve la función que lo para, para dársela tal cual a `useEffect`.
 *
 * Parar no cancela lo ya registrado: los avisos viven en el sistema y no en la app, y que
 * cerrar el panel apagara los de la tarde sería lo contrario de lo que se pidió al ponerles
 * hora.
 */
export function start(): () => void {
  // El mapa lo pone `schedule`, y quien la llama primero es la revisión que corre al montar.
  // Leerlo aquí ataría el ciclo al mapa del arranque —vacío, porque los proyectos todavía se
  // están cargando— y con él a los avisos les faltaría el color hasta el repaso siguiente.
  ticker = window.setInterval(() => void schedule(context, true), RESCAN_MS);

  return () => {
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
  };
}
