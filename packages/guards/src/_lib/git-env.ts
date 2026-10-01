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

/**
 * Extra keys for git calls that talk to a remote (`git fetch`): without the
 * SSH agent / proxy settings the transport cannot authenticate or connect.
 * Opt-in via `gitEnv(env, { transport: true })`; local-only calls stay narrow.
 * `GIT_DIR`/`GIT_WORK_TREE` are deliberately never part of this list.
 */
export const GIT_TRANSPORT_ENV_KEYS = [
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "GIT_TERMINAL_PROMPT",
  "GIT_SSL_CAINFO",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
  "ALL_PROXY",
] as const;

export function gitEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { readonly transport?: boolean } = {},
): Record<string, string> {
  const keys = options.transport ? [...GIT_ENV_KEYS, ...GIT_TRANSPORT_ENV_KEYS] : GIT_ENV_KEYS;
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
