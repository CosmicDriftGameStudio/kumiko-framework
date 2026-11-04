import { describe, expect, test } from "bun:test";
import { type Finding, lintFixture, presetPath } from "./biome-harness";

// An app-shaped repo that really extends the preset: plugin and builtin scopes live in `includes`,
// which the per-plugin harness never sets, so a scope that silently misses src/bin/scripts only
// shows up here.

const PLUGIN = "plugin";

// Assembled so this file does not trip the font CDN plugin it tests.
const googleFontsHost = ["fonts", "googleapis", "com"].join(".");

function findingsFor(findings: readonly Finding[], file: string, category = PLUGIN): number[] {
  return findings.filter((f) => f.file === file && f.category === category).map((f) => f.line);
}

const SERVER_SNIPPETS: Readonly<Record<string, string>> = {
  "no-date-api": "export const created = new Date(0);",
  "unsafe-json-parse": "export const parsed = JSON.parse(input);",
  "error-reasons": 'failUnprocessable("Bad reason");',
  "es-literal-writes": 'export const sql = "INSERT INTO kumiko_events (id) VALUES (1)";',
  "restricted-symbol": 'import { appendEventInTenantDb } from "x";',
  "direct-fetch": 'export const response = fetch("https://example.com");',
};

const SERVER_DIRS = ["src", "bin", "scripts"] as const;

describe("biome-rules preset in an app-shaped repo", () => {
  const files: Record<string, string> = {};
  for (const dir of SERVER_DIRS) {
    for (const [rule, snippet] of Object.entries(SERVER_SNIPPETS)) {
      files[`${dir}/${rule}.ts`] = snippet;
    }
  }
  Object.assign(files, {
    // Allowlists and test files stay quiet.
    "src/__tests__/date.ts": SERVER_SNIPPETS["no-date-api"] ?? "",
    "src/date.test.ts": SERVER_SNIPPETS["no-date-api"] ?? "",
    "src/safe-json.ts": SERVER_SNIPPETS["unsafe-json-parse"] ?? "",
    "scripts/migrations/replay.ts": "await store.appendRaw(event);",
    "src/admin.ts": "await store.appendRaw(event);",
    "src/fs-read.ts": 'import { readFileSync } from "node:fs";',
    "src/fs-require.ts": 'import legacyFs = require("node:fs");',
    "src/fs-reexport.ts": 'export { readFileSync, writeFileSync } from "fs";',
    "src/fs-namespace.ts": 'export * as everything from "fs";',
    "bin/fs-tool.ts": 'import { readFileSync } from "node:fs";',
    "scripts/fs-tool.ts": 'import { readFileSync } from "node:fs";',
    "src/polyfill-require.ts": 'export const poly = require("temporal-polyfill");',
    "src/polyfill-import.ts":
      'import { Temporal } from "temporal-polyfill";\nexport const t = Temporal;',
    "src/styles.css": `@import url("https://${googleFontsHost}/css2?family=Inter");`,
    "src/types.ts": "export type Style = CSSProperties;",
    "src/web/Screen.tsx": "export const Screen = () => <button>Go</button>;",
    "src/public/Page.tsx": "export const Page = () => <button>Go</button>;",
    "src/web/Screen.test.tsx": "export const T = () => <button>Go</button>;",
    "src/screens/Other.tsx": [
      "export const Other = () => (",
      "  <div>",
      "    <button>not a web file</button>",
      "    <input />",
      '    <span className="text-red-500">x</span>',
      "  </div>",
      ");",
    ].join("\n"),
    "src/screens/Styled.tsx": "export const Styled = () => <div style={{ top: 1 }} />;",
    "src/__tests__/title.test.ts": 'test("gibt den Wert zurück", () => {});',
    "src/__tests__/skipped.test.ts": 'test.skip("skipped", () => {});',
    "src/seed.integration.ts": "const d = createTestDispatcher(app);",
    "src/__tests__/seed.test.ts": 'export const sql = "INSERT INTO kumiko_events (id) VALUES (1)";',
  });

  const findings = lintFixture({ extends: [presetPath("biome-rules.json")] }, files);

  test("server-side plugins reach src, bin and scripts", () => {
    for (const dir of SERVER_DIRS) {
      for (const rule of Object.keys(SERVER_SNIPPETS)) {
        expect(findingsFor(findings, `${dir}/${rule}.ts`), `${dir}/${rule}.ts`).toEqual([1]);
      }
    }
  });

  test("tests, allowlisted files and tooling folders stay quiet", () => {
    for (const quiet of [
      "src/__tests__/date.ts",
      "src/date.test.ts",
      "src/safe-json.ts",
      "scripts/migrations/replay.ts",
      "bin/fs-tool.ts",
      "scripts/fs-tool.ts",
      "src/web/Screen.test.tsx",
    ]) {
      expect(findingsFor(findings, quiet), quiet).toEqual([]);
    }
  });

  test("admin API and direct fs imports are caught in src, in every import form", () => {
    for (const file of [
      "src/admin.ts",
      "src/fs-read.ts",
      "src/fs-require.ts",
      "src/fs-reexport.ts",
      "src/fs-namespace.ts",
    ]) {
      expect(findingsFor(findings, file), file).toEqual([1]);
    }
  });

  test("temporal-polyfill is blocked as import and as require()", () => {
    expect(findingsFor(findings, "src/polyfill-require.ts")).toEqual([1]);
    expect(
      findingsFor(findings, "src/polyfill-import.ts", "lint/style/noRestrictedImports"),
    ).toEqual([1]);
  });

  test("font CDN in a stylesheet and CSSProperties in a ts file", () => {
    expect(findingsFor(findings, "src/styles.css")).toEqual([1]);
    expect(findingsFor(findings, "src/types.ts")).toEqual([1]);
  });

  test("raw layout HTML only in web and public, raw form tags and palette classes in any tsx", () => {
    expect(findingsFor(findings, "src/web/Screen.tsx")).toEqual([1]);
    expect(findingsFor(findings, "src/public/Page.tsx")).toEqual([1]);
    expect(findingsFor(findings, "src/screens/Other.tsx")).toEqual([4, 5]);
  });

  test("inline styles are caught in every tsx", () => {
    expect(findingsFor(findings, "src/screens/Styled.tsx", "lint/style/noInlineStyles")).toEqual([
      1,
    ]);
  });

  test("test guards reach test files outside any web folder", () => {
    expect(findingsFor(findings, "src/__tests__/title.test.ts")).toEqual([1]);
    expect(findingsFor(findings, "src/__tests__/skipped.test.ts")).toEqual([1]);
    expect(findingsFor(findings, "src/seed.integration.ts")).toEqual([1]);
    expect(findingsFor(findings, "src/__tests__/seed.test.ts")).toEqual([1]);
  });
});

describe("biome-app preset: process.env", () => {
  const findings = lintFixture(
    { extends: [presetPath("biome-app.json")] },
    {
      "src/read-env.ts": 'export const url = process.env["DATABASE_URL"];',
      "bin/env.ts": 'export const url = process.env["DATABASE_URL"];',
      "bin/server.ts": 'export const url = process.env["DATABASE_URL"];',
      "bin/main.ts": [
        "// biome-ignore-all lint/style/noProcessEnv: wiring is read before the env contract is parsed",
        'export const url = process.env["DATABASE_URL"];',
      ].join("\n"),
      "bin/other.ts": 'export const url = process.env["DATABASE_URL"];',
    },
  );
  const noProcessEnv = "lint/style/noProcessEnv";

  test("src and unlisted bin files are flagged, listed bootstrap files are not", () => {
    expect(findingsFor(findings, "src/read-env.ts", noProcessEnv)).toEqual([1]);
    expect(findingsFor(findings, "bin/other.ts", noProcessEnv)).toEqual([1]);
    expect(findingsFor(findings, "bin/env.ts", noProcessEnv)).toEqual([]);
    expect(findingsFor(findings, "bin/server.ts", noProcessEnv)).toEqual([]);
  });

  test("bin/main.ts is covered by its file-level biome-ignore-all, not by a path exclusion", () => {
    expect(findingsFor(findings, "bin/main.ts", noProcessEnv)).toEqual([]);
  });
});
