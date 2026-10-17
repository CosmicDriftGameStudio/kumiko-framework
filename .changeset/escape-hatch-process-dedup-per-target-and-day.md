---
"@cosmicdrift/kumiko-framework": patch
---

System-cron escape hatch audits are deduplicated per target and repeat daily

<!-- kumiko-changes
feature: framework
type: fix
title: System-cron escape hatch audits are deduplicated per target and repeat daily
detail: The per-process dedup of declared system-cron hatches keyed only on handler, kind and tenant, so a run writing several global tables was audited for the first table only, and a worker running longer than the audit retention left no event. The key now includes the target and the process audits again after 24 hours.
-->
