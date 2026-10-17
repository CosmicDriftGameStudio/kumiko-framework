// Spawns the CLI over whole suites in a fixture repo, which exceeds the 5 s unit budget under load.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSecurityGuard } from "../_lib/guard-kit";
import { GUARDS } from "../run-guards";
import { writeRepo } from "./parent-workspace-fixture";
import { runCli } from "./run-cli";

async function runCliInFixtureRepo(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  // Real-process runs against a one-file fixture repo: scanning the whole
  // checkout from a spawned CLI exceeded the test budget under CI load.
  const fixture = mkdtempSync(join(tmpdir(), "cli-fixture-repo-"));
  writeRepo(fixture, { name: "cli-fixture-repo", layout: "flat" });
  try {
    return await runCli(args, { cwd: fixture });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe("cli.ts — suite runs in a fixture repo", () => {
  test("licenses with nothing installed fails loudly instead of passing", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "cli-licenses-empty-"));
    writeRepo(fixture, { name: "cli-licenses-empty", layout: "flat" });
    try {
      const { exitCode, stderr } = await runCli(["licenses"], { cwd: fixture });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("nothing scanned");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("checks runs the repo-checks suite and prints the guard-kit banner", async () => {
    const { exitCode, stdout } = await runCliInFixtureRepo(["checks"]);

    // The one-file fixture scans 0 files for the real-provider-isolation
    // check, which that check reports as a failure.
    expect(exitCode).toBe(1);
    expect(stdout).toContain("✗ Real-Provider-Isolation Guard");
    expect(stdout).toContain("kumiko-guards");
    expect(stdout).toContain("guards registered");
    const bannerCount = stdout.split("guards registered").length - 1;
    expect(bannerCount).toBe(1);
  });

  test("ui and guards with no args run their whole suite and exit 0 on the fixture repo", async () => {
    for (const suite of ["ui", "guards"]) {
      const { exitCode, stdout } = await runCliInFixtureRepo([suite]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("guards registered");
      expect(stdout).not.toContain("✗");
    }
  });

  test("guards --explain reaches run-guards' --explain branch through the bin instead of running the checks", async () => {
    const { exitCode, stdout } = await runCliInFixtureRepo(["guards", "--explain"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Repo:");
    expect(stdout).not.toContain("guards registered");
  });

  test("guards --strict-security-baseline reaches run-guards' security-only filter through the bin", async () => {
    const expectedCount = GUARDS.filter(isSecurityGuard).length;
    expect(expectedCount).toBeGreaterThan(0);
    expect(expectedCount).toBeLessThan(GUARDS.length);

    const { stdout } = await runCliInFixtureRepo(["guards", "--strict-security-baseline"]);

    expect(stdout).toContain(`${expectedCount} guards registered`);
  });

  test("guards --write-security-baseline reaches run-guards' baseline writer through the bin — the bug this fixes", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "cli-write-baseline-"));
    writeRepo(fixture, { name: "cli-write-baseline-fixture", layout: "flat" });
    try {
      const { exitCode, stdout } = await runCli(["guards", "--write-security-baseline"], {
        cwd: fixture,
      });
      const baselinePath = join(fixture, ".kumiko-security-baseline.json");

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Security baseline written");
      expect(existsSync(baselinePath)).toBe(true);
      const baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
      expect(baseline.repo).toBe("cli-write-baseline-fixture");
      expect(baseline.format).toBe(1);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
