// Adapts the web app manifest of a built game (from the assets repository) to the Archipelago client:
// - relative start URL and scope, so that the app installed from a sub-path (GitHub Pages: /ap_pokerogue/) opens
//   there and not at the root of the domain;
// - its own name, so that it is not mistaken for the official PokéRogue app.
//
// Usage: node archipelago/client/patch-manifest.mjs <built game folder>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function patchManifest(gameDir) {
  const file = join(resolve(gameDir), "manifest.webmanifest");
  if (!existsSync(file)) {
    console.warn(`No manifest in ${gameDir}`);
    return;
  }
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.name = "PokéRogue Archipelago";
  manifest.short_name = "PokéRogue AP";
  manifest.start_url = "./";
  manifest.scope = "./";
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Patched ${file}`);
}

// Run directly (the GitHub Pages workflow), not imported (build-client.mjs)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: node archipelago/client/patch-manifest.mjs <built game folder>");
    process.exit(1);
  }
  patchManifest(dir);
}
