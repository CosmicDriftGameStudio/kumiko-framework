import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
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
  handler: async (query, ctx) => crud.list(query.payload, query.user, ctx.db), // @wrapper-known semantic-alias
});
