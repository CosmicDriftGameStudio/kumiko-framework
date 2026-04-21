// Strict env-var parsers. Misconfig at boot is loud: every helper throws
// with the offending variable name + value so ops sees exactly what's
// wrong instead of a cascading timeout downstream.

export function readPositiveIntEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`[env] ${name}="${raw}" must be a non-negative integer`);
  }
  return n;
}
