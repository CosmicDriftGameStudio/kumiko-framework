import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanGitEnv, runGit } from "../../_git-test-helpers";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function commitCount(dir: string): number {
  // Read with a cleaned env too: a hostile ambient GIT_DIR would otherwise make
  // `git -C <dir>` report the victim's count instead of <dir>'s.
  const result = spawnSync("git", ["-C", dir, "rev-list", "--count", "HEAD"], {
    env: cleanGitEnv(),
    encoding: "utf-8",
  });
  return Number.parseInt(result.stdout.trim(), 10);
}

function initRepoWithBaseCommit(dir: string): void {
  runGit(["init", "-b", "main"], dir);
  runGit(["config", "user.email", "base@base"], dir);
  runGit(["config", "user.name", "Base"], dir);
  runGit(["commit", "--allow-empty", "-m", "base"], dir);
}

describe("git env isolation (regression for #197/#185)", () => {
  test("runGit cannot be redirected by a hostile inherited GIT_DIR", () => {
    const victim = tempDir("kumiko-victim-");
    initRepoWithBaseCommit(victim);
    const victimBaseline = commitCount(victim);

    const savedGitDir = process.env["GIT_DIR"];
    const savedWorkTree = process.env["GIT_WORK_TREE"];
    try {
      // Simulate the pre-push hook env: git is pointed at the "real" repo.
      process.env["GIT_DIR"] = join(victim, ".git");
      process.env["GIT_WORK_TREE"] = victim;

      const work = tempDir("kumiko-work-");
      runGit(["init", "-b", "main"], work);
      runGit(["config", "user.email", "test@test"], work);
      runGit(["config", "user.name", "Test"], work);
      runGit(["commit", "--allow-empty", "-m", "init"], work);

      expect(commitCount(victim)).toBe(victimBaseline); // real repo untouched
      expect(commitCount(work)).toBe(1); // write landed in the temp cwd
    } finally {
      if (savedGitDir === undefined) delete process.env["GIT_DIR"];
      else process.env["GIT_DIR"] = savedGitDir;
      if (savedWorkTree === undefined) delete process.env["GIT_WORK_TREE"];
      else process.env["GIT_WORK_TREE"] = savedWorkTree;
    }
  });

  test("cleanGitEnv removes inherited git-location vars and pins config", () => {
    const savedGitDir = process.env["GIT_DIR"];
    try {
      process.env["GIT_DIR"] = "/some/hostile/.git";
      const env = cleanGitEnv();
      expect(env["GIT_DIR"]).toBeUndefined();
      expect(env["GIT_CONFIG_GLOBAL"]).toBe("/dev/null");
      expect(env["GIT_CONFIG_SYSTEM"]).toBe("/dev/null");
      // The real process.env is left untouched.
      expect(process.env["GIT_DIR"]).toBe("/some/hostile/.git");
    } finally {
      if (savedGitDir === undefined) delete process.env["GIT_DIR"];
      else process.env["GIT_DIR"] = savedGitDir;
    }
  });
});
