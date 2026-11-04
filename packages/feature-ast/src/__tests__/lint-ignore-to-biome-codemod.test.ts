import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodemod as runCodemodCli } from "../scripts/codemod/codemod-support.ts";
import { lintIgnoreToBiomeCodemod } from "../scripts/codemod/lint-ignore-to-biome.ts";

const SCRIPT_PATH = join(import.meta.dir, "../scripts/codemod/lint-ignore-to-biome.ts");

function withFixture<T>(
  files: Record<string, string>,
  run: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "lint-ignore-codemod-"));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

async function runCodemodWithExitCode(
  dir: string,
  extraArgs: readonly string[] = [],
): Promise<{ readonly output: string; readonly exitCode: number }> {
  const lines: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.join(" "));
  });
  try {
    const exitCode = await runCodemodCli(lintIgnoreToBiomeCodemod, [
      dir,
      "--no-format",
      ...extraArgs,
    ]);
    return { output: lines.join("\n"), exitCode };
  } finally {
    logSpy.mockRestore();
  }
}

async function runCodemod(dir: string, extraArgs: readonly string[] = []): Promise<string> {
  return (await runCodemodWithExitCode(dir, extraArgs)).output;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf-8");

describe("lint-ignore-to-biome codemod", () => {
  test("converts line, block and JSX comments of deleted guards and keeps the reason", () =>
    withFixture(
      {
        "a.tsx": [
          "// kumiko-lint-ignore no-raw-hooks DOM integration needs a real effect",
          "useEffect(() => {}, []);",
          "/* kumiko-lint-ignore primitives-discipline hand rolled layout for print */",
          "<button />;",
          "<div>",
          "  {/* kumiko-lint-ignore raw-interactive-elements external link opens a new tab */}",
          "  <a href='x' />",
          "</div>;",
          "// kumiko-lint-ignore no-inline-styles dynamic width from the measured chart",
          "<div style={{ width }} />;",
        ].join("\n"),
      },
      async (dir) => {
        await runCodemod(dir);
        expect(read(dir, "a.tsx")).toBe(
          [
            "// biome-ignore lint/plugin: DOM integration needs a real effect",
            "useEffect(() => {}, []);",
            "/* biome-ignore lint/plugin: hand rolled layout for print */",
            "<button />;",
            "<div>",
            "  {/* biome-ignore lint/plugin: external link opens a new tab */}",
            "  <a href='x' />",
            "</div>;",
            "// biome-ignore lint/style/noInlineStyles: dynamic width from the measured chart",
            "<div style={{ width }} />;",
          ].join("\n"),
        );
      },
    ));

  test("leaves markers of surviving guards and lookalike strings alone", () =>
    withFixture(
      {
        "b.ts": [
          "// kumiko-lint-ignore complexity-budget generated switch over all kinds",
          "const hint = '// kumiko-lint-ignore no-raw-hooks this is only a message string';",
        ].join("\n"),
      },
      async (dir) => {
        const before = read(dir, "b.ts");
        const output = await runCodemod(dir);
        expect(read(dir, "b.ts")).toBe(before);
        expect(output).toContain("rewritten: 0 site(s)");
      },
    ));

  test("lists markers with a missing or short reason instead of inventing one", () =>
    withFixture(
      {
        "c.ts": [
          "// kumiko-lint-ignore direct-fs",
          "import 'node:fs';",
          "// kumiko-lint-ignore direct-fs build tooling",
          "import 'node:fs/promises';",
        ].join("\n"),
      },
      async (dir) => {
        const before = read(dir, "c.ts");
        const output = await runCodemod(dir);
        expect(read(dir, "c.ts")).toBe(before);
        expect(output).toContain("c.ts:1");
        expect(output).toContain("c.ts:3");
      },
    ));

  test("lists slug lists that mix deleted and surviving guards", () =>
    withFixture(
      { "d.ts": "// kumiko-lint-ignore direct-fs,complexity-budget generated code needs both\n" },
      async (dir) => {
        const before = read(dir, "d.ts");
        const output = await runCodemod(dir);
        expect(read(dir, "d.ts")).toBe(before);
        expect(output).toContain("d.ts:1");
      },
    ));

  test("--dry-run reports without writing", () =>
    withFixture(
      { "e.ts": "// kumiko-lint-ignore test-title legacy title kept for history\n" },
      async (dir) => {
        const before = read(dir, "e.ts");
        const output = await runCodemod(dir, ["--dry-run"]);
        expect(read(dir, "e.ts")).toBe(before);
        expect(output).toContain("rewritable: 1 site(s)");
      },
    ));

  test("--check exits 1 without writing while a marker is left", () =>
    withFixture(
      { "g.ts": "// kumiko-lint-ignore test-title legacy title kept for history\n" },
      async (dir) => {
        const before = read(dir, "g.ts");
        const { exitCode } = await runCodemodWithExitCode(dir, ["--check"]);
        expect(exitCode).toBe(1);
        expect(read(dir, "g.ts")).toBe(before);
      },
    ));

  test("rejects an unknown flag without writing", () =>
    withFixture(
      { "h.ts": "// kumiko-lint-ignore test-title legacy title kept for history\n" },
      async (dir) => {
        const before = read(dir, "h.ts");
        const { exitCode } = await runCodemodWithExitCode(dir, ["--preview"]);
        expect(exitCode).toBe(2);
        expect(read(dir, "h.ts")).toBe(before);
      },
    ));

  test("runs as a script", () =>
    withFixture(
      { "f.ts": "// kumiko-lint-ignore no-raw-hooks real DOM integration needs it\n" },
      async (dir) => {
        const proc = Bun.spawn({ cmd: ["bun", SCRIPT_PATH, dir], stdout: "pipe", stderr: "pipe" });
        await proc.exited;
        expect(proc.exitCode).toBe(0);
        expect(read(dir, "f.ts")).toBe(
          "// biome-ignore lint/plugin: real DOM integration needs it\n",
        );
      },
    ));
});
