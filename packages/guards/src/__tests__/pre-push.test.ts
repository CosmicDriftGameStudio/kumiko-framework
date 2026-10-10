import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExecutablePool } from "./executable-pool";

// #3152: pre-push.sh is the POSIX-sh port of the former .husky/pre-push hook,
// shipped as a bin (kumiko-pre-push) so every repo can wire it via a thin
// shim instead of vendoring the logic. These tests exercise the real script
// at its package path (not a chmod'd copy), so a missing executable bit on
// the checked-in file fails here the same way it would in a real hook.
//
// A git hook sets GIT_DIR/GIT_WORK_TREE in its process environment; those
// vars survive into a child `bun test` run and override any `cwd` passed to
// spawned git commands. Every git subprocess below strips the inherited git
// env and pins GIT_CEILING_DIRECTORIES/GIT_CONFIG_GLOBAL to the fixture tree,
// so a run triggered by this very repo's pre-push hook can never touch the
// real repo, even by accident.

const HOOK_PATH = join(import.meta.dir, "..", "pre-push.sh");

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
  // The hook sets these itself; inherited from a run under this repo's own
  // pre-push they would leak into the fixture and break "must be unset"
  // assertions below.
  KUMIKO_CLI_SCOPE,
  KUMIKO_PUSH_REPO_ROOT,
  KUMIKO_PUSH_PARENT_DIR,
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

let fixtureRoot = "";
let templateRepoDir = "";
let writeExecutable: (path: string, content: string) => void = () => {
  throw new Error("fixtures not initialised");
};

beforeAll(() => {
  fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-pre-push-fixtures-")));
  writeExecutable = createExecutablePool(join(fixtureRoot, "executables"));
  templateRepoDir = join(fixtureRoot, "template-repo");
  mkdirSync(templateRepoDir);
  runGit(["init", "-q", "."], templateRepoDir, fixtureRoot);
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
    templateRepoDir,
    fixtureRoot,
  );
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

// Copying a committed template avoids two git spawns per test.
function initGitRepo(dir: string): void {
  cpSync(templateRepoDir, dir, { recursive: true });
}

// Tracked means "in the index" — no commit needed for `git ls-files --error-unmatch` to see it.
function writeTracked(dir: string, relPath: string, content: string, ceilingDir: string): void {
  const path = join(dir, relPath);
  mkdirSync(join(dir, relPath, ".."), { recursive: true });
  writeExecutable(path, content);
  runGit(["add", relPath], dir, ceilingDir);
}

function writeUntrackedExecutable(dir: string, relPath: string, content: string): void {
  const path = join(dir, relPath);
  mkdirSync(join(dir, relPath, ".."), { recursive: true });
  writeExecutable(path, content);
}

function runHook(
  cwd: string,
  ceilingDir: string,
  extraEnv: Record<string, string> = {},
): { output: string; exitCode: number } {
  const result = Bun.spawnSync([HOOK_PATH], {
    cwd,
    env: { ...fixtureEnv(ceilingDir), ...extraEnv },
  });
  return {
    output: result.stdout.toString() + result.stderr.toString(),
    exitCode: result.exitCode ?? 1,
  };
}

const KUMIKO_STUB = [
  'console.log("MAIN_CHECK_RAN");',
  'console.log("MAIN_ARGV=" + process.argv.slice(2).join(","));',
  'console.log("MAIN_KUMIKO_CLI_SCOPE=" + (process.env.KUMIKO_CLI_SCOPE ?? "<unset>"));',
  'console.log("MAIN_KUMIKO_PUSH_REPO_ROOT=" + (process.env.KUMIKO_PUSH_REPO_ROOT ?? "<unset>"));',
  'console.log("MAIN_KUMIKO_PUSH_PARENT_DIR=" + (process.env.KUMIKO_PUSH_PARENT_DIR ?? "<unset>"));',
  'console.log("MAIN_GIT_DIR=" + (process.env.GIT_DIR ?? "<unset>"));',
  "",
].join("\n");

// Hooks run with the repo root as cwd; logging there keeps the script content
// identical across tests so the executable can be shared.
const HOOK_LOG_NAME = "hook-order.log";

function extraScript(): string {
  return [
    "#!/usr/bin/env sh",
    `echo "EXTRA_RAN" >> "$PWD/${HOOK_LOG_NAME}"`,
    'echo "EXTRA_ARGS=$*"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: POSIX sh var expansion, not a JS template literal
    'echo "EXTRA_KUMIKO_PUSH_REPO_ROOT=${KUMIKO_PUSH_REPO_ROOT-<unset>}"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: POSIX sh var expansion, not a JS template literal
    'echo "EXTRA_KUMIKO_PUSH_PARENT_DIR=${KUMIKO_PUSH_PARENT_DIR-<unset>}"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: POSIX sh var expansion, not a JS template literal
    'echo "EXTRA_GIT_DIR=${GIT_DIR-<unset>}"',
    "",
  ].join("\n");
}

function extraFailingScript(): string {
  return ["#!/usr/bin/env sh", 'echo "EXTRA_FAIL_RAN"', "exit 1", ""].join("\n");
}

function checkWtScript(): string {
  return ["#!/usr/bin/env sh", `echo "CHECKWT_RAN" >> "$PWD/${HOOK_LOG_NAME}"`, "exit 0", ""].join(
    "\n",
  );
}

function fixtureTestScript(): string {
  return [
    "#!/usr/bin/env sh",
    "echo MARKER_A > marker-a.txt",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: POSIX sh var expansion, not a JS template literal
    'echo "TEST_KUMIKO_PUSH_REPO_ROOT=${KUMIKO_PUSH_REPO_ROOT-<unset>}"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: POSIX sh var expansion, not a JS template literal
    'echo "TEST_KUMIKO_PUSH_PARENT_DIR=${KUMIKO_PUSH_PARENT_DIR-<unset>}"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: POSIX sh var expansion, not a JS template literal
    'echo "TEST_GIT_DIR=${GIT_DIR-<unset>}"',
    "",
  ].join("\n");
}

function writeStandaloneRepo(dir: string): void {
  initGitRepo(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "standalone", scripts: { test: "sh fixture-test.sh" } }),
  );
  writeExecutable(join(dir, "fixture-test.sh"), fixtureTestScript());
  writeFileSync(
    join(dir, "x.test.ts"),
    ['import { writeFileSync } from "node:fs";', 'writeFileSync("marker-b.txt", "B");', ""].join(
      "\n",
    ),
  );
}

function writeParentWorkspace(tmp: string): { parentDir: string; repoDir: string } {
  const parentDir = join(tmp, "parent");
  mkdirSync(parentDir, { recursive: true });
  writeFileSync(join(parentDir, "package.json"), JSON.stringify({ name: "cosmicdriftgamestudio" }));

  const repoDir = join(parentDir, "kumiko-framework");
  mkdirSync(join(parentDir, "kumiko-framework", "bin"), { recursive: true });
  writeFileSync(join(parentDir, "kumiko-framework", "bin", "kumiko.ts"), KUMIKO_STUB);
  return { parentDir, repoDir };
}

function writeWorktreePackageJson(dir: string, scripts: Record<string, string>): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts }));
}

// Each script writes a marker file in the cwd it ran with, so tests can
// confirm the worktree branch ran these in the worktree itself.
const WORKTREE_MARKER_SCRIPTS = {
  typecheck: "echo MARKER_TYPECHECK > marker-typecheck.txt",
  lint: "echo MARKER_LINT > marker-lint.txt",
  test: "echo MARKER_TEST > marker-test.txt",
  "test:dom": "echo MARKER_TESTDOM > marker-testdom.txt",
};

describe("kumiko-pre-push", () => {
  let tmp: string;

  beforeEach(() => {
    // realpathSync: macOS resolves TMPDIR through /var -> /private/var, and
    // git's --git-common-dir output is already fully resolved — without
    // this the startsWith() check below fails on a path that's genuinely
    // inside the fixture tree.
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-pre-push-")));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("parent-workspace detection", () => {
    test("worktree under .wt/<name> without check-wt.sh runs its own package.json scripts, not the parent branch", () => {
      const { parentDir, repoDir } = writeParentWorkspace(tmp);
      initGitRepo(repoDir);

      const worktreeDir = join(parentDir, ".wt", "fw-3152");
      runGit(["worktree", "add", "-q", "-b", "test-branch", worktreeDir], repoDir, tmp);

      expect(
        Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
          cwd: worktreeDir,
          env: fixtureEnv(tmp),
        })
          .stdout.toString()
          .trim(),
      ).toStartWith(tmp);

      writeWorktreePackageJson(worktreeDir, WORKTREE_MARKER_SCRIPTS);

      const { output, exitCode } = runHook(worktreeDir, tmp);

      expect(output).toContain("worktree without scripts/check-wt.sh");
      expect(output).not.toContain("MAIN_CHECK_RAN");
      expect(output).not.toContain("bun check (scoped:");
      expect(output).not.toContain("scoped: fw-3152");
      expect(readFileSync(join(worktreeDir, "marker-typecheck.txt"), "utf-8")).toContain(
        "MARKER_TYPECHECK",
      );
      expect(readFileSync(join(worktreeDir, "marker-lint.txt"), "utf-8")).toContain("MARKER_LINT");
      expect(readFileSync(join(worktreeDir, "marker-test.txt"), "utf-8")).toContain("MARKER_TEST");
      expect(readFileSync(join(worktreeDir, "marker-testdom.txt"), "utf-8")).toContain(
        "MARKER_TESTDOM",
      );
      expect(exitCode).toBe(0);
    });

    test("regular checkout one level under the parent still takes the parent branch", () => {
      const { repoDir } = writeParentWorkspace(tmp);
      initGitRepo(repoDir);

      const { output, exitCode } = runHook(repoDir, tmp);

      expect(output).toContain("bun check (scoped: kumiko-framework)");
      expect(output).toContain("MAIN_KUMIKO_CLI_SCOPE=kumiko-framework");
      expect(exitCode).toBe(0);
    });

    test("PRE_PUSH_SKIP=1 skips the hook before any check runs and exits 0", () => {
      const { repoDir } = writeParentWorkspace(tmp);
      initGitRepo(repoDir);

      const { output, exitCode } = runHook(repoDir, tmp, { PRE_PUSH_SKIP: "1" });

      expect(output).toContain("hook skipped");
      expect(output).not.toContain("MAIN_CHECK_RAN");
      expect(exitCode).toBe(0);
    });

    test("standalone clone with no cosmicdriftgamestudio ancestor falls back to the package.json test script", () => {
      const standaloneDir = join(tmp, "standalone-clone");
      writeStandaloneRepo(standaloneDir);

      const { output, exitCode } = runHook(standaloneDir, tmp);

      expect(output).toContain("bun run test (standalone)");
      expect(readFileSync(join(standaloneDir, "marker-a.txt"), "utf-8")).toContain("MARKER_A");
      expect(exitCode).toBe(0);
    });
  });

  describe("standalone runs the package.json test script, not a bare bun test", () => {
    test("marker A from the script is written, marker B from a stray *.test.ts is not", async () => {
      const standaloneDir = join(tmp, "standalone-script");
      writeStandaloneRepo(standaloneDir);

      const { exitCode } = runHook(standaloneDir, tmp);

      expect(exitCode).toBe(0);
      expect(Bun.file(join(standaloneDir, "marker-a.txt")).size).toBeGreaterThan(0);
      expect(await Bun.file(join(standaloneDir, "marker-b.txt")).exists()).toBe(false);
    });
  });

  describe("standalone clone without a usable test script refuses the push", () => {
    test("package.json without scripts.test", () => {
      const standaloneDir = join(tmp, "standalone-no-test-script");
      initGitRepo(standaloneDir);
      writeFileSync(
        join(standaloneDir, "package.json"),
        JSON.stringify({ name: "x", scripts: { lint: "true" } }),
      );

      const { output, exitCode } = runHook(standaloneDir, tmp);

      expect(exitCode).not.toBe(0);
      expect(output).toContain('without a package.json "test" script');
      expect(output).not.toContain("was not found");
      expect(output).not.toContain("Script not found");
    });

    test("no package.json at all", () => {
      const standaloneDir = join(tmp, "standalone-no-package-json");
      initGitRepo(standaloneDir);

      const { output, exitCode } = runHook(standaloneDir, tmp);

      expect(exitCode).not.toBe(0);
      expect(output).toContain('without a package.json "test" script');
      expect(output).not.toContain("was not found");
      expect(output).not.toContain("Script not found");
    });

    test("a throwing top-level bunfig preload does not fake a missing test script", () => {
      const standaloneDir = join(tmp, "standalone-throwing-preload");
      writeStandaloneRepo(standaloneDir);
      writeFileSync(join(standaloneDir, "bunfig.toml"), 'preload = ["./boom.ts"]\n');
      writeFileSync(join(standaloneDir, "boom.ts"), 'throw new Error("boom");\n');

      const { output } = runHook(standaloneDir, tmp);

      expect(output).not.toContain('without a package.json "test" script');
      expect(readFileSync(join(standaloneDir, "marker-a.txt"), "utf-8")).toContain("MARKER_A");
    });
  });

  describe("scripts/check-wt.sh", () => {
    test("untracked but executable check-wt.sh is not run", () => {
      const { parentDir, repoDir } = writeParentWorkspace(tmp);
      initGitRepo(repoDir);
      const worktreeDir = join(parentDir, ".wt", "fw-3152");
      runGit(["worktree", "add", "-q", "-b", "test-branch", worktreeDir], repoDir, tmp);

      writeUntrackedExecutable(
        worktreeDir,
        "scripts/check-wt.sh",
        ["#!/usr/bin/env sh", 'echo "CHECKWT_RAN"', "exit 0", ""].join("\n"),
      );

      const { output } = runHook(worktreeDir, tmp);

      expect(output).not.toContain("worktree detected");
      expect(output).not.toContain("CHECKWT_RAN");
      expect(output).toContain("worktree without scripts/check-wt.sh");
      expect(output).not.toContain("MAIN_CHECK_RAN");
    });
  });

  describe("worktree without scripts/check-wt.sh runs package.json scripts", () => {
    function setupWorktree(scripts: Record<string, string>): string {
      const { parentDir, repoDir } = writeParentWorkspace(tmp);
      initGitRepo(repoDir);
      const worktreeDir = join(parentDir, ".wt", "fw-3152");
      runGit(["worktree", "add", "-q", "-b", "test-branch", worktreeDir], repoDir, tmp);
      writeWorktreePackageJson(worktreeDir, scripts);
      return worktreeDir;
    }

    test("a failing script is reported, but later declared scripts still run", () => {
      const worktreeDir = setupWorktree({
        typecheck: "exit 1",
        test: WORKTREE_MARKER_SCRIPTS.test,
      });

      const { output, exitCode } = runHook(worktreeDir, tmp);

      expect(exitCode).not.toBe(0);
      expect(output).toContain("[pre-push] worktree check failed: typecheck");
      expect(readFileSync(join(worktreeDir, "marker-test.txt"), "utf-8")).toContain("MARKER_TEST");
    });

    test("undeclared optional scripts are skipped, only test runs", () => {
      const worktreeDir = setupWorktree({ test: WORKTREE_MARKER_SCRIPTS.test });

      const { output, exitCode } = runHook(worktreeDir, tmp);

      expect(exitCode).toBe(0);
      expect(output).toContain("typecheck: no script, skipped");
      expect(output).toContain("lint: no script, skipped");
      expect(output).toContain("test:dom: no script, skipped");
      expect(readFileSync(join(worktreeDir, "marker-test.txt"), "utf-8")).toContain("MARKER_TEST");
    });

    test("a worktree without a test script refuses the push", () => {
      const worktreeDir = setupWorktree({ lint: "true" });

      const { output, exitCode } = runHook(worktreeDir, tmp);

      expect(exitCode).not.toBe(0);
      expect(output).toContain('FATAL: worktree without a package.json "test" script');
      expect(output).not.toContain("MAIN_CHECK_RAN");
    });

    function writeFakeGuardBin(worktreeDir: string, name: string, exitCode: number): string {
      const logName = `${name}.log`;
      writeUntrackedExecutable(
        worktreeDir,
        `node_modules/.bin/${name}`,
        ["#!/usr/bin/env sh", `echo "$*" >> "$PWD/${logName}"`, `exit ${exitCode}`, ""].join("\n"),
      );
      return join(worktreeDir, logName);
    }

    test("guard bins run with CI arguments when resolvable", () => {
      const worktreeDir = setupWorktree({ test: WORKTREE_MARKER_SCRIPTS.test });
      const guardsLog = writeFakeGuardBin(worktreeDir, "kumiko-guards", 0);

      const { exitCode } = runHook(worktreeDir, tmp);

      expect(exitCode).toBe(0);
      expect(readFileSync(guardsLog, "utf-8").trim().split("\n")).toEqual([
        "guards",
        "checks",
        "comment-lang --touched --base=origin/main",
      ]);
    });

    test("a failing guard bin refuses the push and is named in the failure line", () => {
      const worktreeDir = setupWorktree({ test: WORKTREE_MARKER_SCRIPTS.test });
      const guardsLog = writeFakeGuardBin(worktreeDir, "kumiko-guards", 1);

      const { output, exitCode } = runHook(worktreeDir, tmp);

      expect(exitCode).toBe(1);
      expect(output).toContain("[pre-push] worktree check failed: guards checks comment-lang");
      expect(readFileSync(guardsLog, "utf-8")).toContain("comment-lang --touched");
    });

    test("unresolvable guard bins are skipped with a hint, not fatal", () => {
      const worktreeDir = setupWorktree({ test: WORKTREE_MARKER_SCRIPTS.test });

      const { output, exitCode } = runHook(worktreeDir, tmp);

      expect(exitCode).toBe(0);
      expect(output).toContain("kumiko-guards: not resolvable in worktree/parent, skipped");
      expect(output).not.toContain("FATAL");
    });
  });

  describe("scripts/pre-push-extra.sh", () => {
    test("untracked but executable extra is not run", async () => {
      const standaloneDir = join(tmp, "standalone-extra-untracked");
      writeStandaloneRepo(standaloneDir);
      writeUntrackedExecutable(standaloneDir, "scripts/pre-push-extra.sh", extraScript());

      const { output, exitCode } = runHook(standaloneDir, tmp);

      expect(output).not.toContain("EXTRA_RAN");
      expect(exitCode).toBe(0);
      expect(await Bun.file(join(standaloneDir, HOOK_LOG_NAME)).exists()).toBe(false);
    });

    test("tracked extra exiting non-zero aborts before the main check", () => {
      const standaloneDir = join(tmp, "standalone-extra-fail");
      writeStandaloneRepo(standaloneDir);
      writeTracked(standaloneDir, "scripts/pre-push-extra.sh", extraFailingScript(), tmp);

      const { output, exitCode } = runHook(standaloneDir, tmp);

      expect(output).toContain("EXTRA_FAIL_RAN");
      expect(output).not.toContain("MARKER_A");
      expect(exitCode).not.toBe(0);
    });

    test("tracked extra runs before scripts/check-wt.sh in the worktree branch", () => {
      const { parentDir, repoDir } = writeParentWorkspace(tmp);
      initGitRepo(repoDir);
      const worktreeDir = join(parentDir, ".wt", "fw-3152");
      runGit(["worktree", "add", "-q", "-b", "test-branch", worktreeDir], repoDir, tmp);

      writeTracked(worktreeDir, "scripts/pre-push-extra.sh", extraScript(), tmp);
      writeTracked(worktreeDir, "scripts/check-wt.sh", checkWtScript(), tmp);

      const { exitCode } = runHook(worktreeDir, tmp);

      expect(exitCode).toBe(0);
      const logContent = readFileSync(join(worktreeDir, HOOK_LOG_NAME), "utf-8");
      expect(logContent.indexOf("EXTRA_RAN")).toBeGreaterThanOrEqual(0);
      expect(logContent.indexOf("CHECKWT_RAN")).toBeGreaterThan(logContent.indexOf("EXTRA_RAN"));
    });

    test("extra sees KUMIKO_PUSH_REPO_ROOT/PARENT_DIR, main check sees only REPO_ROOT", () => {
      const { parentDir, repoDir } = writeParentWorkspace(tmp);
      initGitRepo(repoDir);
      writeTracked(repoDir, "scripts/pre-push-extra.sh", extraScript(), tmp);

      const { output } = runHook(repoDir, tmp);

      expect(output).toContain(`EXTRA_KUMIKO_PUSH_REPO_ROOT=${repoDir}`);
      expect(output).toContain(`EXTRA_KUMIKO_PUSH_PARENT_DIR=${parentDir}`);
      expect(output).toContain(`MAIN_KUMIKO_PUSH_REPO_ROOT=${repoDir}`);
      expect(output).toContain("MAIN_KUMIKO_PUSH_PARENT_DIR=<unset>");
    });

    test("standalone: extra sees an empty KUMIKO_PUSH_PARENT_DIR, test script sees none", () => {
      const standaloneDir = join(tmp, "standalone-env");
      writeStandaloneRepo(standaloneDir);
      writeTracked(standaloneDir, "scripts/pre-push-extra.sh", extraScript(), tmp);

      const { output } = runHook(standaloneDir, tmp);

      expect(output).toContain(`EXTRA_KUMIKO_PUSH_REPO_ROOT=${standaloneDir}`);
      expect(output).toContain("EXTRA_KUMIKO_PUSH_PARENT_DIR=");
      expect(output).not.toContain("EXTRA_KUMIKO_PUSH_PARENT_DIR=<unset>");
      expect(output).toContain("TEST_KUMIKO_PUSH_PARENT_DIR=<unset>");
    });

    test("a GIT_DIR set in the hook's own environment does not leak into extra or the test script", () => {
      const standaloneDir = join(tmp, "standalone-gitdir-leak");
      writeStandaloneRepo(standaloneDir);
      writeTracked(standaloneDir, "scripts/pre-push-extra.sh", extraScript(), tmp);

      const { output } = runHook(standaloneDir, tmp, { GIT_DIR: join(standaloneDir, ".git") });

      expect(output).toContain("EXTRA_GIT_DIR=<unset>");
      expect(output).toContain("TEST_GIT_DIR=<unset>");
    });

    test("extra receives the hook's positional arguments", () => {
      const standaloneDir = join(tmp, "standalone-argv");
      writeStandaloneRepo(standaloneDir);
      writeTracked(standaloneDir, "scripts/pre-push-extra.sh", extraScript(), tmp);

      const result = Bun.spawnSync([HOOK_PATH, "origin", "refs/heads/main"], {
        cwd: standaloneDir,
        env: fixtureEnv(tmp),
      });
      const output = result.stdout.toString() + result.stderr.toString();

      expect(output).toContain("EXTRA_ARGS=origin refs/heads/main");
    });
  });

  describe("upgrade-state guard", () => {
    function writeMarker(dir: string, version: string): void {
      mkdirSync(join(dir, ".kumiko"), { recursive: true });
      writeFileSync(join(dir, ".kumiko", "upgrade-state.json"), JSON.stringify({ version }));
    }

    test("no marker — guard is not run, main check still runs", () => {
      const standaloneDir = join(tmp, "standalone-no-marker");
      writeStandaloneRepo(standaloneDir);

      const { output, exitCode } = runHook(standaloneDir, tmp);

      expect(output).not.toContain("upgrade-state guard");
      expect(output).toContain("bun run test (standalone)");
      expect(exitCode).toBe(0);
    });

    test("marker present, guard fails (no kumiko-upgrade bin installed) — push refused before the main check", () => {
      const standaloneDir = join(tmp, "standalone-marker-guard-fails");
      writeStandaloneRepo(standaloneDir);
      // The guard's own resolveRepoRoots() needs a derivable src/ layout, or
      // it treats the fixture as "not a checkout" and skips without checking.
      mkdirSync(join(standaloneDir, "src"), { recursive: true });
      writeMarker(standaloneDir, "1.0.0");

      const { output, exitCode } = runHook(standaloneDir, tmp);

      expect(output).toContain(".kumiko/upgrade-state.json present — running upgrade-state guard");
      expect(output).toContain("upgrade-state guard failed — refusing push");
      expect(output).not.toContain("bun run test (standalone)");
      expect(output).not.toContain("MARKER_A");
      expect(exitCode).not.toBe(0);
    });

    test("guard-upgrade-state.ts not found next to the resolved script location fails closed", () => {
      const standaloneDir = join(tmp, "standalone-guard-missing");
      writeStandaloneRepo(standaloneDir);
      writeMarker(standaloneDir, "1.0.0");

      const copyDir = join(tmp, "hook-copy-without-guard");
      mkdirSync(copyDir, { recursive: true });
      const copyPath = join(copyDir, "pre-push.sh");
      writeExecutable(copyPath, readFileSync(HOOK_PATH, "utf-8"));

      const result = Bun.spawnSync([copyPath], { cwd: standaloneDir, env: fixtureEnv(tmp) });
      const output = result.stdout.toString() + result.stderr.toString();

      expect(result.exitCode).not.toBe(0);
      expect(output).toContain(
        "FATAL: guard-upgrade-state.ts not found next to resolved script location",
      );
    });

    test("hook invoked via a symlink still resolves guard-upgrade-state.ts next to the real script", () => {
      const standaloneDir = join(tmp, "standalone-guard-symlink");
      writeStandaloneRepo(standaloneDir);
      mkdirSync(join(standaloneDir, "src"), { recursive: true });
      writeMarker(standaloneDir, "1.0.0");

      const binDir = join(tmp, "bin-symlink");
      mkdirSync(binDir, { recursive: true });
      const symlinkPath = join(binDir, "kumiko-pre-push");
      symlinkSync(HOOK_PATH, symlinkPath);

      const result = Bun.spawnSync([symlinkPath], { cwd: standaloneDir, env: fixtureEnv(tmp) });
      const output = result.stdout.toString() + result.stderr.toString();

      expect(output).not.toContain("FATAL: guard-upgrade-state.ts not found");
      expect(output).toContain(".kumiko/upgrade-state.json present — running upgrade-state guard");
      expect(result.exitCode).not.toBe(0);
    });
  });
});
