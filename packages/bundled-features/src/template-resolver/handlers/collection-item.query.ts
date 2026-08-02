import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  crossTenantOverrideDenied,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { TEMPLATE_KINDS } from "../constants";
import { type TemplateResourceRow, templateResourcesTable } from "../table";

// Single resource of a collection, for the editor behind a tree node. The
// admin-only counterpart to by-slug — see collection-list for why the public
// and the admin read are two handlers instead of one with a `kind` parameter.
export const collectionItemQuery = defineQueryHandler({
  name: "collection-item",
  schema: z.object({
    slug: z.string().min(1).max(80),
    kind: z.enum(TEMPLATE_KINDS),
    locale: z.string().min(2).max(8),
    /** Optional cross-tenant read — SystemAdmin only. See set.write.ts. */
    tenantIdOverride: z.string().min(1).optional(),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
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
      kind: query.payload.kind,
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
