import { createEventStoreExecutor } from "@kumiko/framework/db";
import { defineWriteHandler } from "@kumiko/framework/engine";
import { z } from "zod";
import { tenantEntity, tenantTable } from "../schema/tenant";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

export const updateWrite = defineWriteHandler({
  name: "update",
  schema: z.object({
    id: z.uuid(),
    // Clients must send the version they read. The CrudExecutor rejects
    // missing versions with version_conflict — see the optimistic-locking
    // design note in crud-executor.ts.
    version: z.number(),
    changes: z.object({ name: z.string().min(1).max(200).optional() }),
  }),
  access: { roles: ["Admin", "SystemAdmin"] },
  handler: async (event, ctx) => crud.update(event.payload, event.user, ctx.db),
});
