import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantTable } from "../schema/tenant";

// Direct query — query handlers don't have a tenant-crud handle. A direct
// select is trivial: WHERE id = tenantId (both UUID). No CRUD detour needed.
export const meQuery = defineQueryHandler({
  name: "me",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:query:me requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const db = ctx.systemDb.assertTenantMatch(query.user.tenantId);
    const row = await fetchOne(db, tenantTable, { id: query.user.tenantId });
    return row ?? null;
  },
});
