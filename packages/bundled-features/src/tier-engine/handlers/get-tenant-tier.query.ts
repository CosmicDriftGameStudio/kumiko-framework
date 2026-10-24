import { buildEntityTable, createTenantDb, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { type TierAssignmentRow, tierAssignmentEntity } from "../entity.ts";

// Reads the tier assignment of ANY tenant (cross-tenant) for the
// tier-admin screen. SystemAdmin-only. get-active-tier reads only its own
// tenant; this uses a "system"-mode TenantDb for the target tenant (no filter),
// so the admin can view another tenant's tier. Returns null if none exists yet.

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);

const GET_TENANT_TIER_REASON = "SystemAdmin reads the tier of the tenant named in the payload";

export const getTenantTierQuery = defineQueryHandler({
  name: "get-tenant-tier",
  description:
    "Returns the tier-assignment of any given tenant including where it came from (manual grant, billing sync or signup default), or null; use it to look up another tenant's plan.",
  schema: z.object({ tenantId: z.string().min(1) }),
  access: { roles: ["SystemAdmin"] },
  escapeHatch: {
    grants: ["unsafeRaw"],
    reason: GET_TENANT_TIER_REASON,
  },
  handler: async (query, ctx) => {
    const tenantId = query.payload.tenantId as TenantId; // @cast-boundary engine-bridge
    const tdb = createTenantDb({
      db: ctx.db.unsafeRaw(),
      tenantId,
      mode: "system",
      reason:
        "tier lookup reads the assignment of the queried tenant, the escape hatch is declared on the handler",
    });
    const row = await fetchOne<TierAssignmentRow>(tdb, tierAssignmentTable, { tenantId });
    return row ?? null;
  },
});
