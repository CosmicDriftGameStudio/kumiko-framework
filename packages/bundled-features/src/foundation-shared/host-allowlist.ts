/** Parses a comma-separated operator host allowlist env var. Never throws —
 *  an unset or empty value just means no bypass. */
export function readHostAllowlistFromEnv(
  envVar: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  const raw = env[envVar];
  if (!raw) return [];
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

export function isHostAllowlisted(host: string, allowlist: readonly string[]): boolean {
  return allowlist.some((candidate) => candidate.toLowerCase() === host.toLowerCase());
}
