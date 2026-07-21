// Unit-Tests für resolveStylesheet — die Verzweigungen aus
// createKumikoServer's CSS-Setup. Läuft unter vitest auf Node, also
// ohne Bun.serve und ohne Bun.resolveSync; der Default-Resolution-
// Pfad (Bun-only) ist hier explizit als "skip silent" abgedeckt.
//
// Warum als eigener File statt im create-kumiko-server.integration.ts:
// die anderen Tests dort booten ein TestStack (DB + Redis), das brauchen
// wir für reine Resolver-Logik nicht.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveStylesheet } from "../create-kumiko-server";

describe("resolveStylesheet", () => {
  test("string → resolved absolute path", () => {
    // Relativ zum CWD aufgelöst — das ist Node's path.resolve-Default.
    const out = resolveStylesheet({
      features: [],
      stylesheet: "./some/stylesheet.css",
    });
    expect(out).toMatch(/\/some\/stylesheet\.css$/);
    expect(out?.startsWith("/")).toBe(true);
  });

  test("absolute string bleibt unverändert (path.resolve idempotent)", () => {
    const out = resolveStylesheet({
      features: [],
      stylesheet: "/abs/path/styles.css",
    });
    expect(out).toBe("/abs/path/styles.css");
  });

  test("false → undefined (Pipeline explizit aus)", () => {
    const out = resolveStylesheet({
      features: [],
      stylesheet: false,
      clientEntry: "./entry.tsx",
    });
    expect(out).toBeUndefined();
  });

  test("undefined ohne clientEntry → undefined (kein Browser-Bundle, keine CSS)", () => {
    const out = resolveStylesheet({
      features: [],
    });
    expect(out).toBeUndefined();
  });

  test("undefined + clientEntry: undefined (silent skip)", () => {
    // Bun resolveSync findet packages/renderer-web/src/styles.css im
    // Repo. Das ist der prod-Pfad — unter Bun (real oder CI) ist der
    // Wert ein absoluter path; unter Node (von wo der Test portiert
    // wurde) wäre es undefined. Wir akzeptieren beides.
    const out = resolveStylesheet({
      features: [],
      clientEntry: "./entry.tsx",
    });
    if (typeof Bun === "undefined") {
      expect(out).toBeUndefined();
    } else {
      expect(out).toMatch(/renderer-web\/src\/styles\.css$/);
    }
  });

  test("Bun.resolveSync failure → undefined (catch path, no throw)", () => {
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-resolve-catch-")));
    const cwdBefore = process.cwd();
    process.chdir(tmpDir);
    try {
      const out = resolveStylesheet({
        features: [],
        clientEntry: "./entry.tsx",
      });
      expect(out).toBeUndefined();
    } finally {
      process.chdir(cwdBefore);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("undefined + clientEntry + src/styles.css existiert → returns App-Theme-Override", () => {
    // Auto-Detection greift VOR dem renderer-web-Fallback: Wenn die App
    // ein eigenes src/styles.css hat (App-Theme-Pattern), wird das
    // automatisch als Tailwind-Entry genommen — symmetrisch zum prod-
    // Build (kumiko-build:resolveStylesheetEntry). Ohne diesen Check
    // müsste jede App `stylesheet:` explizit setzen.
    // realpath aufgelöst, weil macOS' /var → /private/var Symlink sonst
    // einen anderen Pfad rauswirft als process.cwd() nach chdir.
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-resolve-styles-")));
    const srcDir = join(tmpDir, "src");
    mkdirSync(srcDir);
    const stylesheet = join(srcDir, "styles.css");
    writeFileSync(stylesheet, "/* app theme */");

    const cwdBefore = process.cwd();
    process.chdir(tmpDir);
    try {
      const out = resolveStylesheet({
        features: [],
        clientEntry: "./entry.tsx",
      });
      expect(out).toBe(stylesheet);
    } finally {
      process.chdir(cwdBefore);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
