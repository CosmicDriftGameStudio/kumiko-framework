import { fileContextForTenant } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import {
  evaluateDocumentDraft,
  localeSchema,
  templateSlugSchema,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import type { HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { buildDocumentDraftPdfRequest } from "./document-pdf.ts";
import { postRender } from "./http-client.ts";
import { loadClientConfigOrUnavailable } from "./render.ts";
import { clientErrorForRenderFailure } from "./render-and-store.ts";

// Each call prints a full PDF in Chromium, so the cap is generous for editing but not unlimited.
export const PREVIEW_RATE_LIMIT = { limit: 60, windowSeconds: 3600 } as const;
export const PREVIEW_ACCESS = { roles: ["TenantAdmin", "SystemAdmin"] };

export const previewDraftSchema = z.object({
  slug: templateSlugSchema,
  locale: localeSchema,
  content: z.string().max(200_000),
  meta: z.unknown().optional(),
  variableSchema: z.record(z.string(), z.unknown()).default({}),
});

export type PreviewDraft = z.infer<typeof previewDraftSchema>;

export type PrintedPreview = {
  readonly fileName: string;
  readonly pdfBytes: Uint8Array;
  readonly startedAt: number;
};

// The draft passes the same write rules as a save; nothing is stored.
export async function printPreviewDraft(
  draft: PreviewDraft,
  user: SessionUser,
  ctx: HandlerContext,
): Promise<PrintedPreview> {
  const draftScope = user.roles.includes("SystemAdmin") ? "system" : "tenant";
  const evaluated = await evaluateDocumentDraft(ctx, user, draftScope, draft);
  if (!evaluated.ok) throw evaluated.error;

  const startedAt = Date.now();
  const { slug, locale } = draft;
  try {
    const built = await buildDocumentDraftPdfRequest(
      {
        slug,
        locale,
        variables: evaluated.sampleValues,
        draftScope,
        draft: {
          content: evaluated.content,
          meta: evaluated.meta,
          variableSchema: evaluated.variableSchema,
        },
      },
      {
        db: ctx.db,
        registry: ctx.registry,
        tenantId: user.tenantId,
        ...(ctx.config !== undefined && { config: ctx.config }),
        filesForTenant: (fileTenantId) => fileContextForTenant(ctx, user.tenantId, fileTenantId),
      },
    );
    const printed = await postRender(loadClientConfigOrUnavailable(), {
      kind: "document-pdf",
      html: built.html,
      options: built.options,
    });
    return { fileName: built.fileName, pdfBytes: printed.bytes, startedAt };
  } catch (e) {
    throw clientErrorForRenderFailure(e, ctx, slug);
  }
}
