export const REAL_PROVIDERS_ENV = "KUMIKO_REAL_PROVIDERS";
const CI_FLAG = "CI";

function isCi(): boolean {
  const ci = process.env[CI_FLAG];
  return ci !== undefined && ci !== "" && ci !== "0" && ci.toLowerCase() !== "false";
}

// Apps and the e2e/bunfig templates gate real-provider runs on this same
// check instead of re-reading KUMIKO_REAL_PROVIDERS themselves.
export function isRealProviderRun(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[REAL_PROVIDERS_ENV] === "1";
}

export function requireRealProviders(): void {
  if (isCi()) {
    throw new Error(
      `Real-provider tests never run in CI (CI is set). Run them locally with ${REAL_PROVIDERS_ENV}=1 via the test:real / e2e:real script.`,
    );
  }
  if (!isRealProviderRun()) {
    throw new Error(
      `Real-provider test needs ${REAL_PROVIDERS_ENV}=1 (an API key alone never enables it). Run it via the test:real / e2e:real script.`,
    );
  }
}
