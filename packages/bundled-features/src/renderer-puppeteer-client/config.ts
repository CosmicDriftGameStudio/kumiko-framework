// Client config from env vars. App-wide (one service URL + one token per
// app deployment). Per-tenant overrides via config-bundle would be possible
// — they come when the need is real (memory `no_options_without_need`).

export type ClientConfig = {
  readonly serviceUrl: string;
  readonly authToken: string;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
};

export function loadClientConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const serviceUrl = env["PUPPETEER_SERVICE_URL"] ?? "http://puppeteer-service:3000";
  const authToken = env["PUPPETEER_AUTH_TOKEN"];
  if (!authToken || authToken.length < 16) {
    throw new Error(
      "PUPPETEER_AUTH_TOKEN missing or too short (need >=16 chars). Set via env-var matching the puppeteer-service deployment.",
    );
  }
  return {
    serviceUrl: serviceUrl.replace(/\/+$/, ""), // trailing slash strippen
    authToken,
    requestTimeoutMs: parseIntEnv(env["PUPPETEER_CLIENT_TIMEOUT_MS"], 60_000),
    maxRetries: parseIntEnv(env["PUPPETEER_CLIENT_MAX_RETRIES"], 3),
  };
}

function parseIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid integer env-var: "${raw}" — expected non-negative int.`);
  }
  return parsed;
}
