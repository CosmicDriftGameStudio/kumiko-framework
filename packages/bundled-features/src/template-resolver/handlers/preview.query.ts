import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { renderTemplatePreview } from "../template-preview.js";
import { localeSchema, templateSlugSchema } from "./shared.js";

export const previewQuery = defineQueryHandler({
  name: "preview",
  schema: z.object({
    slug: templateSlugSchema,
    kind: z.enum(["mail", "document-pdf"]),
    locale: localeSchema,
    /** Without content the stored template is previewed. */
    content: z.string().max(200_000).optional(),
    meta: z.unknown().optional(),
    variableSchema: z.record(z.string(), z.unknown()).default({}),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Renders a template draft, or the stored template when no content is given, with sample values taken from the declared variable examples, without saving or sending anything: returns the mail subject, html and plain text with its inline images (a PDF template returns its body and layout regions instead), the sample values used, and checks for unresolved images, missing plain text, mail size and unused required placeholders; a draft that fails the write rules is rejected with the same problems as a save.",
  handler: async (query, ctx) => {
    const outcome = await renderTemplatePreview(ctx, query.user, query.payload);
    if (!outcome.ok) throw outcome.error;
    return outcome.preview;
  },
});
