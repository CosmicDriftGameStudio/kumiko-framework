// Dry-run validator (Plan-Doc D10): walks every scripts/demos/*.ts file,
// imports its default export, and asserts the schema is well-formed BEFORE a
// recording session burns 60s of tmux+ffmpeg orchestration on a broken demo.
//
// Pinned today:
//   - default export validates as a DemoDef (kebab title, ≥1 step)
//   - every browser step has a selector that LOOKS like a real selector
//     (starts with `[data-test=`, `#`, `.`, or a tag) — catches typos like
//     forgotten brackets without needing a live app
//   - every editor step references a file path that's inside the scaffolded
//     app tree (src/, bin/, or root config files)
//
// Iter 2 (recording session) will add a STACK-validator that actually boots
// the app and probes the selectors via Playwright. That's the layer that
// catches "this nav-id changed in a refactor" — too heavy for unit CI.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { type DemoDef } from "../demo";
import type { Step } from "../step";

const DEMOS_DIR = join(import.meta.dir, "..");

function listDemoFiles(): readonly string[] {
  return readdirSync(DEMOS_DIR)
    .filter((f) => /^\d+-[a-z0-9-]+\.ts$/.test(f))
    .sort();
}

function isPlausibleSelector(s: string): boolean {
  // [data-test=…] / [data-sidebar=…] / [data-kumiko-layout=…] etc. —
  // any data-* attribute selector counts as a stable landmark.
  return /^\[data-[a-z-]+=|^#|^\.|^[a-z][a-z0-9]*[ >+~[]?/.test(s);
}

function isInsideAppTree(path: string): boolean {
  if (path.startsWith("/")) return false;
  if (path.includes("..")) return false;
  return (
    path.startsWith("src/") ||
    path.startsWith("bin/") ||
    path === ".env" ||
    /^(package|tsconfig|biome|bunfig|docker-compose)\b/.test(path)
  );
}

describe("scripts/demos dry-run", () => {
  const files = listDemoFiles();

  test("at least one demo exists", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    describe(file, () => {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic import returns module shape
      let mod: any;

      test("loads + default-exports a DemoDef", async () => {
        mod = await import(join(DEMOS_DIR, file));
        expect(mod.default).toBeDefined();
        const def = mod.default as DemoDef;
        expect(def.title).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(def.steps.length).toBeGreaterThan(0);
      });

      test("browser-step selectors look plausible", () => {
        const def = mod.default as DemoDef;
        for (const [i, s] of def.steps.entries()) {
          if (s.kind !== "browser") continue;
          for (const sel of [s.click, s.waitFor]) {
            if (!sel) continue;
            expect(isPlausibleSelector(sel), `step ${i}: selector "${sel}"`).toBe(true);
          }
          if (s.navigate) {
            expect(s.navigate, `step ${i}: navigate URL`).toMatch(/^https?:\/\//);
          }
        }
      });

      test("editor-step file paths land in the scaffolded app tree", () => {
        const def = mod.default as DemoDef;
        for (const [i, s] of def.steps.entries()) {
          if (s.kind !== "editor") continue;
          expect(isInsideAppTree(s.file), `step ${i}: file "${s.file}"`).toBe(true);
          expect(s.write.length, `step ${i}: write body non-empty`).toBeGreaterThan(0);
        }
      });

      test("captions are non-empty when present", () => {
        const def = mod.default as DemoDef;
        for (const [i, s] of def.steps.entries() as Iterable<[number, Step]>) {
          if (!s.caption) continue;
          expect(s.caption.de.length, `step ${i}: de caption`).toBeGreaterThan(0);
          expect(s.caption.en.length, `step ${i}: en caption`).toBeGreaterThan(0);
          expect(s.caption.de.length, `step ${i}: de caption ≤ 60 chars`).toBeLessThanOrEqual(60);
          expect(s.caption.en.length, `step ${i}: en caption ≤ 60 chars`).toBeLessThanOrEqual(60);
        }
      });
    });
  }
});
