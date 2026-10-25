export type EnvSource = Readonly<Record<string, string | undefined>>;

export function requiredEnvFor(label: string, env: EnvSource): (name: string) => string {
  return (name) => {
    const value = env[name];
    if (value === undefined || value === "") {
      throw new Error(`[${label}] required env var ${name} is missing or empty`);
    }
    return value;
  };
}
