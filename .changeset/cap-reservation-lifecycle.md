---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Cap reservations run after every pre-handler gate and settle with the handler transaction

Handlers wrapped with `withCapEnforcement` used to reserve capacity before rate limits, access and payload validation had run, so a rejected caller could use up cap or trigger a soft-warn. The dispatcher now runs the same gates, billing rate limits once, before it calls `reserveBeforeTransaction`; a failing gate rejects the command and releases the reservations taken before it. A hook that returns a `ReservationHandle` also confirms inside the handler transaction after the handler succeeded, and a confirm failure fails the write.

Calendar reservations are now rows in the new `store_cap_reservations` table: the counter increment and the row commit together, the handler transaction deletes the row on its own commit, and a release only gives back what is still booked. Rolling caps reserve the same way: a version-guarded `rolling-incremented` append plus a reservation row before the handler transaction, undone by the new `cap-counter:event:rolling-released` event. `readRollingCapUsage` returns incremented minus released amounts in the window, never below 0. Rows a crashed process left behind expire after 60 minutes and are given back before the next reserve for the same cap. `withCapEnforcement` keeps the wrapped handler's other settings and chains an existing `reserveBeforeTransaction` of that handler: the inner reservation is taken first and given back if the outer one fails.

<!-- kumiko-changes
feature: cap-counter
type: breaking
title: Calendar cap reservations are stored in the new store_cap_reservations table
detail: Capped writes now insert and delete rows in store_cap_reservations, so they fail until the table exists.
migration: Generate and apply a migration with `kumiko-schema generate` — capped writes fail without the new store_cap_reservations table
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Rate-limited, denied or invalid callers no longer consume cap usage or trigger soft-warn, because pre-handler gates run before reserveBeforeTransaction
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: reserveBeforeTransaction may return a ReservationHandle whose confirmInTransaction settles the reservation inside the handler transaction
-->

<!-- kumiko-changes
feature: cap-counter
type: improvement
title: Reservations expire after 60 minutes and are swept before the next reserve of the same cap
-->

<!-- kumiko-changes
feature: cap-counter
type: fix
title: withCapEnforcement keeps the wrapped handler's settings (rateLimit, additionalRateLimits) and composes with an inner reserveBeforeTransaction
-->

<!-- kumiko-changes
feature: cap-counter
type: improvement
title: withRollingCapEnforcement reserves before the handler transaction and releases through the new rolling-released event, so rejected or failed writes no longer consume rolling cap
-->
