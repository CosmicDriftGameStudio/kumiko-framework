import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Project } from "ts-morph";
import {
  createGuard,
  hasPluginSuppression,
  neutralizePluginSuppressions,
  parseBiomeDiagnostics,
  scanSecurityPluginSuppressions,
} from "../guard-security-plugin-suppression";
import { fixtureRoot } from "./parent-workspace-fixture";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Inside the package so @biomejs/biome and the framework preset resolve from the workspace.
function tempRepo(): string {
  const dir = mkdtempSync(join(import.meta.dir, "plugin-suppression-repo-"));
  dirs.push(dir);
  return dir;
}

function scan(files: Record<string, string>) {
  return scanSecurityPluginSuppressions(tempRepo(), new Map(Object.entries(files)));
}

const REASON = "reviewed by someone else";

describe("security-plugin-suppression guard", () => {
  test("a suppressed event-store literal write and a suppressed server fetch are findings", () => {
    const result = scan({
      "src/write.ts": `// biome-ignore lint/plugin: ${REASON}\nexport const q = sql\`UPDATE kumiko_events SET x = 1\`;\ndeclare const sql: (s: TemplateStringsArray) => unknown;\n`,
      "src/fetcher.ts": `// biome-ignore lint/plugin: ${REASON}\nexport const load = (userUrl: string) => fetch(userUrl);\n`,
    });
    expect(result.failures).toEqual([]);
    expect(result.findings["src/write.ts"]?.count).toBe(1);
    expect(result.findings["src/fetcher.ts"]).toEqual({ count: 1, firstLine: 2 });
  });

  test("a file-wide suppression does not hide node:fs", () => {
    const result = scan({
      "src/files.ts": `// biome-ignore-all lint/plugin: ${REASON}\nimport { readFileSync } from "node:fs";\nexport const read = readFileSync;\n`,
    });
    expect(result.findings["src/files.ts"]?.count).toBe(1);
  });

  test("suppressing a UI plugin in a tsx file is not a finding", () => {
    const result = scan({
      "src/screen.tsx": `// biome-ignore lint/plugin: ${REASON}\nexport const Screen = () => <div style={{ color: "red" }}>x</div>;\n`,
    });
    expect(result).toEqual({ findings: {}, failures: [] });
  });

  test("browser-side fetch in web tsx may stay suppressed", () => {
    const result = scan({
      "src/web/x.tsx": `// biome-ignore lint/plugin: ${REASON}\nexport const load = (url: string) => fetch(url);\n`,
    });
    expect(result).toEqual({ findings: {}, failures: [] });
  });

  test("a baseline entry covers the file and a missing baseline fails closed", () => {
    const repo = tempRepo();
    mkdirSync(join(repo, "src"));
    const source = `// biome-ignore lint/plugin: ${REASON}\nexport const load = (url: string) => fetch(url);\n`;
    const filePath = join(repo, "src/fetcher.ts");
    writeFileSync(filePath, source);
    const root = fixtureRoot("fixture", repo, {
      kind: "app",
      sourceRoots: ["src"],
      testGlobs: ["src/**/*.test.ts"],
    });
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(filePath, source);

    const missing = createGuard({ baselineRoot: repo }).run([sf], [root]);
    expect(missing.violations.map((v) => v.message).join("\n")).toContain(
      "without a baseline file",
    );

    writeFileSync(
      join(repo, ".kumiko-security-plugin-suppression-baseline.json"),
      JSON.stringify({
        format: 1,
        generated: "2026-11-06",
        total: 1,
        perFile: { "src/fetcher.ts": 1 },
      }),
    );
    expect(createGuard({ baselineRoot: repo }).run([sf], [root]).violations).toEqual([]);
  });

  test("files without a lint/plugin suppression need no Biome run", () => {
    expect(scan({ "src/a.ts": "export const a = 1;\n" })).toEqual({ findings: {}, failures: [] });
  });

  test("an unreadable Biome answer is not a clean report", () => {
    expect(parseBiomeDiagnostics("")).toBeUndefined();
    expect(parseBiomeDiagnostics("{not json")).toBeUndefined();
    expect(parseBiomeDiagnostics('{"summary":{}}')).toBeUndefined();
  });

  test("neutralizing keeps line numbers and leaves other biome-ignore rules alone", () => {
    const source = [
      "// biome-ignore lint/plugin: first reason here",
      "/* biome-ignore-all lint/plugin/foo: second reason here */",
      "// biome-ignore lint/style/noProcessEnv: third reason here",
      "const text = '// biome-ignore lint/plugin: inside a string';",
    ].join("\n");
    const neutralized = neutralizePluginSuppressions(source);
    expect(neutralized.length).toBe(source.length);
    expect(neutralized).toContain("biome_ignore lint/plugin: first");
    expect(neutralized).toContain("biome_ignore-all lint/plugin/foo");
    expect(neutralized).toContain("// biome-ignore lint/style/noProcessEnv");
    expect(neutralized).toContain("'// biome-ignore lint/plugin: inside a string'");
    expect(hasPluginSuppression("const a = '// biome-ignore lint/plugin: x y z';")).toBe(false);
  });
});
