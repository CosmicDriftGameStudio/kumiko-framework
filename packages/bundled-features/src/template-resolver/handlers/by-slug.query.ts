import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  crossTenantOverrideDenied,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { TEXT_BLOCK_KIND } from "../constants";
import { type TemplateResourceRow, templateResourcesTable } from "../table";

// Public read of a single text-block by (tenantId, slug, locale). Anonymous
// must be listed explicitly — `openToAll` alone is auth-only (regression
// guard). The kind is pinned to `text-block`: mail templates and AI prompts
// live in the same table and must not be readable without a session.
//
// Tenant scope defaults to query.user.tenantId (an anonymous context resolves
// to SYSTEM_TENANT_ID or the host-resolved tenant, depending on app setup).
// Optional `tenantIdOverride` (SystemAdmin-only) allows a cross-tenant read —
// symmetric to set.write.
export const bySlugQuery = defineQueryHandler({
  name: "by-slug",
  schema: z.object({
    slug: z.string().min(1).max(80),
    locale: z.string().min(2).max(8),
    /** Optional cross-tenant read — SystemAdmin only. See set.write.ts. */
    tenantIdOverride: z.string().min(1).optional(),
  }),
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const override = query.payload.tenantIdOverride;
    const overrideDenied = crossTenantOverrideDenied(
      query.user,
      override,
      "templateResolver.errors.tenantOverrideRequiresSystemAdmin",
    );
    if (overrideDenied) throw overrideDenied;
    const tenantId = override ?? query.user.tenantId;
    const row = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
      tenantId,
      slug: query.payload.slug,
      kind: TEXT_BLOCK_KIND,
      locale: query.payload.locale,
    });

    if (!row) return null;
    return {
      slug: row.slug,
      locale: row.locale,
      title: row.title,
      content: row.content,
      folder: row.folder,
      updatedAt: row.updatedAt,
    };
  },
});
