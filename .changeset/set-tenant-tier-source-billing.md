---
"@cosmicdrift/kumiko-bundled-features": patch
---

set-tenant-tier can hand a manual grant back to the billing sync

<!-- kumiko-changes
feature: tier-engine
type: improvement
title: set-tenant-tier accepts an optional source so a manual grant can return to billing control
detail: The handler payload takes source (manual, billing or default, default manual). Writing the row with source billing makes the subscription tier sync treat it as billing-driven again, so the next webhook overwrites the tier. The handler stays SystemAdmin only.
-->
