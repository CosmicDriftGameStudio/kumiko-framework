import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  defineQueryHandler,
  type HandlerContext,
  type SessionUser,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import type { ContentFormat, UpsertKind } from "../constants.ts";
import type { TemplateWriteScope } from "../layout-regions.ts";
import { imageResourceKeysOf } from "../linked-resources.ts";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import { isSystemAdmin } from "../template-draft.ts";
import { resolveTemplateVariables, systemPlaceholdersFor } from "../template-validation.ts";
import { contentFormatSchema, kindSchema, localeSchema, templateSlugSchema } from "./shared.ts";
import { evaluateTemplateWrite } from "./template-gates.ts";

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
  return rows.flatMap((row) => imageResourceKeysOf(row.linkedResources));
}

type TemplateDraftInput = {
  readonly slug: string;
  readonly kind: UpsertKind;
  readonly contentFormat: ContentFormat;
  readonly content: string;
  readonly meta?: unknown;
  readonly variableSchema: Readonly<Record<string, unknown>>;
  readonly locale?: string | undefined;
  readonly scope: TemplateWriteScope;
};

// The dry run of the write pipeline; preview feeds on the evaluation, validate returns the response.
export async function validateTemplateDraft(
  ctx: HandlerContext,
  user: SessionUser,
  payload: TemplateDraftInput,
) {
  const variables = resolveTemplateVariables(ctx.registry, payload.slug, payload.variableSchema);
  const { slug, kind, locale } = payload;
  // The dry run must not promise what the caller's write handlers would refuse.
  const scope: TemplateWriteScope = isSystemAdmin(user) ? payload.scope : "tenant";
  const known = [
    ...(await knownResourceKeys(ctx.db, {
      tenantId: SYSTEM_TENANT_ID,
      slug,
      kind,
      scope: "system",
      locale,
    })),
    ...(scope === "tenant"
      ? await knownResourceKeys(ctx.db, { tenantId: user.tenantId, slug, kind, scope, locale })
      : []),
  ];
  const evaluation = evaluateTemplateWrite({
    kind,
    scope,
    contentFormat: payload.contentFormat,
    content: payload.content,
    rawMeta: payload.meta,
    variables,
    resourceKeys: known,
  });
  const validation = evaluation.validation;
  const response = {
    canSave: evaluation.ok,
    canPublish: evaluation.ok && evaluation.publishIssues.length === 0,
    issues: evaluation.ok ? [] : [...evaluation.issues],
    publishIssues: evaluation.ok ? [...evaluation.publishIssues] : [],
    used: [...(validation?.used ?? [])],
    unknown: [...(validation?.unknown ?? [])],
    missingRequired: [...(validation?.missingRequired ?? [])],
    warnings: (validation?.unknownResources ?? []).map((key) => ({
      code: "resource_not_uploaded" as const,
      detail: key,
      i18nKey: "templateResolver.warnings.resourceNotUploaded" as const,
    })),
    variables,
    systemPlaceholders: [...systemPlaceholdersFor(kind)].sort(),
  };
  return { response, evaluation };
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
  handler: async (query, ctx) =>
    (await validateTemplateDraft(ctx, query.user, query.payload)).response,
});
