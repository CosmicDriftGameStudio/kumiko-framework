import type { QueryHandlerDef } from "@kumiko/framework/engine";
import { z } from "zod";

// get-active-tier — return the current tier-assignment for the calling tenant.
//
// **Convenience-wrapper** über `ctx.queryProjection` für die häufigste Frage
// gegen die Engine: „welcher Tier ist gerade aktiv?". Returns null wenn
// noch kein Tier gesetzt — der Caller (composeApp) mappt null → Default-Tier.
//
// **Tenant-scope:** ctx.queryProjection filtert automatisch nach tenantId.
// Pro Plattform-Tenant existiert per Konvention genau eine
// tier-assignment-Row.
export const getActiveTierQuery: QueryHandlerDef = {
  name: "get-active-tier",
  schema: z.object({}),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (_query, ctx) => {
    const rows = await ctx.queryProjection<Record<string, unknown>>(
      "tier-engine:projection:tier-assignment-entity",
    );
    return rows[0] ?? null;
  },
};
