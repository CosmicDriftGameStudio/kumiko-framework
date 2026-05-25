import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatBuildResult } from "../build-prod-bundle";
import { discoverServerEntry } from "../build-server-bundle";

describe("discoverServerEntry", () => {
  test("finds bin/main.ts when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiko-discover-"));
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin/main.ts"), "export {};\n", "utf8");
    expect(discoverServerEntry(dir)).toBe(join(dir, "bin/main.ts"));
  });

  test("returns undefined when no entry exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiko-discover-empty-"));
    expect(discoverServerEntry(dir)).toBeUndefined();
  });
});

describe("formatBuildResult", () => {
  test("includes outDir and manifest entries", () => {
    const out = formatBuildResult(
      { outDir: "dist/client", manifest: { "app.js": "app.abc123.js" } },
      42,
    );
    expect(out).toContain("dist/client");
    expect(out).toContain("app.js");
    expect(out).toContain("42ms");
  });
});
