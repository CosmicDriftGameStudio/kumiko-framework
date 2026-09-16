/**
 * Spawned git calls get an allowlisted environment, never `...process.env`.
 * A caller running as a pre-push hook would otherwise inherit `GIT_DIR`/
 * `GIT_WORK_TREE` from git, which git prefers over `cwd` — so an inherited
 * environment would answer for the hook's repo instead of the path being
 * asked about. `HOME` stays in, so the global config is still read.
 *
 * An allowlist (not a blocklist) so a future git env var neither of us has
 * thought of yet is excluded by construction, not by omission.
 */
export const GIT_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "USER", "LOGNAME"] as const;

export function gitEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of GIT_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
