export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Strict env read for scripts and tests with a fixed label. `runProdApp`/dev boot use
 *  server-runtime's `requireEnv` instead because their advice depends on the boot context. */
export function requiredEnvFor(
  label: string,
  env: EnvSource,
  hint?: string,
): (name: string) => string {
  return (name) => {
    const value = env[name];
    if (value === undefined || value === "") {
      const suffix = hint === undefined ? "" : ` ${hint}`;
      throw new Error(`[${label}] required env var ${name} is missing or empty.${suffix}`);
    }
    return value;
  };
}
