import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { requireSystemDb } from "../../shared/index.ts";
import { tenantEntity, tenantTable } from "../schema/tenant.ts";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

// Admin flip: last-writer-wins is fine. SystemAdmin is the only caller and
// there's no meaningful concurrent-edit race on this single boolean.
function createToggleTenantHandler(enable: boolean) {
  const verbName = enable ? "enable" : "disable";
  return defineWriteHandler({
    name: verbName,
    schema: z.object({ id: z.uuid() }),
    access: { roles: ["SystemAdmin"] },
    // Disabling locks every member out; enabling is its undo.
    ...(enable ? {} : { agent: { risk: "high" as const } }),
    description: enable
      ? "Re-enables a disabled tenant so its members can sign in and switch to it again; this is the undo for tenant:write:disable."
      : "Marks a tenant disabled so it stops counting as a membership — its members can no longer sign in to it or switch to it — while leaving all of its data in place.",
    handler: async (event, ctx) => {
      const systemDb = requireSystemDb(ctx, `tenant:write:${verbName}`);
      const db = systemDb.acknowledgeCrossTenant(
        "SystemAdmin enables/disables tenants platform-wide",
      );
      return crud.update({ id: event.payload.id, changes: { isEnabled: enable } }, event.user, db, {
        skipOptimisticLock: true,
      });
    },
  });
}

export const enableWrite = createToggleTenantHandler(true);
export const disableWrite = createToggleTenantHandler(false);
