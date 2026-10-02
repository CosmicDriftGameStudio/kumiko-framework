---
"@cosmicdrift/kumiko-bundled-features": patch
---

`billing-plans` now fails with an `unconfigured` error when `catalog.providerName` names a provider that is not registered, instead of rendering billing as disabled. Billing renders as disabled only when no `providerName` is set and no provider is mounted. `switch-plan` answers a subscription on an unmounted provider with the `providerMismatch` conflict instead of a 500.

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: Unregistered catalog.providerName fails unconfigured; switch-plan checks provider mismatch before lookup
migration: |
  If `catalog.providerName` names a provider that is not mounted, billing-plans now fails with `unconfigured` instead of rendering billing as disabled; mount the provider or remove `providerName`.
-->
