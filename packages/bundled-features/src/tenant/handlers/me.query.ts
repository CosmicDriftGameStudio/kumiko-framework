import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { tenantTable } from "../schema/tenant";

// Direct query — query handlers don't have a tenant-crud handle. A direct
// select is trivial: WHERE id = tenantId (both UUID). No CRUD detour needed.
export const meQuery = defineQueryHandler({
  name: "me",
  schema: z.object({}),
  access: {
    openToAll: {
      reason:
        "any signed-in user reads only their own active tenant; the query is scoped " +
        "to the caller's own tenantId",
    },
  },
  rateLimit: {
    disabled: true,
    reason:
      "self-scoped read of the caller's own active tenant, hit on every page load; per-tenant " +
      "bucket would throttle the whole tenant, L1 IP limit still applies",
  },
  description:
    "Returns the record of the tenant the caller is currently signed in to, or null if it is gone; use it whenever the active tenant's own name, key or settings are needed.",
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
