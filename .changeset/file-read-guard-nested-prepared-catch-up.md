---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-feature-ast": patch
---

Per-call upload limit, a handler-side file read check, nested-safe `beforeTransaction`, and a catch-up boot rule.

<!-- kumiko-changes
feature: files
type: improvement
title: createFileRefFromBytes takes a per-call maxSize
detail: `CreateFileRefInput.maxSize` (bytes) replaces the route default for that call, so server-side generated files such as mail attachments can exceed the 10 MB upload default without raising it for browsers. A file field's own maxSize still applies first. `configuredMaxUploadBytes(registry)` returns the configured route limit in bytes, or undefined.
-->

<!-- kumiko-changes
feature: files
type: improvement
title: canCallerReadFileRef answers the file read decision in handlers
detail: `canCallerReadFileRef(ctx, fileRef)` applies the same rule as GET /files/:id: the configured accessGuard, otherwise the default guard with the configured privilegedRoles and the bound record's detail query. `createDefaultGuard` is exported from the files barrel. A handler that lists or links files no longer needs its own copy of the rule.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: beforeTransactionWhenNested skip lets a handler with a beforeTransaction phase run nested
detail: `beforeTransactionWhenNested: "skip"` on a write handler lets a nested ctx.dispatch.write run it without the phase. `event.prepared` is then `undefined` (typed `TPrepared | undefined`) and the handler does that work inside its own transaction. Top-level commands still run the phase. Without the option a nested call stays rejected. Boot rejects the option without beforeTransaction and together with reserveBeforeTransaction; transaction "perCommand" is already rejected next to beforeTransaction.
-->

<!-- kumiko-changes
feature: jobs
type: fix
title: catchUp job consumers ignore foreign event types before upcasting, and catchUp with maxPerTenant skip fails at boot
detail: A catch-up job consumer now filters on the trigger's event types before the stored event is upcast, so a foreign event with a failing upcaster no longer stalls the job cursor. Boot rejects `trigger.catchUp` together with `maxPerTenant` onLimit "skip" (including the number shorthand): a replay must not discard history. Use onLimit "defer".
-->

<!-- kumiko-changes
feature: files
type: improvement
title: Projection entities are server-side attach targets for files
detail: An entity declared on a projection (r.projection with entity) is a read-model entity: a files field on it can be the attachTo target of createFileRefFromBytes and uploadFileBytesBeforeTransaction, and the file read check uses the owning feature's `<name>:detail` query for it. The registry gets getReadModelEntity and getReadModelEntityOwner; two projections declaring an entity for the same source fail the boot. POST /files still accepts only r.entity targets, so a client can never attach to a read model. deleteFileRefsBoundToRecord soft-deletes the fileRefs of one record for owners that remove it without an r.entity delete.
-->
