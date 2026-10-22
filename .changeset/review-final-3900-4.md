---
"@cosmicdrift/kumiko-framework": patch
---

`reindexEntity` now lifts the server `statement_timeout` for each batch scan with `SET LOCAL` in a short transaction on the runner it was given. Before, it asked `withoutStatementTimeout` for an unbounded pool, which silently passed through for the gated runner that `ctx.systemDb.unsafeRaw()` returns, so the reindex job still ran under the 60 s cap.

<!-- kumiko-changes
feature: framework
type: fix
title: reindex job batches are no longer cut off by the server statement timeout
detail: reindexEntity reads each batch in its own transaction with statement_timeout lifted for that transaction, on the caller's own runner, so the job path through ctx.systemDb.unsafeRaw() keeps its gates.
-->
