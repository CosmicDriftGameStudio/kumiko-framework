---
"@cosmicdrift/kumiko-framework": minor
---

`getAllProjectionProgress` and `ProjectionProgress` are removed from `@cosmicdrift/kumiko-framework/pipeline`.

<!-- kumiko-changes
feature: framework
type: breaking
title: getAllProjectionProgress removed
detail: The function reported `lag = high-water mark - last_processed_event_id` for every row of kumiko_projections. These are synchronous projections whose cursor only a rebuild writes, so the reported lag grew with every event although the projections were current. No exporter used it. Removed: `getAllProjectionProgress`, `ProjectionProgress`. `listProjectionsWithState` still returns status, cursor, last rebuild and last error; consumer lag of multi-stream projections stays available via `getAllConsumerProgress`.
migration: Replace calls with `listProjectionsWithState` for status and rebuild information, and with `getAllConsumerProgress` for the lag of asynchronous consumers.
affects: getAllProjectionProgress, ProjectionProgress
-->
