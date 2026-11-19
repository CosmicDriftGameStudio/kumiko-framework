import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { countPdfPages } from "./pdf-page-count.ts";
import {
  PREVIEW_ACCESS,
  PREVIEW_RATE_LIMIT,
  previewDraftSchema,
  printPreviewDraft,
} from "./preview-draft.ts";
import { AGENT_IMAGES_RESULT_KEY, rasterizePdf } from "./rasterize.ts";
import { clientErrorForRenderFailure } from "./render-and-store.ts";

export const previewPngQuery = defineQueryHandler({
  name: "preview-png",
  schema: previewDraftSchema,
  access: PREVIEW_ACCESS,
  rateLimit: { per: "user+handler", ...PREVIEW_RATE_LIMIT },
  description:
    "Prints a document template draft like preview-pdf and returns the first pages (at most 5) as PNG images so you can look at the layout: pageCount is the number of pages of the whole PDF, pages the pixel size of each returned page, and agentImages the page images themselves for direct viewing (they are not repeated anywhere else). Nothing is saved. Use it after patch-draft to check the result by eye. While the PDF service does not answer it fails with puppeteer_unavailable (HTTP 503).",
  handler: async (query, ctx) => {
    const printed = await printPreviewDraft(query.payload, query.user, ctx);
    try {
      const rasterized = await rasterizePdf(printed.pdfBytes);
      return {
        fileName: printed.fileName,
        pageCount: countPdfPages(printed.pdfBytes),
        pages: rasterized.pages.map(({ widthPx, heightPx }) => ({ widthPx, heightPx })),
        [AGENT_IMAGES_RESULT_KEY]: rasterized.pages.map(({ mimeType, data }) => ({
          mimeType,
          data,
        })),
        durationMs: Date.now() - printed.startedAt,
      };
    } catch (e) {
      throw clientErrorForRenderFailure(e, ctx, query.payload.slug);
    }
  },
});
