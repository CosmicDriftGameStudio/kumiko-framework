// Playwright globalSetup — spawnt den bun-Emitter vor allen Tests.
// Zweck: framework-runtime läuft in ISOLIERTEM bun-Subprozess, NICHT
// im Playwright-worker. Das schreibt die E2E-Daten-JSON, und
// generated.spec.ts liest sie als reine Datei ohne framework-Chain.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ESM hat kein __dirname — aus import.meta.url ableiten.
const here = dirname(fileURLToPath(import.meta.url));

export default function globalSetup(): void {
  const sampleRoot = resolve(here, "..");
  const script = resolve(sampleRoot, "scripts", "emit-e2e-data.ts");
  const result = spawnSync("bun", ["run", script], {
    stdio: "inherit",
    cwd: sampleRoot,
  });
  if (result.status !== 0) {
    throw new Error(
      `[global-setup] emit-e2e-data.ts failed with exit code ${result.status ?? "(null)"}. ` +
        "Check the bun-output above — typically: entity mismatch in src/feature.ts oder " +
        "generateE2ESpec rejected a Feld-Type der noch nicht im buildEntityFixture steht.",
    );
  }
}
