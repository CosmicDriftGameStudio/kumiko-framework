---
"@cosmicdrift/kumiko-bundled-features": minor
---

tier-engine drops the unused tier option gate.

<!-- kumiko-changes
feature: tier-engine
type: breaking
title: Tier option gate removed
detail: `createTierOptionGate` and its types `TierOptionGate`, `TierOptionGateDeps`, `TierOptionSpec` and `TierOptionAvailability` are removed from `@cosmicdrift/kumiko-bundled-features/tier-engine`. No app used them. `optionsAvailabilityQuery` on a field stays; the write path enforces the same rule in the app's own handler.
migration: An app that gated select options by tier checks the tier in its own write handler before the write and serves `optionsAvailabilityQuery` from its own query handler.
affects: createTierOptionGate, TierOptionGate, TierOptionSpec, TierOptionAvailability
-->
