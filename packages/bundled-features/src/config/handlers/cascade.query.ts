import {
  type ConfigCascade,
  type ConfigCascadeLevel,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { requireConfigResolver } from "../feature";
import { redactInheritedCascade, shouldRedactInherited } from "../read-redaction";
import { hasConfigAccess } from "../write-helpers";

const MASKED = "••••••";

export const cascadeQuery = defineQueryHandler({
  name: "cascade",
  schema: z.object({
    keys: z.array(z.string()).optional(),
  }),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const db = ctx.db;
    const registry = ctx.registry;
    const resolver = requireConfigResolver(ctx, "config:query:cascade");

    const allKeys = registry.getAllConfigKeys();
    const keys = query.payload.keys ?? Array.from(allKeys.keys());

    const keyDefs = new Map<
      string,
      import("@cosmicdrift/kumiko-framework/engine").ConfigKeyDefinition
    >();
    const filteredKeys: string[] = [];

    for (const key of keys) {
      const keyDef = allKeys.get(key);
      if (!keyDef) continue;
      if (!hasConfigAccess(keyDef.access.read, query.user.roles)) continue;
      keyDefs.set(key, keyDef);
      filteredKeys.push(key);
    }

    const cascades = await resolver.getCascadeBatch(
      filteredKeys,
      keyDefs,
      query.user.tenantId,
      query.user.id,
      db,
    );

    const result: Record<string, ConfigCascade> = {};
    for (const [key, rawCascade] of cascades) {
      const keyDef = keyDefs.get(key);
      if (!keyDef) continue;

      // Redact the inherited platform value (system-row, app-override,
      // computed, default) BEFORE masking — masking alone leaves hasValue=true
      // and would still leak "it is set" to a tenant.
      const cascade = shouldRedactInherited(keyDef, query.user.roles)
        ? redactInheritedCascade(rawCascade)
        : rawCascade;

      if (keyDef.encrypted) {
        const maskedLevels: ConfigCascadeLevel[] = cascade.levels.map((l) => ({
          ...l,
          value: l.hasValue ? MASKED : l.value,
        }));
        result[key] = {
          value: cascade.value !== undefined ? MASKED : cascade.value,
          source: cascade.source,
          levels: maskedLevels,
        };
      } else {
        result[key] = cascade;
      }
    }

    return result;
  },
});
