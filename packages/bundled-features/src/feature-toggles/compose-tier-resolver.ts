import {
  type EffectiveFeaturesResolver,
  isToggleableFeature,
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
  // registry needed for toggleability lookups; toggleRuntime keeps its own registry reference private.
  registry: Registry,
): EffectiveFeaturesResolver {
  // Lazy + memoized: computed on first composed(tenantId) call, not at
  // compose-time. Late-bound holder wiring (e.g. run-dev-app.ts's tier
  // resolver plugin) may not have its real tierResolver built yet when
  // composeTierResolverWithGlobalToggles itself runs.
  let tierManaged: ReadonlySet<string> | undefined;

  const composed: EffectiveFeaturesResolver = (tenantId) => {
    if (tierManaged === undefined) {
      const managed = tierResolver(SYSTEM_TENANT_ID);
      // fail-loud: an empty union means the resolver doesn't implement the SYSTEM_TENANT_ID convention at all.
      if (managed.size === 0) {
        throw new Error(
          "composeTierResolverWithGlobalToggles: tierResolver(SYSTEM_TENANT_ID) " +
            "returned an empty set. tier-engine's SYSTEM_TENANT_ID convention " +
            "(union of every tier's features, plus always-on features) must " +
            "never be empty — an empty result means the tierResolver passed in " +
            "doesn't implement that convention, which would silently disable " +
            "all tier-gating (every feature would be treated as tier-unaware).",
        );
      }
      // Structural Rule 1: only the TOGGLEABLE subset of the union is tier-managed.
      // Non-toggleable (always-on) names must keep reaching `result` through the
      // globalCascade loop below even if this resolver's SYSTEM_TENANT_ID answer
      // satisfies the emptiness guard above without also merging always-on into
      // every per-tenant tierSet (framework#1528).
      tierManaged = new Set(
        [...managed].filter((name) => {
          const feature = registry.getFeature(name);
          return feature !== undefined && isToggleableFeature(feature);
        }),
      );
    }

    const tierSet = tierResolver(tenantId);
    const result = new Set<string>();
    for (const name of tierSet) {
      // Only a toggleable feature's override can narrow the tier's grant —
      // computeEffectiveFeatures' Rule 1 ignores overrides for features
      // without a toggleableDefault, and an override row can otherwise
      // reach a non-toggleable feature via seed-scripts/ops-SQL/an
      // r.toggleable() removal after the fact (readOverride/refresh() have
      // no toggleability gate of their own).
      const feature = registry.getFeature(name);
      const isToggleable = feature !== undefined && isToggleableFeature(feature);
      if (!isToggleable || toggleRuntime.readOverride(name) !== false) {
        result.add(name);
      }
    }
    // toggleRuntime.effectiveFeatures() already applies computeEffectiveFeatures'
    // full rule set (toggleableDefault ?? override, THEN the requires() cascade)
    // — reusing it here instead of calling computeEffectiveFeatures directly
    // keeps this in lockstep with the runtime's own dispatcher-facing callback.
    const globalCascade = toggleRuntime.effectiveFeatures();
    for (const name of globalCascade) {
      if (!tierManaged.has(name)) result.add(name);
    }

    // requires() cascade over the combined result: a feature narrowed off by
    // either loop above (tier-managed override, or absent from both sets)
    // must also drop anything that itself requires it — computeEffectiveFeatures
    // enforces this for its own single reader, but tierSet's membership isn't
    // reader-driven, so the cascade has to be re-applied over the union.
    let changed = true;
    while (changed) {
      changed = false;
      for (const name of [...result]) {
        const feature = registry.getFeature(name);
        if (!feature) {
          result.delete(name);
          changed = true;
          continue;
        }
        for (const dep of feature.requires) {
          if (!result.has(dep)) {
            result.delete(name);
            changed = true;
            break;
          }
        }
      }
    }

    return result;
  };

  if (tierResolver.trialGate) {
    return Object.assign(composed, { trialGate: tierResolver.trialGate });
  }
  return composed;
}
