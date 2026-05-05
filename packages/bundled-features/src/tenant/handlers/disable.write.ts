import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { tenantEntity, tenantTable } from "../schema/tenant";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

export const disableWrite = defineWriteHandler({
  name: "disable",
  schema: z.object({ id: z.uuid() }),
  access: { roles: ["SystemAdmin"] },
  // Admin flip: last-writer-wins is fine. SystemAdmin is the only caller and
  // there's no meaningful concurrent-edit race on this single boolean.
  handler: async (event, ctx) =>
    crud.update({ id: event.payload.id, changes: { isEnabled: false } }, event.user, ctx.db, {
      skipOptimisticLock: true,
    }),
});
