import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  crossTenantOverrideDenied,
  defineWriteHandler,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { type PageRow, pageEntity, pagesTable } from "../table";

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

// Upsert einer Page — eine Operation pro (tenantId, slug, lang). Tenant-
// Scope default aus event.user; SystemAdmin kann via `tenantIdOverride`
// für einen anderen Tenant schreiben (typisch SYSTEM_TENANT_ID für app-
// weite Pages). published/description/ogImage werden bei Update preserved
// wenn im Payload weggelassen (undefined) — damit ein Publish-Toggle nicht
// den Body überschreiben muss und umgekehrt.
export const setWrite = defineWriteHandler({
  name: "set",
  schema: z.object({
    slug: slugSchema,
    lang: langSchema,
    title: z.string().min(1).max(200),
    body: z.string().max(100_000).nullable(),
    description: z.string().max(500).nullable().optional(),
    ogImage: z.string().max(2000).nullable().optional(),
    published: z.boolean().optional(),
    /** Cross-tenant write — nur SystemAdmin (z.B. SYSTEM_TENANT_ID-Pages). */
    tenantIdOverride: z.string().min(1).optional(),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    const db = ctx.db;
    const override = event.payload.tenantIdOverride;
    const overrideDenied = crossTenantOverrideDenied(
      event.user,
      override,
      "managedPages.errors.tenantOverrideRequiresSystemAdmin",
    );
    if (overrideDenied) return writeFailure(overrideDenied);
    const tenantId = override ?? event.user.tenantId;
    // override: point the executor context at the target tenant, else getStreamVersion runs against user.tenantId → version_conflict.
    const executorUser =
      override !== undefined ? { ...event.user, tenantId: override as TenantId } : event.user; // @cast-boundary engine-bridge

    // ctx.db is scoped to the executing user's tenant, wrong for a cross-tenant override
    // on both the existing-check and the executor's stream reads; re-scope to the target.
    // Safe: the override branch is SystemAdmin-gated above.
    const scopedDb =
      override !== undefined ? createTenantDb(db.raw, override as TenantId, "tenant") : db; // @cast-boundary engine-bridge
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
            body: event.payload.body,
            description:
              event.payload.description !== undefined
                ? event.payload.description
                : existing.description,
            ogImage: event.payload.ogImage !== undefined ? event.payload.ogImage : existing.ogImage,
            published:
              event.payload.published !== undefined ? event.payload.published : existing.published,
          },
        },
        executorUser,
        scopedDb,
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
        body: event.payload.body,
        description: event.payload.description ?? null,
        ogImage: event.payload.ogImage ?? null,
        published: event.payload.published ?? false,
        tenantId,
      },
      executorUser,
      scopedDb,
    );
    if (!result.isSuccess) return result;
    return {
      isSuccess: true as const,
      data: { slug: event.payload.slug, lang: event.payload.lang, isNew: true },
    };
  },
});
