import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";

// get-active-tier — returns the current tier assignment for the calling tenant.
//
// Wraps `ctx.queryProjection` for the most common engine query: which tier is
// currently active. Returns null when no tier is assigned; the caller (composeApp)
// maps null to the default tier.
//
// **Tenant scope:** `ctx.queryProjection` automatically filters by tenantId.
// By convention, each platform tenant has exactly one tier-assignment row.
export const getActiveTierQuery: QueryHandlerDef = {
  name: "get-active-tier",
  description:
    "Returns the tier-assignment row currently active for the caller's own tenant, or null when none is assigned; use it to answer which plan the caller is on.",
  schema: z.object({}),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (_query, ctx) => {
    const rows = await ctx.queryProjection<Record<string, unknown>>(
      "tier-engine:projection:tier-assignment-entity",
    );
    return rows[0] ?? null;
  },
};
