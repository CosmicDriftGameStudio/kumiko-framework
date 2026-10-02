// Allowlist, not `...process.env`: git prefers an inherited GIT_DIR/GIT_WORK_TREE over cwd,
// so a pre-push hook's env would answer for the hook's repo. HOME stays so global config loads.
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
