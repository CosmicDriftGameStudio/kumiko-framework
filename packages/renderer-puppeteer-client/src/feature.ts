import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-types/feature";
import { puppeteerRender } from "./render.js";

// renderer-puppeteer-client — plugin for renderer-foundation. Renders
// kind=["document-pdf", "image-snapshot"] requests via an HTTP call to
// puppeteer-service (app in apps/puppeteer-service).
//
// **Caller pattern:**
//   1. The caller (e.g. Solon NKA PDF generator) resolves the content template
//      beforehand via template-resolver → resolved HTML in payload.content.
//   2. Foundation selects the plugin via `createRendererForTenant({ kind:
//      "document-pdf" })` → the plugin pool's default is "puppeteer".
//   3. The caller invokes `plugin.render(req, ctx)`. The plugin makes an HTTP POST
//      to PUPPETEER_SERVICE_URL with a bearer token from env.
//   4. The plugin returns { kind: "document-pdf", pdfBytes, ... } — the caller
//      persists it in S3 or passes it on (FileRef etc.).
//
// **Configuration:** env vars (app-wide, one service per deployment):
//   - PUPPETEER_SERVICE_URL  default http://puppeteer-service:3000
//   - PUPPETEER_AUTH_TOKEN   required (>=16 chars, matches the service)
//   - PUPPETEER_CLIENT_TIMEOUT_MS    default 60000
//   - PUPPETEER_CLIENT_MAX_RETRIES   default 3
//
// **Retry strategy:** 5xx + network errors → exponential backoff (200ms,
// 400ms, 800ms) + jitter. 4xx → NO retry (config bug, fail immediately).

export function createRendererPuppeteerClientFeature(): FeatureDefinition {
  return defineFeature("renderer-puppeteer-client", (r) => {
    r.describe(
      'A `renderer-foundation` plugin that handles `kind="document-pdf"` and `kind="image-snapshot"` by forwarding the render request over HTTP to a separately deployed `puppeteer-service`. Configure the service endpoint and auth token via `PUPPETEER_SERVICE_URL` and `PUPPETEER_AUTH_TOKEN` env vars. The client retries on 5xx and network errors with exponential backoff (default 3 retries); 4xx responses fail immediately. The plugin returns raw bytes \u2014 callers are responsible for persisting to S3 or streaming to the client. Register it alongside `renderer-foundation` and reach it through `foundation.createRendererForTenant({ kind: "document-pdf" }).render(...)`. Use this when you need PDF generation or screenshot capabilities without bundling a browser into the app process.',
    );
    r.requires("renderer-foundation");

    r.useExtension("renderer", "puppeteer", {
      kinds: ["document-pdf", "image-snapshot"] as const,
      render: puppeteerRender,
    });
  });
}
