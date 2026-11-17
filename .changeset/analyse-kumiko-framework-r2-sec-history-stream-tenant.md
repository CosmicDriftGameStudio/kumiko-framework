---
"@cosmicdrift/kumiko-framework": patch
---

executor.history checks the streamTenantId binding like listAsOf and hides embedded fields with a restricted sub-field.

<!-- kumiko-changes
feature: framework
type: fix
title: history binds streamTenantId to the db
detail: EventStoreExecutor.history with options.streamTenantId throws AccessDeniedError unless the db is in system mode or bound to that tenant, the same rule as listAsOf. An embedded field with a sub-field the caller may not read is left out of history changes.
-->
