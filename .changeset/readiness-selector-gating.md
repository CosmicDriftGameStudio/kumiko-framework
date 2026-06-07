---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Readiness provider-gating: `ready` counts only the selected provider's keys.

- `r.extensionSelector(extensionName, configKeyHandle)` — extension-point
  owners declare which config key selects the active provider
  (`mail-foundation` and `file-foundation` do). Without this, an app
  mounting smtp + inmemory transports showed `ready: false` forever for a
  tenant correctly running on inmemory.
- Readiness gating counts a provider-feature's required keys and secrets
  only while that provider is the selected one. Applies to
  `readiness:query:status` AND `config:query:readiness`. Features without
  a selector-gated registration count unconditionally, as before.
- `RegistrarExtensionRegistration.featureName` — the registry annotates
  each usage with its owning feature at merge time.
- `buildProviderSelectionGate` exported from the config barrel.
- Registry-build fails on duplicate selectors, selectors for undeclared
  extensions, and unknown selector keys.
