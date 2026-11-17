---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Entities declare `streamRetention: { keepFor }`; the data-retention job `stream-retention` prunes their whole event streams and rows once the newest event is older than keepFor.

<!-- kumiko-changes
feature: data-retention
type: improvement
title: Declarative event stream retention for short-lived entities
detail: An entity that holds technical or short-lived state (previews, run state, claims) declares `streamRetention: { keepFor: "30d" }`. The new global maintenance job `data-retention:job:stream-retention` prunes every stream of that entity whose newest event is older than keepFor, with all its events, and then deletes the entity rows whose stream is gone, so a rebuild stays consistent. While an event consumer lags, the run deletes nothing and retries on the next run. `runStreamRetention({ db, registry, now })` is exported from `@cosmicdrift/kumiko-bundled-features/data-retention` for app tests. Boot rejects streamRetention together with `retention`, on systemStream or idType "serial" entities, on entities with file or image fields, and when a table-bearing r.projection or r.multiStreamProjection reads the entity's events. High-frequency counters belong in an `r.storeTable` written with `ctx.db.upsert(..., { increment })` instead; the persistence reference shows both. The user-data-rights recipe shows streamRetention on a preview entity.
-->
