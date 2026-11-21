import { defineConfig } from "vitest/config";
import { sharedConfig } from "../../vite.config.ts";

// biome-ignore lint/style/noDefaultExport: required for vitest
export default defineConfig(async config => ({
  ...(await sharedConfig(config)),
  test: {
    environment: "jsdom",
    // Same game initialisation as the game data exporter (i18n first, then the battle scene)
    setupFiles: ["./scripts/game-data-exporter/i18n.ts", "./scripts/game-data-exporter/game-data-exporter.setup.ts"],
    include: ["./scripts/archipelago-dex-exporter/export-dex-data.test.ts"],
    disableConsoleIntercept: true,
  },
}));
