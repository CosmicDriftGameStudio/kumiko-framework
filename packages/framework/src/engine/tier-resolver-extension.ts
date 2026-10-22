// Tier composition: framework extension point for per-tenant
// effective-feature resolution.
//
// **Pattern (analogous to mail-foundation / file-foundation):** a feature
// declares `r.extendsRegistrar("tenantTierResolver")`, and plugins
// implement it via `r.useExtension("tenantTierResolver", "id", { build })`.
//
// **Framework auto-wiring:** runDevApp + runProdApp scan the registry
// for this exact extension name. If a plugin is found AND the app author
// has not set an `effectiveFeatures` callback, `plugin.build({ db, registry })`
// is called once in onAfterSetup. The returned callback becomes
// `effectiveFeatures` in the dispatcher.
//
// **Why this pattern:** the app author mounts
// `createTierEngineFeature(opts)` and is done—no late-bound holder in the
// run config and no need to wire an effectiveFeatures callback. The framework
// handles the late-binding internally. Tier composition is a feature, not a
// subsystem with app-specific wiring.
//
// **Apps without a tier engine:** if no plugin is registered, the framework
// does nothing—`effectiveFeatures` remains undefined, and all features are on.

import type { CacheSyncBus } from "@cosmicdrift/kumiko-types/cache-sync-types";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { DbConnection } from "../db/connection.ts";
import type { RegistrarExtensionRegistration } from "./types/config.ts";
import type { FeatureDefinition, Registry } from "./types/feature.ts";
import type { TenantId } from "./types/identifiers.ts";

/**
 * Extension name under which a tier-resolver plugin must be registered in the
 * registry. The constant keeps `r.useExtension(TENANT_TIER_RESOLVER_EXT, ...)`
 * and the framework's `getExtensionUsages(TENANT_TIER_RESOLVER_EXT)` aligned
 * on the same value, preventing typos.
 */
export const TENANT_TIER_RESOLVER_EXT = "tenantTierResolver";

/**
 * Resolver callback shape: synchronous (on the dispatcher's hot path), per
 * tenant. Returns the tenant's effective feature set. Implementations should
 * maintain an in-memory cache and invalidate it via `r.entityHook`.
 *
 * **System-context convention:** calls with SYSTEM_TENANT_ID must return the
 * union of all tier features (see the DispatcherOptions.effectiveFeatures
 * doc block).
 */
export type EffectiveFeaturesResolver = ((tenantId: TenantId) => ReadonlySet<string>) & {
  /**
   * Optional live-trial gate, consulted by the dispatcher feature gate ONLY
   * when the synchronous resolver reports a feature as disabled. Reads the
   * tenant's signup date live (tenant.inserted_at) and returns true when the
   * tenant is within the trial window AND the feature belongs to the trial
   * tier. It is async and not part of the boot cache because the trial is
   * time-dependent and can change between requests. Consulted at three
   * locations: the two dispatch-gate call sites (checkFeatureEnabled) AND
   * ctx.hasFeature in the handler body (as a fallback when the synchronous
   * feature-set check is negative).
   */
  readonly trialGate?: TrialGate;
};

/**
 * Live-Trial-Gate-Shape. Siehe EffectiveFeaturesResolver.trialGate.
 */
export type TrialGate = (tenantId: TenantId, featureName: string) => Promise<boolean>;

/**
 * Plugin shape for the tier-resolver extension. Plugins implement `build`
 * as a boot-time factory: they receive `db` + `registry` (after stack setup),
 * load the initial cache from the database, and return the synchronous
 * resolver callback, optionally with an attached `trialGate`.
 */
export type TierResolverPlugin = {
  readonly build: (deps: {
    readonly db: DbConnection;
    readonly registry: Registry;
    // Cross-process invalidation; absent = this process is the only writer/reader.
    readonly cacheSync?: CacheSyncBus;
  }) => Promise<EffectiveFeaturesResolver>;
};

/**
 * Scans a composed feature list for a `tenantTierResolver` extension usage.
 * Only one plugin is supported because multiple plugins would be ambiguous:
 * it would be unclear which resolver should win. No multi-merge pattern is
 * needed until there is a real use case.
 *
 * Shared by runDevApp + runProdApp so the pickup path remains byte-for-byte
 * identical and cannot drift.
 */
/** Narrows a registration's untyped `options` bag to the tier-resolver
 *  plugin shape — the only thing every implementation must provide is the
 *  `build` factory. */
export function isTierResolverPlugin(v: unknown): v is TierResolverPlugin {
  return isPlainObject(v) && typeof v["build"] === "function";
}

export function requireTierResolverPlugin(
  usage: RegistrarExtensionRegistration,
): TierResolverPlugin {
  if (!isTierResolverPlugin(usage.options)) {
    throw new Error("tier-resolver registration options must provide a build() factory");
  }
  return usage.options;
}

export function findTierResolverUsage(
  features: readonly FeatureDefinition[],
): RegistrarExtensionRegistration | undefined {
  for (const feature of features) {
    for (const usage of feature.extensionUsages) {
      if (usage.extensionName === TENANT_TIER_RESOLVER_EXT) {
        return usage;
      }
    }
  }
  return undefined;
}
