---
"@cosmicdrift/kumiko-bundled-features": patch
---

The calendar cap reservation handle gets `settle(actualAmount)`.

<!-- kumiko-changes
feature: cap-counter
type: improvement
title: calendarCapReservationHandle can settle the actual amount
detail: A caller that reserved an estimate had to consume, release and book any overflow in separate steps, and a retry after a lost ack could book twice. `calendarCapReservationHandle(...).settle(actualAmount)` replaces the reservation by the actual amount in one transaction: it books the overflow when the actual amount is higher, gives the rest back when it is lower, books the full amount when the reservation was already swept, and books nothing when it is repeated.
-->
