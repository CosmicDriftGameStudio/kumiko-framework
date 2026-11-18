---
"@cosmicdrift/kumiko-dev-server": patch
---

`setupAppTestStack` with `registryTables: false` no longer fails at boot when a tier-engine feature is mounted, also together with `featureToggles: true`. The tier gate preloads `read_tier_assignments` while the stack is built, so the unpushed table broke every app test that leaves tables absent on purpose (for example to make the tier-sync step fail and prove the Stripe retry self-heal). With `registryTables: false` the stack now skips the tier gate, as it did before the gate was added to app test stacks.

<!-- kumiko-changes
feature: dev-server
type: fix
title: setupAppTestStack with registryTables false boots with a mounted tier-engine
detail: The tier gate preloads `read_tier_assignments` while the stack is built, so `setupAppTestStack(features, { registryTables: false })` failed at boot as soon as a tier-engine with a tierMap was mounted. With `registryTables: false` the stack now skips the tier gate, and with `featureToggles: true` also the operator toggles, whose runtime preloads its table the same way.
-->
