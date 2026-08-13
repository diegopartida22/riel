import type { CSSProperties } from "react";

/**
 * Los ocho colores curados de proyecto (spec 3.2). Cada uno va en pareja: la versión clara
 * se apaga sobre vidrio oscuro, así que en modo oscuro se usa la aclarada.
 *
 * En la base se guarda **la clara**, que es la identidad del color; la oscura se deduce.
 */
export interface ProjectColor {
  id: string;
  name: string;
  light: string;
  dark: string;
}

export const PALETTE: ProjectColor[] = [
  { id: "cobalto", name: "Cobalto", light: "#3B6FE0", dark: "#6C97F0" },
  { id: "turquesa", name: "Turquesa", light: "#1D9E9E", dark: "#3FBEBE" },
  { id: "jade", name: "Jade", light: "#2E9E5B", dark: "#4FBE7C" },
  { id: "ambar", name: "Ámbar", light: "#C98A16", dark: "#E0A93A" },
  { id: "ladrillo", name: "Ladrillo", light: "#C4483C", dark: "#E06B5F" },
  { id: "carmin", name: "Carmín", light: "#D2467E", dark: "#EA6E9D" },
  { id: "violeta", name: "Violeta", light: "#7C5CE0", dark: "#9E85EE" },
  { id: "grafito", name: "Grafito", light: "#6B7280", dark: "#98A0AC" },
];

/** `#RRGGBB`, en mayúsculas o minúsculas. Es la forma en que se guarda, no la que se exige. */
export const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Lee un color escrito a mano y lo devuelve como `#RRGGBB`, o nulo si no hay forma de leerlo.
 *
 * Acepta más de lo que guarda, a propósito. Un hex se copia de sitios que lo escriben distinto
 * —de Figma llega sin `#`, de un CSS llega abreviado a tres— y rechazar esas formas no protege
 * de nada: no hay ambigüedad sobre qué color quería quien escribió `d4ff44`. Lo que sí hacía
 * daño era exigir la forma exacta, porque el error no se leía como «te falta la almohadilla»
 * sino como «este campo no sirve».
 */
export function parseHex(text: string): string | null {
  const body = text.trim().replace(/^#/, "").toUpperCase();
  // Los tres dígitos de CSS son cada uno duplicado: `#ABC` es `#AABBCC`, no `#0A0B0C`.
  if (/^[0-9A-F]{3}$/.test(body)) return `#${[...body].map((digit) => digit + digit).join("")}`;
  if (/^[0-9A-F]{6}$/.test(body)) return `#${body}`;
  return null;
}

/**
 * El color curado al que corresponde un hex guardado, si es uno de los ocho. Un hex escrito a
 * mano no tiene pareja: se usa igual en los dos modos, porque inventarle una versión oscura
 * sería cambiarle el color que la persona eligió.
 */
export function curatedOf(hex: string): ProjectColor | null {
  return PALETTE.find((color) => color.light.toLowerCase() === hex.toLowerCase()) ?? null;
}

/** Luminancia relativa de la WCAG, el paso previo a cualquier razón de contraste. */
function luminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const rgb = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((rgb >> 16) & 0xff) +
    0.7152 * channel((rgb >> 8) & 0xff) +
    0.0722 * channel(rgb & 0xff)
  );
}

/** Razón de contraste entre dos hex opacos, de 1 a 21. */
export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const ON_DARK = "#FFFFFF";
const ON_LIGHT = "#1C1C1E";

/** `--ink-primary` sin el alfa, que es contra lo que el spec mide un hex manual (3.2). */
const INK_LIGHT = ON_LIGHT;
const INK_DARK = ON_DARK;

/**
 * El aviso en línea del selector de color, o nada si el color se lee bien en los dos modos.
 * No bloquea: el spec es explícito en que se muestra igual, porque es su decisión.
 *
 * El segundo mensaje no está en el spec, que solo escribe el del modo oscuro. Hace falta
 * porque un color muy apagado falla por el otro lado, y avisar del modo equivocado sería peor
 * que no avisar.
 */
export function contrastWarning(hex: string): string | null {
  if (contrast(hex, INK_DARK) < 3) return "Este color va a costar leerse en modo oscuro.";
  if (contrast(hex, INK_LIGHT) < 3) return "Este color va a costar leerse en modo claro.";
  return null;
}

/**
 * Qué tinta se dibuja encima de un color. Solo se calcula para los hex escritos a mano: los
 * ocho curados llevan palomita blanca siempre, que es la convención y lo que mantiene la
 * casilla reconocible entre proyectos. Un hex libre puede ser `#FFFF00`, y ahí una palomita
 * blanca sencillamente no existiría.
 */
export function inkOn(hex: string): string {
  return contrast(hex, ON_DARK) >= contrast(hex, ON_LIGHT) ? ON_DARK : ON_LIGHT;
}

/**
 * Las dos variantes como propiedades en línea, para que la regla de `.tinted` elija según el
 * modo. Sin color — una tarea sin proyecto — devuelve nada y el acento neutro se queda, con la
 * palomita que le corresponde.
 */
export function tint(hex: string | null | undefined): CSSProperties {
  if (!hex) return {};

  const curated = curatedOf(hex);
  const { light, dark } = curated ?? { light: hex, dark: hex };

  return {
    "--project-light": light,
    "--project-dark": dark,
    "--on-project": curated ? ON_DARK : inkOn(hex),
  } as CSSProperties;
}
