const REAL_PROVIDERS_FLAG = "KUMIKO_REAL_PROVIDERS";
const CI_FLAG = "CI";

function isCi(): boolean {
  const ci = process.env[CI_FLAG];
  return ci !== undefined && ci !== "" && ci !== "0" && ci.toLowerCase() !== "false";
}

export function requireRealProviders(): void {
  if (isCi()) {
    throw new Error(
      `Real-provider tests never run in CI (CI is set). Run them locally with ${REAL_PROVIDERS_FLAG}=1 via the test:real / e2e:real script.`,
    );
  }
  if (process.env[REAL_PROVIDERS_FLAG] !== "1") {
    throw new Error(
      `Real-provider test needs ${REAL_PROVIDERS_FLAG}=1 (an API key alone never enables it). Run it via the test:real / e2e:real script.`,
    );
  }
}
