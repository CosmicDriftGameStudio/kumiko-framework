---
"@cosmicdrift/kumiko-bundled-features": minor
---

cap-counter: a TTL sweep or release of a partly consumed calendar reservation no longer makes a later settle or consume count the consumed units twice

<!-- kumiko-changes
feature: cap-counter
type: fix
title: Swept or released calendar reservations remember the units consume booked
detail: |
  The reservation row now stores `consumed_amount`. A release or the TTL sweep gives back only the unconsumed rest. If units were consumed, it keeps the row as a released tombstone (`released_at` set, `amount` 0) until the tombstone TTL passes, instead of deleting it. A later `settle` subtracts the consumed units from the booking, and a `consume` after the sweep books its units directly and is remembered the same way, so the counter ends at exactly the settled total. `settle` below the consumed units throws `CapSettleBelowConsumedError` (422, `cap_settle_below_consumed`) in every state. Expired released tombstones are deleted by the sweep.
migration: Apps with cap-counter generate a migration for the new columns store_cap_reservations.consumed_amount (integer NOT NULL DEFAULT 0) and store_cap_reservations.released_at (kumiko migrate generate).
-->
