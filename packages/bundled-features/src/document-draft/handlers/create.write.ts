import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { joinRowParentIsVisible } from "../../shared/index.ts";
import {
  createTemplateResolverApi,
  isVariantSlugOf,
  readVariantOf,
  sanitizeDocumentHtml,
  TemplateNotFoundError,
  VARIANT_UNKNOWN_REASON,
} from "../../template-resolver/index.ts";
import { documentDraftExecutor } from "../entity.ts";
import { draftNotFound } from "../lib.ts";
import { createDraftSchema } from "../payloads.ts";
import {
  DOCUMENT_DRAFT_ENTITY,
  DOCUMENT_DRAFT_ERROR,
  DOCUMENT_DRAFT_LAST_CHANGE_SOURCE,
  DOCUMENT_DRAFT_STATUS,
} from "../web/constants.ts";

type CreateData = { readonly id: string; readonly version: number };

export function createCreateHandler(
  access: AccessRule,
  subjectTypes: readonly [string, ...string[]],
) {
  const schema = createDraftSchema(subjectTypes);
  return defineWriteHandler<"create", typeof schema, CreateData>({
    name: "create",
    schema,
    access,
    agent: { expose: false },
    description:
      "Creates the editable draft of a PDF document template for one object (subjectType, subjectId), optionally from a variant of the template: the template text with its placeholders is copied, the values are frozen with the draft and the template itself stays unchanged. Returns the draft id and version.",
    handler: async (event, ctx) => {
      const { subjectType, subjectId, templateSlug, variant, locale, variables } = event.payload;
      const user = event.user;
      const subjectIsVisible = await joinRowParentIsVisible(
        ctx.registry,
        DOCUMENT_DRAFT_ENTITY,
        { subjectType, subjectId },
        user,
        ctx.db,
      );
      if (!subjectIsVisible) return draftNotFound();
      if (variant !== undefined && !isVariantSlugOf(variant, templateSlug)) {
        return variantUnknown(variant);
      }

      const api = createTemplateResolverApi(ctx.db, ctx.registry);
      let resource: Awaited<ReturnType<typeof api.resolveTemplate>>;
      try {
        resource = await api.resolveTemplate({
          tenantId: user.tenantId,
          slug: variant ?? templateSlug,
          kind: "document-pdf",
          locale,
        });
      } catch (e) {
        if (!(e instanceof TemplateNotFoundError)) throw e;
        if (variant !== undefined) return variantUnknown(variant);
        return writeFailure(
          new UnprocessableError(DOCUMENT_DRAFT_ERROR.TemplateNotFound, {
            i18nKey: "documentDraft.errors.templateNotFound",
            i18nParams: { slug: templateSlug },
          }),
        );
      }
      if (variant !== undefined && readVariantOf(resource.meta) !== templateSlug) {
        return variantUnknown(variant);
      }

      // Same normalization the editor save applies, so an unchanged save shows no deviation.
      const normalized = sanitizeDocumentHtml(resource.content);
      const startContent = normalized.ok ? normalized.html : resource.content;

      const created = await documentDraftExecutor.create(
        {
          subjectType,
          subjectId,
          templateSlug,
          templateVariant: variant ?? null,
          templateTitle: resource.title,
          templateId: resource.id,
          templateVersion: resource.version,
          templateScope: resource.scope,
          locale,
          body: startContent,
          templateBody: startContent,
          variables,
          meta: resource.meta ?? {},
          variableSchema: resource.variableSchema,
          status: DOCUMENT_DRAFT_STATUS.Open,
          revision: 1,
          lastChange: { source: DOCUMENT_DRAFT_LAST_CHANGE_SOURCE.Create },
        },
        user,
        ctx.db,
      );
      if (!created.isSuccess) return created;
      return {
        isSuccess: true,
        data: { id: String(created.data.id), version: created.data.event.version },
      };
    },
  });
}

function variantUnknown(variant: string) {
  return writeFailure(
    new UnprocessableError(VARIANT_UNKNOWN_REASON, {
      i18nKey: "templateResolver.errors.variantUnknown",
      i18nParams: { variant },
    }),
  );
}
