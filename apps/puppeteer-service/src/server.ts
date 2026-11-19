// HTTP server. Endpoints:
//   POST /render — main endpoint, renders HTML to PDF/image
//   POST /rasterize — turns a PDF into PNG pages (and embedded images) so an agent can look at it
//   GET /healthz — Liveness probe for K8s (HTTP 200 while the service is up)
//   GET /metrics — Prometheus-format metrics (renders-total, render-errors-total, render-duration-ms)
//
// Auth: Bearer token in the Authorization header. /healthz and /metrics are
// unauthenticated — K8s probes carry no token, the Prometheus scraper runs in
// the monitoring namespace, allowed via NetworkPolicy. /render and /rasterize check
// the token before reading the body.

import { createHash, timingSafeEqual } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { TimeoutError } from "puppeteer";
import type { ServiceConfig } from "./config";
import {
  DEFAULT_RASTER_DPI,
  InvalidPdfError,
  RasterResultTooLargeError,
  type RasterizeRequest,
  RasterizeTimeoutError,
  rasterize,
  rasterizeRequestSchema,
} from "./rasterize";
import { isBrowserRunning, type RenderRequest, render, renderRequestSchema } from "./render";

// Hashing first gives timingSafeEqual equal-length inputs without leaking the token length.
function isAuthorized(authHeader: string | undefined, authToken: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authHeader ?? ""), digest(`Bearer ${authToken}`));
}

type Metrics = {
  rendersTotal: { pdf: number; image: number; rasterize: number };
  renderErrorsTotal: number;
  renderRejectedBusyTotal: number;
  renderDurationMs: number[];
};

export type AppDeps = {
  readonly render: typeof render;
  readonly rasterize: typeof rasterize;
};

export function createApp(
  config: ServiceConfig,
  overrides: Partial<AppDeps> = {},
): { app: Hono; metrics: Metrics } {
  const deps: AppDeps = { render, rasterize, ...overrides };
  const metrics: Metrics = {
    rendersTotal: { pdf: 0, image: 0, rasterize: 0 },
    renderErrorsTotal: 0,
    renderRejectedBusyTotal: 0,
    renderDurationMs: [],
  };
  const app = new Hono();

  // Auth runs before the body limit so an unauthenticated caller cannot make the service buffer a body.
  const requireAuth: MiddlewareHandler = async (c, next) => {
    if (!isAuthorized(c.req.header("Authorization"), config.authToken)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };

  // Counts bytes while reading, so a request without Content-Length cannot skip the limit.
  const limitBody = (maxBodyBytes: number, maxBytes: number): MiddlewareHandler =>
    bodyLimit({
      maxSize: maxBodyBytes,
      onError: (c) => {
        const declaredBytes = Number.parseInt(c.req.header("Content-Length") ?? "", 10);
        return c.json(
          {
            error: "payload_too_large",
            maxBytes,
            ...(Number.isFinite(declaredBytes) && { gotBytes: declaredBytes }),
          },
          413,
        );
      },
    });
  let rendersInFlight = 0;

  const recordDuration = (ms: number) => {
    metrics.renderDurationMs.push(ms);
    // Keep only last 1000 samples to bound memory.
    if (metrics.renderDurationMs.length > 1000) {
      metrics.renderDurationMs.splice(0, metrics.renderDurationMs.length - 1000);
    }
  };

  app.get("/healthz", (c) => c.text("ok"));

  app.get("/metrics", (c) => {
    // Prometheus text format. A histogram would be more expressive, but
    // mean + count from raw values are enough for basic monitoring.
    const samples = metrics.renderDurationMs;
    const meanMs =
      samples.length === 0 ? 0 : samples.reduce((sum, v) => sum + v, 0) / samples.length;
    return c.text(
      [
        "# HELP puppeteer_renders_total Total render-Calls per kind.",
        "# TYPE puppeteer_renders_total counter",
        `puppeteer_renders_total{kind="document-pdf"} ${metrics.rendersTotal.pdf}`,
        `puppeteer_renders_total{kind="image-snapshot"} ${metrics.rendersTotal.image}`,
        `puppeteer_renders_total{kind="rasterize"} ${metrics.rendersTotal.rasterize}`,
        "# HELP puppeteer_render_errors_total Total render-Errors.",
        "# TYPE puppeteer_render_errors_total counter",
        `puppeteer_render_errors_total ${metrics.renderErrorsTotal}`,
        "# HELP puppeteer_render_rejected_busy_total Renders refused with 503 because the concurrency limit was reached.",
        "# TYPE puppeteer_render_rejected_busy_total counter",
        `puppeteer_render_rejected_busy_total ${metrics.renderRejectedBusyTotal}`,
        "# HELP puppeteer_render_duration_ms_mean Mean render-duration in ms over last N calls.",
        "# TYPE puppeteer_render_duration_ms_mean gauge",
        `puppeteer_render_duration_ms_mean ${meanMs.toFixed(0)}`,
        "# HELP puppeteer_browser_running 1 while Chromium is running, 0 after the idle close.",
        "# TYPE puppeteer_browser_running gauge",
        `puppeteer_browser_running ${isBrowserRunning() ? 1 : 0}`,
        "",
      ].join("\n"),
      200,
      { "Content-Type": "text/plain; version=0.0.4" },
    );
  });

  // +10k buffer for the JSON envelope (kind, options, etc.).
  app.post("/render", requireAuth, limitBody(config.maxHtmlBytes + 10_000, config.maxHtmlBytes), async (c) => {
    let body: RenderRequest;
    try {
      const raw = await c.req.json();
      body = renderRequestSchema.parse(raw);
    } catch (e) {
      return c.json({ error: "invalid_payload", details: describe(e) }, 400);
    }

    // Byte length, not string length — `.length` is UTF-16 code units,
    // underestimating on emoji-/multi-byte-heavy HTML. MAX_HTML_BYTES
    // is documented as a byte cap.
    const htmlBytes = new TextEncoder().encode(body.html).byteLength;
    if (htmlBytes > config.maxHtmlBytes) {
      return c.json(
        { error: "html_too_large", maxBytes: config.maxHtmlBytes, gotBytes: htmlBytes },
        413,
      );
    }

    if (rendersInFlight >= config.maxConcurrentRenders) {
      metrics.renderRejectedBusyTotal += 1;
      return c.json({ error: "busy" }, 503, { "Retry-After": "1" });
    }
    rendersInFlight += 1;

    const t0 = performance.now();
    try {
      const result = await deps.render(body, {
        timeoutMs: config.renderTimeoutMs,
        browserIdleTimeoutMs: config.browserIdleTimeoutMs,
        executablePath: config.puppeteerExecutablePath,
      });
      const ms = performance.now() - t0;
      if (body.kind === "document-pdf") metrics.rendersTotal.pdf += 1;
      else metrics.rendersTotal.image += 1;
      recordDuration(ms);
      return new Response(result.bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": result.contentType,
          "Content-Length": String(result.bytes.byteLength),
        },
      });
    } catch (e) {
      metrics.renderErrorsTotal += 1;
      logFailure("render failed", e);
      // TimeoutError is a concrete class from puppeteer (`puppeteer.
      // TimeoutError`). String-matching on message would be fragile across
      // localization or lib updates.
      const status = e instanceof TimeoutError ? 504 : 500;
      return c.json({ error: "render_failed" }, status);
    } finally {
      rendersInFlight -= 1;
    }
  });

  // Base64 inflates by 4/3; the +10k buffer covers the JSON envelope.
  const maxRasterizeBodyBytes = Math.ceil((config.maxPdfBytes * 4) / 3) + 10_000;
  app.post("/rasterize", requireAuth, limitBody(maxRasterizeBodyBytes, config.maxPdfBytes), async (c) => {
    let body: RasterizeRequest;
    try {
      body = rasterizeRequestSchema.parse(await c.req.json());
    } catch (e) {
      return c.json({ error: "invalid_payload", details: describe(e) }, 400);
    }

    const pdfBytes = Buffer.from(body.pdfBase64, "base64");
    if (pdfBytes.byteLength > config.maxPdfBytes) {
      return c.json(
        { error: "pdf_too_large", maxBytes: config.maxPdfBytes, gotBytes: pdfBytes.byteLength },
        413,
      );
    }

    if (rendersInFlight >= config.maxConcurrentRenders) {
      metrics.renderRejectedBusyTotal += 1;
      return c.json({ error: "busy" }, 503, { "Retry-After": "1" });
    }
    rendersInFlight += 1;

    const t0 = performance.now();
    try {
      const result = await deps.rasterize({
        pdfBytes,
        maxPages: Math.min(body.maxPages ?? config.maxRasterPages, config.maxRasterPages),
        dpi: body.dpi ?? DEFAULT_RASTER_DPI,
        images: body.images ?? false,
        timeoutMs: config.renderTimeoutMs,
      });
      metrics.rendersTotal.rasterize += 1;
      recordDuration(performance.now() - t0);
      return c.json(result, 200);
    } catch (e) {
      metrics.renderErrorsTotal += 1;
      if (e instanceof InvalidPdfError) {
        logFailure("invalid pdf", e);
        return c.json({ error: "invalid_pdf" }, 400);
      }
      if (e instanceof RasterResultTooLargeError) {
        return c.json({ error: "result_too_large", gotBytes: e.gotBytes }, 413);
      }
      const status = e instanceof RasterizeTimeoutError ? 504 : 500;
      logFailure("rasterize failed", e);
      return c.json({ error: "rasterize_failed" }, status);
    } finally {
      rendersInFlight -= 1;
    }
  });

  return { app, metrics };
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// The caller gets only the error code; the cause goes to the pod log as one line.
function logFailure(label: string, e: unknown): void {
  process.stderr.write(
    `[puppeteer-service] ${label}: ${describe(e).replace(/[\r\n]+/g, " ").slice(0, 500)}\n`,
  );
}
