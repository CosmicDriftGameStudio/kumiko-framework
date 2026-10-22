---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

Handlers get `ctx.scheduleAfterRollback(fn)`, the counterpart of `scheduleAfterCommit` for compensating work outside the transaction.

<!-- kumiko-changes
feature: framework
type: improvement
title: ctx.scheduleAfterRollback for outside-transaction compensation
detail: ctx.scheduleAfterRollback(fn) runs fn when the handler transaction does not commit, or when the enclosing savepoint of a nested ctx.write rolls back (after the outer transaction ends). It never runs on commit, errors are logged and do not change the write result, and it is absent outside a transaction scope (perCommand, post-commit, beforeTransaction, member resolution). A failed COMMIT also triggers it, so callbacks must be idempotent and outcome-safe, for example releasing a reservation row that may already be gone.
-->
