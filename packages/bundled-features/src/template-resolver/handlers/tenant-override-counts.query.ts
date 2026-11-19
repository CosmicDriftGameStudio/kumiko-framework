import { aggregateWhere } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { templateResourcesTable } from "../table.ts";
import { loadEnabledTenantIds, TENANT_OVERRIDES_REASON } from "./tenant-override-selection.ts";

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
    const enabledTenantIds = await loadEnabledTenantIds(ctx);
    // Same rule as pickBestRowPerTenant: a tenant counts once when any of its enabled, non-SYSTEM overrides is active.
    const tenantFilter =
      enabledTenantIds === null
        ? { ne: SYSTEM_TENANT_ID }
        : { in: [...enabledTenantIds].filter((id) => id !== SYSTEM_TENANT_ID) };
    const groups = await aggregateWhere(
      ctx.db.unsafeRawAllTenants(),
      templateResourcesTable,
      {
        measure: { fn: "countDistinct", field: "tenantId" },
        groupBy: [{ field: "kind" }, { field: "slug" }],
      },
      { scope: "tenant", status: "active", tenantId: tenantFilter },
    );
    const counts = groups.flatMap(({ keys: [kind, slug], value }) =>
      typeof kind === "string" && typeof slug === "string"
        ? [{ slug, kind, activeOverrides: value ?? 0 }]
        : [],
    );

    return { totalTenants: enabledTenantIds === null ? null : enabledTenantIds.size, counts };
  },
});
