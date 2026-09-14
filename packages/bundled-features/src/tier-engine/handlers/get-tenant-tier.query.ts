import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { type TierAssignmentRow, tierAssignmentEntity } from "../entity";

// Liest das Tier-Assignment eines BELIEBIGEN Tenants (cross-tenant) für den
// tier-admin-Screen. SystemAdmin-only. get-active-tier liest nur den eigenen
// Tenant — hier ein "system"-mode TenantDb auf den Ziel-Tenant (kein Filter),
// damit der Admin das Tier fremder Tenants sehen kann. null wenn noch keins.

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);

const GET_TENANT_TIER_REASON = "SystemAdmin reads the tier of the tenant named in the payload";

export const getTenantTierQuery = defineQueryHandler({
  name: "get-tenant-tier",
  description:
    "Returns the tier-assignment of any given tenant including where it came from (manual grant, billing sync or signup default), or null; use it to look up another tenant's plan.",
  schema: z.object({ tenantId: z.string().min(1) }),
  access: { roles: ["SystemAdmin"] },
  escapeHatch: {
    reason: GET_TENANT_TIER_REASON,
  },
  handler: async (query, ctx) => {
    const tenantId = query.payload.tenantId as TenantId; // @cast-boundary engine-bridge
    const tdb = createTenantDb(ctx.db.unsafeRaw(GET_TENANT_TIER_REASON), tenantId, "system");
    const row = await fetchOne<TierAssignmentRow>(tdb, tierAssignmentTable, { tenantId });
    return row ?? null;
  },
});
