---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

perTenant jobs skip the system tenant unless they set `includeSystemTenant`, also when the system tenant has an enabled tenant row.

<!-- kumiko-changes
feature: jobs
type: bugfix
title: perTenant jobs no longer run for the system tenant unless they set includeSystemTenant
detail: The fan-out took every enabled tenant row, so an app with a tenant row for the system tenant ran every perTenant job there too, and member-scoped jobs failed with "queryAsMember needs a tenant-scoped context". The system tenant now only gets a run with `includeSystemTenant: true`.
-->
