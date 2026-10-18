// A fresh `kumiko new app` must pass its own `kumiko check`, managed files and
// script standard included, and typecheck against the framework presets.
// The fixture sits inside the repo so @cosmicdrift/* resolves through the
// workspace node_modules, but outside any __tests__ directory: the guards treat
// such paths as test sources and would scan a different file set than an app
// has. `git init` makes it its own repo root for the CLI.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scaffoldApp } from "@cosmicdrift/kumiko-dev-server";
import { renderTestSetup } from "@cosmicdrift/kumiko-testing/scaffold";

const FIXTURE_ROOT = join(import.meta.dir, "..", "..", "..", "..", ".tmp-fixtures");
const CLI_BIN = join(import.meta.dir, "..", "..", "bin", "cli.ts");
const createdDirs: string[] = [];

afterAll(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

async function run(cmd: readonly string[], cwd: string): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn({ cmd: [...cmd], cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, output: `${stdout}${stderr}` };
}

describe("scaffolded app passes kumiko check", () => {
  test("kumiko check (boot, guards, managed, scripts) and tsc are green", async () => {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    const cwd = mkdtempSync(join(FIXTURE_ROOT, "check-"));
    createdDirs.push(cwd);
    const { destination } = await scaffoldApp({
      name: "check-fixture",
      cwd,
      testSetup: renderTestSetup,
    });
    expect((await run(["git", "init", "-q"], destination)).code).toBe(0);

    const check = await run(["bun", CLI_BIN, "check"], destination);
    expect(check.code, check.output).toBe(0);
    expect(check.output).toContain("managed file(s) match the installed template");
    expect(check.output).toContain("all standard scripts present");

    const tsc = await run(["bun", "x", "tsc", "--noEmit", "-p", "."], destination);
    expect(tsc.code, tsc.output).toBe(0);
  });
});
