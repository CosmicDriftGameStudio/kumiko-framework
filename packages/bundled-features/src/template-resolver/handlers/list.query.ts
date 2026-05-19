import { defineQueryHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { and, eq, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { RENDER_KINDS, TEMPLATE_STATUSES } from "../constants";
import { type TemplateResourceRow, templateResourcesTable } from "../table";

// List für Admin-UI: filterbar nach kind / locale / status. Liefert
// system-templates + tenant's eigene zusammen — Admin-UI rendert beide
// Spalten mit scope-marker. SystemAdmin sieht alle (auch andere Tenants).
export const listQuery = defineQueryHandler({
  name: "list",
  schema: z.object({
    kind: z.enum(RENDER_KINDS).optional(),
    locale: z.string().min(2).max(8).optional(),
    status: z.enum(TEMPLATE_STATUSES).optional(),
    includeSystem: z.boolean().default(true),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin", "User"] },
  handler: async (query, ctx) => {
    const isSystemAdmin = query.user.roles.includes("SystemAdmin");
    const conditions: SQL<unknown>[] = [];

    // Tenant-Scope: SystemAdmin sieht alles, andere nur eigener Tenant + System
    if (!isSystemAdmin) {
      if (query.payload.includeSystem) {
        const scopeCondition = or(
          eq(templateResourcesTable["tenantId"], query.user.tenantId),
          eq(templateResourcesTable["tenantId"], SYSTEM_TENANT_ID),
        );
        if (scopeCondition) conditions.push(scopeCondition);
      } else {
        conditions.push(eq(templateResourcesTable["tenantId"], query.user.tenantId));
      }
    } else if (!query.payload.includeSystem) {
      // SystemAdmin mit includeSystem=false → noch eigener Tenant only
      conditions.push(eq(templateResourcesTable["tenantId"], query.user.tenantId));
    }

    if (query.payload.kind) {
      conditions.push(eq(templateResourcesTable["kind"], query.payload.kind));
    }
    if (query.payload.locale) {
      conditions.push(eq(templateResourcesTable["locale"], query.payload.locale));
    }
    if (query.payload.status) {
      conditions.push(eq(templateResourcesTable["status"], query.payload.status));
    }

    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = (await ctx.db
      .select()
      .from(templateResourcesTable)
      .where(whereExpr)
      .limit(500)) as TemplateResourceRow[];

    return rows.map((row) => ({
      id: String(row.id),
      tenantId: row.tenantId,
      slug: row.slug,
      kind: row.kind,
      locale: row.locale,
      scope: row.scope,
      status: row.status,
      contentFormat: row.contentFormat,
      updatedAt: row.updatedAt,
    }));
  },
});
