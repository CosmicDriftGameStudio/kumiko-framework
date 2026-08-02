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

// template-resolver — strukturierter Template-Storage mit Tenant-
// Override-Hierarchie, Locale-Fallback und Resource-Linking via
// file-foundation. Plan-Doc: kumiko-platform/docs/plans/features/template-resolver.md
//
// Konsumtions-Pfade:
//   - Render-Time: ctx.templateResolver.resolveTemplate(...) (siehe api.ts)
//   - Admin-UI: write/query-handlers (upsertSystem, upsertTenant, publish, archive, findById, list)
//   - Cross-Feature: requireTemplateResolver(ctx, callerName) — Pattern wie requireTextContent
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
      "Stores notification and mail templates in the database with a 4-level fallback: tenant+locale \u2192 system+locale \u2192 tenant+fallback-locale \u2192 system+fallback-locale. Call `ctx.templateResolver.resolveTemplate({ tenantId, slug, kind, locale })` at render time; manage templates via the `upsertSystem`, `upsertTenant`, `publish`, and `archive` write handlers. Tenants can override system-default templates without touching application code.",
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
