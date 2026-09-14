import { countWhere, insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { auditTable, invoiceTable } from "./entities";

export const auditWrite = defineWriteHandler({
  name: "audit:write",
  handler: async (event, ctx) => {
    const tenantId = event.payload.tenantId;
    await insertOne(ctx.db.raw, auditTable, { tenantId, action: event.payload.action });
    const total = await countWhere(ctx.db.raw, invoiceTable, { status: "open" });
    return { total };
  },
});

export function bootstrapSystemDb(ctx: Ctx, x: unknown) {
  return createTenantDb(ctx.db.raw, x, "system");
}

export const crossTenantAck = defineWriteHandler({
  name: "cross-tenant:ack",
  handler: async (event, ctx) => {
    const r = { id: event.payload.id };
    const acked = ctx.systemDb.acknowledgeCrossTenant(r).raw;
    return { acked };
  },
});
