import { spawnSync } from "node:child_process";

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

/** Env copy with git's location vars removed (config pinned to /dev/null).
 *  Bun ignores `delete process.env[...]` for inherited children — #197/#185. */
export function cleanGitEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of GIT_LOCATION_ENV) delete env[key];
  env["GIT_CONFIG_GLOBAL"] = "/dev/null";
  env["GIT_CONFIG_SYSTEM"] = "/dev/null";
  return env;
}

/** Runs git in `cwd` with inherited git-location env removed so a test never
 *  lands on the enclosing repo — #197/#185. Throws loudly on non-zero exit. */
export function runGit(args: ReadonlyArray<string>, cwd: string): void {
  const result = spawnSync("git", [...args], {
    cwd,
    env: cleanGitEnv(),
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} (cwd=${cwd}) failed: ${gitFailureDetail(result)}`);
  }
}

interface GitSpawnResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
  readonly stderr: string | null;
}

/** Failure detail from a spawnSync result. Empty error.message/stderr must fall
 *  through (`||`, not `??`) to signal/exit rather than yielding an empty detail. */
export function gitFailureDetail(result: GitSpawnResult): string {
  return (
    result.error?.message ||
    result.stderr?.trim() ||
    (result.signal ? `signal ${result.signal}` : `exit ${String(result.status)}`)
  );
}
