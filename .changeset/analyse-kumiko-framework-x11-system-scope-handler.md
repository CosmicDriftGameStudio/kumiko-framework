---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

Handlers declare `systemScope: true` and get a non-optional `ctx.systemDb`.

<!-- kumiko-changes
feature: framework
type: breaking
title: systemScope handlers get ctx.systemDb typed as present
detail: `defineWriteHandler`, `defineQueryHandler` and `definePagedQueryHandler` accept `systemScope: true`. The handler then receives `SystemScopeHandlerContext`, whose `systemDb` is not optional, so the hand-written "ctx.systemDb not wired" checks go away. Boot rejects the marker in a feature without `r.systemScope()` (rule handler/system-scope-without-feature-system-scope), and a dispatch without `ctx.systemDb` (no db wired) throws an InternalError naming the handler. Without the marker nothing changes: `ctx.systemDb` stays optional. `WriteHandlerInput` is now a union over the marker, `defineQueryHandler`/`definePagedQueryHandler` take the new `QueryHandlerInput`, and `WriteHandlerDefinition`/`QueryHandlerDefinition` carry `systemScope?: true`. New helpers: `hasSystemDb` (db) and the type `SystemScopeHandlerContext` (engine). Jobs and hooks keep `requireSystemDb`.
migration: Nothing has to change. To drop a not-wired check, add `systemScope: true` to the handler definition in an `r.systemScope()` feature and replace `requireSystemDb(ctx, "…")` or the `if (!ctx.systemDb) throw …` block with `ctx.systemDb`. An inline `r.writeHandler({ … })` needs `defineWriteHandler(…)` around it for the typed context. A helper taking `HandlerContext` can take `SystemScopeHandlerContext` instead once all its callers declare the marker. A value already typed as `QueryHandlerDefinition` or `WriteHandlerDefinition` can no longer be passed back into `defineQueryHandler`/`defineWriteHandler`; register it directly with `r.queryHandler`/`r.writeHandler`. `systemScope` must be the literal `true`, not a boolean variable.
affects: defineWriteHandler(, defineQueryHandler(, definePagedQueryHandler(, WriteHandlerInput, QueryHandlerInput, SystemScopeHandlerContext, hasSystemDb(, requireSystemDb(
-->
