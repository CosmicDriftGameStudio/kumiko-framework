import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanGitEnv, runGit } from "../../_git-test-helpers";
import { envWithoutGitOverrides, GIT_LOCATION_ENV } from "../_spawn";

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

function initRepoWithBaseCommit(dir: string): void {
  runGit(["init", "-b", "main"], dir);
  runGit(["config", "user.email", "base@base"], dir);
  runGit(["config", "user.name", "Base"], dir);
  runGit(["commit", "--allow-empty", "-m", "base"], dir);
}

// The hostile location lives only in the child's OS environment; mutating process.env here would
// leak into whatever test shares this process under --no-isolate.
function runChildWithHostileEnv(victim: string): {
  victimBefore: number;
  victimAfter: number;
  workCommits: number;
  status: string;
} {
  const hostile: Record<string, string> = {};
  for (const key of GIT_LOCATION_ENV) hostile[key] = join(victim, ".git");
  hostile["GIT_WORK_TREE"] = victim;
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dir, "git-env-isolation.child.ts"), victim],
    { env: { ...process.env, ...hostile }, encoding: "utf-8" },
  );
  if (result.status !== 0) throw new Error(`child failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "");
}

describe("git env isolation", () => {
  test("neither runGit nor the productive run() can be redirected by an inherited git location", () => {
    const victim = tempDir("kumiko-victim-");
    initRepoWithBaseCommit(victim);

    const seen = runChildWithHostileEnv(victim);

    expect(seen.victimAfter).toBe(seen.victimBefore); // real repo untouched
    expect(seen.workCommits).toBe(1); // write landed in the temp cwd
    expect(seen.status).toBe("?? file.txt"); // run() saw the temp repo, not the victim
  });

  test("cleanGitEnv removes every git-location var and pins config, leaving the input alone", () => {
    const input: Record<string, string> = { KEEP: "1" };
    for (const key of GIT_LOCATION_ENV) input[key] = "/some/hostile/.git";
    const env = cleanGitEnv(input);
    for (const key of GIT_LOCATION_ENV) expect(env[key]).toBeUndefined();
    expect(env["KEEP"]).toBe("1");
    expect(env["GIT_CONFIG_GLOBAL"]).toBe("/dev/null");
    expect(env["GIT_CONFIG_SYSTEM"]).toBe("/dev/null");
    expect(input["GIT_DIR"]).toBe("/some/hostile/.git");
  });

  test("envWithoutGitOverrides strips GIT_COMMON_DIR as well", () => {
    const env = envWithoutGitOverrides({ GIT_COMMON_DIR: "/x/.git", PATH: "/bin" });
    expect(env["GIT_COMMON_DIR"]).toBeUndefined();
    expect(env["PATH"]).toBe("/bin");
  });
});
