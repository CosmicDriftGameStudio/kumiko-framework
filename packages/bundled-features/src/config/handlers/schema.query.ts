import { type ConfigKeyDefinition, defineQueryHandler } from "@kumiko/framework/engine";
import { z } from "zod";
import { hasConfigAccess } from "../write-helpers";

export const schemaQuery = defineQueryHandler({
  name: "schema",
  schema: z.object({}),
  // Per-key read access enforced via hasConfigAccess inside the handler.
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const registry = ctx.registry;
    const allKeys = registry.getAllConfigKeys();
    const result: Record<string, ConfigKeyDefinition> = {};

    for (const [qualifiedKey, keyDef] of allKeys) {
      if (!hasConfigAccess(keyDef.access.read, query.user.roles)) continue;
      result[qualifiedKey] = keyDef;
    }

    return result;
  },
});
