import {
  type ConfigKeyType,
  type ConfigScope,
  defineQueryHandler,
  type HandlerContext,
  type SessionUser,
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

// Core of config:query:readiness, exported through the config barrel so the
// readiness rollup-feature reuses the exact same cascade + access filter.
// Resolved through the same cascade as ctx.config() so readiness can never
// drift from what the owning feature's build-fn will see. Note:
// required+encrypted assumes encryption is wired — resolver.get decrypts
// stored values, same prerequisite as any ctx.config() read of that key.
export async function collectMissingRequiredConfig(
  ctx: HandlerContext,
  callerQn: string,
  user: SessionUser,
): Promise<ReadinessMissingKey[]> {
  const resolver = requireConfigResolver(ctx, callerQn);
  const missing: ReadinessMissingKey[] = [];
  for (const [qualifiedKey, keyDef] of ctx.registry.getAllConfigKeys()) {
    if (keyDef.required !== true) continue;
    if (!hasConfigAccess(keyDef.access.read, user.roles)) continue;
    const value = await resolver.get(qualifiedKey, keyDef, user.tenantId, user.id, ctx.db);
    if (isUnset(value, keyDef.type)) {
      missing.push({ key: qualifiedKey, scope: keyDef.scope, type: keyDef.type });
    }
  }
  return missing;
}

// No boolean "ready" verdict on purpose — config readiness says nothing
// about secrets. readiness:query:status (readiness feature) rolls both up.
export const readinessQuery = defineQueryHandler({
  name: "readiness",
  schema: z.object({}),
  // Per-key read access enforced via hasConfigAccess inside the handler.
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const missing = await collectMissingRequiredConfig(ctx, "config:query:readiness", query.user);
    return { missing };
  },
});
