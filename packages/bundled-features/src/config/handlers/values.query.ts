import {
  type ConfigScope,
  type ConfigValueSource,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { requireConfigResolver } from "../feature";
import { shouldRedactInheritedSystem } from "../read-redaction";
import { deserializeValue } from "../resolver";
import { hasConfigAccess } from "../write-helpers";

export const valuesQuery = defineQueryHandler({
  name: "values",
  schema: z.object({}),
  // Per-key read access enforced via hasConfigAccess inside the handler.
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const db = ctx.db;
    const registry = ctx.registry;
    const resolver = requireConfigResolver(ctx, "config:query:values");

    const allKeys = registry.getAllConfigKeys();
    const storedValues = await resolver.getAllWithSource(query.user.tenantId, query.user.id, db);

    const result: Record<
      string,
      {
        value: string | number | boolean | undefined;
        scope: ConfigScope;
        source: ConfigValueSource;
      }
    > = {};

    for (const [qualifiedKey, keyDef] of allKeys) {
      if (!hasConfigAccess(keyDef.access.read, query.user.roles)) continue;

      const stored = storedValues.get(qualifiedKey);

      // Tenant-side viewers must not see an inherited system value (nor that
      // it is set) when the key opts out of inheritance — present it as unset.
      if (
        stored?.source === "system-row" &&
        shouldRedactInheritedSystem(keyDef, query.user.roles)
      ) {
        result[qualifiedKey] = { value: keyDef.default, scope: keyDef.scope, source: "default" };
        continue;
      }

      let value: string | number | boolean | undefined;
      const source: ConfigValueSource = stored?.source ?? "default";

      if (keyDef.encrypted) {
        value = stored ? "••••••" : undefined;
      } else if (stored?.value !== null && stored?.value !== undefined) {
        value = deserializeValue(stored.value, keyDef.type);
      } else {
        value = keyDef.default;
      }

      result[qualifiedKey] = { value, scope: keyDef.scope, source };
    }

    return result;
  },
});
