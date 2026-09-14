import { type ConfigKeyDefinition, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { hasConfigAccess } from "../write-helpers";

export const schemaQuery = defineQueryHandler({
  name: "schema",
  description:
    "Returns the definitions of all config keys the caller may read (scope, type, default, bounds, required flag) without any values; use it to discover which settings exist and how they may be set.",
  schema: z.object({}),
  // Per-key read access enforced via hasConfigAccess inside the handler.
  access: {
    openToAll: {
      reason:
        "any signed-in user may call schema; hasConfigAccess filters the result to " +
        "only the config key definitions the caller's roles may read",
    },
  },
  rateLimit: {
    disabled: true,
    reason:
      "self-scoped read of the caller's own readable config schema, hit on every page load; " +
      "per-tenant bucket would throttle the whole tenant, L1 IP limit still applies",
  },
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
