import { fileContextForTenant } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import {
  evaluateDocumentDraft,
  localeSchema,
  templateSlugSchema,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { buildDocumentDraftPdfRequest } from "./document-pdf.ts";
import { postRender } from "./http-client.ts";
import { countPdfPages } from "./pdf-page-count.ts";
import { loadClientConfigOrUnavailable } from "./render.ts";
import { clientErrorForRenderFailure } from "./render-and-store.ts";

// Each call prints a full PDF in Chromium, so the cap is generous for editing but not unlimited.
const PREVIEW_PDF_RATE_LIMIT = { limit: 60, windowSeconds: 3600 } as const;

export const previewPdfQuery = defineQueryHandler({
  name: "preview-pdf",
  schema: z.object({
    slug: templateSlugSchema,
    locale: localeSchema,
    content: z.string().max(200_000),
    meta: z.unknown().optional(),
    variableSchema: z.record(z.string(), z.unknown()).default({}),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  rateLimit: { per: "user+handler", ...PREVIEW_PDF_RATE_LIMIT },
  description:
    "Prints a document template draft to a real PDF with sample values taken from the declared variable examples, without saving anything: the draft passes the same write rules as a save and the stored template is not read for its body; returns the file name, the PDF as base64, the page count, the size and the render time. While the PDF service does not answer it fails with puppeteer_unavailable (HTTP 503).",
  handler: async (query, ctx) => {
    const draftScope = query.user.roles.includes("SystemAdmin") ? "system" : "tenant";
    const draft = await evaluateDocumentDraft(ctx, query.user, draftScope, query.payload);
    if (!draft.ok) throw draft.error;

    const startedAt = Date.now();
    const { slug, locale } = query.payload;
    try {
      const built = await buildDocumentDraftPdfRequest(
        {
          slug,
          locale,
          variables: draft.sampleValues,
          draftScope,
          draft: {
            content: draft.content,
            meta: draft.meta,
            variableSchema: draft.variableSchema,
          },
        },
        {
          db: ctx.db,
          registry: ctx.registry,
          tenantId: query.user.tenantId,
          ...(ctx.config !== undefined && { config: ctx.config }),
          filesForTenant: (fileTenantId) =>
            fileContextForTenant(ctx, query.user.tenantId, fileTenantId),
        },
      );
      const printed = await postRender(loadClientConfigOrUnavailable(), {
        kind: "document-pdf",
        html: built.html,
        options: built.options,
      });
      return {
        fileName: built.fileName,
        pdfBase64: Buffer.from(printed.bytes).toString("base64"),
        pageCount: countPdfPages(printed.bytes),
        sizeBytes: printed.bytes.byteLength,
        durationMs: Date.now() - startedAt,
      };
    } catch (e) {
      throw clientErrorForRenderFailure(e, ctx, slug);
    }
  },
});
