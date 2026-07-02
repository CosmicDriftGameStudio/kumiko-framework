---
"@cosmicdrift/kumiko-framework": minor
---

Forget/export delete-hooks now receive the app registry (`UserDataHookCtx.registry`).

A DSGVO forget hook that must erase CHILD read-model rows past the entity's own row — m:n join projections, per-parent detail projections — now gets the app registry so it can run those custom projections for the executor's `<entity>.forgotten` event via `runProjectionsForEvent(result.data.event, ctx.registry, ctx.db)`. `executor.forget` purges only the entity's own projection, and the forget pipeline is a job (not a dispatched command), so the dispatcher's post-command projection pass never fires — without this the cascade was unreachable and child read-model rows were orphaned on a live forget.

Migration: hook-ctx constructors now pass `registry`; the framework's own `runForgetCleanup`/`runUserExport` already do. Custom code that constructs a `UserDataHookCtx` must add `registry`.
