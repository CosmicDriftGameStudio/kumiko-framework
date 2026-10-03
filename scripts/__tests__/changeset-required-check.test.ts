// changeset-required-check.sh is shared by CI and the worktree pre-push hook
// (scripts/check-wt.sh); the branch exemptions and the consumer-repo skip live in
// the script itself. Real git in a temp repo, real `changeset status` through a
// node_modules symlink to this repo's install.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "scripts", "changeset-required-check.sh");
const CHECK_WT = join(REPO_ROOT, "scripts", "check-wt.sh");

let dir: string;

function git(...args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
}

function write(relative: string, content: string): void {
  const target = join(dir, relative);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
}

function initRepo({ withChangesetConfig }: { withChangesetConfig: boolean }): void {
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(SCRIPT, join(dir, "scripts", "changeset-required-check.sh"));
  write("package.json", JSON.stringify({ name: "fixture-root", private: true, workspaces: ["packages/*"] }));
  write("packages/foo/package.json", JSON.stringify({ name: "@fixture/foo", version: "1.0.0" }));
  write("packages/foo/index.ts", "export const a = 1;\n");
  if (withChangesetConfig) {
    write(".changeset/config.json", JSON.stringify({ changelog: false, commit: false, access: "public", baseBranch: "main" }));
    symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"));
  }
  write(".gitignore", "node_modules\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  // The script diffs against origin/main; a ref is enough, no remote needed.
  git("update-ref", "refs/remotes/origin/main", "HEAD");
}

function commitPackageChange(branch: string): void {
  git("checkout", "-q", "-b", branch);
  write("packages/foo/index.ts", "export const a = 2;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "change");
}

function runCheck(env: Record<string, string> = {}) {
  const result = Bun.spawnSync(["bash", "scripts/changeset-required-check.sh"], {
    cwd: dir,
    env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", BASE_REF: "main", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, output: `${result.stdout.toString()}${result.stderr.toString()}` };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "changeset-required-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("changeset-required-check.sh", () => {
  test.each(["renovate/lockfile-maintenance", "changeset-release/main"])(
    "branch %s is exempt even with a changed package and no changeset",
    (branch) => {
      initRepo({ withChangesetConfig: true });
      commitPackageChange("tmp-work");
      const viaEnv = runCheck({ HEAD_REF: branch });
      expect(viaEnv.code).toBe(0);
      expect(viaEnv.output).toContain(`skipped for branch ${branch}`);
    },
  );

  test("the checked-out branch decides when HEAD_REF is unset", () => {
    initRepo({ withChangesetConfig: true });
    commitPackageChange("renovate/some-dep");
    const result = runCheck();
    expect(result.code).toBe(0);
    expect(result.output).toContain("skipped for branch renovate/some-dep");
  });

  test("a repo without .changeset/config.json is skipped", () => {
    initRepo({ withChangesetConfig: false });
    commitPackageChange("feature/x");
    const result = runCheck();
    expect(result.code).toBe(0);
    expect(result.output).toContain("no .changeset/config.json");
  });

  test("a changed package without a changeset fails with the named package", () => {
    initRepo({ withChangesetConfig: true });
    commitPackageChange("feature/x");
    const result = runCheck();
    expect(result.code).toBe(1);
    expect(result.output).toContain("No changeset found for changed package(s): @fixture/foo");
  });

  test("the same change with a changeset passes", () => {
    initRepo({ withChangesetConfig: true });
    commitPackageChange("feature/x");
    write(".changeset/fix-foo.md", '---\n"@fixture/foo": patch\n---\n\nFix foo.\n');
    git("add", "-A");
    git("commit", "-q", "-m", "changeset");
    expect(runCheck().code).toBe(0);
  });

  test("a malformed HEAD_REF is rejected like BASE_REF", () => {
    initRepo({ withChangesetConfig: true });
    const result = runCheck({ HEAD_REF: "bad ref;rm" });
    expect(result.code).toBe(1);
    expect(result.output).toContain("HEAD_REF has an unexpected shape");
  });
});

describe("check-wt.sh entry points", () => {
  const checkWt = readFileSync(CHECK_WT, "utf-8");
  const ci = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf-8");

  test("runs the AST guard suite entry that kumiko check's guards step uses", () => {
    expect(checkWt).toContain("bun packages/guards/src/run-guards.ts");
    expect(readFileSync(join(REPO_ROOT, "packages/cli/src/commands/check.ts"), "utf-8")).toContain(
      "runGuardsCli([])",
    );
  });

  test("runs the CI changeset script against main", () => {
    expect(checkWt).toContain("BASE_REF=main bash scripts/changeset-required-check.sh");
    expect(ci).toContain("bash scripts/changeset-required-check.sh");
  });

  test("CI passes HEAD_REF and keeps no branch exemptions of its own", () => {
    const step = ci.slice(ci.indexOf("- name: Changeset required"));
    const stepBlock = step.slice(0, step.indexOf("- name: Run tests"));
    expect(stepBlock).toContain("HEAD_REF: ${{ github.head_ref }}");
    expect(stepBlock).not.toContain("renovate/");
    expect(stepBlock).not.toContain("changeset-release/main");
  });
});
