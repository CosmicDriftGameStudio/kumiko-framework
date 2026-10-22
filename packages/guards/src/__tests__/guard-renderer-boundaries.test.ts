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

  test("flags a bare fetch call but not a qualified .fetch call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "renderer-boundaries-guard-"));
    try {
      const rendererSrc = join(dir, "packages/renderer/src");
      mkdirSync(rendererSrc, { recursive: true });
      writeFileSync(
        join(rendererSrc, "load.ts"),
        'export const a = () => fetch("/api/x");\nexport const b = (c: Client) => c.fetch("/ok");\n',
      );
      const root = fixtureRoot("kumiko-framework", dir, {
        kind: "framework",
        sourceRoots: ["packages/*/src"],
        testGlobs: ["packages/*/src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.violations.map((v) => v.line)).toEqual([1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports every JSX tag on a line, not only the first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "renderer-boundaries-guard-"));
    try {
      const rendererSrc = join(dir, "packages/renderer/src");
      mkdirSync(rendererSrc, { recursive: true });
      writeFileSync(
        join(rendererSrc, "view.tsx"),
        "export const v = () => <div><span>x</span></div>;\n",
      );
      const root = fixtureRoot("kumiko-framework", dir, {
        kind: "framework",
        sourceRoots: ["packages/*/src"],
        testGlobs: ["packages/*/src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.violations.map((v) => v.message)).toEqual([
        expect.stringContaining("<div>"),
        expect.stringContaining("<span>"),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("headless and live subtrees only get the import rules", async () => {
    const dir = mkdtempSync(join(tmpdir(), "renderer-boundaries-guard-"));
    try {
      const headlessDir = join(dir, "packages/renderer/src/headless");
      const liveDir = join(dir, "packages/renderer/src/live");
      mkdirSync(headlessDir, { recursive: true });
      mkdirSync(liveDir, { recursive: true });
      writeFileSync(
        join(headlessDir, "page.ts"),
        'export const html = `<div class="x"></div>`;\nexport const a = () => document.title;\n',
      );
      writeFileSync(join(liveDir, "client.ts"), 'export const a = () => fetch("/api/x");\n');
      writeFileSync(
        join(headlessDir, "bad.ts"),
        'import { createRoot } from "react-dom/client";\nimport { x } from "@cosmicdrift/kumiko-renderer-web";\n',
      );
      const root = fixtureRoot("kumiko-framework", dir, {
        kind: "framework",
        sourceRoots: ["packages/*/src"],
        testGlobs: ["packages/*/src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.violations.map((v) => `${v.file}:${v.line}`).sort()).toEqual([
        "packages/renderer/src/headless/bad.ts:1",
        "packages/renderer/src/headless/bad.ts:2",
      ]);
      expect(outcome.violations.every((v) => v.message.includes("forbidden-import"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("web subtree is not scanned, but the shared root and headless must not import it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "renderer-boundaries-guard-"));
    try {
      const webDir = join(dir, "packages/renderer/src/web");
      const appDir = join(dir, "packages/renderer/src/app");
      const headlessDir = join(dir, "packages/renderer/src/headless");
      mkdirSync(webDir, { recursive: true });
      mkdirSync(appDir, { recursive: true });
      mkdirSync(headlessDir, { recursive: true });
      writeFileSync(
        join(webDir, "root.tsx"),
        'import { createRoot } from "react-dom/client";\nexport const App = () => <div onClick={() => window.alert(1)} />;\n',
      );
      writeFileSync(join(appDir, "leak.ts"), 'import { createApp } from "../web/index.ts";\n');
      writeFileSync(
        join(headlessDir, "leak.ts"),
        'import { a } from "@cosmicdrift/kumiko-renderer/web";\n',
      );
      const root = fixtureRoot("kumiko-framework", dir, {
        kind: "framework",
        sourceRoots: ["packages/*/src"],
        testGlobs: ["packages/*/src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.violations.map((v) => v.file).sort()).toEqual([
        "packages/renderer/src/app/leak.ts",
        "packages/renderer/src/headless/leak.ts",
      ]);
      expect(outcome.violations.every((v) => v.message.includes("forbidden-import"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check.run — subtree import rules", () => {
  async function violationsFor(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "renderer-boundaries-guard-"));
    try {
      for (const [rel, content] of Object.entries(files)) {
        const full = join(dir, "packages/renderer/src", rel);
        mkdirSync(join(full, ".."), { recursive: true });
        writeFileSync(full, content);
      }
      const root = fixtureRoot("kumiko-framework", dir, {
        kind: "framework",
        sourceRoots: ["packages/*/src"],
        testGlobs: ["packages/*/src/**/*.test.ts"],
      });
      return (await check.run([root])).violations.map((v) => v.file).sort();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("headless may not leave its folder or import react or the renderer root", async () => {
    expect(
      await violationsFor({
        "headless/a.ts": 'import { x } from "../index.ts";\n',
        "headless/b.ts": 'import { y } from "../app/y.ts";\n',
        "headless/c.ts": 'import { useState } from "react";\n',
        "headless/d.ts": 'import { z } from "@cosmicdrift/kumiko-renderer";\n',
        "headless/e.ts": 'import { z } from "@cosmicdrift/kumiko-renderer/live";\n',
      }),
    ).toEqual([
      "packages/renderer/src/headless/a.ts",
      "packages/renderer/src/headless/b.ts",
      "packages/renderer/src/headless/c.ts",
      "packages/renderer/src/headless/d.ts",
      "packages/renderer/src/headless/e.ts",
    ]);
  });

  test("headless may import itself, third-party packages and its own subpath", async () => {
    expect(
      await violationsFor({
        "headless/a.ts":
          'import { x } from "./sub/x.ts";\nimport { z } from "zod";\nimport { w } from "../dev-console.ts";\n',
        "headless/sub/x.ts":
          'import { y } from "../a.ts";\nimport { h } from "@cosmicdrift/kumiko-renderer/headless";\n',
      }),
    ).toEqual([]);
  });

  test("the shared layer may not import live, but live may import itself", async () => {
    expect(
      await violationsFor({
        "app/x.ts": 'import { c } from "../live/index.ts";\n',
        "hooks/y.ts": 'import { c } from "@cosmicdrift/kumiko-renderer/live";\n',
        "live/a.ts": 'import { b } from "./b.ts";\n',
        "app/ok.ts": 'import { b } from "../hooks/y.ts";\n',
      }),
    ).toEqual(["packages/renderer/src/app/x.ts", "packages/renderer/src/hooks/y.ts"]);
  });
});
