import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSecurityGuard } from "../_lib/guard-kit";
import { GUARDS } from "../run-guards";
import { REPO_CHECKS } from "../run-repo-checks";
import { UI_GUARDS } from "../run-ui-guards";
import { writeRepo } from "./parent-workspace-fixture";

const CLI_PATH = join(import.meta.dir, "..", "cli.ts");

async function runCli(
  args: string[],
  opts: { readonly cwd?: string } = {},
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts.cwd,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("cli.ts — real process runs, no mocks", () => {
  test("an unknown subcommand exits 1 and lists the valid subcommands on stderr", async () => {
    const { exitCode, stderr } = await runCli(["nonsense"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("guards");
    expect(stderr).toContain("ui");
    expect(stderr).toContain("checks");
  });

  test("list prints the registration inventory as JSON, without running any suite", async () => {
    const { exitCode, stdout, stderr } = await runCli(["list"]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const inventory = JSON.parse(stdout) as {
      suites: {
        guards: { count: number; names: string[] };
        ui: { count: number; names: string[] };
        checks: { count: number; names: string[] };
      };
      total: number;
    };
    expect(inventory.suites.guards.count).toBe(GUARDS.length);
    expect(inventory.suites.ui.count).toBe(UI_GUARDS.length);
    expect(inventory.suites.checks.count).toBe(REPO_CHECKS.length);
    expect(inventory.suites.guards.names).toEqual(GUARDS.map((g) => g.name));
    expect(inventory.total).toBe(GUARDS.length + UI_GUARDS.length + REPO_CHECKS.length);
  });

  test("checks runs the repo-checks suite and prints the guard-kit banner", async () => {
    const { exitCode, stdout } = await runCli(["checks"]);

    expect([0, 1]).toContain(exitCode);
    expect(stdout).toContain("kumiko-guards");
    expect(stdout).toContain("guards registered");
    const bannerCount = stdout.split("guards registered").length - 1;
    expect(bannerCount).toBe(1);
  }, 30_000);

  test("guards --explain reaches run-guards' --explain branch through the bin instead of running the checks", async () => {
    const { exitCode, stdout } = await runCli(["guards", "--explain"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Repo:");
    expect(stdout).not.toContain("guards registered");
  }, 30_000);

  test("guards --strict-security-baseline reaches run-guards' security-only filter through the bin", async () => {
    const expectedCount = GUARDS.filter(isSecurityGuard).length;
    expect(expectedCount).toBeGreaterThan(0);
    expect(expectedCount).toBeLessThan(GUARDS.length);

    const { stdout } = await runCli(["guards", "--strict-security-baseline"]);

    expect(stdout).toContain(`${expectedCount} guards registered`);
  }, 30_000);

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
  }, 30_000);

  test("an unknown flag for guards exits 1 and lists guards' known flags on stderr, instead of being silently ignored", async () => {
    const { exitCode, stderr } = await runCli(["guards", "--bogus-flag"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown argument for "guards": --bogus-flag');
    expect(stderr).toContain("--explain");
    expect(stderr).toContain("--write-security-baseline");
    expect(stderr).toContain("--strict-security-baseline");
  });

  test("an unknown flag for ui exits 1 and reports ui has no known flags", async () => {
    const { exitCode, stderr } = await runCli(["ui", "--bogus-flag"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown argument for "ui": --bogus-flag');
    expect(stderr).toContain("(none)");
  });

  test("an unknown flag for checks exits 1 and reports checks has no known flags", async () => {
    const { exitCode, stderr } = await runCli(["checks", "--bogus-flag"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown argument for "checks": --bogus-flag');
    expect(stderr).toContain("(none)");
  });

  test("a single-dash typo (-strict-security-baseline) is rejected instead of silently running a non-strict guard pass", async () => {
    const { exitCode, stderr } = await runCli(["guards", "-strict-security-baseline"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown argument for "guards": -strict-security-baseline');
    expect(stderr).toContain("--strict-security-baseline");
  });

  test("a stray positional argument for guards exits 1 instead of being silently ignored", async () => {
    const { exitCode, stderr } = await runCli(["guards", "foo"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown argument for "guards": foo');
  });
});
