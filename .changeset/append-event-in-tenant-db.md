---
"@cosmicdrift/kumiko-framework": minor
---

`appendEventInTenantDb` appends an event on a TenantDb's own connection or transaction

Framework-side code that holds a `TenantDb` (for example inside `runInOwnTransaction`) could not append to the event store without a raw runner. `appendEventInTenantDb(tenantDb, event, { registry })` and `getStreamVersionInTenantDb(tenantDb, aggregateId)` from `@cosmicdrift/kumiko-framework/event-store` do it: the tenant is always the TenantDb's own, the append goes through `append()` (PII encryption, origin stamping), and with `registry` the inline projections run on the same runner.

<!-- kumiko-changes
feature: framework
type: improvement
title: appendEventInTenantDb and getStreamVersionInTenantDb append and read stream versions through a TenantDb, optionally running inline projections
-->
