// A fresh `kumiko new app` must pass its own `kumiko check`, managed files and
// script standard included, and typecheck against the framework presets.
// The fixture sits inside the repo so @cosmicdrift/* resolves through the
// workspace node_modules, but outside any __tests__ directory: the guards treat
// such paths as test sources and would scan a different file set than an app
// has. `git init` makes it its own repo root for the CLI.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scaffoldApp } from "@cosmicdrift/kumiko-dev-server";
import { renderTestSetup } from "@cosmicdrift/kumiko-testing/scaffold";
import type { CheckStepId } from "../commands/check";

const FIXTURE_ROOT = join(import.meta.dir, "..", "..", "..", "..", ".tmp-fixtures");
const CLI_BIN = join(import.meta.dir, "..", "..", "bin", "cli.ts");
const createdDirs: string[] = [];
const runningProcs = new Set<Bun.Subprocess>();
let appDir = "";

// One subprocess per test keeps each under the per-test budget; a test that
// still times out must not leave its child running into the next one.
afterEach(() => {
  for (const proc of runningProcs) proc.kill();
  runningProcs.clear();
});

afterAll(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

async function run(cmd: readonly string[], cwd: string): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn({ cmd: [...cmd], cwd, stdout: "pipe", stderr: "pipe" });
  runningProcs.add(proc);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  runningProcs.delete(proc);
  return { code, output: `${stdout}${stderr}` };
}

beforeAll(async () => {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  const cwd = mkdtempSync(join(FIXTURE_ROOT, "check-"));
  createdDirs.push(cwd);
  const { destination } = await scaffoldApp({
    name: "check-fixture",
    cwd,
    testSetup: renderTestSetup,
  });
  const init = await run(["git", "init", "-q"], destination);
  if (init.code !== 0) throw new Error(`git init failed: ${init.output}`);
  appDir = destination;
});

const STEP_EXPECTATIONS: readonly (readonly [CheckStepId, string | undefined])[] = [
  ["boot", undefined],
  ["guards", undefined],
  ["ui", undefined],
  ["checks", undefined],
  ["managed", "managed file(s) match the installed template"],
  ["scripts", "all standard scripts present"],
];

describe("scaffolded app passes kumiko check", () => {
  test.each(STEP_EXPECTATIONS)("kumiko check %s is green", async (step, expectedLine) => {
    const check = await run(["bun", CLI_BIN, "check", step], appDir);
    expect(check.code, check.output).toBe(0);
    if (expectedLine !== undefined) expect(check.output).toContain(expectedLine);
  });

  test("tsc against the framework presets is green", async () => {
    const tsc = await run(["bun", "x", "tsc", "--noEmit", "-p", "."], appDir);
    expect(tsc.code, tsc.output).toBe(0);
  });
});
