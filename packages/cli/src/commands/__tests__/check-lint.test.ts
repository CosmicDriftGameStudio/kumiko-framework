import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLintCheckStep } from "../check-lint";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PRESET = "@cosmicdrift/kumiko-framework/biome-rules";

// Inside the package so @biomejs/biome and the preset resolve from the workspace's node_modules.
function repoWith(source: string, biomeConfig: object = { extends: [PRESET] }): string {
  const dir = mkdtempSync(join(import.meta.dir, "lint-repo-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "biome.json"), JSON.stringify({ root: true, ...biomeConfig }));
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

  describe("preset requirement", () => {
    test("a biome.json without extends fails before Biome runs", async () => {
      const run = capture();
      const code = await runLintCheckStep(run.out, repoWith("debugger;\n", {}));
      const output = run.lines.join("\n");
      expect(code).toBe(1);
      expect(output).toContain('"extends": ["@cosmicdrift/kumiko-framework/biome"]');
      expect(output).not.toContain("noDebugger");
    });

    test("an unrelated extends fails", async () => {
      const run = capture();
      const dir = repoWith("export const a = 1;\n", { extends: ["@other/biome-config"] });
      expect(await runLintCheckStep(run.out, dir)).toBe(1);
      expect(run.lines.join("\n")).toContain("does not extend the Kumiko Biome preset");
    });

    test("the biome app preset by package name passes", async () => {
      const run = capture();
      const dir = repoWith("export const a = 1;\n", {
        extends: ["@cosmicdrift/kumiko-framework/biome"],
      });
      expect(await runLintCheckStep(run.out, dir)).toBe(0);
    });

    test("a relative chain that ends at the preset file passes, a comment-laden biome.jsonc included", async () => {
      const run = capture();
      const dir = repoWith("export const a = 1;\n", {});
      rmSync(join(dir, "biome.json"));
      writeFileSync(
        join(dir, "biome.jsonc"),
        `{\n  // chain through a shared file\n  "root": true,\n  "extends": ["./shared.json",],\n}\n`,
      );
      writeFileSync(
        join(dir, "shared.json"),
        JSON.stringify({ extends: ["../../../../../framework/presets/biome-rules.json"] }),
      );
      expect(await runLintCheckStep(run.out, dir)).toBe(0);
    });

    test("a relative extends cycle without the preset fails instead of looping", async () => {
      const run = capture();
      const dir = repoWith("export const a = 1;\n", { extends: ["./other.json"] });
      writeFileSync(join(dir, "other.json"), JSON.stringify({ extends: ["./biome.json"] }));
      expect(await runLintCheckStep(run.out, dir)).toBe(1);
    });
  });
});
