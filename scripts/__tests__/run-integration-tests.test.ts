// Any non-zero exit of a directory run fails the whole run, even when every
// test in it passed: an exit code the summary cannot explain is a real error,
// never a benign teardown warning.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { type IntegrationShard } from "../../bin/_lib/integration-test";
import { discoverIntegrationTargets } from "../run-integration-tests";

const RUNNER_PATH = join(import.meta.dir, "..", "run-integration-tests.ts");

let tmpDir: string | undefined;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

function writeFixture(testBody: string): string {
  const dir = mkdtempSync(join(tmpdir(), "kumiko-integration-runner-"));
  writeFileSync(join(dir, "bunfig.integration.toml"), "");
  mkdirSync(join(dir, "packages", "x"), { recursive: true });
  writeFileSync(
    join(dir, "packages", "x", "a.integration.test.ts"),
    `import { expect, test } from "bun:test";\n\ntest("a", () => {\n  expect(1).toBe(1);\n${testBody}});\n`,
  );
  return dir;
}

async function runRunnerIn(
  dir: string,
  shard: IntegrationShard | null = null,
): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(
    [
      "bun",
      "-e",
      `const { runIntegrationTests } = await import(${JSON.stringify(RUNNER_PATH)}); process.exit(await runIntegrationTests("bulk", ${JSON.stringify(shard)}));`,
    ],
    { cwd: dir, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout: stdout + stderr };
}

describe("runIntegrationTests", () => {
  test("a directory that sets process.exitCode after all tests pass still fails the run", async () => {
    tmpDir = writeFixture("  process.exitCode = 3;\n");
    const { code, stdout } = await runRunnerIn(tmpDir);

    expect(code).not.toBe(0);
    expect(stdout).toContain("Integration run FAILED.");
    expect(stdout).toContain("1 pass");
  });

  test("a directory with a clean exit stays green", async () => {
    tmpDir = writeFixture("");
    const { code, stdout } = await runRunnerIn(tmpDir);

    expect(code).toBe(0);
    expect(stdout).toContain("Integration run complete.");
  });

  test("runs only the discovered files, not other test files whose path contains theirs", async () => {
    tmpDir = writeFixture("");
    writeFileSync(
      join(tmpDir, "packages", "x", "a.integration.test.ts.unit.test.ts"),
      `import { expect, test } from "bun:test";\n\ntest("must not run", () => {\n  expect(1).toBe(2);\n});\n`,
    );
    const { code, stdout } = await runRunnerIn(tmpDir);

    expect(code).toBe(0);
    expect(stdout).toContain("Files: 1/1 executed");
    expect(stdout).not.toContain("must not run");
  });

  function writeSubprocessLaneFixture(dir: string, testBody: string): void {
    const laneDir = join(dir, "packages", "cli", "src", "__tests__");
    mkdirSync(laneDir, { recursive: true });
    writeFileSync(
      join(laneDir, "scaffold-check.integration.test.ts"),
      `import { expect, test } from "bun:test";\n\ntest("lane", () => {\n${testBody}});\n`,
    );
  }

  test("a subprocess-check file runs in its own lane after the bulk lane, without --parallel", async () => {
    tmpDir = writeFixture("");
    writeSubprocessLaneFixture(tmpDir, "  expect(1).toBe(1);\n");
    const { code, stdout } = await runRunnerIn(tmpDir);

    expect(code).toBe(0);
    expect(stdout).toContain("=== Integration: 1 file(s) (--parallel=4) ===");
    expect(stdout).toContain("=== Integration subprocess checks: 1 file(s) ===");
    expect(stdout.indexOf("Integration subprocess checks")).toBeGreaterThan(
      stdout.indexOf("=== Integration: 1 file(s)"),
    );
  });

  test("a red subprocess-check lane fails the run even when the bulk lane is green", async () => {
    tmpDir = writeFixture("");
    writeSubprocessLaneFixture(tmpDir, "  expect(1).toBe(2);\n");
    const { code, stdout } = await runRunnerIn(tmpDir);

    expect(code).not.toBe(0);
    expect(stdout).toContain("Integration run FAILED.");
  });
});

describe("runIntegrationTests with a shard", () => {
  function writeSecondFile(dir: string): void {
    writeFileSync(
      join(dir, "packages", "x", "b.integration.test.ts"),
      `import { expect, test } from "bun:test";\n\ntest("b", () => {\n  expect(1).toBe(1);\n});\n`,
    );
  }

  test("each shard runs its own slice and counts only that slice as expected", async () => {
    tmpDir = writeFixture("");
    writeSecondFile(tmpDir);
    const first = await runRunnerIn(tmpDir, { index: 1, total: 2 });
    const second = await runRunnerIn(tmpDir, { index: 2, total: 2 });

    expect(first.code).toBe(0);
    expect(first.stdout).toContain("Files: 1/1 executed");
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("Files: 1/1 executed");
  });

  test("a shard without files fails instead of passing vacuously", async () => {
    tmpDir = writeFixture("");
    const { code, stdout } = await runRunnerIn(tmpDir, { index: 2, total: 2 });

    expect(code).not.toBe(0);
    expect(stdout).toContain("No integration test files in shard 2/2");
  });

  test("the subprocess lane runs in shard 1 only", async () => {
    tmpDir = writeFixture("");
    writeSecondFile(tmpDir);
    const laneDir = join(tmpDir, "packages", "cli", "src", "__tests__");
    mkdirSync(laneDir, { recursive: true });
    writeFileSync(
      join(laneDir, "scaffold-check.integration.test.ts"),
      `import { expect, test } from "bun:test";\n\ntest("lane", () => {\n  expect(1).toBe(1);\n});\n`,
    );
    const first = await runRunnerIn(tmpDir, { index: 1, total: 2 });
    const second = await runRunnerIn(tmpDir, { index: 2, total: 2 });

    expect(first.stdout).toContain("Integration subprocess checks");
    expect(second.stdout).not.toContain("Integration subprocess checks");
  });

  test.each([2, 3])(
    "every real integration file runs in exactly one of %i shards",
    async (total) => {
      const all = (await discoverIntegrationTargets("bulk")).includedFiles;
      const perShard: string[][] = [];
      for (let index = 1; index <= total; index++) {
        const shard: IntegrationShard = { index, total };
        perShard.push((await discoverIntegrationTargets("bulk", shard)).includedFiles);
      }

      expect(perShard.flat().sort()).toEqual([...all].sort());
      expect(new Set(perShard.flat()).size).toBe(all.length);
      for (const files of perShard) expect(files.length).toBeGreaterThan(0);
    },
  );
});
