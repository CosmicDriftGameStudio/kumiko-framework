---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`requireSystemDb`, `requireOutsideTransactionDb` and `hasOutsideTransactionDb` are exported from `@cosmicdrift/kumiko-framework/db`.

<!-- kumiko-changes
feature: framework
type: improvement
title: Public guards for ctx.systemDb and ctx.db.outsideTransaction
detail: `requireSystemDb(ctx, callerName)` returns `ctx.systemDb` with the exact type of the given context or throws an InternalError that names the caller and points at `r.systemScope()`. `requireOutsideTransactionDb(ctx)` returns `ctx.db.outsideTransaction` or throws, `hasOutsideTransactionDb(ctx)` narrows it. Handlers use them instead of hand-written "not wired" checks; the bundled features use the same `requireSystemDb`.
-->
