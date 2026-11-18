---
"@cosmicdrift/kumiko-dev-server": patch
---

`setupAppTestStack` with `registryTables: false` no longer fails at boot when a tier-engine feature is mounted. The tier gate preloads `read_tier_assignments` while the stack is built, so the unpushed table broke every app test that leaves tables absent on purpose (for example to make the tier-sync step fail and prove the Stripe retry self-heal). With `registryTables: false` the stack now skips the tier gate, as it did before the gate was added to app test stacks.
