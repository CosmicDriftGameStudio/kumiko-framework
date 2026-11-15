import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  NotFoundError,
  ValidationError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { patchIssue } from "../document-op-blocks.ts";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import {
  refuseTemplateEdit,
  type TemplateEditPolicy,
  templateEditAccess,
} from "../template-edit-policy.ts";
import { resolveTemplateVariables } from "../template-validation.ts";
import {
  VARIANT_KIND,
  variantNameFromTitle,
  variantNameSchema,
  variantSlug,
} from "../template-variants.ts";
import { FALLBACK_LOCALE } from "../web/constants.ts";
import { TemplateResolverErrors } from "../web/qualified-names.ts";
import { loadDocumentBase } from "./document-base.ts";
import { localeSchema, templateSlugSchema, titleSchema } from "./shared.ts";
import { writeTemplateRow } from "./template-write.ts";

function variantsNotEnabled(policy: TemplateEditPolicy, baseSlug: string): WriteFailure | null {
  const entry = policy.tenantEditable.find(
    (candidate) => candidate.kind === VARIANT_KIND && candidate.slug === baseSlug,
  );
  if (entry?.variants === true) return null;
  return writeFailure(
    new ValidationError({
      fields: [
        patchIssue("baseSlug", TemplateResolverErrors.variantsNotEnabled, { slug: baseSlug }),
      ],
    }),
  );
}

function variantNameInvalid(): WriteFailure {
  return writeFailure(
    new ValidationError({
      fields: [patchIssue("name", TemplateResolverErrors.variantNameInvalid)],
    }),
  );
}

export function makeCreateVariantWrite(policy: TemplateEditPolicy) {
  return defineWriteHandler({
    name: "create-variant",
    schema: z.object({
      baseSlug: templateSlugSchema,
      // A form sends an untouched text field as "": same as no name, the title then supplies it.
      name: z.union([variantNameSchema, z.literal("")]).optional(),
      title: titleSchema,
      locale: localeSchema.default(FALLBACK_LOCALE),
    }),
    access: templateEditAccess(policy.tenantEditable),
    agent: { risk: "low", effect: "proposal" },
    description:
      "Creates a variant of a PDF document template of the caller's tenant (a second version of the same document, e.g. a rental contract for commercial use) as a draft under the slug <baseSlug>:<name> (name is kebab-case, at most 40 characters, and is derived from the title when omitted; locale defaults to de) with the given title. The draft starts as a copy of the base template as the caller sees it (content, variables, linked images and settings including the layout); the variables stay those of the base and cannot be changed on the variant. It fails with variants_not_enabled when the app did not allow variants for the base template (this also applies to a TenantAdmin) and with variant_exists when the tenant already has that slug. Returns the variant slug, locale, kind, title and base ({scope, version}) for the next call. Next steps: change the text with patch-draft (kind document-pdf, the returned slug), then let a person publish it with publish-templates; a variant needs the same required placeholders as its base before it can be published. The variants query lists the published variants of a base.",
    handler: async (event, ctx) => {
      const { baseSlug, title, locale } = event.payload;
      const name = event.payload.name || variantNameFromTitle(title);
      if (!variantNameSchema.safeParse(name).success) return variantNameInvalid();
      const refused = refuseTemplateEdit(policy, event.user, {
        slug: baseSlug,
        kind: VARIANT_KIND,
      });
      if (refused !== null) return refused;
      const disabled = variantsNotEnabled(policy, baseSlug);
      if (disabled !== null) return disabled;

      const slug = variantSlug(baseSlug, name);
      if (!templateSlugSchema.safeParse(slug).success) return variantNameInvalid();
      const existing = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
        tenantId: event.user.tenantId,
        slug,
        kind: VARIANT_KIND,
        locale,
      });
      if (existing !== undefined) {
        return writeFailure(
          new ValidationError({
            fields: [patchIssue("name", TemplateResolverErrors.variantExists, { slug })],
          }),
        );
      }

      const loaded = await loadDocumentBase(ctx, event.user, {
        slug: baseSlug,
        kind: VARIANT_KIND,
        locale,
      });
      if (loaded === null) return writeFailure(new NotFoundError("template-resource", baseSlug));

      const written = await writeTemplateRow({
        linkedResources: loaded.linkedResources ?? "{}",
        ctx,
        user: event.user,
        tenantId: event.user.tenantId,
        scope: "tenant",
        status: "draft",
        variables: resolveTemplateVariables(ctx.registry, slug, loaded.variableSchema),
        payload: {
          slug,
          kind: VARIANT_KIND,
          locale,
          content: loaded.content,
          contentFormat: "html",
          variableSchema: loaded.variableSchema,
          meta: { ...loaded.meta, variantOf: baseSlug },
          title,
        },
        expectedVersion: null,
      });
      if (!written.isSuccess) return written;
      return {
        isSuccess: true as const,
        data: {
          slug,
          locale,
          kind: VARIANT_KIND,
          title,
          base: { scope: "tenant" as const, version: written.data.version },
        },
      };
    },
  });
}
