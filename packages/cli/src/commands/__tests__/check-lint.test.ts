import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLintCheckStep } from "../check-lint";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Inside the package so @biomejs/biome resolves from the workspace's node_modules.
function repoWith(source: string): string {
  const dir = mkdtempSync(join(import.meta.dir, "lint-repo-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "biome.json"), JSON.stringify({ root: true, linter: { enabled: true } }));
  writeFileSync(join(dir, "src", "a.ts"), source);
  return dir;
}

function capture() {
  const lines: string[] = [];
  return { lines, out: { log: (l: string) => lines.push(l), err: (l: string) => lines.push(l) } };
}

describe("kumiko check lint step", () => {
  test("a rule violation fails the step and prints the finding", async () => {
    const run = capture();
    const code = await runLintCheckStep(run.out, repoWith("debugger;\n"));
    expect(code).toBe(1);
    expect(run.lines.join("\n")).toContain("noDebugger");
  });

  test("a clean repo passes", async () => {
    const run = capture();
    expect(await runLintCheckStep(run.out, repoWith("export const a = 1;\n"))).toBe(0);
  });

  test("a repo that cannot resolve Biome fails with an install hint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiko-lint-nobiome-"));
    dirs.push(dir);
    const run = capture();
    expect(await runLintCheckStep(run.out, dir)).toBe(1);
    expect(run.lines.join("\n")).toContain("bun add -d @biomejs/biome");
  });
});
