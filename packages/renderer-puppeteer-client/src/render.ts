// Render function: bridges Foundation's RenderRequest to an HTTP call to
// puppeteer-service. document-pdf resolves a stored template and embeds every
// resource as data: URI before sending; image-snapshot forwards payload.content as is.

import {
  type RendererContext,
  RendererError,
  type RenderRequest,
  type RenderResponse,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { type ClientConfig, loadClientConfig } from "./config.js";
import { buildDocumentPdfRequest } from "./document-pdf.js";
import { postRender } from "./http-client.js";
import { readImageDimensions } from "./image-dimensions.js";
import { countPdfPages } from "./pdf-page-count.js";

export function loadClientConfigOrUnavailable(): ClientConfig {
  try {
    return loadClientConfig();
  } catch (e) {
    throw new RendererError(e instanceof Error ? e.message : String(e), "unavailable");
  }
}

export async function puppeteerRender(
  req: RenderRequest,
  ctx: RendererContext,
): Promise<RenderResponse> {
  if (req.kind !== "document-pdf" && req.kind !== "image-snapshot") {
    throw new RendererError(
      `renderer-puppeteer-client supports kinds=[document-pdf, image-snapshot], got "${req.kind}"`,
      "invalid_payload",
    );
  }

  // Env vars cannot change at runtime, but loadClientConfig validates; loading per call is cheap.
  const config = loadClientConfigOrUnavailable();

  if (req.kind === "document-pdf") {
    const built = await buildDocumentPdfRequest(req, ctx);
    const result = await postRender(config, {
      kind: "document-pdf",
      html: built.html,
      options: built.options,
    });
    return {
      kind: "document-pdf",
      pdfBytes: result.bytes,
      pageCount: countPdfPages(result.bytes),
      sizeBytes: result.bytes.byteLength,
      fileName: built.fileName,
      template: built.template,
      ...(built.layout !== null && { layout: built.layout }),
    };
  }

  // The caller resolves the template; the plugin takes payload.content as is.
  const html = req.payload.content;
  if (!html) {
    throw new RendererError(
      `renderer-puppeteer-client: payload.content is required (got empty/undefined)`,
      "invalid_payload",
    );
  }
  const result = await postRender(config, { kind: req.kind, html, options: req.options });
  const format = result.contentType.includes("png") ? "png" : "jpg";
  const actual = readImageDimensions(result.bytes, format);
  return {
    kind: "image-snapshot",
    imageBytes: result.bytes,
    format,
    width: actual?.width ?? req.options?.width ?? 1200,
    height: actual?.height ?? req.options?.height ?? 800,
  };
}
