import { describe, expect, test } from "bun:test";
import { lineNumbers, lintFixture, presetPath } from "./biome-harness";

const sharedRules = { extends: [presetPath("biome-rules.json")] };
const appPreset = { extends: [presetPath("biome-app.json")] };

function categories(findings: ReturnType<typeof lintFixture>, file: string): string[] {
  return findings.filter((f) => f.file === file).map((f) => f.category);
}

describe("shared biome-rules preset", () => {
  test("temporal-polyfill is closed as a whole: Temporal, helpers, namespace and subpaths", () => {
    const findings = lintFixture(sharedRules, {
      "a.ts": [
        'import { Temporal } from "temporal-polyfill";',
        'import { toTemporalInstant } from "temporal-polyfill";',
        'import { Intl as PolyfillIntl } from "temporal-polyfill";',
        'import * as polyfill from "temporal-polyfill";',
        'import { something } from "temporal-polyfill/impl";',
        "export const all = [Temporal, toTemporalInstant, PolyfillIntl, polyfill, something];",
      ].join("\n"),
    });
    expect(categories(findings, "a.ts")).toEqual(Array(5).fill("lint/style/noRestrictedImports"));
    expect(lineNumbers(findings, "a.ts")).toEqual([1, 2, 3, 4, 5]);
  });

  test("ts-ignore, floating promises and nested component definitions are errors", () => {
    const findings = lintFixture(sharedRules, {
      "a.ts": [
        "// @ts-ignore",
        "export const value: number = 'x';",
        "async function load() {}",
        "export function run() {",
        "  load();",
        "}",
      ].join("\n"),
      "b.tsx": [
        "export function Outer() {",
        "  const Inner = () => <span />;",
        "  return <Inner />;",
        "}",
      ].join("\n"),
    });
    expect(categories(findings, "a.ts")).toEqual([
      "lint/suspicious/noTsIgnore",
      "lint/nursery/noFloatingPromises",
    ]);
    expect(categories(findings, "b.tsx")).toEqual([
      "lint/correctness/noNestedComponentDefinitions",
    ]);
  });

  test("temporal-polyfill: side effect, re-export and type imports are errors, the kumiko source is not", () => {
    const findings = lintFixture(sharedRules, {
      "a.ts": [
        'import "temporal-polyfill/global";',
        'export { Temporal } from "temporal-polyfill";',
        'import type { Temporal as TypeOnly } from "temporal-polyfill";',
        'import { Temporal as Shared } from "@cosmicdrift/kumiko-types/temporal";',
        "export type At = TypeOnly.Instant | Shared.Instant;",
      ].join("\n"),
    });
    const restricted = findings.filter((f) => f.category === "lint/style/noRestrictedImports");
    expect(lineNumbers(restricted, "a.ts")).toEqual([1, 2, 3]);
  });

  test("promises in conditions or void callbacks and non-exhaustive switches are errors", () => {
    const findings = lintFixture(sharedRules, {
      "a.ts": [
        "type Mode = 'a' | 'b';",
        "const cache = new Map<string, Promise<number>>();",
        "export function read(key: string): Promise<number> | undefined {",
        "  const hit = cache.get(key);",
        "  if (hit) return hit;",
        "  if (hit !== undefined) return hit;",
        "  return undefined;",
        "}",
        "export function pick(mode: Mode): number {",
        "  switch (mode) {",
        "    case 'a':",
        "      return 1;",
        "  }",
        "  return 0;",
        "}",
        "export function pickAll(mode: Mode): number {",
        "  switch (mode) {",
        "    case 'a':",
        "      return 1;",
        "    case 'b':",
        "      return 2;",
        "  }",
        "}",
      ].join("\n"),
    });
    expect(
      findings.map((f) => `${f.category}:${f.line}`).filter((entry) => !entry.includes("noUnused")),
    ).toEqual(["lint/nursery/noMisusedPromises:5", "lint/nursery/useExhaustiveSwitchCases:10"]);
  });

  test("inline styles are an error in every tsx", () => {
    const findings = lintFixture(sharedRules, {
      "packages/x/src/web/screen.tsx": "export const A = () => <div style={{ color: 'red' }} />;",
      "packages/x/src/lib/card.tsx": "export const B = () => <div style={{ color: 'red' }} />;",
    });
    expect(categories(findings, "packages/x/src/web/screen.tsx")).toEqual([
      "lint/style/noInlineStyles",
    ]);
    expect(categories(findings, "packages/x/src/lib/card.tsx")).toEqual([
      "lint/style/noInlineStyles",
    ]);
  });

  test("a justified biome-ignore silences a plugin diagnostic", () => {
    const findings = lintFixture(sharedRules, {
      "packages/x/src/a.ts": [
        "// biome-ignore lint/plugin: wire format needs the Date API",
        "export const created = new Date(0);",
        "export const other = new Date(1);",
      ].join("\n"),
    });
    expect(lineNumbers(findings, "packages/x/src/a.ts")).toEqual([3]);
  });
});

describe("biome-app preset", () => {
  test("it extends the shared rules and bans process.env in app source", () => {
    const findings = lintFixture(appPreset, {
      "src/a.ts": [
        "export const url = process.env.DATABASE_URL;",
        "export const created = new Date(0);",
      ].join("\n"),
      "bin/env.ts": "export const url = process.env.DATABASE_URL;",
    });
    expect(categories(findings, "src/a.ts").sort()).toEqual(["lint/style/noProcessEnv", "plugin"]);
    expect(categories(findings, "bin/env.ts")).toEqual([]);
  });
});
