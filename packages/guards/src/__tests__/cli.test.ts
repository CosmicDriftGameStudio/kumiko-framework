import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GUARDS } from "../run-guards";
import { REPO_CHECKS } from "../run-repo-checks";
import { UI_GUARDS } from "../run-ui-guards";
import { runCli } from "./run-cli";

describe("cli.ts — real process runs, no mocks", () => {
  test("an unknown subcommand exits 1 and lists the valid subcommands on stderr", async () => {
    const { exitCode, stderr } = await runCli(["nonsense"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("guards");
    expect(stderr).toContain("ui");
    expect(stderr).toContain("checks");
  });

  test("<subcommand> --help prints the help and exits 0 instead of failing as an unknown flag", async () => {
    const { exitCode, stdout, stderr } = await runCli(["guards", "--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: kumiko-guards");
    expect(stderr).toBe("");
  });

  test("licenses, security and outdated are registered, take --report and reject other flags", async () => {
    const { stdout } = await runCli(["--help"]);
    for (const sub of ["licenses", "security", "outdated"]) {
      expect(stdout).toContain(`${sub} [--report]`);
      const { exitCode, stderr } = await runCli([sub, "--nope"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Unknown argument");
    }
  });

  test("list rejects unknown flags instead of silently ignoring them", async () => {
    const { exitCode, stdout, stderr } = await runCli(["list", "--nope"]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Unknown argument");
    expect(stderr).toContain("(none)");
  });

  test("list prints the registration inventory as JSON, without running any suite", async () => {
    const { exitCode, stdout, stderr } = await runCli(["list"]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const inventory = JSON.parse(stdout) as {
      version: string;
      suites: {
        guards: { count: number; names: string[] };
        ui: { count: number; names: string[] };
        checks: { count: number; names: string[] };
      };
      total: number;
    };
    expect(GUARDS.length).toBeGreaterThan(0);
    expect(UI_GUARDS.length).toBeGreaterThan(0);
    expect(REPO_CHECKS.length).toBeGreaterThan(0);
    expect(inventory.suites.guards.count).toBe(GUARDS.length);
    expect(inventory.suites.ui.count).toBe(UI_GUARDS.length);
    expect(inventory.suites.checks.count).toBe(REPO_CHECKS.length);
    expect(inventory.suites.guards.names).toEqual(GUARDS.map((g) => g.name));
    expect(inventory.suites.ui.names).toEqual(UI_GUARDS.map((g) => g.name));
    expect(inventory.suites.checks.names).toEqual(REPO_CHECKS.map((c) => c.name));
    expect(inventory.total).toBe(GUARDS.length + UI_GUARDS.length + REPO_CHECKS.length);
    const pkg: { version: string } = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf8"),
    );
    expect(inventory.version).toBe(pkg.version);
  });

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

  test("an unknown flag for checks exits 1 and reports the known checks flags", async () => {
    const { exitCode, stderr } = await runCli(["checks", "--bogus-flag"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown argument for "checks": --bogus-flag');
    expect(stderr).toContain("--write-baseline");
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
