import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantEntity, tenantTable } from "../schema/tenant";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

export const listQuery = defineQueryHandler({
  name: "list",
  schema: z.object({
    cursor: z.string().optional(),
    limit: z.number().optional(),
    search: z.string().optional(),
  }),
  access: { roles: ["SystemAdmin"] },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:query:list requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant("SystemAdmin lists tenants platform-wide");
    return crud.list(query.payload, query.user, db); // @wrapper-known semantic-alias
  },
});
