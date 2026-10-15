import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { resolveTemplateVariables, systemPlaceholdersFor } from "../template-validation.js";
import { contentFormatSchema, kindSchema, templateSlugSchema } from "./shared.js";
import { evaluateTemplateWrite } from "./template-gates.js";

export const validateQuery = defineQueryHandler({
  name: "validate",
  schema: z.object({
    slug: templateSlugSchema,
    kind: kindSchema,
    contentFormat: contentFormatSchema,
    content: z.string().max(200_000),
    meta: z.unknown().optional(),
    variableSchema: z.record(z.string(), z.unknown()).default({}),
    linkedResources: z.record(z.string(), z.string()).default({}),
    scope: z.enum(["tenant", "system"]).default("tenant"),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Dry-runs the write pipeline for a template draft without saving: reports whether it can be saved or published, the sanitizer and placeholder problems, which placeholders it uses, which are unknown, which required variables are missing, and the variables and system placeholders available for the kind; use it to give an editor live feedback.",
  handler: async (query, ctx) => {
    const payload = query.payload;
    const variables = resolveTemplateVariables(ctx.registry, payload.slug, payload.variableSchema);
    const result = evaluateTemplateWrite({
      kind: payload.kind,
      scope: payload.scope,
      contentFormat: payload.contentFormat,
      content: payload.content,
      rawMeta: payload.meta,
      variables,
      resourceKeys: Object.keys(payload.linkedResources),
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
      variables,
      systemPlaceholders: [...systemPlaceholdersFor(payload.kind)].sort(),
    };
  },
});
