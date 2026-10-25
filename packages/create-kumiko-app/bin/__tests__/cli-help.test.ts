// `create-kumiko-app --help` used to fall through to "missing name" (exit 1)
// instead of printing usage as a successful help request.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgv, runCreate } from "../../src/index";

const CLI_PATH = join(import.meta.dir, "..", "cli.ts");

describe("create-kumiko-app --help", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "create-kumiko-app-help-"));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  test("--help: usage on stdout, exit 0, nothing scaffolded", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "--help"], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: bun create kumiko-app");
    expect(readdirSync(cwd)).toEqual([]);
  });

  test("-h: usage on stdout, exit 0, nothing scaffolded", async () => {
    const lines: string[] = [];
    const exitCode = await runCreate({
      ...parseArgv(["-h"]),
      cwd,
      log: (line) => lines.push(line),
    });

    expect(exitCode).toBe(0);
    expect(lines.join("\n")).toContain("Usage: bun create kumiko-app");
    expect(readdirSync(cwd)).toEqual([]);
  });
});
