// Genera los iconos de la barra de menú como PNG template.
//
// Un icono template solo usa el canal alfa: macOS repinta el glifo en negro o blanco
// según la barra, y aplica el modo de contraste alto por su cuenta. Por eso el RGB
// va en negro fijo y toda la forma vive en el alfa.
//
// Cada glifo lleva dos pesos, que es lo que dice la sección 4: contorno cuando no hay nada
// vencido, relleno cuando sí. Sin badge numérico — el cambio de peso se ve de reojo y no
// ensucia la barra, que es de donde salen todos los glifos de aquí abajo: ninguno lleva
// detalle que no sobreviva a 18 puntos de alto, y los cinco cambian de peso sin cambiar de
// silueta, para que la diferencia se lea como «pasa algo» y no como «es otro icono».
//
// Sobre el tamaño: `tray-icon` reescala la imagen a 18pt de alto pase lo que pase
// (platform_impl/macos: `let icon_height: f64 = 18.0`). Un lienzo de 22pt saldría
// reescalado por un factor no entero y el trazo de 1.4pt se ablandaría. Dibujamos
// directo a 18pt @2x para que caiga 1:1 en Retina.
//
//   node scripts/make-tray-icons.mjs

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PT = 18; // lado del icono en puntos
const SCALE = 2; // @2x
const SIZE = PT * SCALE; // 36 px

const C = PT / 2; // centro, en puntos
const RING_W = 1.4; // grosor del anillo
const DISC_R = 7.6; // borde exterior del glifo: 15.2pt de diámetro, 1.4pt de aire
const RING_R = DISC_R - RING_W / 2; // radio a la mitad del trazo
const CHECK_W = 1.4; // grosor de la palomita en el contorno
const CHECK_W_KNOCKOUT = 1.7; // calada necesita algo más de aire para leerse

// Palomita, en puntos. Tres nudos: entrada, vértice, salida.
const CHECK = [
  [C - 2.86, C + 0.08],
  [C - 0.9, C + 2.05],
  [C + 3.03, C - 2.37],
];

/** La misma palomita a lo ancho del icono, para cuando va sola y no dentro de un anillo. */
const CHECK_SOLA = CHECK.map(([x, y]) => [C + (x - C) * 1.55, C + (y - C) * 1.55]);

/** Distancia de un punto a un segmento, con extremos redondeados. */
function distToSegment(px, py, [ax, ay], [bx, by]) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

/** Distancia con signo a un cuadrado de esquinas redondeadas, centrado. */
function roundedSquareDist(x, y, half, radius) {
  const dx = Math.abs(x - C) - (half - radius);
  const dy = Math.abs(y - C) - (half - radius);
  return (
    Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius
  );
}

/**
 * Cobertura a partir de una distancia con signo, en píxeles.
 * Negativa = dentro. Esto es el antialiasing: una rampa de 1px en el borde.
 */
function coverage(signedDistPt) {
  return Math.max(0, Math.min(1, 0.5 - signedDistPt * SCALE));
}

/** Distancia con signo a una polilínea engrosada — una palomita, un renglón. */
function strokeDist(x, y, nodes, width) {
  let d = Infinity;
  for (let i = 0; i < nodes.length - 1; i++) {
    d = Math.min(d, distToSegment(x, y, nodes[i], nodes[i + 1]));
  }
  return d - width / 2;
}

/** La unión de varias formas: gana la que más cubre ese píxel. */
function union(...coverages) {
  return Math.max(...coverages);
}

/**
 * Los glifos.
 *
 * Cada uno es una función `(x, y, relleno)` que devuelve la cobertura de ese punto, en
 * puntos y no en píxeles: el muestreo y el antialiasing los pone `renderAlpha`.
 *
 * El orden de aquí es el que sale en Ajustes, y `casilla` va primero porque es el de omisión:
 * es la casilla de una fila de la app, que es lo que Riel hace.
 */
const GLYPHS = {
  casilla(x, y, relleno) {
    const r = Math.hypot(x - C, y - C);
    if (!relleno) {
      return union(
        coverage(Math.abs(r - RING_R) - RING_W / 2),
        coverage(strokeDist(x, y, CHECK, CHECK_W)),
      );
    }
    // Calada y no encima: una palomita opaca sobre un disco opaco no se vería, porque en un
    // icono template las dos serían el mismo negro.
    return coverage(r - DISC_R) * (1 - coverage(strokeDist(x, y, CHECK, CHECK_W_KNOCKOUT)));
  },

  palomita(x, y, relleno) {
    return coverage(strokeDist(x, y, CHECK_SOLA, relleno ? 2.5 : 1.6));
  },

  lista(x, y, relleno) {
    const bala = relleno ? 1.05 : 0.72;
    const renglon = relleno ? 1.9 : 1.3;
    let a = 0;
    for (const fila of [C - 3.7, C, C + 3.7]) {
      a = union(
        a,
        coverage(Math.hypot(x - (C - 5.5), y - fila) - bala),
        coverage(strokeDist(x, y, [[C - 2.6, fila], [C + 5.5, fila]], renglon)),
      );
    }
    return a;
  },

  disco(x, y, relleno) {
    const r = Math.hypot(x - C, y - C);
    const radio = 5.6;
    return relleno ? coverage(r - radio) : coverage(Math.abs(r - (radio - 0.7)) - 0.7);
  },

  cuadro(x, y, relleno) {
    const d = roundedSquareDist(x, y, 7.2, 2.6);
    if (!relleno) {
      return union(
        coverage(Math.abs(d + RING_W / 2) - RING_W / 2),
        coverage(strokeDist(x, y, CHECK, CHECK_W)),
      );
    }
    return coverage(d) * (1 - coverage(strokeDist(x, y, CHECK, CHECK_W_KNOCKOUT)));
  },
};

function renderAlpha(glyph, relleno) {
  const draw = GLYPHS[glyph];
  const alpha = new Uint8Array(SIZE * SIZE);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      // centro del píxel, en puntos
      const x = (px + 0.5) / SCALE;
      const y = (py + 0.5) / SCALE;
      alpha[py * SIZE + px] = Math.round(draw(x, y, relleno) * 255);
    }
  }
  return alpha;
}

// --- Codificador PNG mínimo (RGBA de 8 bits, sin filtros) ---

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(alpha) {
  // Una fila = 1 byte de filtro (0 = None) + SIZE píxeles RGBA.
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  let o = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[o++] = 0;
    for (let x = 0; x < SIZE; x++) {
      raw[o++] = 0; // R
      raw[o++] = 0; // G
      raw[o++] = 0; // B
      raw[o++] = alpha[y * SIZE + x];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // profundidad de bits
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compresión
  ihdr[11] = 0; // filtro
  ihdr[12] = 0; // entrelazado

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "icons");
// La misma imagen, otra vez, para que el selector de Ajustes enseñe el glifo y no su nombre:
// «Cuadro» no dice qué va a salir en la barra. El webview no puede leer `src-tauri/icons`, y
// dibujar los glifos otra vez en SVG sería tener la geometría en dos sitios que se separan.
const previewDir = join(root, "public", "tray");
mkdirSync(outDir, { recursive: true });
mkdirSync(previewDir, { recursive: true });

for (const glyph of Object.keys(GLYPHS)) {
  for (const [suffix, relleno] of [
    ["outline", false],
    ["filled", true],
  ]) {
    const file = join(outDir, `tray-${glyph}-${suffix}.png`);
    const png = encodePng(renderAlpha(glyph, relleno));
    writeFileSync(file, png);
    console.log(`${file}  ${SIZE}×${SIZE}`);
    // Solo el contorno: el selector enseña el glifo en reposo, que es como se ve casi siempre.
    if (!relleno) writeFileSync(join(previewDir, `${glyph}.png`), png);
  }
}
