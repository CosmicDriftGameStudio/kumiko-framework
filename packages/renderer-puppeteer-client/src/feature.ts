import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-types/feature";
import { buildDocumentPreview } from "./document-pdf.ts";
import { RENDERED_PDF_ENTITY_NAME, renderedPdfEntity } from "./entity.ts";
import { previewPdfQuery } from "./preview-pdf.query.ts";
import { puppeteerRender } from "./render.ts";
import { puppeteerStatusQuery } from "./status.query.ts";

// renderer-puppeteer-client — plugin for renderer-foundation. Renders
// kind=["document-pdf", "image-snapshot"] requests via an HTTP call to
// puppeteer-service (app in apps/puppeteer-service).
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
      "A `renderer-foundation` plugin that prints documents to PDF through a separately deployed `puppeteer-service`. A `document-pdf` request names a stored template (`{ slug, locale, variables }`): the plugin resolves the template and its `pdf-layout` (header, signature and footer regions), embeds every image as a data URI, turns repeating table header rows into a real table head and sends the finished HTML to the service, which performs no network fetches itself. The page format, margins, file name pattern and title come from the template meta. A write handler renders with `renderPdfBeforeTransaction(ctx, { slug, locale, variables })` as its `beforeTransaction` phase, so the print service call holds no database connection, and stores the result with `storeRenderedPdf(ctx, event.prepared)` in the handler: a file plus a `rendered-pdf` record that keeps the template and layout version, so a stored document can always be traced to the text it was created from. The `puppeteer-status` query tells a TenantAdmin whether the service answers; while it does not, rendering fails with a `puppeteer_unavailable` error (HTTP 503) and no PDF is created. `image-snapshot` requests still take ready HTML in `payload.content`, which must embed all resources as data: URIs because the service fetches no http(s) resources. Configure the endpoint and token with `PUPPETEER_SERVICE_URL` and `PUPPETEER_AUTH_TOKEN`; the client retries 5xx and network errors with exponential backoff (default 3 retries), 4xx fails at once. The feature adds the `rendered_pdfs` table, so apps that mount it need a schema migration.",
    );
    r.requires({ features: ["renderer-foundation"] });

    r.useExtension("renderer", "puppeteer", {
      kinds: ["document-pdf", "image-snapshot"] as const,
      render: puppeteerRender,
      previewDocument: buildDocumentPreview,
    });

    r.entity({ name: RENDERED_PDF_ENTITY_NAME, ...renderedPdfEntity });
    r.queryHandler(puppeteerStatusQuery);
    r.queryHandler(previewPdfQuery);
  });
}
