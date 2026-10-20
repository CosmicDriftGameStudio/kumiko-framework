---
"@cosmicdrift/kumiko-framework": minor
---

readDatabaseNow helper, SaveContext.event kept out of JSON responses, dashboard navigate with a record binding accepted by the boot validator.

<!-- kumiko-changes
feature: framework
type: improvement
title: readDatabaseNow(db) in framework/db
detail: Typed read of the Postgres clock for a TenantDb without unsafeRaw. Inside a transaction now() is the transaction start, so repeated reads agree.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: SaveContext.event no longer reaches JSON responses
detail: The event echoed on the SaveContext of create, update and restore is non-enumerable, so a handler returning the save result no longer leaks event data (PII) in its response; hooks and projections still read it by property.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Dashboard navigate params may bind a record
detail: The boot validator accepts navigate params on a dashboard row action that has a record binding (record.param) but no filter; it still rejects params when the dashboard reads no filter, time range or record binding.
-->
