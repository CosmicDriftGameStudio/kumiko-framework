---
"@cosmicdrift/kumiko-framework": patch
---

requireTierResolverPlugin replaces three copies of the tier-resolver build() check

<!-- kumiko-changes
feature: framework
type: improvement
title: requireTierResolverPlugin narrows a tier-resolver registration or fails the boot
detail: requireTierResolverPlugin(usage) returns the TierResolverPlugin of a tenantTierResolver registration and throws "tier-resolver registration options must provide a build() factory" otherwise. runProdApp, the worker boot and runDevApp share it, so the boot error is identical in all three entry points.
-->
