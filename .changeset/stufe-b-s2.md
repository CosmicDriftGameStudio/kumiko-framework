---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Database load and pagination hardening plus a job-defer API: server-side statement (60 s) and idle-in-transaction (300 s) timeouts, concurrent session lookups, page-only tenant decryption, keyset scans in reindex, purge and escape-hatch retention, and `ctx.defer(ms)` for jobs.

<!-- kumiko-changes
feature: framework
type: improvement
title: Prod and worker pools cap statements at 60 s and idle transactions at 300 s
detail: Behavior change, not an API break. runProdApp and runWorkerApp now open their Postgres pools with statement_timeout 60 s and idle_in_transaction_session_timeout 300 s (handlers that await external calls inside a transaction are not killed early, leaked transactions still end), so one runaway query or a transaction left open no longer holds a connection indefinitely. lock_timeout stays off. Opt out per limit by setting the variable to 0, or change it, with DATABASE_STATEMENT_TIMEOUT_MS, DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS and DATABASE_LOCK_TIMEOUT_MS (for example DATABASE_STATEMENT_TIMEOUT_MS=0); createDbConnection takes statementTimeoutMs, idleInTransactionSessionTimeoutMs and lockTimeoutMs. Migrations, projection and multi-stream rebuilds, search reindex, PII backfills and the CREATE INDEX CONCURRENTLY helpers run without the statement cap (withoutStatementTimeout). A custom long-running statement on the app pool now needs the same helper or a higher limit.
-->

<!-- kumiko-changes
feature: sessions
type: improvement
title: sessionChecker looks up the user and the membership concurrently
detail: The session check starts the user lookup together with the session read and the membership lookup together with the last-seen refresh. Results and the fail-open behavior are unchanged; a failed lookup that is not needed no longer raises an unhandled rejection.
-->

<!-- kumiko-changes
feature: cap-overview
type: improvement
title: Tenant caps list decrypts only the visible page
detail: Without a search and with a sort other than name, the list loads light tenant rows, pages them, and fetches and decrypts names for the current page only. The default name sort and any search still decrypt every tenant, because tenant names are stored encrypted and cannot be sorted or filtered in SQL. Order, total and rows are unchanged.
-->

<!-- kumiko-changes
feature: tenant
type: improvement
title: Tenant directory search stops decrypting once the limit is reached
detail: Tenant names are encrypted and not in the search index, so the directory search decrypts in small batches and stops after limit matches; the 1000-row scan cap stays. With more matches than the limit, the first matches in key order are returned (sorted by label), not the best alphabetical ones. The missing-profile list drops tenants that already have a profile before decrypting.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Reindex and subject purge scan by keyset instead of OFFSET
detail: reindexEntity and the subject purge page with WHERE id > last ORDER BY id LIMIT n, so rows deleted or changed while the scan runs no longer make it skip later rows.
-->

<!-- kumiko-changes
feature: audit
type: improvement
title: Escape-hatch retention loads only needed columns, in keyset pages
detail: The retention run groups tenants only over events older than the shortest cutoff, selects id, aggregateId, createdAt and payload, and prunes per 2000-row keyset page instead of loading every row with its full payload.
-->

<!-- kumiko-changes
feature: jobs
type: breaking
title: Job handlers can return ctx.defer(ms)
detail: A handler that returns ctx.defer(ms) moves the queue job to delayed and runs again after ms, like the maxPerTenant defer. It consumes no retry attempt and records no failure, failure log or failed run; the run row of the deferred pass is removed and a tenantVisibleRun record goes back to queued. maxDefers on the job (default 100, shared counter with maxPerTenant defers) bounds the loop; exceeding it fails the run for good (no retry) with a clear message. Inline runs (boot gates) throw. New run-logger hook onJobDeferred, passed through the entrypoint jobs options. JobHandlerFn may now return a JobDeferral. JobContext has a required defer member.
migration: add defer to every hand-built JobContext object (tests, seeds), e.g. defer: (delayMs) => ({ kind: "job-deferral", delayMs })
-->
