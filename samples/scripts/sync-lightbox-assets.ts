// Copies apex-landing hero-app.png into showcase public/ for the React Lightbox demo.

import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function syncLightboxAssets(samplesRoot = DEFAULT_SAMPLES): void {
  const src = resolve(samplesRoot, "recipes/apex-landing/screenshots/hero-app.png");
  if (!existsSync(src)) {
    throw new Error(
      "hero-app.png missing — run: cd samples/recipes/apex-landing && bun run screenshot",
    );
  }
  const destDir = resolve(samplesRoot, "apps/showcase/public/screenshots");
  const dest = resolve(destDir, "hero-app.png");
  const stale = resolve(destDir, "landing.png");
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
  if (existsSync(stale)) unlinkSync(stale);
  console.log(`synced lightbox asset → ${dest}`);
}

if (import.meta.main) {
  // biome-ignore lint/suspicious/noConsole: CLI script
  try {
    syncLightboxAssets();
  } catch (err: unknown) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
