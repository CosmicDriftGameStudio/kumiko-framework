import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineQueryHandler,
  SYSTEM_ROLE,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantTable } from "../schema/tenant";

export const activeTenantIdsQuery = defineQueryHandler({
  name: "activeTenantIds",
  schema: z.object({}),
  access: { roles: [SYSTEM_ROLE, "SystemAdmin"] },
  description:
    "Returns the ids of every tenant that is currently enabled, platform-wide; use it to drive work that has to fan out over all live tenants.",
  handler: async (_query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:query:activeTenantIds requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant("lists active tenant ids platform-wide");
    // tenants.id is a uuid string (TenantId), not a numeric surrogate.
    // Brand at the DB parse boundary — getActiveTenantIds consumers expect TenantId[].
    const rows = await selectMany<{ id: TenantId }>(db, tenantTable, { isEnabled: true });
    return rows.map((r) => r.id);
  },
});
