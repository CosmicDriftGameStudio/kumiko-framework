import { createEventStoreExecutor, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { requireForTenant } from "../../shared/index.ts";
import { BODY_FORMATS, DEFAULT_BODY_FORMAT } from "../constants.ts";
import { type PageRow, pageEntity, pagesTable } from "../table.ts";
import { sanitizePageBody } from "./page-body-issues.ts";

const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be kebab-case (lowercase, digits, dashes)");

const langSchema = z
  .string()
  .min(2)
  .max(8)
  .regex(/^[a-z]{2}(-[a-z]{2})?$/i, "lang must be ISO 639-1 (e.g. de, en, en-us)");

const executor = createEventStoreExecutor(pagesTable, pageEntity, { entityName: "page" });

// Upserts one page per (tenantId, slug, lang). The tenant scope defaults to event.user;
// SystemAdmin can write to another tenant via `tenantIdOverride` (typically SYSTEM_TENANT_ID
// for app-wide pages). On update, omitted published/description/ogImage values are preserved
// so a publish toggle does not overwrite the body, and vice versa. bodyFormat is the
// exception: omitted means markdown, so provisioning callers that only know markdown stay valid.
export const setWrite = defineWriteHandler({
  name: "set",
  schema: z.object({
    slug: slugSchema,
    lang: langSchema,
    title: z.string().min(1).max(200),
    body: z.string().max(100_000).nullable(),
    bodyFormat: z.enum(BODY_FORMATS).optional(),
    description: z.string().max(500).nullable().optional(),
    ogImage: z.string().max(2000).nullable().optional(),
    published: z.boolean().optional(),
    /** Cross-tenant write — only SystemAdmin (for example, SYSTEM_TENANT_ID pages). */
    tenantIdOverride: z.string().min(1).optional(),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Creates or overwrites one managed page addressed by slug and language, keeping the existing published flag, description and OG image when the payload omits them and resetting bodyFormat to markdown (the default) when it is omitted; use it for content edits and publish toggles, and as SystemAdmin to write another tenant's pages.",
  handler: async (event, ctx) => {
    const override = event.payload.tenantIdOverride;
    const tenantId = (override ?? event.user.tenantId) as TenantId; // @cast-boundary engine-bridge
    const bodyFormat = event.payload.bodyFormat ?? DEFAULT_BODY_FORMAT;
    const sanitized = sanitizePageBody(event.payload.body, bodyFormat);
    if (!sanitized.ok) return writeFailure(new ValidationError({ fields: sanitized.issues }));
    const { body } = sanitized;
    // ctx.db is scoped to the executing user's tenant, wrong for a cross-tenant override
    // on both the existing-check and the executor's stream reads; re-scope to the target.
    const { db: scopedDb, streamTenantId } = requireForTenant(ctx, tenantId);
    const existing = await fetchOne<PageRow>(scopedDb, pagesTable, {
      tenantId,
      slug: event.payload.slug,
      lang: event.payload.lang,
    });

    if (existing) {
      const result = await executor.update(
        {
          id: existing.id,
          version: existing.version,
          changes: {
            title: event.payload.title,
            body,
            bodyFormat,
            description:
              event.payload.description !== undefined
                ? event.payload.description
                : existing.description,
            ogImage: event.payload.ogImage !== undefined ? event.payload.ogImage : existing.ogImage,
            published:
              event.payload.published !== undefined ? event.payload.published : existing.published,
          },
        },
        event.user,
        scopedDb,
        { streamTenantId },
      );
      if (!result.isSuccess) return result;
      return {
        isSuccess: true as const,
        data: { slug: event.payload.slug, lang: event.payload.lang, isNew: false },
      };
    }

    const result = await executor.create(
      {
        slug: event.payload.slug,
        lang: event.payload.lang,
        title: event.payload.title,
        body,
        bodyFormat,
        description: event.payload.description ?? null,
        ogImage: event.payload.ogImage ?? null,
        published: event.payload.published ?? false,
        tenantId,
      },
      event.user,
      scopedDb,
      { streamTenantId },
    );
    if (!result.isSuccess) return result;
    return {
      isSuccess: true as const,
      data: { slug: event.payload.slug, lang: event.payload.lang, isNew: true },
    };
  },
});
