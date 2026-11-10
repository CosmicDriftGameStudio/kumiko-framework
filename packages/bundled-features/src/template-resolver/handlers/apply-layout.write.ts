import { defineWriteHandler, type HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { createTemplateResolverApi, TemplateNotFoundError } from "../api.ts";
import {
  refuseTemplateEdit,
  type TemplateEditPolicy,
  templateEditAccess,
} from "../template-edit-policy.ts";
import { resolveTemplateVariables } from "../template-validation.ts";
import {
  DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY,
  FALLBACK_LOCALE,
  MAX_SELECTED_TEMPLATES,
} from "../web/constants.ts";
import { ConfigHandlers, TemplateResolverErrors } from "../web/qualified-names.ts";
import { loadDocumentBase } from "./document-base.ts";
import { failureReason } from "./failure-reason.ts";
import { localeSchema, templateSlugSchema } from "./shared.ts";
import { writeTemplateRow } from "./template-write.ts";

const templateRefSchema = z.object({ slug: templateSlugSchema, locale: localeSchema });

type TemplateRef = z.infer<typeof templateRefSchema>;
type SkippedTemplate = TemplateRef & { readonly reason: string };

async function applyLayoutToDraft(
  ctx: HandlerContext,
  user: HandlerContext["user"],
  layoutSlug: string,
  { slug, locale }: TemplateRef,
): Promise<SkippedTemplate | null> {
  const loaded = await loadDocumentBase(ctx, user, { slug, kind: "document-pdf", locale });
  if (loaded === null) return { slug, locale, reason: TemplateResolverErrors.notFound };
  const written = await writeTemplateRow({
    ctx,
    user,
    tenantId: user.tenantId,
    scope: "tenant",
    status: "draft",
    variables: resolveTemplateVariables(ctx.registry, slug, loaded.variableSchema),
    payload: {
      slug,
      kind: "document-pdf",
      locale,
      content: loaded.content,
      contentFormat: "html",
      variableSchema: loaded.variableSchema,
      meta: { ...loaded.meta, layoutSlug },
      title: loaded.title,
      folder: loaded.folder,
      parentTemplateId: loaded.parentTemplateId,
    },
    expectedVersion: loaded.base.scope === "tenant" ? loaded.base.version : null,
  });
  return written.isSuccess ? null : { slug, locale, reason: failureReason(written) };
}

export function makeApplyLayoutWrite(policy: TemplateEditPolicy) {
  return defineWriteHandler({
    name: "apply-layout",
    schema: z.object({
      layoutSlug: templateSlugSchema,
      target: z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("all") }),
        z.object({
          mode: z.literal("selected"),
          templates: z.array(templateRefSchema).min(1).max(MAX_SELECTED_TEMPLATES),
        }),
      ]),
    }),
    access: templateEditAccess(policy.tenantEditable),
    description:
      "Applies a PDF layout to the caller's PDF templates without copying it. Mode all sets the tenant's default PDF layout, which every PDF template that names no layout of its own follows; mode selected saves a tenant draft per listed template and locale that names the layout (text and placeholders stay as they are, a system template gets its own tenant version first) and returns the ones it refused or could not write in skipped with the reason. Nothing is published; use publish-templates for that. The caller needs the right to edit the layout, and for selected also each template. Returns applied and skipped (both empty for mode all).",
    handler: async (event, ctx) => {
      const { layoutSlug, target } = event.payload;
      const refused = refuseTemplateEdit(policy, event.user, {
        slug: layoutSlug,
        kind: "pdf-layout",
      });
      if (refused !== null) return refused;
      try {
        await createTemplateResolverApi(ctx.db, ctx.registry).resolveLayout({
          tenantId: event.user.tenantId,
          slug: layoutSlug,
          kind: "pdf-layout",
          locale: FALLBACK_LOCALE,
        });
      } catch (e) {
        if (!(e instanceof TemplateNotFoundError)) throw e;
        return writeFailure(
          new ValidationError(
            {
              fields: [
                {
                  path: "layoutSlug",
                  code: TemplateResolverErrors.layoutNotPublished,
                  i18nKey: "templateResolver.errors.layout_not_published",
                },
              ],
            },
            { i18nKey: "templateResolver.errors.layout_not_published" },
          ),
        );
      }

      const applied: TemplateRef[] = [];
      const skipped: SkippedTemplate[] = [];
      if (target.mode === "all") {
        const pointer = await ctx.dispatch.write(ConfigHandlers.set, {
          key: DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY,
          value: layoutSlug,
        });
        if (!pointer.isSuccess) return pointer;
        return {
          isSuccess: true as const,
          data: { applied, skipped },
        };
      }

      const seen = new Set<string>();
      for (const ref of target.templates) {
        const key = `${ref.slug}\u0000${ref.locale}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (refuseTemplateEdit(policy, event.user, { slug: ref.slug, kind: "document-pdf" })) {
          skipped.push({ ...ref, reason: TemplateResolverErrors.templateNotTenantEditable });
          continue;
        }
        const skip = await applyLayoutToDraft(ctx, event.user, layoutSlug, ref);
        if (skip === null) applied.push(ref);
        else skipped.push(skip);
      }
      return { isSuccess: true as const, data: { applied, skipped } };
    },
  });
}
