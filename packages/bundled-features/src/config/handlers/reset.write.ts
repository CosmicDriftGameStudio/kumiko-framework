import { createEventStoreExecutor } from "@kumiko/framework/db";
import { ConfigScopes, defineWriteHandler, SYSTEM_TENANT_ID } from "@kumiko/framework/engine";
import { z } from "zod";
import { configValueEntity, configValuesTable } from "../table";
import { findConfigRow, prepareConfigWrite } from "./set.write";

const scopeEnum = z.enum([ConfigScopes.system, ConfigScopes.tenant, ConfigScopes.user]);

const executor = createEventStoreExecutor(configValuesTable, configValueEntity, {
  entityName: "configValue",
});

export const resetWrite = defineWriteHandler({
  name: "reset",
  schema: z.object({
    key: z.string(),
    scope: scopeEnum.optional(),
  }),
  // Per-key access enforcement lives inside the handler via checkWriteAccess.
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const db = ctx.db;

    const prep = prepareConfigWrite({
      registry: ctx.registry,
      user: event.user,
      key: event.payload.key,
      scope: event.payload.scope,
    });
    if (!prep.ok) return prep.failure;
    const { scope, tenantId, userId } = prep;

    const rowTenantId = tenantId ?? SYSTEM_TENANT_ID;
    const existing = await findConfigRow(db, event.payload.key, rowTenantId, userId);

    // No-op when there is nothing to reset. Pre-ES this path silently did
    // nothing too — keep the contract intact so callers can reset
    // idempotently without a 404 dance.
    if (existing) {
      const result = await executor.delete({ id: existing.id }, event.user, db);
      if (!result.isSuccess) return result;
    }

    return { isSuccess: true, data: { key: event.payload.key, scope } };
  },
});
