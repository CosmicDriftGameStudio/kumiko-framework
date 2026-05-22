---
"@cosmicdrift/kumiko-framework": patch
---

`validateExtensionUsages` allows self-extension (feature provides AND consumes the same extension).

Previously a feature like tier-engine — which defines the `tenantTierResolver` extension-point AND ships a default plugin against it — failed boot-validation with `Feature "tier-engine" uses extension "tenantTierResolver" but missing requires("tier-engine")`. `r.requires(self)` would be a circular declaration that the registry-build rejects too, so the only escape was to not validate self-extension. That's now the contract: providerFeature === feature.name short-circuits the dependency check.

Surfaced when studio.kumiko.so booted in production-bundle for the first time (Sprint 9.8). The same source had run for months in monorepo-dev-mode because composeFeatures' bundled-additions happen to come BEFORE the validate step in a different order — only a real `bun build`-bundled boot triggers the path. Memory `feedback_audit_drift_root_cause_now`: framework-bug, not per-app workaround.
