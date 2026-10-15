// Render function: bridges Foundation's RenderRequest to an HTTP call to
// puppeteer-service. The plugin's `ctx` is NOT used (the service is
// app-wide, no tenant scoping needed). Pure render function.

import {
  type RendererContext,
  RendererError,
  type RenderRequest,
  type RenderResponse,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { loadClientConfig } from "./config.js";
import { postRender } from "./http-client.js";
import { countPdfPages } from "./pdf-page-count.js";

export async function puppeteerRender(
  req: RenderRequest,
  // ctx is required by the Foundation contract, unused here: the service is
  // app-wide without tenant scoping. Underscore prefix = intentionally unused.
  _ctx: RendererContext,
): Promise<RenderResponse> {
  if (req.kind !== "document-pdf" && req.kind !== "image-snapshot") {
    throw new RendererError(
      `renderer-puppeteer-client supports kinds=[document-pdf, image-snapshot], got "${req.kind}"`,
      "invalid_payload",
    );
  }

  // Load config on every call — env vars cannot change at runtime,
  // but loadClientConfig validates. Lazy load is minimal cost.
  const config = loadClientConfig();

  // HTML kommt aus payload.content (renderer-foundation contract).
  // Plugin nimmt payload.content as-is — keine Markdown-Substitution
  // hier (das macht der Caller, z.B. ein PDF-Template-Renderer der
  // template-resolver konsumiert).
  const html = req.payload.content;
  if (!html) {
    throw new RendererError(
      `renderer-puppeteer-client: payload.content is required (got empty/undefined)`,
      "invalid_payload",
    );
  }

  const result = await postRender(config, {
    kind: req.kind,
    html,
    options: req.options,
  });

  if (req.kind === "document-pdf") {
    return {
      kind: "document-pdf",
      pdfBytes: result.bytes,
      pageCount: countPdfPages(result.bytes),
      sizeBytes: result.bytes.byteLength,
    };
  }
  // image-snapshot
  const format = result.contentType.includes("png") ? "png" : "jpg";
  return {
    kind: "image-snapshot",
    imageBytes: result.bytes,
    format,
    width: req.options?.width ?? 1200,
    height: req.options?.height ?? 800,
  };
}
