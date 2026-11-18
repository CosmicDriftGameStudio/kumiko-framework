---
"@cosmicdrift/kumiko-bundled-features": patch
---
`createTierResolver` applies the tier-engine trial to the resolved tier and its caps.
<!-- kumiko-changes
feature: tier-engine
type: improvement
title: createTierResolver knows the trial
detail: `createTierResolver({ ..., trial: { tier, durationHours, tierOrder } })` lifts a tenant to the trial tier while the window from the tenant's creation is open and its stored tier ranks below the trial tier (a stored tier missing from `tierOrder` is never lifted), using the same `tenant.inserted_at` source as the tier-engine gate. `resolveTier` and `resolveTierCaps` return the effective tier, and the new `resolveTierState` also returns the stored tier and `trialEndsAtEpochMs` for billing displays. Apps no longer compute the trial themselves through a raw runner.
-->
