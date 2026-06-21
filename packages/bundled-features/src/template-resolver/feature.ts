import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { findByIdQuery } from "./handlers/find-by-id.query";
import { listQuery } from "./handlers/list.query";
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
export function createTemplateResolverFeature() {
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
    };

    const queries = {
      findById: r.queryHandler(findByIdQuery),
      list: r.queryHandler(listQuery),
    };

    return { handlers, queries };
  });
}
