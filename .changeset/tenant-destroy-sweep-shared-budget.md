---
"@cosmicdrift/kumiko-bundled-features": patch
---

Tenant destruction sweep splits one tick budget across all destroying tenants

<!-- kumiko-changes
feature: tenant-lifecycle
type: fix
title: One sweep tick shares a single stage budget between all destroying tenants
detail: The destruction sweep used to give every destroying tenant its own full stage budget, so a few large tenants stretched one tick far beyond the minute cron window and the following ticks were skipped. The tick budget is now divided evenly over the destroying tenants. Each tenant's slice starts when that tenant's turn begins, so an overrun by one tenant never leaves the next ones with a zero slice. runNextDestructionStage accepts an optional deadlineAt.
-->
