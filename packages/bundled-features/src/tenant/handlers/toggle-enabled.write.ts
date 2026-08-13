import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantEntity, tenantTable } from "../schema/tenant";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

// Admin flip: last-writer-wins is fine. SystemAdmin is the only caller and
// there's no meaningful concurrent-edit race on this single boolean.
function createToggleTenantHandler(enable: boolean) {
  const verbName = enable ? "enable" : "disable";
  return defineWriteHandler({
    name: verbName,
    schema: z.object({ id: z.uuid() }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event, ctx) => {
      if (!ctx.systemDb) {
        throw new InternalError({
          message: `tenant:write:${verbName} requires ctx.systemDb — is r.systemScope() still set on the tenant feature?`,
        });
      }
      const db = ctx.systemDb.acknowledgeCrossTenant(
        "SystemAdmin enables/disables tenants platform-wide",
      );
      return crud.update({ id: event.payload.id, changes: { isEnabled: enable } }, event.user, db, {
        skipOptimisticLock: true,
      }); // @wrapper-known semantic-alias
    },
  });
}

export const enableWrite = createToggleTenantHandler(true);
export const disableWrite = createToggleTenantHandler(false);
