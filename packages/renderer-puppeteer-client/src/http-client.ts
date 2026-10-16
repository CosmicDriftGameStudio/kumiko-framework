// HTTP client for puppeteer-service. Retry strategy: only on 5xx + network
// errors (4xx is a client bug, not a retry candidate). Exponential backoff with
// jitter to avoid thundering-herd effects.

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
      lastError = e instanceof Error ? e : new Error(String(e));
      if (e instanceof RendererError && e.code === "invalid_payload") {
        // Client-side validation error or 4xx from the service: NO retry.
        throw e;
      }
      // 5xx or network error: continue to the next attempt
    }
  }
  throw new RendererError(
    `puppeteer-service is not reachable at ${config.serviceUrl}: ${lastError?.message ?? "unknown"}`,
    "unavailable",
  );
}

async function tryFetch(
  config: ClientConfig,
  body: unknown,
  postToService: (raw: string, init?: RequestInit) => Promise<Response>,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  let response: Response;
  try {
    response = await postToService(`${config.serviceUrl}/render`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`request timeout after ${config.requestTimeoutMs}ms`);
    }
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (response.status >= 200 && response.status < 300) {
    const buffer = await response.arrayBuffer();
    return {
      contentType: response.headers.get("Content-Type") ?? "application/octet-stream",
      bytes: new Uint8Array(buffer),
    };
  }

  // 4xx: no retry (see postRender's catch logic via the RendererError throw)
  if (response.status >= 400 && response.status < 500) {
    const detail = await safeReadErrorJson(response);
    throw new RendererError(
      `puppeteer-service rejected request: ${response.status} ${detail}`,
      "invalid_payload",
    );
  }

  // 5xx: continue to retry (caught in postRender)
  const detail = await safeReadErrorJson(response);
  throw new Error(`puppeteer-service ${response.status}: ${detail}`);
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
