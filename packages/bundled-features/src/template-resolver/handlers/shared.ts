import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import * as z from "zod";
import { templateResourceEntity, templateResourcesTable } from "../table.ts";
import { templateSlugSchema } from "../template-meta.ts";
import { CONTENT_FORMATS, TEMPLATE_STATUSES, UPSERT_KINDS } from "../web/constants.ts";

// One executor per bundle, shared by all four handlers for create/update via
// event store + optimistic lock.
export const executor = createEventStoreExecutor(templateResourcesTable, templateResourceEntity, {
  entityName: "template-resource",
});

// Slug regex follows the plan-doc naming convention.
export const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be kebab-case (lowercase, digits, dashes)");

export { templateSlugSchema };

export const localeSchema = z
  .string()
  .min(2)
  .max(8)
  .regex(/^[a-z]{2}(-[a-z]{2})?$/i, "locale must be ISO 639-1 (e.g. de, en, en-us)");

export const kindSchema = z.enum(UPSERT_KINDS);

// Folder path for the content tree: kebab segments joined by `/`.
export const folderSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/, "folder must be kebab-case path");

export const titleSchema = z.string().min(1).max(200);
export const contentFormatSchema = z.enum(CONTENT_FORMATS);
export const statusSchema = z.enum(TEMPLATE_STATUSES);

// Common upsert payload shared by upsertSystem and upsertTenant.
// Only ACL and tenantId determination differ.
export const upsertPayloadSchema = z.object({
  slug: templateSlugSchema,
  kind: kindSchema,
  locale: localeSchema,
  content: z.string().max(200_000),
  contentFormat: contentFormatSchema,
  variableSchema: z.record(z.string(), z.unknown()).default({}),
  // Shape depends on kind; validated against template-meta.ts in the handler so
  // problems surface as field issues on `meta.*`.
  meta: z.unknown().optional(),
  parentTemplateId: z.string().min(1).optional(),
  title: titleSchema.nullable().optional(),
  folder: folderSchema.nullable().optional(),
});
