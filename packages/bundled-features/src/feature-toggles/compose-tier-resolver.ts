import {
  computeEffectiveFeatures,
  type EffectiveFeaturesResolver,
  type Registry,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import type { GlobalFeatureToggleRuntime } from "./toggle-runtime";

// Composes a tenantTierResolver (tier-engine) with a GlobalFeatureToggleRuntime
// (feature-toggles) into a single resolver an app can pass as
// runProdApp/runDevApp's `effectiveFeatures`.
//
// The framework only auto-wires ONE tenantTierResolver plugin (single-plugin
// assumption, see tier-resolver-extension.ts) — an app running BOTH
// tier-engine (per-tenant feature cuts) and feature-toggles (global runtime
// switches, e.g. an operator kill-switch not tied to any tier) needs to
// combine them itself. This is that combination, factored out here instead
// of duplicated per app.
//
// Two disjoint classes of toggleable feature exist once both are mounted:
//   - tier-managed (e.g. a Team-tier perk like personal-access-tokens): the
//     TIER decides membership, not the feature's own default — a toggleable
//     feature with no override row must stay governed by its tier, or every
//     tier-gated toggleable would silently leak/vanish the moment
//     feature-toggles is composed in. The global layer may only NARROW this
//     (`enabled: false` removes it; no row / `true` leaves the tier's grant
//     untouched).
//   - tier-unaware (e.g. a pure operator kill-switch with no tier
//     differentiation at all, such as auth-self-registration): no tier's
//     `features` list ever mentions it, so it would never appear in ANY
//     tenant's tier-set — narrowing alone can only remove features, never
//     grant this one. Its membership must come from computeEffectiveFeatures'
//     normal cascade (override ?? toggleableDefault) instead.
//
// `tierResolver(SYSTEM_TENANT_ID)` is tier-engine's documented convention for
// "union of every tier's features" (operator-tooling/async-dispatch
// convention) — used here purely to classify which toggleable names are
// tier-managed, without needing the app's TierMap as a separate parameter.
export function composeTierResolverWithGlobalToggles(
  tierResolver: EffectiveFeaturesResolver,
  toggleRuntime: GlobalFeatureToggleRuntime,
  registry: Registry,
): EffectiveFeaturesResolver {
  const tierManaged = tierResolver(SYSTEM_TENANT_ID);

  const composed = ((tenantId) => {
    const tierSet = tierResolver(tenantId);
    const result = new Set<string>();
    for (const name of tierSet) {
      if (toggleRuntime.readOverride(name) !== false) result.add(name);
    }
    const globalCascade = computeEffectiveFeatures(registry, (name) =>
      toggleRuntime.readOverride(name),
    );
    for (const name of globalCascade) {
      if (!tierManaged.has(name)) result.add(name);
    }
    return result;
  }) as EffectiveFeaturesResolver;

  if (tierResolver.trialGate) {
    return Object.assign(composed, { trialGate: tierResolver.trialGate });
  }
  return composed;
}
