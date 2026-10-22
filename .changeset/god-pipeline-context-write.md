---
"@cosmicdrift/kumiko-framework": patch
---

The handler context builder and the write pipeline are split into named steps. The handler context keeps the same fields, field order and checks; gate order, error texts, savepoints and after-commit hooks of a write are unchanged.

<!-- kumiko-changes
feature: framework
type: improvement
title: Handler context and write pipeline split into named steps
detail: buildHandlerContext() in pipeline/dispatch-shared.ts now composes one builder per facet of the flat HandlerContext: the shared scope (handler-context-scope.ts), the tenant-scoped db handles, forTenant and file contexts (handler-context-db.ts), the commit sinks with ctx.query/write/queryAs/writeAs and nested writes in savepoints (handler-context-dispatch.ts), ctx.notify (handler-context-notify.ts), config, configFor, tz and locale (handler-context-config.ts), the event store surfaces and ctx.queryProjection (handler-context-events.ts), the identity-gated auth surfaces and ctx.hasFeature (handler-context-auth.ts) and log, tracer and metrics (handler-context-observability.ts). executeWriteInner() in pipeline/dispatch-write.ts runs the entry checks, the pre-handler gates with the reservation, the transition guard, the handler call and the settle step with reservation confirm, lifecycle and after-commit hooks as separate functions; executeNestedWrite() checks the nested foreign keys, verifies the parent row and writes the children in their own steps. Public exports are unchanged. New tests cover the ctx.snapshotAggregate/ctx.loadAggregateWithSnapshot roundtrip with tenant isolation and the no-database error text of the event store surfaces.
-->
