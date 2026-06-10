import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
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
    const where: Record<string, unknown> = {};

    // TenantDb scopes non-SystemAdmin reads to [own tenant, SYSTEM reference] and
    // overrides a caller-narrowed where.tenantId (enforced isolation). SystemAdmin
    // uses a system-scoped db that sees every tenant, so narrow to own explicitly
    // when they don't want the cross-tenant view.
    if (isSystemAdmin && !query.payload.includeSystem) {
      where["tenantId"] = query.user.tenantId;
    }

    if (query.payload.kind) {
      where["kind"] = query.payload.kind;
    }
    if (query.payload.locale) {
      where["locale"] = query.payload.locale;
    }
    if (query.payload.status) {
      where["status"] = query.payload.status;
    }

    // @cast-boundary db-row — selectMany returnt unknown[]; Row-Shape ist
    // durch templateResourcesTable + buildBaseColumns garantiert.
    const rows = (await selectMany(ctx.db, templateResourcesTable, where, {
      limit: 500,
    })) as TemplateResourceRow[];

    // TenantDb always surfaces SYSTEM reference rows alongside the tenant's own;
    // includeSystem=false drops them here since they can't be excluded at the DB.
    const visible = query.payload.includeSystem
      ? rows
      : rows.filter((row) => row.tenantId !== SYSTEM_TENANT_ID);

    return visible.map((row) => ({
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
