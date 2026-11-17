---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

A handler can call another feature's query handler with a typed payload and result instead of a qualified-name string and a cast.

<!-- kumiko-changes
feature: framework
type: improvement
title: queryByRef calls a query handler through its typed ref
detail: `r.queryHandler(...)` now returns a `QueryHandlerRef<Payload, Result>` that carries the qualified name (`<feature>:query:<name>`, kebab-cased like the registry key) and, type-only, the handler's input and result types. `queryByRef(ctx.dispatch, ref, payload)` from `@cosmicdrift/kumiko-framework/engine` runs it like `ctx.dispatch.query` and returns the handler's result type, so a feature that exports the ref from its setup lets other features drop the hand-written qualified name and the `as` cast on the result. Field read rules of a `resultEntity` can still drop fields at runtime that the type shows.
-->
