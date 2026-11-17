---
"@cosmicdrift/kumiko-framework": patch
---

Live multi-stream projections and event-triggered jobs now receive upcast events.

<!-- kumiko-changes
feature: framework
type: fix
title: Live MSP apply and job triggers upcast stored events
detail: The event-dispatcher consumer of an `r.multiStreamProjection` and the job-trigger consumer now run the registered event upcasters before apply or `handleEvent`, as catch-up jobs and the projection rebuild already did. After an event version bump the live read model matches a rebuild, and a job triggered by an older stored event sees the current payload shape. The job-trigger consumer ignores event types no event-triggered job listens to, so a broken upcaster of an unrelated event does not stall it.
-->
