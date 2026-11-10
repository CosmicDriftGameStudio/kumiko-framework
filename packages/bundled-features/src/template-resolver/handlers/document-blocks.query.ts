import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, ValidationError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { allowedBlocksFor } from "../document-op-blocks.ts";
import { documentBlocksOf } from "../document-ops.ts";
import { parseDocumentJson } from "../document-sanitizer.ts";
import { resolveTemplateVariables } from "../template-validation.ts";
import { loadDocumentBase } from "./document-base.ts";
import { documentTargetShape, editableHtmlOf, regionIssue } from "./document-region.ts";
import { localeSchema, templateSlugSchema } from "./shared.ts";
import { knownResourceKeysFor } from "./validate.query.ts";

export const documentBlocksQuery = defineQueryHandler({
  name: "document-blocks",
  schema: z.object({
    slug: templateSlugSchema,
    ...documentTargetShape,
    locale: localeSchema,
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Reads a mail template, a PDF document template or, with kind pdf-layout and a region (header, signature, footer), one region of a PDF layout as a list of blocks with stable ids (b0, b1, ...) for structured editing with patch-draft: each block has its type (paragraph, heading, list, table, repeat, frame with its position in mm, image, button, divider, pageBreak, steps), its text with {{name}} placeholders and its settings, plus the meta, the stored and effective variables (variablesDeclaredByFeature is true when a notification declares them, so they cannot be changed), the block types allowed for the kind (a frame only in document-pdf) and the uploaded image keys. It reads the caller's own version (the open draft if there is one), else the served system default; base carries the scope and version that patch-draft expects back.",
  handler: async (query, ctx) => {
    const { slug, kind, region, locale } = query.payload;
    const misplacedRegion = regionIssue(kind, region);
    if (misplacedRegion !== null) {
      throw new ValidationError({ fields: [misplacedRegion] });
    }
    const loaded = await loadDocumentBase(ctx, query.user, { slug, kind, locale });
    if (loaded === null) throw new NotFoundError("template-resource", slug);
    return {
      slug,
      kind,
      ...(region === undefined ? {} : { region }),
      locale,
      base: loaded.base,
      status: loaded.status,
      blocks: documentBlocksOf(parseDocumentJson(editableHtmlOf(kind, region, loaded.content))),
      meta: loaded.meta,
      variableSchema: loaded.variableSchema,
      variables: resolveTemplateVariables(ctx.registry, slug, loaded.variableSchema),
      variablesDeclaredByFeature:
        ctx.registry.getAllNotifications().get(slug)?.variables !== undefined,
      allowedBlocks: allowedBlocksFor(kind),
      resourceKeys: await knownResourceKeysFor(ctx, query.user, {
        slug,
        kind,
        scope: "tenant",
        locale,
      }),
    };
  },
});
