// `kumiko-testing integration --help` used to crash in parseArgs (strict mode
// rejects the unknown flag); help must work at top level and after any command.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "kumiko-testing.ts");

async function runCli(args: string[], cwd: string) {
  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("kumiko-testing --help", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kumiko-testing-help-"));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  for (const args of [
    ["--help"],
    ["-h"],
    ["bunfig", "--help"],
    ["bunfig", "-h"],
    ["integration", "--help"],
    ["integration", "-h"],
  ]) {
    test(`${args.join(" ")}: usage on stdout, exit 0, no files written`, async () => {
      const { stdout, stderr, exitCode } = await runCli(args, cwd);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("kumiko-testing <command>");
      expect(stderr).toBe("");
      expect(readdirSync(cwd)).toEqual([]);
    });
  }

  test("no command still fails with usage on stderr", async () => {
    const { stderr, exitCode } = await runCli([], cwd);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("kumiko-testing <command>");
  });
});
