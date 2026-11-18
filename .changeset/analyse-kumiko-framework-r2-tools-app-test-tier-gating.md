---
"@cosmicdrift/kumiko-dev-server": minor
---
`setupAppTestStack` gates handlers by the tenant's tier when tier-engine is mounted with a tierMap.
<!-- kumiko-changes
feature: dev-server
type: breaking
title: App test stacks gate tiers like runDevApp
detail: `setupAppTestStack` now wires the tenantTierResolver of a mounted tier-engine (`createTierEngineFeature({ tierMap })`, `composeSaasStack({ tiers })`) the same way runDevApp and runProdApp do, including the trial gate and `featureToggles`. `ctx.hasFeature` and the dispatcher's feature gate are no longer always on in app tests, so a free-tier refusal test can fail. Breaking for app tests that call tier-gated handlers without assigning a tier: assign one with `tier-engine:write:tier-assignment:create`, or pass `effectiveFeatures` explicitly, which still replaces the resolver.
migration: App tests that call tier-gated handlers without assigning a tier assign one with `tier-engine:write:tier-assignment:create`, or pass `effectiveFeatures` to `setupAppTestStack`, which still replaces the resolver.
affects: setupAppTestStack
-->
