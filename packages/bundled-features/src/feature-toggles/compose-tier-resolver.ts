import type { EffectiveFeaturesResolver } from "@cosmicdrift/kumiko-framework/engine";
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
// Semantics: the global toggle layer can only NARROW what the tier grants,
// never widen it — an explicit `enabled: false` row removes a feature the
// tier would otherwise include; no row, or an explicit `true` row, leaves
// the tier's grant untouched. Deliberately NOT computeEffectiveFeatures'
// cascade (which falls back to a toggleable feature's declared default):
// under tier-engine, a toggleable feature with no override row is governed
// by the TIER, not by its own default — falling back to the default would
// silently kill every tier-gated toggleable feature (e.g. a Team-tier
// feature defaulting `false`) the moment feature-toggles gets composed in.
export function composeTierResolverWithGlobalToggles(
  tierResolver: EffectiveFeaturesResolver,
  toggleRuntime: GlobalFeatureToggleRuntime,
): EffectiveFeaturesResolver {
  const composed = ((tenantId) => {
    const tierSet = tierResolver(tenantId);
    const result = new Set<string>();
    for (const name of tierSet) {
      if (toggleRuntime.readOverride(name) !== false) result.add(name);
    }
    return result;
  }) as EffectiveFeaturesResolver;

  if (tierResolver.trialGate) {
    return Object.assign(composed, { trialGate: tierResolver.trialGate });
  }
  return composed;
}
