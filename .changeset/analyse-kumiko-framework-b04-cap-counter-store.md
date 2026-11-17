---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Calendar cap counters are booked into a store table with one atomic upsert instead of an event-sourced entity.

<!-- kumiko-changes
feature: cap-counter
type: breaking
title: Cap counters are an atomic store table
detail: Calendar counters live in `store_cap_counters` and are booked with one atomic upsert instead of an event plus version-conflict retries. `bookCapUsage` returns `{ value }`, `markCapSoftWarned` returns `true` only for the call that set the flag and creates the row if needed, and the soft-hit notifier runs after that mark, at most once per period. `get-counter` returns `{ capName, periodStartIso, value, lastSoftWarnedAt }`. New reads: `readCalendarCapCounter` and `readCalendarCapUsageByTenant`. Removed: `capCounterEntity`, `capCounterAggregateId`, the `cap-list` screen, nav and the `cap-counter:query:cap-counter:list` query (use cap-overview's tenant cap list). Cap-counter events already stored stay in the event store and are ignored; counters start from zero in the new table.
migration: Replace `if (!booked.isSuccess)` checks on `bookCapUsage`/`markCapSoftWarned` with try/catch. Replace reads of the cap-counter entity table or `capCounterAggregateId` with `readCalendarCapCounter` / `readCalendarCapUsageByTenant`. Remove nav entries pointing at `cap-counter:screen:cap-list`. Run `kumiko-schema generate` and ship the migration that adds `store_cap_counters` and `store_cap_reservations.subject_hash` and drops `read_cap_counters`.
-->
