import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  type ContentCollectionDefinition,
  crossTenantOverrideDenied,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { type TemplateResourceRow, templateResourcesTable } from "../table";
import { DEFAULT_COLLECTION_ACCESS, ownerFilter } from "./collection-shared";

// Single entry of one collection, for the editor behind a tree node. Same
// per-collection construction as collection-list — see there for why.
export function makeCollectionItemQuery(collection: ContentCollectionDefinition) {
  const isUserOwned = collection.ownership === "user";
  return defineQueryHandler({
    name: `${collection.id}-item`,
    schema: z.object({
      slug: z.string().min(1).max(80),
      locale: z.string().min(2).max(8),
      /** Optional cross-tenant read — SystemAdmin only. */
      tenantIdOverride: z.string().min(1).optional(),
    }),
    access: collection.access ?? DEFAULT_COLLECTION_ACCESS,
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
        kind: collection.kind,
        locale: query.payload.locale,
        ...ownerFilter(isUserOwned, query.user),
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
}
