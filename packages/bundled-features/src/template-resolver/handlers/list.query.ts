import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { TEMPLATE_KINDS, TEMPLATE_STATUSES } from "../constants.ts";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import { isHiddenSystemDraft } from "../template-draft.ts";
import { isSystemOnlyTemplateHiddenFrom } from "../template-system-only.ts";

// ctx.db is tenant-scoped even for SystemAdmin: every caller sees its own
// tenant's rows plus the system defaults, never another tenant's rows.
export const listQuery = defineQueryHandler({
  name: "list",
  schema: z.object({
    kind: z.enum(TEMPLATE_KINDS).optional(),
    locale: z.string().min(2).max(8).optional(),
    status: z.enum(TEMPLATE_STATUSES).optional(),
    includeSystem: z.boolean().default(true),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin", "User"] },
  description:
    "Lists template resources of the caller's tenant alongside the system defaults as summaries without content, filterable by kind, locale and status; use it to browse the catalogue, then find-by-id to read one row.",
  handler: async (query, ctx) => {
    const where: Record<string, unknown> = {};

    // includeSystem=false narrows to own tenant AT THE DB — TenantDb permits
    // narrowing within its enforced [own, SYSTEM] scope. Filtering at the DB
    // keeps the limit meaningful (no post-filter starvation).
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

    return rows
      .filter(
        (row) =>
          !isHiddenSystemDraft(query.user, row) &&
          !isSystemOnlyTemplateHiddenFrom(query.user, ctx.registry, row),
      )
      .map((row) => ({
        id: String(row.id),
        tenantId: row.tenantId,
        slug: row.slug,
        kind: row.kind,
        locale: row.locale,
        scope: row.scope,
        status: row.status,
        contentFormat: row.contentFormat,
        modifiedAt: row.modifiedAt,
      }));
  },
});
