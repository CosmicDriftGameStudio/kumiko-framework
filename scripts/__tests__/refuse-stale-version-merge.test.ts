import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "bun:test";

const SCRIPT_PATH = fileURLToPath(new URL("../refuse-stale-version-merge.sh", import.meta.url));

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: GIT_ENV, stdout: "pipe", stderr: "pipe" });
  if (!result.success) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function writeFile(dir: string, relPath: string, content: string) {
  const fullPath = join(dir, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function commitAll(repo: string, message: string): void {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message]);
}

function runGuard(cwd: string): { exitCode: number; output: string } {
  const result = Bun.spawnSync(["bash", SCRIPT_PATH], { cwd, env: GIT_ENV, stdout: "pipe", stderr: "pipe" });
  return { exitCode: result.exitCode ?? -1, output: result.stdout.toString().trim() };
}

const CHANGESET = '---\n"pkg": patch\n---\nx\n';

// main carries changeset x.md; the release branch consumes it in a "chore: version packages" commit.
function buildRepoWithReleaseBranch(): string {
  const repo = mkdtempSync(join(tmpdir(), "refuse-stale-version-merge-"));
  tempDirs.push(repo);
  git(repo, ["init", "-q", "-b", "main", "."]);
  writeFile(repo, "version.txt", "0.1.0\n");
  writeFile(repo, ".changeset/README.md", "readme\n");
  writeFile(repo, ".changeset/x.md", CHANGESET);
  commitAll(repo, "main with changeset x");
  git(repo, ["checkout", "-q", "-b", "changeset-release/main"]);
  writeFile(repo, "version.txt", "0.2.0\n");
  git(repo, ["rm", "-q", ".changeset/x.md"]);
  commitAll(repo, "chore: version packages");
  git(repo, ["checkout", "-q", "main"]);
  return repo;
}

function mergeReleaseBranch(repo: string): void {
  git(repo, ["merge", "-q", "--no-ff", "-m", "Merge pull request #1 from Org/changeset-release/main", "changeset-release/main"]);
}

describe("refuse-stale-version-merge.sh", () => {
  test("accepts a fresh Version PR merged as a merge commit", () => {
    const repo = buildRepoWithReleaseBranch();
    mergeReleaseBranch(repo);
    expect(runGuard(repo).exitCode).toBe(0);
  });

  test("refuses a Version PR merge commit that left a newer changeset unconsumed", () => {
    const repo = buildRepoWithReleaseBranch();
    writeFile(repo, ".changeset/y.md", CHANGESET);
    commitAll(repo, "changeset y landed after the version commit");
    mergeReleaseBranch(repo);

    const result = runGuard(repo);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(".changeset/y.md");
  });

  test("refuses a stale squash-merged Version PR", () => {
    const repo = buildRepoWithReleaseBranch();
    git(repo, ["checkout", "-q", "-b", "stale-squash", "main"]);
    writeFile(repo, "version.txt", "0.2.0\n");
    commitAll(repo, "chore: version packages (#2)");
    expect(runGuard(repo).exitCode).toBe(1);
  });

  test("passes through a commit that is not a version merge", () => {
    const repo = buildRepoWithReleaseBranch();
    writeFile(repo, "other.txt", "x\n");
    commitAll(repo, "feat: ordinary change");
    const result = runGuard(repo);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("not a version commit");
  });
});
