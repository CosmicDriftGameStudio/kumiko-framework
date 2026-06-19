// Relocation-Test für den @source-Layout-Fix (#359).
//
// Der Bug: renderer-web/src/styles.css scannte seine eigenen Shell-Klassen
// über einen MONOREPO-relativen @source (`../../renderer-web/src`). Im
// Workspace löst der via Symlink auf (grün), in einem Standalone-Consumer
// (echtes node_modules ohne Monorepo-Geschwister) findet er nichts → unstyled
// prod (15KB statt 48KB). Der Fix macht die Zeile self-relativ (`./`), weil
// das Paket `src` shippt.
//
// Am REALEN Ort der styles.css sind `./` und `../../renderer-web/src`
// identisch — ein Test dort wäre grün mit Bug UND Fix. Der Diskriminator ist
// RELOCATION: wir kopieren die echte styles.css an einen Ort, an dem der alte
// Pfad tot ist und nur `./` greift. Der Ort liegt unter dem Repo-Root, damit
// `@import "tailwindcss"` / `react-day-picker` weiter über node_modules
// auflösen. Braucht Bun (Bun.spawn im Tailwind-One-Shot) — sonst silent skip.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTailwindOnce } from "../build-prod-bundle";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");
const RENDERER_WEB_STYLES = resolve(__dirname, "../../../renderer-web/src/styles.css");
const SELF_SOURCE = '@source "./**/*.{ts,tsx}";';
const MONOREPO_SOURCE = '@source "../../renderer-web/src/**/*.{ts,tsx}";';

function bunAvailable(): boolean {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("renderer-web styles.css @source relocation (#359)", () => {
  // skipIf statt `if (!bunAvailable()) return;` — sonst meldet der Runner den
  // Test grün, obwohl er nie lief (silent-pass verschleiert fehlende Coverage).
  test.skipIf(!bunAvailable())(
    "self-relative @source scans the shell standalone; monorepo path would not",
    async () => {
      // Tailwind v4 auto-scannt nur das cwd-Verzeichnis (empirisch bestätigt:
      // das Verzeichnis der Input-CSS wird NICHT automatisch gescannt). Im echten
      // Standalone-Consumer ist renderer-web zudem in node_modules (gitignored) →
      // ebenfalls nicht auto-gescannt. Die Shell-Klassen erreicht also NUR der
      // explizite @source der styles.css. Hier mirrorn wir das robust, ohne
      // gitignore-/node_modules-Semantik: das Paket-`src` (mit der Shell-Probe)
      // liegt AUSSERHALB des Build-cwd — nur der self-relative `@source "./**"`
      // der relozierten styles.css erreicht es, der monorepo-Pfad ist tot.
      // Temp unter REPO_ROOT, damit @import "tailwindcss"/react-day-picker via
      // node_modules auflösen.
      const dir = await mkdtemp(join(REPO_ROOT, ".reloc-rendererweb-"));
      const buildCwd = join(dir, "app");
      const pkgSrc = join(dir, "pkg");
      try {
        const realCss = await readFile(RENDERER_WEB_STYLES, "utf8");
        // Guard: der Fix MUSS in der Quelle stehen, sonst testet die Relocation nichts.
        expect(realCss).toContain(SELF_SOURCE);

        await mkdir(buildCwd, { recursive: true });
        await mkdir(join(pkgSrc, "layout"), { recursive: true });
        await writeFile(
          join(pkgSrc, "layout/probe.tsx"),
          `export const P = () => <div className="min-h-screen" />;\n`,
        );

        await writeFile(join(pkgSrc, "styles.css"), realCss);
        const fixed = await runTailwindOnce(join(pkgSrc, "styles.css"), buildCwd);
        expect(fixed).toContain("min-h-screen");

        // Diskriminator: mit dem ALTEN monorepo-relativen @source ist die Probe
        // an diesem relozierten Ort unerreichbar → Sentinel fehlt. Beweist, dass
        // der Fix kein No-op ist (der Test würde bei einem Revert rot).
        await writeFile(join(pkgSrc, "styles.css"), realCss.replace(SELF_SOURCE, MONOREPO_SOURCE));
        const buggy = await runTailwindOnce(join(pkgSrc, "styles.css"), buildCwd);
        expect(buggy).not.toContain("min-h-screen");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
