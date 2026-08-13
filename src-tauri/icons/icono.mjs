// Genera el icono de Riel a 1024×1024, que es de donde sale todo lo demás:
//
//     node src-tauri/icons/icono.mjs /tmp/riel-1024.png
//     npx tauri icon /tmp/riel-1024.png
//
// Está aquí para que el icono se pueda rehacer. Un repositorio con un `.icns` y ninguna forma
// de volver a producirlo obliga a quien quiera cambiar un color a redibujarlo entero.
//
// Sin dependencias: no hace falta ningún rasterizador de SVG instalado, y un PNG es una
// cabecera, un deflate y un CRC.
//
// El motivo es el panel: el riel de discos pegado al borde izquierdo y la lista a su derecha
// (spec 3.4). Tres filas y no seis porque a 16px en la lista del Finder seis son una mancha.
//
// La columna de discos sola, centrada, no vale: se lee como un semáforo. Lo que la convierte
// en un riel es tener la lista al lado.

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 1024;
// La retícula de iconos de macOS: el cuerpo ocupa 824 de los 1024 y el resto es aire.
const BODY = 824;
// Superelipse y no rectángulo redondeado: es la diferencia entre parecer un icono de macOS y
// parecer uno de otro sitio, y se nota justo al lado de los demás en el Dock.
const N = 4.7;

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

// El fondo va del grafito del acento al casi negro de la tinta. Los discos son las variantes
// aclaradas de la paleta: es la regla del propio spec — sobre oscuro, las claras se apagan.
const TOP = hex("#3A3A3C");
const BOTTOM = hex("#1C1C1E");
const DISCS = ["#3FBEBE", "#E0A93A", "#EA6E9D"].map(hex);

const half = BODY / 2;
const center = SIZE / 2;
const left = center - half;
const right = center + half;

/** Dentro de la superelipse. La cobertura del borde la da el supermuestreo. */
function inBody(x, y) {
  const dx = Math.abs(x - center) / half;
  const dy = Math.abs(y - center) / half;
  return Math.pow(dx, N) + Math.pow(dy, N) <= 1;
}

const RADIUS = 65;
const ROW_GAP = 200;
const ROWS = [center - ROW_GAP, center, center + ROW_GAP];

const DISC_X = left + 90 + RADIUS;
const LINE_X = left + 90 + RADIUS * 2 + 80;
/** Anchos distintos: tres barras iguales se leen como una tabla, no como tareas. */
const LINE_WIDTHS = [right - 90 - LINE_X, 330, 392];
const LINE_HEIGHT = 44;
const LINE_INK = [255, 255, 255];
const LINE_ALPHA = 0.8;

function discAt(x, y) {
  for (let i = 0; i < ROWS.length; i++) {
    const dx = x - DISC_X;
    const dy = y - ROWS[i];
    if (dx * dx + dy * dy <= RADIUS * RADIUS) return i;
  }
  return -1;
}

/** Cápsula: un rectángulo cuyo radio es la mitad de su alto, así que basta el mismo test. */
function onLine(x, y) {
  for (let i = 0; i < ROWS.length; i++) {
    const r = LINE_HEIGHT / 2;
    const cx = Math.min(Math.max(x, LINE_X + r), LINE_X + LINE_WIDTHS[i] - r);
    const cy = ROWS[i];
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

const SS = 4; // 16 muestras por píxel: suficiente para que el borde no se vea escalonado
const pixels = Buffer.alloc(SIZE * SIZE * 4);

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let alpha = 0;
    let r = 0;
    let g = 0;
    let b = 0;

    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS;
        const y = py + (sy + 0.5) / SS;
        if (!inBody(x, y)) continue;

        alpha++;
        const disc = discAt(x, y);
        if (disc >= 0) {
          r += DISCS[disc][0];
          g += DISCS[disc][1];
          b += DISCS[disc][2];
          continue;
        }

        // Degradado vertical del fondo, medido sobre el cuerpo y no sobre el lienzo.
        const t = Math.min(1, Math.max(0, (y - left) / BODY));
        let cr = TOP[0] + (BOTTOM[0] - TOP[0]) * t;
        let cg = TOP[1] + (BOTTOM[1] - TOP[1]) * t;
        let cb = TOP[2] + (BOTTOM[2] - TOP[2]) * t;

        // Las líneas van con alfa sobre el fondo, no opacas: es lo que las deja por debajo de
        // los discos en peso visual, que es el orden que tienen en el panel.
        if (onLine(x, y)) {
          cr += (LINE_INK[0] - cr) * LINE_ALPHA;
          cg += (LINE_INK[1] - cg) * LINE_ALPHA;
          cb += (LINE_INK[2] - cb) * LINE_ALPHA;
        }

        r += cr;
        g += cg;
        b += cb;
      }
    }

    const at = (py * SIZE + px) * 4;
    if (!alpha) continue;
    pixels[at] = Math.round(r / alpha);
    pixels[at + 1] = Math.round(g / alpha);
    pixels[at + 2] = Math.round(b / alpha);
    pixels[at + 3] = Math.round((alpha / (SS * SS)) * 255);
  }
}

// ── PNG ────────────────────────────────────────────────────────────────────────────────

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c;
}
const crc32 = (buf) => {
  let c = -1;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bits por canal
ihdr[9] = 6; // RGBA
// 10, 11, 12 = deflate, filtro adaptativo, sin entrelazar — todos 0

// Una fila con su byte de filtro delante. Filtro 0 en todas: el deflate ya deja el archivo en
// unas decenas de kilobytes y aquí no hay que optimizar nada.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const from = y * SIZE * 4;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, from, from + SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(process.argv[2], png);
console.log(`${process.argv[2]}  ${SIZE}×${SIZE}  ${(png.length / 1024).toFixed(1)} kB`);
