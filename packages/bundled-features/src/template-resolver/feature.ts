import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { archiveWrite } from "./handlers/archive.write";
import { findByIdQuery } from "./handlers/find-by-id.query";
import { listQuery } from "./handlers/list.query";
import { publishWrite } from "./handlers/publish.write";
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
