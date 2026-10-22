import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import {
  loadEnabledTenantIds,
  pickBestRowPerTenant,
  TENANT_OVERRIDES_REASON,
} from "./tenant-override-selection.ts";

type OverrideCountRow = Pick<
  TemplateResourceRow,
  "tenantId" | "slug" | "kind" | "status" | "version"
>;

export const tenantOverrideCountsResultSchema = z.object({
  totalTenants: z.number().nullable(),
  counts: z.array(z.object({ slug: z.string(), kind: z.string(), activeOverrides: z.number() })),
});

export const tenantOverrideCountsQuery = defineQueryHandler({
  name: "tenant-override-counts",
  schema: z.object({}),
  access: { roles: ["SystemAdmin"] },
  description:
    "Counts, per template slug and kind, the enabled tenants that override it with an active version, next to the number of enabled tenants; one query for the whole template overview instead of one tenant-overrides call per row.",
  escapeHatch: { grants: ["unsafeRaw"], reason: TENANT_OVERRIDES_REASON },
  handler: async (_query, ctx) => {
    const found = await selectMany<OverrideCountRow>(
      ctx.db.unsafeRaw(),
      templateResourcesTable,
      { scope: "tenant" },
      { fields: ["tenantId", "slug", "kind", "status", "version"] },
    );
    const enabledTenantIds = await loadEnabledTenantIds(ctx);

    const rowsBySlugAndKind = new Map<
      string,
      { slug: string; kind: string; rows: OverrideCountRow[] }
    >();
    for (const row of found) {
      const key = `${row.kind}|${row.slug}`;
      const group = rowsBySlugAndKind.get(key) ?? { slug: row.slug, kind: row.kind, rows: [] };
      group.rows.push(row);
      rowsBySlugAndKind.set(key, group);
    }
    const counts = [...rowsBySlugAndKind.values()].map(({ slug, kind, rows }) => ({
      slug,
      kind,
      activeOverrides: [...pickBestRowPerTenant(rows, enabledTenantIds).values()].filter(
        (row) => row.status === "active",
      ).length,
    }));

    return { totalTenants: enabledTenantIds === null ? null : enabledTenantIds.size, counts };
  },
});
