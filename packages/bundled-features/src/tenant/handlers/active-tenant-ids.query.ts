import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineQueryHandler,
  SYSTEM_ROLE,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { tenantTable } from "../schema/tenant";

export const activeTenantIdsQuery = defineQueryHandler({
  name: "activeTenantIds",
  schema: z.object({}),
  access: { roles: [SYSTEM_ROLE, "SystemAdmin"] },
  handler: async (_query, ctx) => {
    // tenants.id is a uuid string (TenantId), not a numeric surrogate.
    // Brand at the DB parse boundary — getActiveTenantIds consumers expect TenantId[].
    const rows = await selectMany<{ id: TenantId }>(ctx.db, tenantTable, { isEnabled: true });
    return rows.map((r) => r.id);
  },
});
