// Corta una release y la publica en GitHub, con lo que el actualizador necesita.
//
//   npm run release -- 0.1.2
//   npm run release -- 0.1.2 --notes "Arregla el riel en modo oscuro."
//   npm run release -- 0.1.2 --dry-run     # compila y arma todo, sin tocar git ni GitHub
//
// El paso que no se puede hacer a mano es el `latest.json`: lleva la firma minisign del
// paquete, y si no coincide con la llave pública de `tauri.conf.json` la app rechaza la
// actualización sin decir por qué. Por eso esto es un script y no una lista de pasos en el
// README — el `.sig` se copia dentro sin que nadie lo teclee.
//
// El resto es orden. La versión vive en tres archivos que tienen que decir lo mismo, la firma
// de Apple tiene que estar puesta antes de empaquetar (sin ella el sistema no entrega avisos,
// según lo que documenta el README), y la URL del `latest.json` apunta a un asset que todavía
// no existe cuando se escribe: por eso la release se crea con todo de una vez.
//
// Requisitos:
//   - `gh` autenticado          →  brew install gh && gh auth login
//   - APPLE_SIGNING_IDENTITY    →  la identidad del llavero, igual que en `tauri build`
//   - ~/.tauri/riel.key         →  la llave privada del actualizador (RIEL_SIGNING_KEY la mueve)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUNDLE = join(ROOT, "src-tauri", "target", "release", "bundle");
const KEY = process.env.RIEL_SIGNING_KEY ?? join(homedir(), ".tauri", "riel.key");

/** La única arquitectura que se publica. El `.dmg` de Intel no se compila (README). */
const PLATFORM = "darwin-aarch64";

const args = process.argv.slice(2);
// Posicional y no buscado: si se buscara «el primero que no empiece por guion», el texto de
// `--notes` pasaría por versión en cuanto alguien pusiera las banderas primero.
const version = args[0]?.startsWith("-") ? undefined : args[0];
const dryRun = args.includes("--dry-run");
const assumeYes = args.includes("--yes");
const notes = args.includes("--notes") ? args[args.indexOf("--notes") + 1] : null;

const die = (message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
};

const run = (cmd, cmdArgs, options = {}) =>
  execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8", ...options });

/** Igual que `run`, pero devuelve `null` en vez de reventar. Para las comprobaciones. */
const tryRun = (cmd, cmdArgs) => {
  try {
    return run(cmd, cmdArgs, { stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

// ── Comprobaciones ──────────────────────────────────────────────────────────────────────
//
// Todas van antes de compilar. Un `tauri build` son minutos, y descubrir al final que faltaba
// la identidad de Apple obliga a repetirlos enteros.

if (!version) die("Falta la versión.  Uso: npm run release -- 0.1.2");
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`«${version}» no es una versión. Se espera 1.2.3.`);

const pkgPath = join(ROOT, "package.json");
const confPath = join(ROOT, "src-tauri", "tauri.conf.json");
const cargoPath = join(ROOT, "src-tauri", "Cargo.toml");

const pkg = readFileSync(pkgPath, "utf8");
const conf = readFileSync(confPath, "utf8");
const cargo = readFileSync(cargoPath, "utf8");

const current = JSON.parse(pkg).version;
const higher = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
if (!higher(version, current)) die(`La versión tiene que subir. Ahora hay ${current}.`);

if (!tryRun("git", ["rev-parse", "--git-dir"])) die("Esto no es un repositorio de git.");
if (tryRun("git", ["status", "--porcelain"]) !== "")
  die("Hay cambios sin confirmar. La release se corta sobre un árbol limpio.");

const branch = tryRun("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") die(`Estás en «${branch}». Las releases salen de main.`);

const tag = `v${version}`;
if (tryRun("git", ["tag", "-l", tag])) die(`La etiqueta ${tag} ya existe.`);

// El endpoint del actualizador y el repositorio al que se publica tienen que ser el mismo. Si
// se separan, la app seguiría preguntándole al repositorio viejo y nadie se enteraría: no hay
// error que ver, solo actualizaciones que dejan de llegar.
const endpoint = JSON.parse(conf).plugins?.updater?.endpoints?.[0];
if (!endpoint) die("`plugins.updater.endpoints` está vacío en tauri.conf.json.");
const slug = endpoint.match(/github\.com\/([^/]+\/[^/]+)\/releases/)?.[1];
const origin = tryRun("git", ["remote", "get-url", "origin"])?.match(
  /github\.com[:/]([^/]+\/[^/.]+)/,
)?.[1];
if (!slug) die(`No se reconoce un repositorio de GitHub en el endpoint:\n  ${endpoint}`);
if (slug !== origin)
  die(`El endpoint apunta a ${slug} y origin es ${origin}. La app buscaría en el otro.`);

if (!tryRun("gh", ["--version"]))
  die("Falta `gh`.  Instálalo con:  brew install gh && gh auth login");
if (!tryRun("gh", ["auth", "status"]))
  die("`gh` no está autenticado.  Arréglalo con:  gh auth login");

const identity = process.env.APPLE_SIGNING_IDENTITY;
if (!identity)
  die(
    "Falta APPLE_SIGNING_IDENTITY.\n" +
      '  export APPLE_SIGNING_IDENTITY="Apple Development: tu@correo (EQUIPO)"\n' +
      "  Sin firma, macOS no entrega las notificaciones de las tareas con hora.",
  );

if (!existsSync(KEY))
  die(
    `No está la llave privada del actualizador en ${KEY}.\n` +
      "  Si la perdiste, genera otra con `npx tauri signer generate -w ~/.tauri/riel.key`\n" +
      "  y pon la pública nueva en tauri.conf.json — pero ojo: quien tenga instalada una\n" +
      "  versión firmada con la vieja ya no podrá actualizarse solo.",
  );

// ── Versión ─────────────────────────────────────────────────────────────────────────────
//
// Se reescribe el texto en vez de volcar el JSON: `JSON.stringify` reordenaría los arrays a
// una línea por elemento y el diff de la release sería medio archivo en vez de un número.

const bump = (path, text, pattern, replacement) => {
  if (!pattern.test(text)) die(`No se encontró la versión en ${path}.`);
  writeFileSync(path, text.replace(pattern, replacement));
};

bump(pkgPath, pkg, /"version": "[^"]+"/, `"version": "${version}"`);
bump(confPath, conf, /"version": "[^"]+"/, `"version": "${version}"`);
bump(cargoPath, cargo, /^version = "[^"]+"/m, `version = "${version}"`);
console.log(`\n· Versión ${current} → ${version} en package.json, tauri.conf.json y Cargo.toml`);

// ── Compilación ─────────────────────────────────────────────────────────────────────────

console.log(`· Compilando con «${identity}»…\n`);
run("npm", ["run", "tauri", "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    APPLE_SIGNING_IDENTITY: identity,
    // El contenido y no la ruta: la CLI acepta las dos, y así no depende de cómo resuelva
    // `~` el proceso que la llame.
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(KEY, "utf8"),
    // Explícito aunque esté vacío. Sin la variable, la CLI se para a preguntar la contraseña
    // en mitad de la compilación y el script se queda colgado sin decir por qué.
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
  },
});

const app = join(BUNDLE, "macos", "Riel.app");
const tgz = join(BUNDLE, "macos", "Riel.app.tar.gz");
const sig = `${tgz}.sig`;
const dmg = join(BUNDLE, "dmg", `Riel_${version}_aarch64.dmg`);

for (const file of [app, tgz, sig, dmg]) {
  if (!existsSync(file)) die(`La compilación no dejó ${file}.`);
}

// La firma de Apple se comprueba sobre el `.app` ya empaquetado, no sobre la variable de
// entorno: que la identidad estuviera puesta no demuestra que `codesign` la haya aplicado.
try {
  run("codesign", ["--verify", "--strict", app], { stdio: ["ignore", "ignore", "pipe"] });
} catch {
  die(`${app} salió sin firmar. Revisa APPLE_SIGNING_IDENTITY.`);
}

// ── latest.json ─────────────────────────────────────────────────────────────────────────
//
// La URL apunta a la etiqueta concreta y no a `latest`: dentro de un año, alguien que siga en
// la 0.1.2 tiene que poder bajar exactamente ese paquete, y `latest` ya sería otro.

const manifest = {
  version,
  notes: notes ?? `Riel ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    [PLATFORM]: {
      signature: readFileSync(sig, "utf8").trim(),
      url: `https://github.com/${slug}/releases/download/${tag}/Riel.app.tar.gz`,
    },
  },
};

const manifestPath = join(BUNDLE, "latest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log("\n· Listo para publicar:");
for (const file of [dmg, tgz, sig, manifestPath]) console.log(`    ${file.replace(ROOT, ".")}`);

if (dryRun) {
  console.log(
    "\n--dry-run: no se ha tocado git ni GitHub.\n" +
      `Los cambios de versión sí están escritos; para deshacerlos: git checkout -- . \n`,
  );
  process.exit(0);
}

// ── Publicación ─────────────────────────────────────────────────────────────────────────

if (!assumeYes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\nSe va a etiquetar ${tag}, subirlo a ${slug} y crear la release. ¿Seguir? [s/N] `,
  );
  rl.close();
  if (!/^s(í|i)?$/i.test(answer.trim())) die("Cancelado. Los cambios de versión siguen escritos.");
}

// El commit va después de compilar a propósito: `tauri build` actualiza Cargo.lock con la
// versión nueva, y hacerlo antes dejaría el lock desincronizado en el árbol.
const touched = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];
run("git", ["add", ...touched], { stdio: "inherit" });
run("git", ["commit", "-m", `Cortar la v${version}`], { stdio: "inherit" });
run("git", ["tag", tag], { stdio: "inherit" });
run("git", ["push", "origin", "main", "--follow-tags"], { stdio: "inherit" });

// Sin `--draft` y sin `--prerelease`: el endpoint del actualizador es
// `releases/latest/download/latest.json`, y GitHub solo cuenta como «latest» una release
// publicada y estable. Un borrador se subiría bien y no le llegaría a nadie.
run(
  "gh",
  [
    "release",
    "create",
    tag,
    "--title",
    `Riel v${version}`,
    ...(notes ? ["--notes", notes] : ["--generate-notes"]),
    dmg,
    tgz,
    sig,
    manifestPath,
  ],
  { stdio: "inherit" },
);

console.log(
  `\n✓ Riel ${version} publicada.\n` +
    `  Las copias instaladas la verán en su próximo chequeo — al abrir el panel, como mucho 24 h después.\n`,
);
