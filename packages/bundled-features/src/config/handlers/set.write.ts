import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { ConfigScopes, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { requireConfigEncryption } from "../feature";
import { configValueEntity, configValuesTable } from "../table";
import {
  findConfigRow,
  prepareConfigWrite,
  validateBounds,
  validateScope,
  validateType,
} from "../write-helpers";

const scopeEnum = z.enum([ConfigScopes.system, ConfigScopes.tenant, ConfigScopes.user]);

const executor = createEventStoreExecutor(configValuesTable, configValueEntity, {
  entityName: "config-value",
});

export const setWrite = defineWriteHandler({
  name: "set",
  schema: z.object({
    key: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]),
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

    const scopeError = validateScope(scope, keyDef.scope, event.payload.key);
    if (scopeError) return writeFailure(scopeError);

    const typeError = validateType(event.payload.value, keyDef);
    if (typeError) return writeFailure(typeError);

    // Bounds enforcement: hard-reject (not silent-clamp). A caller that
    // sends 9999 for a bounds.max=1000 key should see a 422 and fix their
    // input — silent clamping would make `get` return a different value
    // than what was sent, which is a UX trap with no upside.
    const boundsError = validateBounds(event.payload.value, keyDef);
    if (boundsError) return writeFailure(boundsError);

    let serialized = JSON.stringify(event.payload.value);
    if (keyDef.encrypted) {
      const encryption = requireConfigEncryption(ctx, "config:write:set");
      serialized = encryption.encrypt(serialized);
    }

    const existing = await findConfigRow(db, event.payload.key, tenantId, userId);

    if (existing) {
      const result = await executor.update(
        {
          id: existing.id,
          version: existing.version,
          changes: { value: serialized },
        },
        event.user,
        db,
      );
      if (!result.isSuccess) return result;
    } else {
      const result = await executor.create(
        {
          key: event.payload.key,
          value: serialized,
          tenantId,
          userId,
        },
        event.user,
        db,
      );
      if (!result.isSuccess) return result;
    }

    return {
      isSuccess: true,
      data: { key: event.payload.key, value: event.payload.value, scope },
    };
  },
});
