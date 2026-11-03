---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-testing": patch
---

Review round 3 hardening for PII, RLS and write races: statements on an RLS-enforced pool always run inside a scope, `read_*` tables are no longer writable from plain runners, `seedRow` refuses event-sourced entity tables, and several smaller PII, rebuild and search gaps are closed.

<!-- kumiko-changes
feature: framework
type: breaking
title: pool statements without a tenant scope run in an empty scope; seedRow refuses event-sourced entity tables; read_ tables are not writable from plain runners
detail: On an RLS-enforced pool every statement now runs in a short scoped transaction, also when no scope is active (empty GUCs, so RLS policies match nothing); before, a scope-free statement went straight to the connection and could meet a connection polluted by an earlier scope. Non-transactional DDL (CREATE INDEX CONCURRENTLY, CREATE/DROP DATABASE) and session-level statements must be wrapped in `outsideRowLevelSecurityScope`. `table("read_...")` from the db dialect now returns a plain `SchemaTable` without the `Writable` brand, so writing a projection table through a plain runner is a compile error; projection applies and `withExecutorManagedWrites` runners are unaffected. The testing helpers `seedRow` and `seedRows` throw for tables built by `buildEntityTable` or `r.entity`, because the projection row would exist without its event.
migration: Wrap non-transactional DDL and session-state statements on a pool in `outsideRowLevelSecurityScope(() => ...)`. Replace `seedRow(db, entityTable, ...)` by `seedRowViaEventStore`, or pass `{ projectionOnly: "<reason>" }` as fourth argument for a deliberate event-less row. For a `read_*` table written outside a projection, wrap the runner in `withExecutorManagedWrites`.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: PII backfill moves only the latest copy of a field to a changed owner; nested echoed events are stripped from write responses
detail: The backfill rekey stage no longer re-keys older, superseded copies of a user-keyed field to the new owner when a newer event already carries the field, so forgetting the previous owner still erases the old value. The dispatcher also strips the echoed `event` from executor results that a handler nests in its own response data, not only from the top-level result.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: plain statements wait for open savepoints; jsonb default changes rebuild the projection; trash list with search is rejected
detail: A statement issued through the query helpers on a transaction now queues behind pending savepoints instead of racing them and failing with an aborted transaction after a savepoint rollback. A changed jsonb column default on a managed projection table now writes a rebuild marker, so existing rows get the new empty value. A list with `onlyDeleted` and a search term returns a validation error, because soft-deleted rows are not in the search index and the list would always be empty.
-->

<!-- kumiko-changes
feature: dev-server
type: fix
title: managed check reports a bin entry that does not pass bundledLists
detail: When `kumiko.config.ts` sets `bundledLists`, every `runProdApp`, `runDevApp` and `runWorkerApp` call in `bin/*.ts` must pass `bundledLists` too; otherwise the managed-files check reports an error instead of the app drifting silently from its config.
-->
