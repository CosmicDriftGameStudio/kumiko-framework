// Service config from env-vars. Tier-specific limits are set via K8s pod
// env (per Helm values per tier deployment).
//
// **Tier model:**
//   - basic   (strict):  RENDER_TIMEOUT_MS=10000   MAX_HTML_BYTES=500_000
//   - growth  (default): RENDER_TIMEOUT_MS=30000   MAX_HTML_BYTES=2_000_000
//   - scale   (loose):   RENDER_TIMEOUT_MS=60000   MAX_HTML_BYTES=10_000_000
//
// MAX_PDF_BYTES (default 10_000_000) caps the PDF /rasterize accepts, MAX_RASTER_PAGES (default 5)
// the pages it renders per call; /rasterize shares the render concurrency limit.
// MAX_CONCURRENT_RENDERS (default 4) caps in-flight renders per pod; beyond it
// /render answers 503 busy and the client retries. Size it to the pod memory limit.
// BROWSER_IDLE_TIMEOUT_MS (default 300000) closes Chromium after that long without a render;
// the next render relaunches it.
//
// Memory limit is set via K8s resources.limits.memory, not here — the
// service itself has no memory-cap mechanism (puppeteer crash on OOM is
// intended behavior, K8s restart-policy catches it).

export type ServiceConfig = {
  readonly port: number;
  readonly authToken: string;
  readonly renderTimeoutMs: number;
  readonly maxHtmlBytes: number;
  readonly maxPdfBytes: number;
  readonly maxRasterPages: number;
  readonly maxConcurrentRenders: number;
  readonly browserIdleTimeoutMs: number;
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
    maxPdfBytes: parseIntEnv(env["MAX_PDF_BYTES"], 10_000_000),
    maxRasterPages: parseIntEnv(env["MAX_RASTER_PAGES"], 5),
    maxConcurrentRenders: parseIntEnv(env["MAX_CONCURRENT_RENDERS"], 4),
    browserIdleTimeoutMs: parseIntEnv(env["BROWSER_IDLE_TIMEOUT_MS"], 300_000, MAX_TIMER_MS),
    puppeteerExecutablePath: env["PUPPETEER_EXECUTABLE_PATH"],
  };
}

// setTimeout fires after ~1 ms for delays above the signed 32-bit range.
const MAX_TIMER_MS = 2_147_483_647;

function parseIntEnv(raw: string | undefined, fallback: number, max?: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer env-var: "${raw}" — expected positive int.`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`Invalid integer env-var: "${raw}" — must be <= ${max}.`);
  }
  return parsed;
}
