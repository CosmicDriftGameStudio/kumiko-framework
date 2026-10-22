---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

`ctx.loadAggregate(id, { atVersion })` reads only the event at that stream version, upcast and scoped to the tenant like the full load. The workflow runner uses it to follow a trigger or awaited event reference, so a resume no longer loads the whole stream of the referenced aggregate.

<!-- kumiko-changes
feature: framework
type: feature
title: ctx.loadAggregate can read a single event by version
detail: The new atVersion option returns the event at that version of the stream (or nothing), with upcasting and the tenant filter. It cannot be combined with asOf. Workflow resume uses it for event references.
-->
