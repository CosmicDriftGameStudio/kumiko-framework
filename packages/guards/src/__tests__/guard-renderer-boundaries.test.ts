import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../guard-renderer-boundaries";
import { fixtureRoot } from "./parent-workspace-fixture";

describe("check.run — RepoCheck seam", () => {
  test("notApplicable when the framework root has no packages/renderer/src", async () => {
    const dir = mkdtempSync(join(tmpdir(), "renderer-boundaries-guard-"));
    try {
      const root = fixtureRoot("kumiko-framework", dir, {
        kind: "framework",
        sourceRoots: ["packages/*/src"],
        testGlobs: ["packages/*/src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.notApplicable).toBe(true);
      expect(outcome.violations).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a `window.` usage in packages/renderer/src is a violation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "renderer-boundaries-guard-"));
    try {
      const rendererSrc = join(dir, "packages/renderer/src");
      mkdirSync(rendererSrc, { recursive: true });
      writeFileSync(
        join(rendererSrc, "mount.ts"),
        "export function mount() { window.alert('x'); }\n",
      );
      const root = fixtureRoot("kumiko-framework", dir, {
        kind: "framework",
        sourceRoots: ["packages/*/src"],
        testGlobs: ["packages/*/src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.notApplicable).toBe(false);
      expect(outcome.violations).toHaveLength(1);
      expect(outcome.violations[0]?.file).toBe("packages/renderer/src/mount.ts");
      expect(outcome.violations[0]?.message).toContain("forbidden-symbol");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a non-framework root never contributes a scan dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "renderer-boundaries-guard-"));
    try {
      const root = fixtureRoot("solon", dir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.notApplicable).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
