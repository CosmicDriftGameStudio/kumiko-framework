---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

The ref `r.queryHandler` returns is a query contract, so `ctx.dispatch.query(ref, payload)` is typed by the target handler.

<!-- kumiko-changes
feature: framework
type: improvement
title: Query handler refs type ctx.dispatch.query
detail: `r.queryHandler(...)` returns a `QueryHandlerRef<Payload, Result>` that is a `QueryContract` (`kind: "query"`, `qualifiedName` kebab-cased like the registry key) plus the handler `name`. Pass it wherever a query contract is accepted, such as `ctx.dispatch.query(ref, payload)`, `ctx.dispatch.queryAs`, `systemQuery` and `query` of extra routes and `r.httpRoute`. The payload is checked against the handler schema's input, and the result is the handler's return type without the `WriteFailure` branch, because a returned failure is thrown. A feature that exports the ref from its setup lets other features drop the hand-written qualified name and the `as` cast on the result. Field read rules of a `resultEntity` can still drop fields at runtime that the type shows.
-->
