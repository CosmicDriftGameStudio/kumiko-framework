import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler, SYSTEM_ROLE } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { tenantTable } from "../schema/tenant";

export const activeTenantIdsQuery = defineQueryHandler({
  name: "activeTenantIds",
  schema: z.object({}),
  access: { roles: [SYSTEM_ROLE, "SystemAdmin"] },
  handler: async (_query, ctx) => {
    const rows = await selectMany<{ id: number }>(ctx.db, tenantTable, { isEnabled: true });
    return rows.map((r) => r.id);
  },
});
