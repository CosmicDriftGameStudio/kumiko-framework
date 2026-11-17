---
"@cosmicdrift/kumiko-bundled-features": minor
---

Rolling caps now count hourly usage buckets in a store table instead of summing events, and the unused rolling and value-cap entry points are removed.

<!-- kumiko-changes
feature: cap-counter
type: breaking
title: Rolling caps count hourly buckets; rolling guards, value-cap guard and rolling events removed
detail: `increment-rolling` now adds its amount to an hourly bucket row in the new store table `store_cap_rolling_usage` with one atomic upsert instead of appending a `rolling-incremented` event, and `readRollingCapUsage` sums those buckets with one SQL aggregate. The window starts at the full hour, so a read can count up to one extra hour at its old edge. `windowDays` must be a whole number from 1 to 90; an increment deletes the tenant's buckets older than 90 days. The handler result is now `{ capName, amount, bucketStart }`. Removed exports: `withRollingCapEnforcement`, `RollingCapDef`, `RollingCapResolver`, `enforceRollingCap`, `enforceRollingCapAndMaybeNotify`, `createValueCapGuard`, `ValueCapGuard`, `ValueCapSpec`, `rollingCapAggregateId`, `CAP_COUNTER_ROLLING_AGGREGATE_TYPE`, `ROLLING_INCREMENTED_EVENT_QN`, `ROLLING_INCREMENTED_EVENT_SHORT`, `ROLLING_RELEASED_EVENT_QN`, `ROLLING_RELEASED_EVENT_SHORT`. The events `cap-counter:event:rolling-incremented` and `cap-counter:event:rolling-released` are no longer registered.
migration: Run `kumiko migrate generate` in every app that mounts cap-counter to create `store_cap_rolling_usage`. Usage booked as events before the update is not carried over, so rolling windows start empty. Book rolling usage with `CapCounterHandlers.incrementRolling` and check it with `readRollingCapUsage` before the side effect. Replace `createValueCapGuard` with `createStockCapGuard` or an own `usage` check.
affects: cap-counter, increment-rolling, incrementRolling, readRollingCapUsage, withRollingCapEnforcement, RollingCapDef, RollingCapResolver, enforceRollingCap, createValueCapGuard, ValueCapGuard, ValueCapSpec, rollingCapAggregateId, CAP_COUNTER_ROLLING_AGGREGATE_TYPE, ROLLING_INCREMENTED_EVENT, ROLLING_RELEASED_EVENT, rolling-incremented, rolling-released
-->
