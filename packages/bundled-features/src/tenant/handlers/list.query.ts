import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { acknowledgedSystemDb } from "../../shared/index.ts";
import { tenantEntity, tenantTable } from "../schema/tenant.ts";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

export const listQuery = defineQueryHandler({
  name: "list",
  schema: z.object({
    cursor: z.string().optional(),
    limit: z.number().optional(),
    search: z.string().optional(),
    totalCount: z.boolean().optional(),
  }),
  access: { roles: ["SystemAdmin"] },
  description:
    "Pages through every tenant on the platform with an optional search term, for a SystemAdmin browsing the tenant roster.",
  handler: async (query, ctx) => {
    const db = acknowledgedSystemDb(
      ctx,
      "tenant:query:list",
      "SystemAdmin lists tenants platform-wide",
    );
    return crud.list(query.payload, query.user, db);
  },
});
