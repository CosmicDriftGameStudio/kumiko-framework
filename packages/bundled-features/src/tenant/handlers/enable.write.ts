import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { tenantEntity, tenantTable } from "../schema/tenant";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

// Recovery-Gegenstück zu disable — ohne enable wäre ein Fehlklick des
// Operators nur per Event-Hack reversibel.
export const enableWrite = defineWriteHandler({
  name: "enable",
  schema: z.object({ id: z.uuid() }),
  access: { roles: ["SystemAdmin"] },
  // Admin flip: last-writer-wins is fine. SystemAdmin is the only caller and
  // there's no meaningful concurrent-edit race on this single boolean.
  handler: async (event, ctx) =>
    crud.update({ id: event.payload.id, changes: { isEnabled: true } }, event.user, ctx.db, {
      skipOptimisticLock: true,
    }),
});
