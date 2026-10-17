import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  RENDERER_EXTENSION,
  RendererError,
  type RenderRequest,
  type RenderResponse,
} from "../renderer-foundation/index.js";
import { pdfTableDocumentSchema, renderTablePdf } from "./render-table-pdf.js";

export async function renderTablePdfRequest(req: RenderRequest): Promise<RenderResponse> {
  if (req.kind !== "document-pdf") {
    throw new RendererError(
      `renderer-pdf supports only kind="document-pdf", got "${req.kind}"`,
      "invalid_payload",
    );
  }
  const parsed = pdfTableDocumentSchema.safeParse(req.payload.variables);
  if (!parsed.success) {
    throw new RendererError(
      `renderer-pdf: payload.variables is not a table document: ${parsed.error.message}`,
      "invalid_payload",
    );
  }
  const { pdfBytes, pageCount } = await renderTablePdf(parsed.data, {
    ...(req.options?.format && { format: req.options.format }),
    ...(req.options?.marginMm && { marginMm: req.options.marginMm }),
  });
  return {
    kind: "document-pdf",
    pdfBytes,
    pageCount,
    sizeBytes: pdfBytes.byteLength,
    fileName: `${req.payload.slug}.pdf`,
  };
}

export function createRendererPdfFeature(): FeatureDefinition {
  return defineFeature("renderer-pdf", (r) => {
    r.describe(
      'Renderer plugin for `kind="document-pdf"` that draws a table document (title, meta lines, weighted columns, repeating header, page footer) as a PDF in pure JavaScript, without a browser or Puppeteer service. `payload.variables` must be a `PdfTableDocument`. Requires `renderer-foundation`; mount a Puppeteer-based plugin instead when you need HTML/CSS layouts.',
    );
    r.uiHints({
      displayLabel: "Renderer · PDF tables",
      category: "notifications",
      recommended: false,
    });
    r.requires({ features: ["renderer-foundation"] });

    r.useExtension(RENDERER_EXTENSION, "pdf", {
      kinds: ["document-pdf"] as const,
      render: (req) => renderTablePdfRequest(req),
    });
  });
}
