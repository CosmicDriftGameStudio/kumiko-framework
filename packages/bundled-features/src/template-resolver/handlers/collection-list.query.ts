import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { castTenantRows } from "@cosmicdrift/kumiko-framework/db";
import {
  type ContentCollectionDefinition,
  crossTenantOverrideDenied,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { type TemplateResourceRow, templateResourcesTable } from "../table";
import { DEFAULT_COLLECTION_ACCESS, ownerFilter } from "./collection-shared";

// One list handler per declared collection: `kind`, `ownership` and `access`
// come from the declaration, never from the payload.
//
// Why per collection instead of one handler taking a kind: `access` is then
// the handler's own rule and the dispatcher enforces it. A shared handler
// would have to admit the union of every collection's roles and sort them out
// in its body — one bug there and a prompt engineer's collection is open to
// everyone who may edit a signature.
export function makeCollectionListQuery(collection: ContentCollectionDefinition) {
  const isUserOwned = collection.ownership === "user";
  return defineQueryHandler({
    name: `${collection.id}-list`,
    schema: z.object({
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
      const rows = castTenantRows<TemplateResourceRow>(
        await selectMany(ctx.db, templateResourcesTable, {
          tenantId,
          kind: collection.kind,
          ...ownerFilter(isUserOwned, query.user),
        }),
      );
      return {
        blocks: rows.map((row) => ({
          slug: row.slug,
          locale: row.locale,
          title: row.title,
          content: row.content,
          folder: row.folder,
          updatedAt: row.updatedAt,
        })),
      };
    },
  });
}
