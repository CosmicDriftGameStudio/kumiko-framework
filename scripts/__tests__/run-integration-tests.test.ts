// Any non-zero exit of a directory run fails the whole run, even when every
// test in it passed: an exit code the summary cannot explain is a real error,
// never a benign teardown warning.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

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

async function runRunnerIn(dir: string): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(
    [
      "bun",
      "-e",
      `const { runIntegrationTests } = await import(${JSON.stringify(RUNNER_PATH)}); process.exit(await runIntegrationTests());`,
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
  }, 30_000);

  test("a directory with a clean exit stays green", async () => {
    tmpDir = writeFixture("");
    const { code, stdout } = await runRunnerIn(tmpDir);

    expect(code).toBe(0);
    expect(stdout).toContain("Integration run complete.");
  }, 30_000);
});
