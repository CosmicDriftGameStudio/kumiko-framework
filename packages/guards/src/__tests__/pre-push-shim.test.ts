import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// These tests exercise the checked-in hook file directly (not a copy) — a
// missing executable bit on it fails here the same way it would as a hook.
const HOOK_PATH = join(import.meta.dir, "..", "..", "hooks", "pre-push");

const {
  GIT_DIR,
  GIT_WORK_TREE,
  GIT_INDEX_FILE,
  GIT_PREFIX,
  GIT_COMMON_DIR,
  GIT_OBJECT_DIRECTORY,
  GIT_ALTERNATE_OBJECT_DIRECTORIES,
  GIT_CONFIG,
  GIT_CONFIG_GLOBAL,
  PRE_PUSH_SKIP,
  ...INHERITED_ENV
} = process.env;

function fixtureEnv(ceilingDir: string): Record<string, string> {
  return {
    ...INHERITED_ENV,
    GIT_CEILING_DIRECTORIES: ceilingDir,
    GIT_CONFIG_GLOBAL: "/dev/null",
  } as Record<string, string>;
}

function runGit(args: string[], cwd: string, ceilingDir: string): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: fixtureEnv(ceilingDir),
  });
  if (!result.success) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr.toString()}`);
  }
}

function initGitRepo(dir: string, ceilingDir: string): void {
  mkdirSync(dir, { recursive: true });
  runGit(["init", "-q", "."], dir, ceilingDir);
  runGit(
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=test",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ],
    dir,
    ceilingDir,
  );
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function stubBinScript(): string {
  return [
    "#!/usr/bin/env sh",
    'echo "BIN_RAN"',
    'echo "ARGS=$*"',
    'echo "PWD=$(pwd)"',
    "cat",
    "",
  ].join("\n");
}

function writeStubBin(binDir: string, content: string): void {
  mkdirSync(binDir, { recursive: true });
  writeExecutable(join(binDir, "kumiko-pre-push"), content);
}

function runHook(
  cwd: string,
  ceilingDir: string,
  args: string[] = [],
  stdin = "",
  extraEnv: Record<string, string> = {},
): { output: string; exitCode: number } {
  const result = Bun.spawnSync([HOOK_PATH, ...args], {
    cwd,
    env: { ...fixtureEnv(ceilingDir), ...extraEnv },
    stdin: Buffer.from(stdin),
  });
  return {
    output: result.stdout.toString() + result.stderr.toString(),
    exitCode: result.exitCode ?? 1,
  };
}

describe("hooks/pre-push shim", () => {
  let tmp: string;

  beforeEach(() => {
    // realpathSync: macOS resolves TMPDIR through /var -> /private/var, and
    // the hook's `git rev-parse --show-toplevel` output is already resolved —
    // without this the PWD=<repoDir> assertions below fail on path mismatch.
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-pre-push-shim-")));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("no node_modules anywhere above the repo fails closed with the bun install / PRE_PUSH_SKIP hint", () => {
    // The upward walk in the shim goes all the way to "/"; this only holds
    // if no real ancestor of the tmp fixture happens to carry the bin.
    let dir = tmp;
    while (true) {
      expect(existsSync(join(dir, "node_modules", ".bin", "kumiko-pre-push"))).toBe(false);
      if (dir === "/") break;
      dir = dirname(dir);
    }

    const repoDir = join(tmp, "repo");
    initGitRepo(repoDir, tmp);

    const { output, exitCode } = runHook(repoDir, tmp);

    expect(exitCode).not.toBe(0);
    const lines = output.trim().split("\n");
    expect(lines).toEqual([
      `[pre-push] kumiko-pre-push not found in any node_modules/.bin above ${repoDir}.`,
      "Run `bun install`, or set PRE_PUSH_SKIP=1 to bypass this hook.",
    ]);
  });

  test("PRE_PUSH_SKIP=1 with no bin anywhere exits 0", () => {
    const repoDir = join(tmp, "repo");
    initGitRepo(repoDir, tmp);

    const { output, exitCode } = runHook(repoDir, tmp, [], "", { PRE_PUSH_SKIP: "1" });

    expect(exitCode).toBe(0);
    expect(output).toContain("PRE_PUSH_SKIP=1");
  });

  test("repo-local bin is invoked from REPO_ROOT with args and stdin forwarded", () => {
    const repoDir = join(tmp, "repo");
    initGitRepo(repoDir, tmp);
    writeStubBin(join(repoDir, "node_modules", ".bin"), stubBinScript());
    mkdirSync(join(repoDir, "sub"), { recursive: true });

    const { output, exitCode } = runHook(
      join(repoDir, "sub"),
      tmp,
      ["origin", "https://x"],
      "refs/heads/a sha refs/heads/a sha\n",
    );

    expect(exitCode).toBe(0);
    expect(output).toContain("BIN_RAN");
    expect(output).toContain("ARGS=origin https://x");
    expect(output).toContain(`PWD=${repoDir}`);
    expect(output).toContain("refs/heads/a sha refs/heads/a sha");
  });

  test("non-zero exit from the bin propagates", () => {
    const repoDir = join(tmp, "repo");
    initGitRepo(repoDir, tmp);
    writeStubBin(
      join(repoDir, "node_modules", ".bin"),
      ["#!/usr/bin/env sh", "exit 7", ""].join("\n"),
    );

    const { exitCode } = runHook(repoDir, tmp);

    expect(exitCode).toBe(7);
  });

  test("bin in an ancestor's node_modules is used when the repo has none", () => {
    const parentDir = join(tmp, "parent");
    const repoDir = join(parentDir, "repo");
    initGitRepo(repoDir, tmp);
    writeStubBin(join(parentDir, "node_modules", ".bin"), stubBinScript());

    const { output, exitCode } = runHook(repoDir, tmp);

    expect(exitCode).toBe(0);
    expect(output).toContain("BIN_RAN");
    expect(output).toContain(`PWD=${repoDir}`);
  });

  test("a broken repo-local symlink is skipped in favor of an ancestor's bin", () => {
    const parentDir = join(tmp, "parent");
    const repoDir = join(parentDir, "repo");
    initGitRepo(repoDir, tmp);
    writeStubBin(join(parentDir, "node_modules", ".bin"), stubBinScript());

    const repoLocalBinDir = join(repoDir, "node_modules", ".bin");
    mkdirSync(repoLocalBinDir, { recursive: true });
    const brokenLink = join(repoLocalBinDir, "kumiko-pre-push");
    symlinkSync(join(repoLocalBinDir, "does-not-exist"), brokenLink);
    expect(lstatSync(brokenLink).isSymbolicLink()).toBe(true);
    expect(existsSync(brokenLink)).toBe(false);

    const { output, exitCode } = runHook(repoDir, tmp);

    expect(exitCode).toBe(0);
    expect(output).toContain("BIN_RAN");
    expect(output).toContain(`PWD=${repoDir}`);
  });
});
