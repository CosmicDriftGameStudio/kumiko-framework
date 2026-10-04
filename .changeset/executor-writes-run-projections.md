---
"@cosmicdrift/kumiko-framework": minor
---

Executor writes run custom projections

`EventStoreExecutor` create, update, delete, forget and restore now run the custom projections registered for the written event, in the same savepoint as the write. The registry is bound to the `TenantDb` by the dispatcher and the job runner; a `TenantDb` built elsewhere skips custom projections. Projection runs are idempotent per event object, so the dispatcher's own pass after the handler does not run them twice.

<!-- kumiko-changes
feature: framework
type: fix
title: Executor writes outside the dispatcher no longer skip custom projections
migration: |
  Remove manual `runProjections` calls after executor writes in hooks or jobs together with the bump. A call is a no-op only when it passes the exact event object the executor returned; a spread or rebuilt event projects twice.
-->
