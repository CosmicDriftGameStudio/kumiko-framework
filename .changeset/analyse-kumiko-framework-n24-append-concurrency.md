---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Every event append states expectedVersion or a blindAppendReason; the workflow resume claim is version-pinned.

<!-- kumiko-changes
feature: event-store
type: breaking
title: Every event append states its concurrency expectation
detail: ctx.events.append, unsafeAppend, tryAppend, emitEvent, the job ctx.events.append, the MSP appendEvent and unsafeAppendEvent and r.step.aggregate.appendEvent now require either expectedVersion or blindAppendReason (type AppendConcurrency from @cosmicdrift/kumiko-types/handlers). Before, the stream version was read at append time, so a handler that read state and then appended could silently stack on a decision another transaction had just committed. An append with neither field, a negative or non-integer expectedVersion, or a placeholder reason (todo, legacy, n/a, ...) throws internal_error. With expectedVersion a concurrent append fails with 409 version_conflict (tryAppend returns ok:false). unsafeAppend now only means an untyped payload; the typed path is emitEvent(ctx, eventDef, ...). The bundled workflow runner pins its resume claim, so a step can no longer be resumed twice when two dispatches race.
migration: At every append site pick one: (1) the handler reads state of the aggregate before appending: call const v = await ctx.events.streamVersion(aggregateId) as the first statement before that read (projection row, executor detail or ctx.events.load) and pass expectedVersion: v (v + 1 for a second append in the same handler), or append through a ctx.events.fetchForWriting handle; (2) the aggregate id was created in this handler: expectedVersion: 0; (3) the event is valid whatever was appended meanwhile: blindAppendReason with a concrete sentence. Clients treat 409 version_conflict like a stale form: reload and retry. Known sites: solon 35, publicstatus 6, kumiko-enterprise 2, money-horse 1.
affects: events.append, unsafeAppend, tryAppend, emitEvent, appendEvent
-->
