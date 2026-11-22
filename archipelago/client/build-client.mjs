// Builds the PokeRogue Archipelago client: a folder players run without installing anything.
//
// Usage: node archipelago/client/build-client.mjs <output folder> [--node <folder holding node.exe>] [--no-build]
//
// Output folder:
//   game/            the built game (vite build --mode app: no login, saves in the browser)
//   serve.mjs        small web server for the game (http://localhost:8000), opens the browser
//   pokerogue.bat    starts it with node\node.exe
//   node/            node.exe (copied with --node, or added by hand)
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(clientDir, "..", "..");
const args = process.argv.slice(2);
const output = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--node");
const nodeIndex = args.indexOf("--node");
const nodeDir = nodeIndex >= 0 ? args[nodeIndex + 1] : undefined;

if (!output) {
  console.error("Usage: node archipelago/client/build-client.mjs <output folder> [--node <folder>] [--no-build]");
  process.exit(1);
}
const outDir = resolve(output);

if (!args.includes("--no-build")) {
  console.log("Building the game (vite build --mode app)...");
  execSync("npx vite build --mode app", { cwd: root, stdio: "inherit" });
}
const dist = join(root, "dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error(`No build found in ${dist}`);
  process.exit(1);
}

// Files of the assets repository that are not part of the game
const SKIPPED_EXTENSIONS = new Set([".map", ".bat", ".ps1", ".tps"]);

console.log(`Copying the game to ${join(outDir, "game")}...`);
rmSync(join(outDir, "game"), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(dist, join(outDir, "game"), {
  recursive: true,
  filter: source => !SKIPPED_EXTENSIONS.has(extname(source).toLowerCase()),
});
for (const file of ["serve.mjs", "pokerogue.bat"]) {
  cpSync(join(clientDir, file), join(outDir, file));
}
if (nodeDir) {
  console.log(`Copying node from ${nodeDir}...`);
  cpSync(resolve(nodeDir), join(outDir, "node"), { recursive: true });
}
if (!existsSync(join(outDir, "node", "node.exe"))) {
  console.warn(`Warning: ${join(outDir, "node", "node.exe")} is missing: add it (--node <folder>) before shipping.`);
}
console.log(`Done: ${outDir}`);
