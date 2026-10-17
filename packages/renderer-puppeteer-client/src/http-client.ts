// HTTP client for puppeteer-service. Retry strategy: only network errors and
// 502/503 (4xx is a client bug, 500/504 a deterministic render failure, neither
// is a retry candidate). Exponential backoff with jitter to avoid
// thundering-herd effects.

import { RendererError } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { egress } from "@cosmicdrift/kumiko-framework/http";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { ClientConfig } from "./config.js";

export type FetchResult = {
  readonly contentType: string;
  readonly bytes: Uint8Array;
};

// The allowlist is the service URL's own origin, so it cannot restrict the
// target — what `internal` buys here is http(s)-scheme enforcement and
// redirects confined to that same origin (scheme, host, port), so a compromised
// or misrouted puppeteer-service cannot bounce the Bearer token elsewhere.
export function serviceEgress(
  serviceUrl: string,
): (raw: string, init?: RequestInit) => Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(serviceUrl);
  } catch {
    throw new RendererError(
      `renderer-puppeteer-client: PUPPETEER_SERVICE_URL is not a URL: ${serviceUrl}`,
      "other",
    );
  }
  // Checked here, not left to egress(): egress runs inside the retry loop and
  // would retry a permanent config error with backoff.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RendererError(
      `renderer-puppeteer-client: PUPPETEER_SERVICE_URL has unsupported scheme ${parsed.protocol}`,
      "other",
    );
  }
  return egress({ kind: "internal", allowOrigins: [parsed.origin] });
}

export async function postRender(config: ClientConfig, body: unknown): Promise<FetchResult> {
  const postToService = serviceEgress(config.serviceUrl);
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 200ms, 400ms, 800ms, ... plus 0–100% jitter
      // (Math.random() returns 0..1, multiplied by base gives
      // additive jitter between 0 and base — so actual waits:
      // 200–400ms, 400–800ms, 800–1600ms). Avoids a thundering herd
      // when several clients retry at the same time.
      const baseMs = 100 * 2 ** attempt;
      const jitter = Math.random() * baseMs;
      await sleep(baseMs + jitter);
    }
    try {
      return await tryFetch(config, body, postToService);
    } catch (e) {
      // A RendererError is final (4xx, deterministic render failure, client timeout);
      // only plain Errors (network failure, 502/503) fall through to the next attempt.
      if (e instanceof RendererError) throw e;
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw new RendererError(
    `puppeteer-service is not reachable at ${config.serviceUrl}: ${lastError?.message ?? "unknown"}`,
    "unavailable",
  );
}

// 502/503 mean the service (or its proxy) could not take the job at all. A 500/504 means
// the render ran and failed or timed out: repeating it only burns Chromium time again.
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503]);

// The timer covers headers AND body: a service that sends headers and then stalls
// must not block the caller forever.
async function tryFetch(
  config: ClientConfig,
  body: unknown,
  postToService: (raw: string, init?: RequestInit) => Promise<Response>,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await postToService(`${config.serviceUrl}/render`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await readRenderResponse(response);
  } catch (e) {
    // The service keeps rendering after the client gives up; a retry would start a
    // second parallel render on the same pod.
    if (e instanceof Error && e.name === "AbortError") {
      throw new RendererError(`request timeout after ${config.requestTimeoutMs}ms`, "unavailable");
    }
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function readRenderResponse(response: Response): Promise<FetchResult> {
  if (response.status >= 200 && response.status < 300) {
    const buffer = await response.arrayBuffer();
    return {
      contentType: response.headers.get("Content-Type") ?? "application/octet-stream",
      bytes: new Uint8Array(buffer),
    };
  }

  const detail = await safeReadErrorJson(response);
  if (response.status >= 400 && response.status < 500) {
    throw new RendererError(
      `puppeteer-service rejected request: ${response.status} ${detail}`,
      "invalid_payload",
    );
  }
  if (RETRYABLE_STATUSES.has(response.status)) {
    throw new Error(`puppeteer-service ${response.status}: ${detail}`);
  }
  throw new RendererError(`puppeteer-service failed: ${response.status} ${detail}`, "other");
}

async function safeReadErrorJson(response: Response): Promise<string> {
  try {
    const json: unknown = await response.json();
    return [propertyOf(json, "error"), propertyOf(json, "details")]
      .filter((field): field is string => typeof field === "string" && field !== "")
      .join(" — ");
  } catch {
    return `<no parseable body>`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
