import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
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
  handler: async (event, ctx) => {
    // "Admin" is tenant-scoped and must not touch another tenant's row —
    // SystemAdmin is the platform-wide role and stays cross-tenant by design.
    if (!event.user.roles.includes("SystemAdmin") && event.payload.id !== event.user.tenantId) {
      return writeFailure(new NotFoundError("tenant", event.payload.id));
    }
    return crud.update(event.payload, event.user, ctx.db);
  },
});
