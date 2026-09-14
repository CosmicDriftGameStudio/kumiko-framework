---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

`StreamHandlerDef`/`StreamHandlerDefinition` (`@cosmicdrift/kumiko-types/handlers`, `/define-handler`) and the `r.streamHandler` options param now accept `escapeHatch: { reason }`, same contract as `WriteHandlerDef`/`QueryHandlerDef`: a stream handler that switches identity to SYSTEM via `ctx.queryAs` needs its own `escapeHatch` declaration (or its feature must be `r.systemScope()`), same as write and query handlers already require. Stream handlers still cannot reach `db.global()` (`globalWrites` stays write-only) but do get the same SYSTEM-identity-switch and `ctx.db.unsafeRaw(reason)` grant a query handler's `escapeHatch` already unlocks. The boot validator rejects an empty `escapeHatch.reason` on a stream handler the same way it does for write/query handlers.
