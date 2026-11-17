---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`ctx.events.streamVersion(aggregateId)` returns a stream's highest version without loading its events.

<!-- kumiko-changes
feature: event-store
type: improvement
title: ctx.events.streamVersion reads a stream's version without loading it
detail: Handlers that only need to know whether a stream exists, or which version it has, used to load every event with ctx.events.load and count them. `ctx.events.streamVersion(aggregateId)` runs one indexed query in the caller's tenant and returns 0 when the stream has no events. Unlike load it ignores archiving: an archived stream still reports its version, so an id that is already taken stays visible.
-->
