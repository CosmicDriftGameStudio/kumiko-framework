import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  ConfigScopes,
  defineWriteHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { configValueEntity, configValuesTable } from "../table";
import { findConfigRow, prepareConfigWrite } from "../write-helpers";

const scopeEnum = z.enum([ConfigScopes.system, ConfigScopes.tenant, ConfigScopes.user]);

const executor = createEventStoreExecutor(configValuesTable, configValueEntity, {
  entityName: "config-value",
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
    const { keyDef, scope, tenantId, userId } = prep;

    // backing="secrets": clear the secret from the secrets store. delete() is
    // idempotent (returns false if absent) — mirrors the config no-op contract.
    if (keyDef.backing === "secrets") {
      if (!ctx.secrets) {
        throw new InternalError({
          message:
            `[config:write:reset] key "${event.payload.key}" declares backing="secrets" but ` +
            `ctx.secrets is not wired — provide extraContext.secrets (and a MasterKeyProvider).`,
        });
      }
      await ctx.secrets.delete(SYSTEM_TENANT_ID, event.payload.key, {
        deletedBy: event.user.id,
      });
      return { isSuccess: true, data: { key: event.payload.key, scope } };
    }

    const existing = await findConfigRow(db, event.payload.key, tenantId, userId);

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
