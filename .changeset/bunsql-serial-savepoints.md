---
"@cosmicdrift/kumiko-framework": patch
---

Parallel writes on one handler transaction no longer abort it, and invalid date values are a 400.

<!-- kumiko-changes
feature: framework
type: fix
title: Parallel writes in one handler no longer abort the transaction
detail: Bun.SQL does not serialize savepoints on a transaction. A handler that started several executor writes on ctx.db with Promise.all opened overlapping savepoints, the first RELEASE also released its neighbours, and the next one aborted the whole transaction with a 500. runInSavepoint and runInSavepointIfSupported now queue savepoints per transaction (proxy runners over the same transaction share one queue, savepoints opened from inside a running one still nest), and executor verbs started in parallel on one transaction run one after another. Postgres errors 22007 and 22008 (a date or time value the column rejects, such as 2026-02-30) now map to a 400 validation_error instead of a 500.
-->
