import {
  type ConfigKeyDefinition,
  type ConfigScope,
  type ConfigValueSource,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { requireConfigResolver } from "../feature";
import { redactInheritedCascade, shouldRedactInherited } from "../read-redaction";
import { hasConfigAccess } from "../write-helpers";

const MASKED = "••••••";

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
    const keyDefs = new Map<string, ConfigKeyDefinition>();
    const filteredKeys: string[] = [];
    for (const [qualifiedKey, keyDef] of allKeys) {
      if (!hasConfigAccess(keyDef.access.read, query.user.roles)) continue;
      keyDefs.set(qualifiedKey, keyDef);
      filteredKeys.push(qualifiedKey);
    }

    // Resolve through the full cascade (rows → app-override → computed →
    // default) — the same path as config:query:cascade — so the mask shows the
    // inherited default (e.g. an ENV-bridged app-override), not only DB rows.
    const cascades = await resolver.getCascadeBatch(
      filteredKeys,
      keyDefs,
      query.user.tenantId,
      query.user.id,
      db,
    );

    const result: Record<
      string,
      {
        value: string | number | boolean | undefined;
        scope: ConfigScope;
        source: ConfigValueSource;
      }
    > = {};

    for (const [qualifiedKey, keyDef] of keyDefs) {
      const rawCascade = cascades.get(qualifiedKey);
      if (!rawCascade) continue;

      // Redact inherited platform rungs BEFORE masking — masking alone leaves
      // a value present and would leak "it is set" to a tenant-side viewer.
      const cascade = shouldRedactInherited(keyDef, query.user.roles)
        ? redactInheritedCascade(rawCascade)
        : rawCascade;

      let value: string | number | boolean | undefined;
      if (keyDef.encrypted) {
        value = cascade.value !== undefined ? MASKED : undefined;
      } else {
        value = cascade.value;
      }

      result[qualifiedKey] = { value, scope: keyDef.scope, source: cascade.source };
    }

    return result;
  },
});
