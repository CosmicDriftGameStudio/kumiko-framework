import type { Registry } from "./types";

// Callback that returns the current global-toggle override for a feature.
// `true`  = explicit global row says enabled.
// `false` = explicit global row says disabled.
// `undefined` = no row — fall back to the feature's declared toggleableDefault.
//
// The feature-toggles bundled feature provides this reader; tests can inject
// a map-backed stub. The reader is called once per feature during compute;
// callers that fetch toggles from a DB should batch-load upfront and expose
// a Map lookup to keep compute() allocation-light.
export type ToggleReader = (featureName: string) => boolean | undefined;

// Compute the set of effectively-enabled features for the current call.
//
// Rules (AND-combined, any false wins):
//   1. Always-on: feature without r.toggleable() → enabled, ignores overrides.
//   2. Toggleable: enabled = (globalOverride ?? toggleableDefault).
//   3. Cascade: a feature is only effectively enabled if ALL its r.requires()
//      targets are effectively enabled. Applied transitively.
//
// Cascade semantics note: a NON-toggleable feature A that requires a
// toggleable feature B becomes effectively disabled when B is off. This is
// intentional — running A's handlers/hooks without its declared dependency
// would be a worse failure mode than gating A. Ops documentation must call
// this out so disabling "leaf" features doesn't surprise anyone.
//
// The result is a plain Set for O(1) `has(name)` checks in the dispatcher
// gate, hook filter, and MSP runner. Cycle-safety is delegated to the
// registry's existing boot-validation (cycles are rejected there).
export function computeEffectiveFeatures(
  registry: Registry,
  readToggle: ToggleReader,
): ReadonlySet<string> {
  // Raw enablement, before cascade.
  const raw = new Map<string, boolean>();
  for (const feature of registry.features.values()) {
    if (feature.toggleableDefault === undefined) {
      raw.set(feature.name, true);
      continue;
    }
    const override = readToggle(feature.name);
    raw.set(feature.name, override ?? feature.toggleableDefault);
  }

  // Transitive cascade via DFS with memoization. Cycles are already rejected
  // at boot, so no cycle-breaking is needed here.
  const effective = new Map<string, boolean>();

  function resolve(name: string): boolean {
    const cached = effective.get(name);
    if (cached !== undefined) return cached;

    const rawEnabled = raw.get(name) ?? true;
    if (!rawEnabled) {
      effective.set(name, false);
      return false;
    }

    const feature = registry.getFeature(name);
    // Feature referenced by requires() but not loaded — registry boot should
    // have caught this, but be defensive: treat missing deps as disabled
    // (surfaces the same behaviour as "dep is off", not a silent pass).
    if (!feature) {
      effective.set(name, false);
      return false;
    }

    for (const dep of feature.requires) {
      if (!resolve(dep)) {
        effective.set(name, false);
        return false;
      }
    }

    effective.set(name, true);
    return true;
  }

  for (const feature of registry.features.values()) resolve(feature.name);

  const result = new Set<string>();
  for (const [name, enabled] of effective) {
    if (enabled) result.add(name);
  }
  return result;
}
