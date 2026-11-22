// PokeRogue Archipelago client: serves the built game (the "game" folder next to this file) on
// http://localhost:8000 and opens it in the default browser. Needs only node.exe, no dependency.
//
// The port stays the same on purpose: the browser keeps the saves (localStorage) per address, so a different
// port would show an empty save.
import { exec } from "node:child_process";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.POKEROGUE_PORT) || 8000;
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "game");
const URL_TO_OPEN = `http://localhost:${PORT}/`;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

function openBrowser() {
  // POKEROGUE_NO_BROWSER=1: only serve the game (tests)
  if (process.env.POKEROGUE_NO_BROWSER) {
    return;
  }
  const command =
    process.platform === "win32"
      ? `start "" "${URL_TO_OPEN}"`
      : process.platform === "darwin"
        ? `open "${URL_TO_OPEN}"`
        : `xdg-open "${URL_TO_OPEN}"`;
  exec(command, () => {});
}

/** File of the game matching the requested path (`null`: outside the game folder or missing) */
function resolveFile(urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const file = normalize(join(ROOT, path));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    return null;
  }
  try {
    const stats = statSync(file);
    if (stats.isDirectory()) {
      const index = join(file, "index.html");
      return statSync(index).isFile() ? { file: index, size: statSync(index).size } : null;
    }
    return { file, size: stats.size };
  } catch {
    return null;
  }
}

const server = createServer((request, response) => {
  const found = resolveFile(request.url ?? "/");
  if (!found) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extname(found.file).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": found.size,
    "Cache-Control": "no-cache",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(found.file).pipe(response);
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    // Most likely PokeRogue is already running: just open it
    console.log(`Le port ${PORT} est deja utilise : PokeRogue est probablement deja lance.`);
    console.log(`Ouverture de ${URL_TO_OPEN} ...`);
    openBrowser();
    setTimeout(() => process.exit(0), 3000);
    return;
  }
  console.error(error);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`PokeRogue est lance sur ${URL_TO_OPEN}`);
  console.log("Gardez cette fenetre ouverte pendant la partie ; fermez-la pour arreter PokeRogue.");
  openBrowser();
});
