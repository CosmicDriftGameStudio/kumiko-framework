import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandContext, Output, Role } from "./types";

/** In-memory output spy. Replaces stdout/stderr so tests can assert
 *  on what a command emitted without scribbling to the test runner. */
export function makeSpyOutput(): {
  readonly out: Output;
  readonly logs: ReadonlyArray<string>;
  readonly warns: ReadonlyArray<string>;
  readonly errs: ReadonlyArray<string>;
} {
  const logs: string[] = [];
  const warns: string[] = [];
  const errs: string[] = [];
  return {
    logs,
    warns,
    errs,
    out: {
      log: (m: string) => logs.push(m),
      warn: (m: string) => warns.push(m),
      err: (m: string) => errs.push(m),
    },
  };
}

/** Erstellt ein cwd-Verzeichnis das beim afterEach via cleanup() weg
 *  ist. Wenn `files` gegeben sind, werden sie reingelegt. */
export function makeTempCwd(files?: Record<string, string>): {
  readonly cwd: string;
  readonly cleanup: () => void;
} {
  const cwd = mkdtempSync(join(tmpdir(), "kumiko-cmd-"));
  if (files) {
    for (const [relPath, content] of Object.entries(files)) {
      const full = join(cwd, relPath);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content, "utf-8");
    }
  }
  return {
    cwd,
    cleanup: () => {
      try {
        rmSync(cwd, { recursive: true, force: true });
      } catch {
        // ignore — best-effort
      }
    },
  };
}

export function makeContext(overrides: {
  readonly cwd: string;
  readonly argv?: ReadonlyArray<string>;
  readonly role?: Role;
  readonly scope?: string;
  readonly binPath?: string;
  readonly repoRoot?: string;
  readonly out?: Output;
}): CommandContext {
  const spy = overrides.out ?? makeSpyOutput().out;
  return {
    cwd: overrides.cwd,
    argv: overrides.argv ?? [],
    role: overrides.role ?? "maintainer",
    scope: overrides.scope,
    binPath: overrides.binPath ?? join(overrides.cwd, "node_modules", ".bin"),
    repoRoot: overrides.repoRoot ?? overrides.cwd,
    out: spy,
  };
}

const GIT_LOCATION_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_CEILING_DIRECTORIES",
] as const;

/** A copy of the environment with git's location vars removed and config pinned
 *  to /dev/null. Bun ignores `delete process.env[...]` for default-inherit child
 *  processes, so an explicit env is the only reliable way to neutralise an
 *  inherited GIT_DIR. */
export function cleanGitEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of GIT_LOCATION_ENV) delete env[key];
  env["GIT_CONFIG_GLOBAL"] = "/dev/null";
  env["GIT_CONFIG_SYSTEM"] = "/dev/null";
  return env;
}

/** Runs git against `cwd` with the inherited git-location env removed, so a test
 *  can never operate on the enclosing repo. The pre-push hook runs `bun test`
 *  with GIT_DIR / GIT_WORK_TREE set by git; an unscrubbed `git commit` would
 *  otherwise land on the real branch — kumiko-framework#197 / #185. Throws on a
 *  non-zero exit so a broken fixture fails loudly instead of writing nowhere. */
export function runGit(args: ReadonlyArray<string>, cwd: string): void {
  const result = spawnSync("git", [...args], {
    cwd,
    env: cleanGitEnv(),
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() ?? `exit ${String(result.status)}`;
    throw new Error(`git ${args.join(" ")} (cwd=${cwd}) failed: ${detail}`);
  }
}
