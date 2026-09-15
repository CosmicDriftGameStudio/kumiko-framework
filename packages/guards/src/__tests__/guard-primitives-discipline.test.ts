// Review 92/3+93/3 (infra): der Guard war ungetestet — Pins für die Regex-Fixes
// 92/1 (toast.alert ist KEIN Treffer) und 93/4 (Inline-Kommentare).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRepoChecks } from "../_lib/guard-kit";
import { check, checkFile } from "../guard-primitives-discipline";
import { fixtureRoot } from "./parent-workspace-fixture";

function violationsFor(source: string) {
  const dir = mkdtempSync(join(tmpdir(), "prim-guard-"));
  const file = join(dir, "probe.tsx");
  writeFileSync(file, source);
  const out = checkFile(file, "bundled-features");
  rmSync(dir, { recursive: true, force: true });
  return out;
}

describe("guard-primitives-discipline checkFile()", () => {
  test("nackter alert(-Call wird gemeldet, window.alert ebenso", () => {
    expect(violationsFor('alert("x");\n').length).toBe(1);
    expect(violationsFor('window.alert("x");\n').length).toBe(1);
  });

  test("Method-Calls wie toast.alert( sind KEIN Treffer (92/1)", () => {
    expect(violationsFor('toast.alert("x");\n')).toHaveLength(0);
    expect(violationsFor('myalert("x");\n')).toHaveLength(0);
  });

  test("alert( im trailing Inline-Kommentar ist KEIN Treffer (93/4)", () => {
    expect(violationsFor('save(); // früher: alert("x")\n')).toHaveLength(0);
  });

  test("kumiko-lint-ignore auf der Vorzeile unterdrückt den Treffer", () => {
    const src = '// kumiko-lint-ignore primitives-discipline demo\nalert("x");\n';
    expect(violationsFor(src)).toHaveLength(0);
  });

  test("raw <button> wird gemeldet", () => {
    expect(violationsFor("<button onClick={x}>Go</button>\n").length).toBe(1);
  });

  test("raw bg-card className wird gemeldet (Card-Chrome → <Card>)", () => {
    const v = violationsFor('<div className="rounded-lg border bg-card p-4 shadow-sm">x</div>\n');
    expect(v).toHaveLength(1);
    expect(v[0]?.kind).toBe("class");
  });

  test("text-card-foreground ist KEIN bg-card-Treffer", () => {
    expect(violationsFor('<div className="text-card-foreground border">x</div>\n')).toHaveLength(0);
  });

  test("hover:bg-card und dark:bg-card werden erkannt (157/2)", () => {
    expect(violationsFor('<div className="hover:bg-card">x</div>\n')).toHaveLength(1);
    expect(violationsFor('<div className="dark:bg-card">x</div>\n')).toHaveLength(1);
  });

  test("bg-card/50 Opacity-Modifier wird erkannt (157/2)", () => {
    expect(violationsFor('<div className="bg-card/50">x</div>\n')).toHaveLength(1);
  });

  test("kumiko-lint-ignore auf der Vorzeile unterdrückt bg-card", () => {
    const src =
      '{/* kumiko-lint-ignore primitives-discipline demo */}\n<div className="bg-card">x</div>\n';
    expect(violationsFor(src)).toHaveLength(0);
  });

  test("my-bg-card ist KEIN Treffer (regex-scope Fix — \\b matchte vorher jedes bindestrich-praefixierte Token)", () => {
    expect(violationsFor('<div className="my-bg-card">x</div>\n')).toHaveLength(0);
  });

  test("bg-card-elevated ist KEIN Treffer (regex-scope Fix)", () => {
    expect(violationsFor('<div className="bg-card-elevated">x</div>\n')).toHaveLength(0);
  });

  test('checkFile(file, "app") klassifiziert Violations mit scope="app"', () => {
    const dir = mkdtempSync(join(tmpdir(), "prim-guard-"));
    const file = join(dir, "probe.tsx");
    writeFileSync(file, 'alert("x");\n');
    const out = checkFile(file, "app");
    rmSync(dir, { recursive: true, force: true });
    expect(out).toHaveLength(1);
    expect(out[0]?.scope).toBe("app");
  });
});

// check.run() scope resolution — replaces infra's subprocess-spawn +
// KUMIKO_GUARD_ROOTS fixtures with direct RepoRoot injection at the
// RepoCheck seam `kumiko check` (PR3) actually calls.
describe("check.run — RepoCheck seam", () => {
  test("no scope resolves (no roots at all) → vacuous, not a silent pass", async () => {
    const outcome = await check.run([]);
    expect(outcome.notApplicable).toBe(false);
    expect(outcome.matchedFiles).toBe(0);
    const results = await runRepoChecks([check], []);
    expect(results[0]?.ok).toBe(false);
  });

  test("framework root: bundled-features blocks, samples only warns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prim-guard-framework-"));
    try {
      const bundledWeb = join(dir, "packages/bundled-features/src/billing/web");
      mkdirSync(bundledWeb, { recursive: true });
      writeFileSync(
        join(bundledWeb, "Screen.tsx"),
        "export const S = () => <button onClick={x}>Go</button>;\n",
      );
      const samplesWeb = join(dir, "samples/recipes/demo/web");
      mkdirSync(samplesWeb, { recursive: true });
      writeFileSync(
        join(samplesWeb, "Panel.tsx"),
        "export const P = () => <button onClick={x}>Go</button>;\n",
      );
      const root = fixtureRoot("kumiko-framework", dir, {
        kind: "framework",
        sourceRoots: ["packages/*/src"],
        testGlobs: ["packages/*/src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.violations).toHaveLength(1);
      expect(outcome.violations[0]?.file).toBe(
        "packages/bundled-features/src/billing/web/Screen.tsx",
      );
      expect(outcome.warnings).toHaveLength(1);
      expect(outcome.warnings?.[0]?.file).toBe("samples/recipes/demo/web/Panel.tsx");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("flat app root: a web/ .tsx is checked and blocks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prim-guard-app-"));
    try {
      const web = join(dir, "src/features/billing/web");
      mkdirSync(web, { recursive: true });
      writeFileSync(
        join(web, "Screen.tsx"),
        "export const S = () => <button onClick={x}>Go</button>;\n",
      );
      const root = fixtureRoot("solon", dir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.matchedFiles).toBe(1);
      expect(outcome.violations).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("flat app root: schema-driven repo with .tsx only outside web/ passes with 0 checked, not vacuous", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prim-guard-app-schema-"));
    try {
      const src = join(dir, "src/features/billing");
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "entity.tsx"), "export const x = 1;\n");
      const root = fixtureRoot("phronexsis", dir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.violations).toEqual([]);
      expect(outcome.matchedFiles).toBeGreaterThan(0); // walked files, not web-filtered — not vacuous
      const results = await runRepoChecks([check], [root]);
      expect(results[0]?.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("flat app root: an empty src/ (walk finds nothing) fails instead of reporting clean", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prim-guard-app-empty-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      const root = fixtureRoot("solon", dir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const results = await runRepoChecks([check], [root]);
      expect(results[0]?.ok).toBe(false);
      expect(results[0]?.matchedFiles).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("kumiko-enterprise-like (packages/*/src, library kind): every package's web/ is scanned", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prim-guard-enterprise-"));
    try {
      const designerWeb = join(dir, "packages/designer/src/web");
      mkdirSync(designerWeb, { recursive: true });
      writeFileSync(
        join(designerWeb, "Screen.tsx"),
        "export const S = () => <table><tr><td>x</td></tr></table>;\n",
      );
      const aiWeb = join(dir, "packages/ai-foundation/src/web");
      mkdirSync(aiWeb, { recursive: true });
      writeFileSync(
        join(aiWeb, "Panel.tsx"),
        "export const P = () => <button onClick={x}>Go</button>;\n",
      );
      mkdirSync(join(dir, "packages/no-src-pkg"), { recursive: true });

      const root = fixtureRoot("kumiko-enterprise", dir, {
        kind: "library",
        sourceRoots: ["packages/*/src"],
        testGlobs: ["packages/*/src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      // designer's <table><tr><td> is 3 forbidden tags, ai-foundation's <button> is 1.
      expect(outcome.violations).toHaveLength(4);
      const files = [...new Set(outcome.violations.map((v) => v.file))].sort();
      expect(files).toEqual([
        "packages/ai-foundation/src/web/Panel.tsx",
        "packages/designer/src/web/Screen.tsx",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("kumiko-platform-like (apps/*/src + tools/*/src): both source roots are scanned", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prim-guard-platform-"));
    try {
      const appWeb = join(dir, "apps/web/src/web");
      mkdirSync(appWeb, { recursive: true });
      writeFileSync(
        join(appWeb, "Screen.tsx"),
        "export const S = () => <table><tr><td>x</td></tr></table>;\n",
      );
      const toolWeb = join(dir, "tools/cli/src/web");
      mkdirSync(toolWeb, { recursive: true });
      writeFileSync(
        join(toolWeb, "Panel.tsx"),
        "export const P = () => <button onClick={x}>Go</button>;\n",
      );

      const root = fixtureRoot("kumiko-platform", dir, {
        kind: "app",
        sourceRoots: ["apps/*/src", "tools/*/src"],
        testGlobs: ["apps/*/src/**/*.test.ts", "tools/*/src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      // appWeb's <table><tr><td> is 3 forbidden tags, toolWeb's <button> is 1.
      expect(outcome.violations).toHaveLength(4);
      const files = [...new Set(outcome.violations.map((v) => v.file))].sort();
      expect(files).toEqual(["apps/web/src/web/Screen.tsx", "tools/cli/src/web/Panel.tsx"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
