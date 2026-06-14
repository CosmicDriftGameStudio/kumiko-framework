import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { tenantEntity, tenantTable } from "../schema/tenant";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

// Admin flip: last-writer-wins is fine. SystemAdmin is the only caller and
// there's no meaningful concurrent-edit race on this single boolean.
function createToggleTenantHandler(enable: boolean) {
  return defineWriteHandler({
    name: enable ? "enable" : "disable",
    schema: z.object({ id: z.uuid() }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event, ctx) =>
      crud.update({ id: event.payload.id, changes: { isEnabled: enable } }, event.user, ctx.db, {
        skipOptimisticLock: true,
      }), // @wrapper-known semantic-alias
  });
}

export const enableWrite = createToggleTenantHandler(true);
export const disableWrite = createToggleTenantHandler(false);
