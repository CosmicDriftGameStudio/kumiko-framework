import {
  type ContentCollectionDefinition,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { bySlugQuery } from "./handlers/by-slug.query";
import { byTenantQuery } from "./handlers/by-tenant.query";
import { makeCollectionItemQuery } from "./handlers/collection-item.query";
import { makeCollectionListQuery } from "./handlers/collection-list.query";
import { makeCollectionSetWrite } from "./handlers/collection-set.write";
import { findByIdQuery } from "./handlers/find-by-id.query";
import { listQuery } from "./handlers/list.query";
import { setWrite } from "./handlers/set.write";
import { archiveWrite, publishWrite } from "./handlers/toggle-status.write";
import { upsertSystemWrite } from "./handlers/upsert-system.write";
import { upsertTenantWrite } from "./handlers/upsert-tenant.write";
import { templateResourceEntity } from "./table";
import { userContentEntryEntity } from "./user-content-table";

// template-resolver — structured template storage with tenant-override
// hierarchy, locale fallback and resource linking via file-foundation.
// Plan doc: kumiko-platform/docs/plans/features/template-resolver.md
//
// Consumption paths:
//   - Render time: ctx.templateResolver.resolveTemplate(...) (see api.ts)
//   - Admin UI: write/query handlers (upsertSystem, upsertTenant, publish, archive, findById, list)
//   - Cross-feature: requireTemplateResolver(ctx, callerName)
export type TemplateResolverOptions = {
  /** Content collections this app mounts. Declared here rather than inside the
   *  feature because `access` needs the host's role vocabulary — a bundled
   *  feature cannot know that an app calls its support staff "Agent". Same
   *  reasoning as the `access` option on tags/folders/ledger.
   *
   *  Each collection gets its own list/item/set handlers named
   *  `<id>-list` / `<id>-item` / `<id>-set`, each carrying that collection's
   *  access rule, so the dispatcher enforces the separation instead of a
   *  branch in a shared handler. */
  readonly collections?: readonly ContentCollectionDefinition[];
};

export function createTemplateResolverFeature(opts: TemplateResolverOptions = {}) {
  const collections = opts.collections ?? [];
  const hasUserOwned = collections.some((c) => c.ownership === "user");
  return defineFeature("template-resolver", (r) => {
    r.describe(
      [
        "Every piece of editable text lives here, in one entity: mail bodies, notification texts, PDF document templates, AI prompts and plain text blocks. What a record is used for is the `kind` (`notification`, `mail-html`, `document-pdf`, `ai-prompt`, `text-block`, `image-snapshot`).",
        "Reading is one call — `ctx.templateResolver.resolveTemplate({ tenantId, slug, kind, locale })`. It walks four levels: tenant+locale, system+locale, tenant+fallback-locale, system+fallback-locale. A tenant overrides a system default by simply having its own record; no application code changes.",
        "Text an editor should be able to change belongs in a collection, declared at mount: `createTemplateResolverFeature({ collections: [{ id, kind, access: { roles }, nav }] })`. It appears in the navigation, and `access` is part of the mount because a bundled feature cannot know the host's roles. Each collection gets its own `<id>-list` / `<id>-item` / `<id>-set` handlers, so the dispatcher enforces the separation.",
        "How a collection is edited follows from `contentFormat`: `plain` gives a text area, `rich` a small WYSIWYG (bold, italic, headings, lists, links). Both offer the collection's `variableSchema` as insertable chips and a preview rendered with sample data — an editor sees what `{{firstName}}` becomes without sending a mail. An app can register its own editor for a format and wins over the built-in one.",
        'A collection is tenant-wide by default. With `ownership: "user"` every user keeps their own entries — mail signatures being the obvious case. Those rows live in the separate `user-content-entry` entity and count as user data, so mounting one also requires the `template-resolver-user-data` feature and a migration on the app side.',
        "Replaces the former `text-content` feature; its blocks now live here as kind `text-block`.",
      ].join("\n\n"),
    );
    r.uiHints({
      displayLabel: "Template Resolver",
      category: "notifications",
      recommended: false,
    });
    r.entity("template-resource", templateResourceEntity);
    // Only when the app actually mounts a user-owned collection: the entity's
    // `content` is `userOwned`, which makes it subject data — the boot guard
    // then requires an EXT_USER_DATA hook (mount `template-resolver-user-data`).
    // Registering it unconditionally would impose that on every app.
    if (hasUserOwned) r.entity("user-content-entry", userContentEntryEntity);

    const handlers = {
      upsertSystem: r.writeHandler(upsertSystemWrite),
      upsertTenant: r.writeHandler(upsertTenantWrite),
      publish: r.writeHandler(publishWrite),
      archive: r.writeHandler(archiveWrite),
      set: r.writeHandler(setWrite),
    };

    const queries = {
      findById: r.queryHandler(findByIdQuery),
      list: r.queryHandler(listQuery),
      bySlug: r.queryHandler(bySlugQuery),
      byTenant: r.queryHandler(byTenantQuery),
    };

    for (const collection of collections) {
      r.contentCollection(collection);
      r.queryHandler(makeCollectionListQuery(collection));
      r.queryHandler(makeCollectionItemQuery(collection));
      r.writeHandler(makeCollectionSetWrite(collection));
    }

    // Visual-tree actions for the text-block content tree. The handle is
    // propagated through the setup export so other features can build
    // compile-time-typed cross-feature edit targets.
    const treeHandle = r.treeActions({
      edit: { args: { slug: "" as string, locale: "" as string } },
      list: {},
      create: { args: { folder: "" as string } },
    });

    return { handlers, queries, treeHandle };
  });
}
