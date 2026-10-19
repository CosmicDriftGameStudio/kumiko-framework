// Relocation test for the @source layout fix (#359).
//
// The bug: styles.css scanned its own shell classes through a MONOREPO-relative
// @source. In the workspace that resolves through the symlink (green), in a
// standalone consumer (real node_modules without monorepo siblings) it finds
// nothing and prod ships unstyled (15KB instead of 48KB). The fix makes the line
// self-relative (`./`), because the package ships `src/web`.
//
// At the REAL location of styles.css, `./` and the monorepo path are
// identical, so a test there would be green with the bug AND the fix. The
// discriminator is RELOCATION: copy the real styles.css to a place where the
// old path is dead and only `./` works. The place sits under the repo root so
// that `@import "tailwindcss"` / `react-day-picker` still resolve through
// node_modules. Needs Bun (Bun.spawn in the Tailwind one-shot), else a skip.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTailwindOnce } from "../build-prod-bundle.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");
const RENDERER_WEB_STYLES = resolve(__dirname, "../../../renderer/src/web/styles.css");
const SELF_SOURCE = '@source "./**/*.{ts,tsx}";';
const PARENT_SOURCE = '@source "../**/*.{ts,tsx}";';
const MONOREPO_SOURCE = '@source "../../../renderer/src/web/**/*.{ts,tsx}";';

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
        expect(realCss).toContain(PARENT_SOURCE);

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
        // The parent line is dropped too: relocated, `../` would reach the probe.
        await writeFile(
          join(pkgSrc, "styles.css"),
          realCss.replace(SELF_SOURCE, MONOREPO_SOURCE).replace(PARENT_SOURCE, ""),
        );
        const buggy = await runTailwindOnce(join(pkgSrc, "styles.css"), buildCwd);
        expect(buggy).not.toContain("min-h-screen");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
