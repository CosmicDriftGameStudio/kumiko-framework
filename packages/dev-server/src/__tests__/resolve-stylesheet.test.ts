// Unit tests for resolveStylesheet cover the branches in
// createKumikoServer's CSS setup. They run under vitest on Node, without
// Bun.serve or Bun.resolveSync; the Bun-only default resolution path is
// explicitly covered as a silent skip.
//
// This is a separate file because the other tests in
// create-kumiko-server.integration.ts boot a test stack (DB + Redis),
// which is unnecessary for resolver logic.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveStylesheet,
  resolveStylesheetWatch,
  STYLESHEET_WATCH_ENV,
} from "../create-kumiko-server.ts";

describe("resolveStylesheet", () => {
  test("string → resolved absolute path", () => {
    // Resolve relative to CWD, matching Node's path.resolve default.
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
    // Bun.resolveSync finds packages/renderer/src/web/styles.css in the repo.
    // This is the production path: under Bun (locally or in CI), the result is
    // absolute; under Node, where this test was ported from, it is undefined.
    // Both results are accepted.
    const out = resolveStylesheet({
      features: [],
      clientEntry: "./entry.tsx",
    });
    if (typeof Bun === "undefined") {
      expect(out).toBeUndefined();
    } else {
      expect(out).toMatch(/renderer\/src\/web\/styles\.css$/);
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
    // Auto-detection takes precedence over the renderer-web fallback: an app's
    // src/styles.css is treated as its Tailwind entry, matching the production
    // build (kumiko-build:resolveStylesheetEntry). Without this check, every app
    // would need to set `stylesheet:` explicitly.
    // realpath is required because macOS's /var → /private/var symlink would
    // otherwise produce a different path from process.cwd() after chdir.
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

describe("resolveStylesheetWatch", () => {
  test("an explicit option wins over the env", () => {
    expect(resolveStylesheetWatch({ stylesheetWatch: false }, {})).toBe(false);
    expect(resolveStylesheetWatch({ stylesheetWatch: true }, { [STYLESHEET_WATCH_ENV]: "0" })).toBe(
      true,
    );
  });

  test("no option, env=0 → false", () => {
    expect(resolveStylesheetWatch({}, { [STYLESHEET_WATCH_ENV]: "0" })).toBe(false);
  });

  test("no option, no or other env value → true", () => {
    expect(resolveStylesheetWatch({}, {})).toBe(true);
    expect(resolveStylesheetWatch({}, { [STYLESHEET_WATCH_ENV]: "1" })).toBe(true);
  });
});
