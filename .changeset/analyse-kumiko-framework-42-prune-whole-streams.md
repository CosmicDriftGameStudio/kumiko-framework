---
"@cosmicdrift/kumiko-framework": minor
---

`pruneEvents` deletes only whole event streams whose newest event is older than the cutoff.

<!-- kumiko-changes
feature: framework
type: breaking
title: Event pruning removes whole streams only
detail: `pruneEvents` used to delete every event older than the cutoff, so a long-lived aggregate lost its old `.created` event while newer `.updated` events stayed. The next rebuild then dropped the row silently, because an update without a row is a no-op and the ghost-row guard only asks for any event. Now a stream (tenant, aggregate id) is pruned only when all of its events are older than the cutoff, and then completely. `batchSize` limits whole streams per call instead of single events, so a batch never cuts a stream; `deletedCount` still counts events and can exceed `batchSize`. Loops that stop when `deletedCount < batchSize` keep terminating.
migration: Retention jobs that relied on trimming old events from streams that are still active get fewer deletions; to shrink active streams, archive or snapshot them instead. Callers that compared `deletedCount` with an exact per-call event limit must treat `batchSize` as a stream limit.
affects: all
-->
