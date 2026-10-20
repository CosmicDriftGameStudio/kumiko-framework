import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { documentBlocksOf } from "../document-ops.ts";
import { parseDocumentJson } from "../document-sanitizer.ts";
import { resolveTemplateVariables } from "../template-validation.ts";
import { DOCUMENT_HTML_KINDS } from "../web/constants.ts";
import { documentBlocksForKind } from "../web/document-blocks.ts";
import { loadDocumentBase } from "./document-base.ts";
import { localeSchema, templateSlugSchema } from "./shared.ts";
import { knownResourceKeysFor } from "./validate.query.ts";

export const documentBlocksQuery = defineQueryHandler({
  name: "document-blocks",
  schema: z.object({
    slug: templateSlugSchema,
    kind: z.enum(DOCUMENT_HTML_KINDS),
    locale: localeSchema,
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Reads a mail or PDF document template as a list of blocks with stable ids (b0, b1, ...) for structured editing: each block has its type (paragraph, heading, list, table, repeat, image, button, divider, pageBreak, steps), its text with {{name}} placeholders and its settings, plus the meta, the stored and effective variables (variablesDeclaredByFeature is true when a notification declares them, so they cannot be changed), the block types allowed for the kind and the uploaded image keys. It reads the caller's own version (the open draft if there is one), else the served system default; base carries the scope and version that patch-draft expects back.",
  handler: async (query, ctx) => {
    const { slug, kind, locale } = query.payload;
    const loaded = await loadDocumentBase(ctx, query.user, { slug, kind, locale });
    if (loaded === null) throw new NotFoundError("template-resource", slug);
    return {
      slug,
      kind,
      locale,
      base: loaded.base,
      status: loaded.status,
      blocks: documentBlocksOf(parseDocumentJson(loaded.content)),
      meta: loaded.meta,
      variableSchema: loaded.variableSchema,
      variables: resolveTemplateVariables(ctx.registry, slug, loaded.variableSchema),
      variablesDeclaredByFeature:
        ctx.registry.getAllNotifications().get(slug)?.variables !== undefined,
      allowedBlocks: documentBlocksForKind(kind),
      resourceKeys: await knownResourceKeysFor(ctx, query.user, {
        slug,
        kind,
        scope: "tenant",
        locale,
      }),
    };
  },
});
