import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  type ContentCollectionDefinition,
  defineWriteHandler,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { requireForTenant } from "../../shared/index.ts";
import { systemTemplateExists } from "../api.ts";
import { documentViolationsToFieldIssues, sanitizeTemplateBody } from "../document-sanitizer.ts";
import { refuseTemplateEdit, type TemplateEditPolicy } from "../template-edit-policy.ts";
import { DEFAULT_COLLECTION_ACCESS, isCollectionRefusedKind } from "../web/constants.ts";
import { type CollectionEntryRow, collectionStore, storageFormatOf } from "./collection-shared.ts";
import { folderSchema, localeSchema, slugSchema } from "./shared.ts";

// Upsert inside one collection. Mirrors set.write for text-blocks, but the
// kind comes from the declaration and the access rule is the collection's own,
// so an app can let agents edit their snippets without letting them near the
// AI prompts.
//
// Like set.write this publishes on save (status active, empty variableSchema)
// — the draft stage lives on upsertTenant + publish.
export function makeCollectionSetWrite(
  collection: ContentCollectionDefinition,
  editPolicy: TemplateEditPolicy,
) {
  const store = collectionStore(collection);
  const contentFormat = storageFormatOf(collection);
  return defineWriteHandler({
    name: `${collection.id}-set`,
    schema: z.object({
      slug: slugSchema,
      locale: localeSchema,
      title: z.string().min(1).max(200),
      content: z.string().max(200_000).nullable(),
      folder: folderSchema.nullable().optional(),
      /** The create form sets it so a taken slug is reported instead of overwritten. */
      createOnly: z.boolean().optional(),
      /** Optional cross-tenant write — SystemAdmin only. */
      tenantIdOverride: z.string().min(1).optional(),
    }),
    access: collection.access ?? DEFAULT_COLLECTION_ACCESS,
    description:
      collection.ownership === "user"
        ? `Creates or overwrites the caller's own "${collection.id}" entry at a slug and locale, live on save with no draft stage; it always writes the acting user's entry, never another user's.`
        : `Creates or overwrites the tenant-wide "${collection.id}" entry at a slug and locale, live on save with no draft stage; the change is visible to everyone who may reach this shared collection.`,
    handler: async (event, ctx) => {
      // Defense in depth: createTemplateResolverFeature already refuses these kinds at mount.
      if (isCollectionRefusedKind(collection.kind)) {
        return writeFailure(
          new ValidationError({
            fields: [
              {
                path: "",
                code: "kind_not_allowed",
                i18nKey: "templateResolver.errors.collection.kindNotAllowed",
                params: { detail: collection.kind },
              },
            ],
          }),
        );
      }
      const override = event.payload.tenantIdOverride;
      // @cast-boundary engine-payload — override is a zod-validated string, the
      // user's own tenantId is already TenantId-branded.
      const tenantId = (override ?? event.user.tenantId) as TenantId;
      const { db, streamTenantId } = requireForTenant(ctx, tenantId);
      // Scoped to the acting user even under a tenant override: a SystemAdmin
      // writing into another tenant still writes their own entry, never
      // someone else's signature.
      const owner = store.scopeOf(event.user);

      const body = sanitizeTemplateBody({
        kind: collection.kind,
        contentFormat,
        content: event.payload.content,
        alwaysSanitizeHtml: collection.contentFormat === "document",
      });
      if (!body.ok) {
        return writeFailure(
          new ValidationError({ fields: documentViolationsToFieldIssues(body.violations) }),
        );
      }

      // The collection's access must not open a system template that the app did not unlock.
      if (
        collection.ownership !== "user" &&
        (await systemTemplateExists(db, collection.kind, event.payload.slug))
      ) {
        const refused = refuseTemplateEdit(editPolicy, event.user, {
          slug: event.payload.slug,
          kind: collection.kind,
        });
        if (refused) return refused;
      }

      const existing = await fetchOne<CollectionEntryRow>(db, store.table, {
        tenantId,
        slug: event.payload.slug,
        kind: collection.kind,
        locale: event.payload.locale,
        ...owner,
      });

      if (existing && event.payload.createOnly === true) {
        return writeFailure(
          new ValidationError({
            fields: [
              {
                path: "slug",
                code: "slug_exists",
                i18nKey: "templateResolver.errors.collection.slugExists",
                params: { detail: event.payload.slug },
              },
            ],
          }),
        );
      }

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
              content: body.content,
              contentFormat,
              folder: event.payload.folder ?? null,
            },
          },
          event.user,
          db,
          { streamTenantId },
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
          content: body.content,
          contentFormat,
          folder: event.payload.folder ?? null,
          ...store.createDefaults(tenantId),
          ...owner,
        },
        event.user,
        db,
        { streamTenantId },
      );
      if (!result.isSuccess) return result;
      return {
        isSuccess: true as const,
        data: { slug: event.payload.slug, locale: event.payload.locale, isNew: true },
      };
    },
  });
}
