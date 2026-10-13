import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitEnv } from "../_lib/git-env";
import { resolvePushRepoRoot } from "../_lib/push-root";
import { writeRepo } from "./parent-workspace-fixture";

let stderrSpy: ReturnType<typeof spyOn<typeof console, "error">>;

beforeEach(() => {
  stderrSpy = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => stderrSpy.mockRestore());

describe("resolvePushRepoRoot", () => {
  test("returns the push root when its folder name is the CLI scope", () => {
    expect(
      resolvePushRepoRoot({
        KUMIKO_CLI_SCOPE: "kumiko-studio",
        KUMIKO_PUSH_REPO_ROOT: "/ws/kumiko-studio",
      }),
    ).toBe("/ws/kumiko-studio");
  });

  test("ignores a stale push root that names another repo", () => {
    expect(
      resolvePushRepoRoot({
        KUMIKO_CLI_SCOPE: "kumiko-studio",
        KUMIKO_PUSH_REPO_ROOT: "/ws/solon",
      }),
    ).toBeUndefined();
    expect(stderrSpy).toHaveBeenCalled();
  });

  test("ignores a push root exported without KUMIKO_CLI_SCOPE", () => {
    expect(resolvePushRepoRoot({ KUMIKO_PUSH_REPO_ROOT: "/ws/solon" })).toBeUndefined();
  });

  test("accepts a worktree judged by its canonical checkout name, not its folder name", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "push-root-")));
    try {
      const canonical = join(base, "kumiko-studio");
      const worktree = join(base, "parked", "unrelated-name");
      writeRepo(canonical, { name: "studio-package", layout: "flat" });
      mkdirSync(join(base, "parked"), { recursive: true });
      const git = (cwd: string, ...args: string[]) => {
        const proc = Bun.spawnSync(
          ["git", "-c", "user.email=t@t.test", "-c", "user.name=t", ...args],
          { cwd, env: gitEnv(), stderr: "pipe" },
        );
        if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
      };
      git(canonical, "init", "-q", "-b", "main");
      git(canonical, "add", "-A");
      git(canonical, "commit", "-q", "-m", "base");
      git(canonical, "worktree", "add", "-q", "-b", "feature", worktree);

      expect(
        resolvePushRepoRoot({ KUMIKO_CLI_SCOPE: "kumiko-studio", KUMIKO_PUSH_REPO_ROOT: worktree }),
      ).toBe(worktree);
      expect(
        resolvePushRepoRoot({ KUMIKO_CLI_SCOPE: "solon", KUMIKO_PUSH_REPO_ROOT: worktree }),
      ).toBeUndefined();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
