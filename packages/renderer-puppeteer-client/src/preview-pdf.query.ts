import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { countPdfPages } from "./pdf-page-count.ts";
import {
  PREVIEW_ACCESS,
  PREVIEW_RATE_LIMIT,
  previewDraftSchema,
  printPreviewDraft,
} from "./preview-draft.ts";

export const previewPdfQuery = defineQueryHandler({
  name: "preview-pdf",
  schema: previewDraftSchema,
  access: PREVIEW_ACCESS,
  rateLimit: { per: "user+handler", ...PREVIEW_RATE_LIMIT },
  description:
    "Prints a document template draft to a real PDF with sample values taken from the declared variable examples, without saving anything: the draft passes the same write rules as a save and the stored template is not read for its body; returns the file name, the PDF as base64, the page count, the size and the render time. While the PDF service does not answer it fails with puppeteer_unavailable (HTTP 503).",
  handler: async (query, ctx) => {
    const printed = await printPreviewDraft(query.payload, query.user, ctx);
    return {
      fileName: printed.fileName,
      pdfBase64: Buffer.from(printed.pdfBytes).toString("base64"),
      pageCount: countPdfPages(printed.pdfBytes),
      sizeBytes: printed.pdfBytes.byteLength,
      durationMs: Date.now() - printed.startedAt,
    };
  },
});
