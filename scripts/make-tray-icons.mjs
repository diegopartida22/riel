// Genera los dos iconos de la barra de menú como PNG template.
//
// Un icono template solo usa el canal alfa: macOS repinta el glifo en negro o blanco
// según la barra, y aplica el modo de contraste alto por su cuenta. Por eso el RGB
// va en negro fijo y toda la forma vive en el alfa.
//
// El glifo es la casilla de la app: un anillo con palomita. Contorno cuando no hay
// nada vencido, relleno (palomita calada) cuando sí lo hay.
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

/**
 * Cobertura a partir de una distancia con signo, en píxeles.
 * Negativa = dentro. Esto es el antialiasing: una rampa de 1px en el borde.
 */
function coverage(signedDistPt) {
  return Math.max(0, Math.min(1, 0.5 - signedDistPt * SCALE));
}

function checkDist(x, y, halfWidth) {
  const d = Math.min(
    distToSegment(x, y, CHECK[0], CHECK[1]),
    distToSegment(x, y, CHECK[1], CHECK[2]),
  );
  return d - halfWidth;
}

/** @param {"outline"|"filled"} variant */
function renderAlpha(variant) {
  const alpha = new Uint8Array(SIZE * SIZE);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      // centro del píxel, en puntos
      const x = (px + 0.5) / SCALE;
      const y = (py + 0.5) / SCALE;
      const r = Math.hypot(x - C, y - C);

      let a;
      if (variant === "outline") {
        const ring = coverage(Math.abs(r - RING_R) - RING_W / 2);
        const check = coverage(checkDist(x, y, CHECK_W / 2));
        a = Math.max(ring, check);
      } else {
        const disc = coverage(r - DISC_R);
        const knockout = coverage(checkDist(x, y, CHECK_W_KNOCKOUT / 2));
        a = disc * (1 - knockout);
      }
      alpha[py * SIZE + px] = Math.round(a * 255);
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

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

for (const variant of ["outline", "filled"]) {
  const file = join(outDir, `tray-${variant}.png`);
  writeFileSync(file, encodePng(renderAlpha(variant)));
  console.log(`${file}  ${SIZE}×${SIZE}`);
}
