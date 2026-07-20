import type { BootCheckContext, FeatureDefinition } from "../types";

// r.bootCheck(fn) lets a feature declare its own mount-invariant instead of
// relying on framework-internal knowledge (the gdpr-storage.ts guards are
// the framework-owned version of this same idea). Each registered fn gets
// the full mounted-feature set and throws to fail the boot; we wrap the
// message with the owning feature's name so the error text points back at
// the feature that declared the check.
export function validateFeatureBootChecks(features: readonly FeatureDefinition[]): void {
  const ctx: BootCheckContext = { features };
  for (const feature of features) {
    for (const check of feature.bootChecks) {
      try {
        check(ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`[Feature ${feature.name}] r.bootCheck failed: ${message}`);
      }
    }
  }
}
