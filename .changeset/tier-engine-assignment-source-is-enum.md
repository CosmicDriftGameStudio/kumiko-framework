---
"@cosmicdrift/kumiko-bundled-features": patch
---

Tier assignment source is restricted to manual, billing and default

<!-- kumiko-changes
feature: tier-engine
type: fix
title: tier-assignment source is a select field of TierAssignmentSources
detail: The source column keeps its text storage, but the entity now validates it against manual, billing and default, so a typo can no longer bypass the manual-grant protection of the billing sync. TierAssignmentSource and isTierAssignmentSource are exported; the billing sync narrows the stored value with the guard.
-->
