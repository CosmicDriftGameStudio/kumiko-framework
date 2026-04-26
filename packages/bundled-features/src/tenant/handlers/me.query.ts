import { fetchOne } from "@kumiko/framework/db";
import { defineQueryHandler } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenantTable } from "../schema/tenant";

// Direct query — query-handlers haben keinen tenant-crud-Handle. Direct-select
// ist trivial: WHERE id = tenantId (beides UUID). Kein CRUD-Detour nötig.
export const meQuery = defineQueryHandler({
  name: "me",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const row = await fetchOne(ctx.db, tenantTable, eq(tenantTable["id"], query.user.tenantId));
    return row ?? null;
  },
});
