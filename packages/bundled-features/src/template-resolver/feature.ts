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
  const userOwned = collections.filter((c) => c.ownership === "user");
  if (userOwned.length > 0) {
    // Fail loudly at mount instead of quietly serving one shared set to every
    // user — the ownerId column doesn't exist yet (#1770).
    throw new Error(
      `template-resolver: ownership "user" is not implemented yet (#1770) — ` +
        `collections ${userOwned.map((c) => `"${c.id}"`).join(", ")} would silently ` +
        `share one tenant-wide set between all users.`,
    );
  }
  return defineFeature("template-resolver", (r) => {
    r.describe(
      "The one content store: notification and mail templates, PDF document templates, AI prompts and plain editable text blocks all live here as one entity, distinguished by `kind` (`notification`, `mail-html`, `document-pdf`, `ai-prompt`, `text-block`, `image-snapshot`). Resolution uses a 4-level fallback: tenant+locale \u2192 system+locale \u2192 tenant+fallback-locale \u2192 system+fallback-locale, so tenants can override system defaults without touching application code. Call `ctx.templateResolver.resolveTemplate({ tenantId, slug, kind, locale })` at render time; manage templates via the `upsertSystem`, `upsertTenant`, `publish` and `archive` write handlers. Apps that want an editable collection in their navigation declare it at mount: `createTemplateResolverFeature({ collections: [{ id, kind, access: { roles }, nav }] })` \u2014 `access` belongs to the mount because a bundled feature does not know the host's role vocabulary. Each collection gets its own `<id>-list` / `<id>-item` / `<id>-set` handlers carrying that collection's access rule, so the dispatcher enforces the separation. Replaces the former `text-content` feature, whose blocks now live here as kind `text-block`.",
    );
    r.uiHints({
      displayLabel: "Template Resolver",
      category: "notifications",
      recommended: false,
    });
    r.entity("template-resource", templateResourceEntity);

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
