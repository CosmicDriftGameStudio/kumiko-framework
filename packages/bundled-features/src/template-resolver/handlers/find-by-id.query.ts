import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import { draftViewerTenantId, isHiddenSystemDraft, toWorkingRow } from "../template-draft.js";
import { isSystemOnlyTemplateHiddenFrom } from "../template-system-only.js";

// Admin-Lookup für UI-Edit-Flow. Returnt das raw Template inkl. draft/
// archived Status. Tenant-Isolation: User sieht nur Templates des
// eigenen Tenants oder SYSTEM_TENANT (system-defaults sind public-
// readable); ctx.db is tenant-scoped for every role, so the check below is defense in depth. Anonymous bleibt aus — Public-
// Read geht über resolveTemplate aus der API, nicht hier.
export const findByIdQuery = defineQueryHandler({
  name: "find-by-id",
  schema: z.object({ id: z.string().min(1) }),
  access: { roles: ["TenantAdmin", "SystemAdmin", "User"] },
  description:
    "Reads the version of one template resource an editor works on, by row id: the open draft if there is one (status draft), else the stored version, with content, variable schema and scope, but only when it belongs to the caller's tenant or is a served system default (a never-served system draft is visible to a SystemAdmin only); `active` is the version number and since-time the resolver serves, null when none is served. Use it to load a template into the admin editor.",
  handler: async (query, ctx) => {
    const stored = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
      id: query.payload.id,
    });
    if (
      !stored ||
      isHiddenSystemDraft(query.user, stored) ||
      isSystemOnlyTemplateHiddenFrom(query.user, ctx.registry, stored)
    ) {
      return null;
    }
    const row = toWorkingRow(stored, draftViewerTenantId(query.user, stored));
    const isOwnTenant = row.tenantId === query.user.tenantId;
    const isSystemTemplate = row.scope === "system";
    if (!isOwnTenant && !isSystemTemplate) return null;

    return {
      id: String(row.id),
      version: row.version,
      tenantId: row.tenantId,
      slug: row.slug,
      kind: row.kind,
      locale: row.locale,
      content: row.content,
      contentFormat: row.contentFormat,
      variableSchema: row.variableSchema,
      linkedResources: row.linkedResources,
      meta: row.meta,
      scope: row.scope,
      parentTemplateId: row.parentTemplateId,
      status: row.status,
      modifiedAt: row.modifiedAt,
      active: row.active,
    };
  },
});
