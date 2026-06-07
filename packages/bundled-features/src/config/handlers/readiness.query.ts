import {
  type ConfigKeyType,
  type ConfigScope,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { requireConfigResolver } from "../feature";
import { hasConfigAccess } from "../write-helpers";

export type ReadinessMissingKey = {
  readonly key: string;
  readonly scope: ConfigScope;
  readonly type: ConfigKeyType;
};

// Mirrors requireNonEmpty in foundation-shared/config-helpers.ts: required
// text keys ship default "" and count as unset while empty/whitespace.
function isUnset(value: string | number | boolean | undefined, type: ConfigKeyType): boolean {
  if (value === undefined) return true;
  return type === "text" && typeof value === "string" && value.trim().length === 0;
}

// No boolean "ready" verdict on purpose — config readiness says nothing
// about secrets, so callers compose this list with the secrets list-handler.
export const readinessQuery = defineQueryHandler({
  name: "readiness",
  schema: z.object({}),
  // Per-key read access enforced via hasConfigAccess inside the handler.
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const db = ctx.db;
    const registry = ctx.registry;
    const resolver = requireConfigResolver(ctx, "config:query:readiness");

    // Resolved through the same cascade as ctx.config() so readiness can
    // never drift from what the owning feature's build-fn will see. Note:
    // required+encrypted assumes encryption is wired — resolver.get decrypts
    // stored values, same prerequisite as any ctx.config() read of that key.
    const missing: ReadinessMissingKey[] = [];
    for (const [qualifiedKey, keyDef] of registry.getAllConfigKeys()) {
      if (keyDef.required !== true) continue;
      if (!hasConfigAccess(keyDef.access.read, query.user.roles)) continue;
      const value = await resolver.get(
        qualifiedKey,
        keyDef,
        query.user.tenantId,
        query.user.id,
        db,
      );
      if (isUnset(value, keyDef.type)) {
        missing.push({ key: qualifiedKey, scope: keyDef.scope, type: keyDef.type });
      }
    }

    return { missing };
  },
});
