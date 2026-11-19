---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

A job's `ctx.db.unsafeRaw()` is typed as `DbConnection`, so job handlers need no cast.

<!-- kumiko-changes
feature: jobs
type: improvement
title: Job raw runner typed as DbConnection
detail: `JobContext.db` is the new `ConnectionTenantDb`: a `TenantDb` whose `unsafeRaw()` returns `DbConnection`, because the job runner always builds it from the boot connection. `createTenantDb` returns `ConnectionTenantDb` when given a `DbConnection`. The bundled jobs drop their `as DbConnection` casts and read the time from `ctx.tz.now()`, which honours an injected clock.
migration: Optional: remove `ctx.db.unsafeRaw() as DbConnection` casts in job handlers. A hand-built `JobContext` must take its `db` from `createTenantDb({ db: <DbConnection>, ... })`.
-->
