import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  type ContentCollectionDefinition,
  crossTenantOverrideDenied,
  defineWriteHandler,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import {
  type CollectionEntryRow,
  collectionStore,
  DEFAULT_COLLECTION_ACCESS,
} from "./collection-shared";
import { contentFormatSchema, folderSchema, localeSchema, slugSchema } from "./shared";

// Upsert inside one collection. Mirrors set.write for text-blocks, but the
// kind comes from the declaration and the access rule is the collection's own,
// so an app can let agents edit their snippets without letting them near the
// AI prompts.
//
// Like set.write this publishes on save (status active, empty variableSchema)
// — the draft stage lives on upsertTenant + publish.
export function makeCollectionSetWrite(collection: ContentCollectionDefinition) {
  const store = collectionStore(collection);
  return defineWriteHandler({
    name: `${collection.id}-set`,
    schema: z.object({
      slug: slugSchema,
      locale: localeSchema,
      title: z.string().min(1).max(200),
      content: z.string().max(200_000).nullable(),
      contentFormat: contentFormatSchema.default("markdown"),
      folder: folderSchema.nullable().optional(),
      /** Optional cross-tenant write — SystemAdmin only. */
      tenantIdOverride: z.string().min(1).optional(),
    }),
    access: collection.access ?? DEFAULT_COLLECTION_ACCESS,
    handler: async (event, ctx) => {
      const db = ctx.db;
      const override = event.payload.tenantIdOverride;
      const overrideDenied = crossTenantOverrideDenied(
        event.user,
        override,
        "templateResolver.errors.tenantOverrideRequiresSystemAdmin",
      );
      if (overrideDenied) return writeFailure(overrideDenied);
      // @cast-boundary engine-payload — override is a zod-validated string, the
      // user's own tenantId is already TenantId-branded.
      const tenantId = (override ?? event.user.tenantId) as TenantId;
      const executorUser = override !== undefined ? { ...event.user, tenantId } : event.user;
      // Scoped to the acting user even under a tenant override: a SystemAdmin
      // writing into another tenant still writes their own entry, never
      // someone else's signature.
      const owner = store.scopeOf(event.user);

      const existing = await fetchOne<CollectionEntryRow>(db, store.table, {
        tenantId,
        slug: event.payload.slug,
        kind: collection.kind,
        locale: event.payload.locale,
        ...owner,
      });

      if (existing) {
        const result = await store.executor.update(
          {
            id: existing.id,
            version: existing.version,
            // Only the editable columns — slug/kind/locale are the unique key,
            // and rewriting scope/status/variableSchema here would reset what
            // the template upserts put on the row.
            changes: {
              title: event.payload.title,
              content: event.payload.content,
              contentFormat: event.payload.contentFormat,
              folder: event.payload.folder ?? null,
            },
          },
          executorUser,
          db,
        );
        if (!result.isSuccess) return result;
        return {
          isSuccess: true as const,
          data: { slug: event.payload.slug, locale: event.payload.locale, isNew: false },
        };
      }

      const result = await store.executor.create(
        {
          tenantId,
          slug: event.payload.slug,
          kind: collection.kind,
          locale: event.payload.locale,
          title: event.payload.title,
          content: event.payload.content,
          contentFormat: event.payload.contentFormat,
          folder: event.payload.folder ?? null,
          ...store.createDefaults(tenantId),
          ...owner,
        },
        executorUser,
        db,
      );
      if (!result.isSuccess) return result;
      return {
        isSuccess: true as const,
        data: { slug: event.payload.slug, locale: event.payload.locale, isNew: true },
      };
    },
  });
}
