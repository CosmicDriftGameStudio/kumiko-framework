import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { z } from "zod";
import { CONTENT_FORMATS, RENDER_KINDS, TEMPLATE_STATUSES } from "../constants";
import { templateResourceEntity, templateResourcesTable } from "../table";

// Single executor pro Bundle — Pattern aus text-content. Wird von allen
// 4 Handlers geteilt für create/update-Operationen mit Event-Store +
// Optimistic-Lock.
export const executor = createEventStoreExecutor(templateResourcesTable, templateResourceEntity, {
  entityName: "template-resource",
});

// Slug-Regex symmetrisch zu text-content + plan-doc naming-convention.
export const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be kebab-case (lowercase, digits, dashes)");

export const localeSchema = z
  .string()
  .min(2)
  .max(8)
  .regex(/^[a-z]{2}(-[a-z]{2})?$/i, "locale must be ISO 639-1 (e.g. de, en, en-us)");

export const kindSchema = z.enum(RENDER_KINDS);
export const contentFormatSchema = z.enum(CONTENT_FORMATS);
export const statusSchema = z.enum(TEMPLATE_STATUSES);

// Common Upsert-Payload — geteilt zwischen upsertSystem + upsertTenant.
// Unterschied: ACL + tenantId-Bestimmung, sonst identisch.
export const upsertPayloadSchema = z.object({
  slug: slugSchema,
  kind: kindSchema,
  locale: localeSchema,
  content: z.string().max(200_000),
  contentFormat: contentFormatSchema,
  variableSchema: z.record(z.string(), z.unknown()).default({}),
  linkedResources: z.record(z.string(), z.string()).default({}),
  parentTemplateId: z.string().min(1).optional(),
});
