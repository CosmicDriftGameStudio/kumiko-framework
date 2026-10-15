// Service config from env-vars. Tier-specific limits are set via K8s pod
// env (per Helm values per tier deployment).
//
// **Tier model:**
//   - basic   (strict):  RENDER_TIMEOUT_MS=10000   MAX_HTML_BYTES=500_000
//   - growth  (default): RENDER_TIMEOUT_MS=30000   MAX_HTML_BYTES=2_000_000
//   - scale   (loose):   RENDER_TIMEOUT_MS=60000   MAX_HTML_BYTES=10_000_000
//
// Memory limit is set via K8s resources.limits.memory, not here — the
// service itself has no memory-cap mechanism (puppeteer crash on OOM is
// intended behavior, K8s restart-policy catches it).

export type ServiceConfig = {
  readonly port: number;
  readonly authToken: string;
  readonly renderTimeoutMs: number;
  readonly maxHtmlBytes: number;
  readonly puppeteerExecutablePath: string | undefined;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const authToken = env["PUPPETEER_AUTH_TOKEN"];
  if (!authToken || authToken.length < 16) {
    throw new Error(
      "PUPPETEER_AUTH_TOKEN missing or too short (need >=16 chars). Set via K8s Secret.",
    );
  }
  return {
    port: parseIntEnv(env["PORT"], 3000),
    authToken,
    renderTimeoutMs: parseIntEnv(env["RENDER_TIMEOUT_MS"], 30_000),
    maxHtmlBytes: parseIntEnv(env["MAX_HTML_BYTES"], 2_000_000),
    puppeteerExecutablePath: env["PUPPETEER_EXECUTABLE_PATH"],
  };
}

function parseIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer env-var: "${raw}" — expected positive int.`);
  }
  return parsed;
}
