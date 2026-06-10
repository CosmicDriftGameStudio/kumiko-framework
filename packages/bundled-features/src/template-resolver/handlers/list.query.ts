import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
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
    const where: Record<string, unknown> = {};

    // includeSystem=false narrows to own tenant AT THE DB — for non-SystemAdmin
    // TenantDb permits narrowing within its enforced [own, SYSTEM] scope, for
    // SystemAdmin (system-scoped db) the where applies verbatim. Filtering at
    // the DB keeps the limit meaningful (no post-filter starvation).
    if (!query.payload.includeSystem) {
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
