---
"@cosmicdrift/kumiko-framework": patch
---

Review fixes: a job no longer fails when the tenant timezone config read throws, the escape-hatch process dedup drops expired entries, handler cross-tenant reads are metered per call, and a beforeTransaction phase and its handler see the same parsed payload.

<!-- kumiko-changes
feature: jobs
type: fix
title: Job runs survive a failing tenant timezone config read
detail: A throwing tenant timezone config read now logs a warning and falls back to UTC for ctx.tz instead of failing a job that never uses ctx.tz.
-->

<!-- kumiko-changes
feature: observability
type: fix
title: Escape-hatch process dedup no longer grows without bound
detail: Entries older than the daily re-audit interval are swept, so row-level cross-tenant read targets in long-lived workers are not kept forever.
-->

<!-- kumiko-changes
feature: observability
type: fix
title: Handler cross-tenant reads count in the escape-hatch metric
detail: Handlers now report to the escape-hatch meter like jobs do, so every ctx.crossTenantReads call is counted while the audit event stays deduplicated per report window.
-->

<!-- kumiko-changes
feature: pipeline
type: fix
title: beforeTransaction phase and handler share one parsed payload
detail: The payload parsed for the pre-transaction phases is handed to the handler as is, so schema defaults or transforms that generate values no longer differ between the phase and the handler.
-->

<!-- kumiko-changes
feature: pipeline
type: fix
title: Cascade delete and set-null load only child ids
detail: The cascade handler selects the id column instead of full child rows before calling the executor per child.
-->
