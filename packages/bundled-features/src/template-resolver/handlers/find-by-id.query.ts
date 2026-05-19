import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type TemplateResourceRow, templateResourcesTable } from "../table";

// Admin-Lookup für UI-Edit-Flow. Returnt das raw Template inkl. draft/
// archived Status. Tenant-Isolation: User sieht nur Templates des
// eigenen Tenants oder SYSTEM_TENANT (system-defaults sind public-
// readable). SystemAdmin sieht alle. Anonymous bleibt aus — Public-
// Read geht über resolveTemplate aus der API, nicht hier.
export const findByIdQuery = defineQueryHandler({
  name: "find-by-id",
  schema: z.object({ id: z.string().min(1) }),
  access: { roles: ["TenantAdmin", "SystemAdmin", "User"] },
  handler: async (query, ctx) => {
    const row = await fetchOne<TemplateResourceRow>(
      ctx.db,
      templateResourcesTable,
      eq(templateResourcesTable["id"], query.payload.id),
    );
    if (!row) return null;
    const isSystemAdmin = query.user.roles.includes("SystemAdmin");
    const isOwnTenant = row.tenantId === query.user.tenantId;
    const isSystemTemplate = row.scope === "system";
    if (!isSystemAdmin && !isOwnTenant && !isSystemTemplate) return null;

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
      scope: row.scope,
      parentTemplateId: row.parentTemplateId,
      status: row.status,
      updatedAt: row.updatedAt,
    };
  },
});
