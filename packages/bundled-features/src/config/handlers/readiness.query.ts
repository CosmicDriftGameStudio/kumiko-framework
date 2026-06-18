import {
  type ConfigKeyType,
  type ConfigScope,
  defineQueryHandler,
  type HandlerContext,
  type SessionUser,
  toKebab,
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

// Whether a required key/secret counts for THIS tenant right now. Keys of
// provider-features under a selector-declared extension point count only
// while their provider is the selected one — an SMTP password is no gap
// for a tenant running the inmemory transport.
export type RequiredKeyGate = (qualifiedName: string) => boolean;

// Builds the per-tenant gate from r.extensionSelector declarations: resolve
// each selector through the config cascade, mark every provider-feature
// registered under that point as counted/uncounted. Features without a
// selector-gated registration always count.
export async function buildProviderSelectionGate(
  ctx: HandlerContext,
  callerQn: string,
  user: SessionUser,
): Promise<RequiredKeyGate> {
  const resolver = requireConfigResolver(ctx, callerQn);
  const countsByFeature = new Map<string, boolean>();
  for (const [extensionName, selectorKey] of ctx.registry.getAllExtensionSelectors()) {
    const keyDef = ctx.registry.getConfigKey(selectorKey);
    if (!keyDef) continue; // registry-build already failed this; defensive
    const value = await resolver.get(selectorKey, keyDef, user.tenantId, user.id, ctx.db);
    const selected = typeof value === "string" ? value.trim() : "";
    for (const usage of ctx.registry.getExtensionUsages(extensionName)) {
      if (usage.featureName === undefined) continue;
      const owner = toKebab(usage.featureName);
      const isSelected = usage.entityName === selected;
      countsByFeature.set(owner, (countsByFeature.get(owner) ?? false) || isSelected);
    }
  }
  return (qualifiedName) => countsByFeature.get(qualifiedName.split(":")[0] ?? "") ?? true;
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
  gate?: RequiredKeyGate,
  options?: {
    /** Verdict-Pfade (Rollup, selbst role-gated) MÜSSEN ungefiltert zählen:
     *  der Per-Key-read-Filter ist Info-Disclosure-Schutz für den
     *  openToAll-Handler — im Verdict droppte er SystemAdmin-gated
     *  required-Keys still und meldete ready:true trotz Lücke. */
    readonly skipAccessFilter?: boolean;
  },
): Promise<ReadinessMissingKey[]> {
  const resolver = requireConfigResolver(ctx, callerQn);
  const effectiveGate = gate ?? (await buildProviderSelectionGate(ctx, callerQn, user));
  // Kandidaten erst sammeln, dann EIN Batch-Resolve — die sequentielle
  // resolver.get-Schleife war ein N+1 über alle required Keys (272/1).
  type KeyDef =
    ReturnType<typeof ctx.registry.getAllConfigKeys> extends ReadonlyMap<string, infer D>
      ? D
      : never;
  const candidates = new Map<string, KeyDef>();
  for (const [qualifiedKey, keyDef] of ctx.registry.getAllConfigKeys()) {
    if (keyDef.required !== true) continue;
    if (!effectiveGate(qualifiedKey)) continue;
    if (options?.skipAccessFilter !== true && !hasConfigAccess(keyDef.access.read, user.roles)) {
      continue;
    }
    candidates.set(qualifiedKey, keyDef);
  }
  const missing: ReadinessMissingKey[] = [];
  const cascades = await resolver.getCascadeBatch(
    [...candidates.keys()],
    candidates,
    user.tenantId,
    user.id,
    ctx.db,
    ctx.secrets,
  );
  for (const [qualifiedKey, keyDef] of candidates) {
    // Deliberately the unredacted cascade value: readiness asks "does this
    // tenant functionally have the value?", and an inheritedToTenant:false key
    // set only at system-level IS inherited (the resolver ignores
    // inheritedToTenant — that flag only redacts the value queries' display).
    // Redacting here would report a working key as missing. The is-set bit this
    // exposes is intentional; see read-redaction.ts.
    const value = cascades.get(qualifiedKey)?.value;
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
