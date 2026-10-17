---
"@cosmicdrift/kumiko-bundled-features": minor
---

cap-counter: a reservation can be consumed per unit through a public handle, so jobs that learn their quantity at runtime stay under the hard cap

<!-- kumiko-changes
feature: cap-counter
type: improvement
title: calendarCapReservationHandle consumes a reservation per unit
detail: |
  `reserveCalendarCapUsage` now returns `reservationId`. `calendarCapReservationHandle(ctx, reservationId, { capName, periodStartIso })` returns a handle with `consume(units)` (turns reserved units into booked ones, counter unchanged) and `release()` (gives back the unconsumed rest). A handler reserves the worst case before the job is dispatched, the job consumes per written unit, so parallel dispatches can no longer overshoot the hard cap and a retry only counts what was written.

  `consume` beyond the still-reserved rest throws `CapReservationOverConsumedError` (422, `cap_reservation_over_consumed`). Both calls are no-ops against a settle tombstone. When the reservation outlived its TTL and was swept, `consume` books the units directly, the way settle does for a missing row, without a hard-cap check.
-->
