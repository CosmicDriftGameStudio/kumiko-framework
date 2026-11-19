---
"@cosmicdrift/kumiko-framework": patch
---

Reading an event stored at a newer eventVersion than the running code knows now throws, and live multi-stream projections upcast events before apply.

<!-- kumiko-changes
feature: framework
type: fix
title: Events from a newer schema are rejected, live multi-stream projections upcast
detail: The upcaster passed an event through unchanged when its stored `eventVersion` was above the version the code registers, or above 1 for a type the code does not know. A pod still on the previous release then applied a payload in a shape it was never written for. Such an event now throws `EventVersionAheadError` wherever events are upcast (handler and job `ctx.events.load`, `fetchForWriting`, projection and multi-stream rebuilds, catch-up jobs, live multi-stream projections), so the consumer retries until the newer code reads it. Live multi-stream projection delivery also ran apply on the stored payload without upcasting; it now walks the event through the registered migrations first, like the rebuild.
-->
