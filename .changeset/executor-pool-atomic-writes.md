---
"@cosmicdrift/kumiko-framework": minor
---

EventStoreExecutor write verbs open their own transaction when called on a pool-bound TenantDb, so the event append, entity row, custom projections and hooks commit or roll back together.

<!-- kumiko-changes
feature: framework
type: fix
title: Executor writes on a pool runner are atomic
detail: executor.create/update/delete/forget/restore on a TenantDb that is not inside a transaction used to run append, projection and custom projections as separate autocommit statements, so a failing projection left an event without its row. They now run in their own transaction, and a returned failure such as version_conflict rolls it back too. Calls inside a handler transaction keep their savepoint behavior. Callers that wrapped executor writes in runInOwnTransaction as a workaround can drop it.
-->
