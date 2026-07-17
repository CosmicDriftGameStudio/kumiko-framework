---
"@cosmicdrift/kumiko-framework": patch
---

Export `runInSavepoint` from `@cosmicdrift/kumiko-framework/db` and `/bun-db`.

Why: app-code write handlers that fall back to computing inline (no
JobRunner) share the write-dispatch's outer transaction (`ctx.db` is the
`tx` from `runBatch`'s `transaction(db, ...)` wrap). A failing statement
during that inline compute poisons the whole transaction per Postgres
semantics — any further write, including one that tries to record a
"failed" status, then errors with "current transaction is aborted,
commands ignored until end of transaction block". `runInSavepoint` was
already the framework's own answer to this for inline projections
(`dispatch-shared.ts`) and rebuild passes (`msp-rebuild.ts`,
`projection-rebuild.ts`) — it just wasn't reachable from outside the
package. No behavior change to the framework itself, additive export only.
