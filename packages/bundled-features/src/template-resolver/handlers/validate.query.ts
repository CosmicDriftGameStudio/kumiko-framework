import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import { resolveTemplateVariables, systemPlaceholdersFor } from "../template-validation.js";
import { contentFormatSchema, kindSchema, localeSchema, templateSlugSchema } from "./shared.js";
import { evaluateTemplateWrite, storedRecord } from "./template-gates.js";

async function knownResourceKeys(
  db: Parameters<typeof selectMany>[0],
  where: {
    readonly tenantId: string;
    readonly slug: string;
    readonly kind: string;
    readonly scope: "tenant" | "system";
    readonly locale: string | undefined;
  },
): Promise<string[]> {
  const rows = await selectMany<TemplateResourceRow>(db, templateResourcesTable, {
    tenantId: where.tenantId,
    slug: where.slug,
    kind: where.kind,
    scope: where.scope,
    ...(where.locale === undefined ? {} : { locale: where.locale }),
    ...(where.scope === "system" ? { status: "active" } : {}),
  });
  return rows.flatMap((row) => Object.keys(storedRecord(row.linkedResources)));
}

export const validateQuery = defineQueryHandler({
  name: "validate",
  schema: z.object({
    slug: templateSlugSchema,
    kind: kindSchema,
    contentFormat: contentFormatSchema,
    content: z.string().max(200_000),
    meta: z.unknown().optional(),
    variableSchema: z.record(z.string(), z.unknown()).default({}),
    /** Narrows the known resource keys to one locale's rows. */
    locale: localeSchema.optional(),
    scope: z.enum(["tenant", "system"]).default("tenant"),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Dry-runs the write pipeline for a template draft without saving: reports whether it can be saved or published, the sanitizer and placeholder problems, which placeholders it uses, which are unknown, which required variables are missing, and the variables and system placeholders available for the kind; use it to give an editor live feedback.",
  handler: async (query, ctx) => {
    const payload = query.payload;
    const variables = resolveTemplateVariables(ctx.registry, payload.slug, payload.variableSchema);
    const { slug, kind, scope, locale } = payload;
    const known = [
      ...(await knownResourceKeys(ctx.db, {
        tenantId: SYSTEM_TENANT_ID,
        slug,
        kind,
        scope: "system",
        locale,
      })),
      ...(scope === "tenant"
        ? await knownResourceKeys(ctx.db, {
            tenantId: query.user.tenantId,
            slug,
            kind,
            scope,
            locale,
          })
        : []),
    ];
    const result = evaluateTemplateWrite({
      kind: payload.kind,
      scope: payload.scope,
      contentFormat: payload.contentFormat,
      content: payload.content,
      rawMeta: payload.meta,
      variables,
      resourceKeys: known,
    });
    const validation = result.validation;
    return {
      canSave: result.ok,
      canPublish: result.ok && result.publishIssues.length === 0,
      issues: result.ok ? [] : [...result.issues],
      publishIssues: result.ok ? [...result.publishIssues] : [],
      used: [...(validation?.used ?? [])],
      unknown: [...(validation?.unknown ?? [])],
      missingRequired: [...(validation?.missingRequired ?? [])],
      warnings: (validation?.unknownResources ?? []).map((key) => ({
        code: "resource_not_uploaded" as const,
        detail: key,
        i18nKey: "templateResolver.warnings.resourceNotUploaded" as const,
      })),
      variables,
      systemPlaceholders: [...systemPlaceholdersFor(payload.kind)].sort(),
    };
  },
});
