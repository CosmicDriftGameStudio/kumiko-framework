// Strict env-var read. Throws with a clear hint when missing — better
// than discovering a Postgres-connection-refused 30s into the boot.
// `src` defaults to process.env but is threaded from the caller's envSource
// so the boot-path reads the SAME env-quelle that was validated above —
// injected dummies in test-mode must not silently fall back to process.env.
export function requireEnv(
  name: string,
  src: Record<string, string | undefined> = process.env,
  context = "runProdApp",
): string {
  const value = src[name];
  if (value === undefined || value === "") {
    const advice =
      context === "runProdApp"
        ? "Set it in your container env / .env.production / Coolify secrets."
        : "Set it in your .env / shell before running the dev server.";
    throw new Error(`${context}: required env var "${name}" is missing or empty. ${advice}`);
  }
  return value;
}

// Optional env helper — returns undefined for missing, string for set.
// Used for KUMIKO_INSTANCE_ID, JWT_ISSUER and other "nice to have" knobs.
export function readEnv(
  name: string,
  src: Record<string, string | undefined> = process.env,
): string | undefined {
  const value = src[name];
  return value === undefined || value === "" ? undefined : value;
}
