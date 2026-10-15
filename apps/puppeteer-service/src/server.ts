// HTTP server. Endpoints:
//   POST /render — main endpoint, renders HTML to PDF/image
//   GET /healthz — Liveness probe for K8s (HTTP 200 while the service is up)
//   GET /metrics — Prometheus-format metrics (renders-total, render-errors-total, render-duration-ms)
//
// Auth: Bearer token in the Authorization header. /healthz and /metrics are
// unauthenticated — K8s probes carry no token, the Prometheus scraper runs in
// the same namespace via NetworkPolicy.

import { Hono } from "hono";
import { TimeoutError } from "puppeteer";
import type { ServiceConfig } from "./config";
import { type RenderRequest, render, renderRequestSchema } from "./render";

type Metrics = {
  rendersTotal: { pdf: number; image: number };
  renderErrorsTotal: number;
  renderDurationMs: number[];
};

export function createApp(config: ServiceConfig): { app: Hono; metrics: Metrics } {
  const metrics: Metrics = {
    rendersTotal: { pdf: 0, image: 0 },
    renderErrorsTotal: 0,
    renderDurationMs: [],
  };
  const app = new Hono();

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
        "# HELP puppeteer_render_errors_total Total render-Errors.",
        "# TYPE puppeteer_render_errors_total counter",
        `puppeteer_render_errors_total ${metrics.renderErrorsTotal}`,
        "# HELP puppeteer_render_duration_ms_mean Mean render-duration in ms over last N calls.",
        "# TYPE puppeteer_render_duration_ms_mean gauge",
        `puppeteer_render_duration_ms_mean ${meanMs.toFixed(0)}`,
        "",
      ].join("\n"),
      200,
      { "Content-Type": "text/plain; version=0.0.4" },
    );
  });

  app.post("/render", async (c) => {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${config.authToken}`) {
      return c.json({ error: "unauthorized" }, 401);
    }

    // Content-Length check before JSON parse — we don't want to pull
    // megabyte-sized HTML into server memory when the tier limit is smaller.
    const contentLength = Number.parseInt(c.req.header("Content-Length") ?? "0", 10);
    if (contentLength > config.maxHtmlBytes + 10_000) {
      // +10k buffer for JSON overhead (kind, options, etc.)
      return c.json(
        { error: "payload_too_large", maxBytes: config.maxHtmlBytes, gotBytes: contentLength },
        413,
      );
    }

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

    const t0 = performance.now();
    try {
      const result = await render(body, {
        timeoutMs: config.renderTimeoutMs,
        executablePath: config.puppeteerExecutablePath,
      });
      const ms = performance.now() - t0;
      if (body.kind === "document-pdf") metrics.rendersTotal.pdf += 1;
      else metrics.rendersTotal.image += 1;
      metrics.renderDurationMs.push(ms);
      // Keep only last 1000 samples to bound memory.
      if (metrics.renderDurationMs.length > 1000) {
        metrics.renderDurationMs.splice(0, metrics.renderDurationMs.length - 1000);
      }
      return new Response(result.bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": result.contentType,
          "Content-Length": String(result.bytes.byteLength),
        },
      });
    } catch (e) {
      metrics.renderErrorsTotal += 1;
      const message = describe(e);
      // TimeoutError is a concrete class from puppeteer (`puppeteer.
      // TimeoutError`). String-matching on message would be fragile across
      // localization or lib updates.
      const status = e instanceof TimeoutError ? 504 : 500;
      return c.json({ error: "render_failed", details: message }, status);
    }
  });

  return { app, metrics };
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
