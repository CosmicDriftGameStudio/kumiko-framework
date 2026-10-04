---
"@cosmicdrift/kumiko-bundled-features": patch
---

withCapEnforcement reserves cap usage atomically

`withCapEnforcement` used to check the cap and book the usage in two separate steps, so parallel calls could all pass the same stale read and exceed the hard limit. It now reserves the usage before the handler runs: the hard-cap check and the increment are one short, version-guarded write that commits at once in its own transaction, so the counter stream is not held while the handler runs and capped calls on the same counter still run in parallel. A version-conflict retry re-reads and re-checks. If the handler throws or returns a failure result, a compensating release books the amount back (never below 0). `bookCapUsage` accepts a `guardCurrentValue` callback, `markCapSoftWarned` and `enforceCapAndMaybeNotify` can write outside the handler transaction, and the soft-warning pre-check now honors `amount`. `withRollingCapEnforcement` is unchanged and keeps its check-then-book race.

<!-- kumiko-changes
feature: cap-counter
type: fix
title: withCapEnforcement reserves cap usage atomically so parallel calls cannot exceed the hard limit
migration: No action needed. Calls above the hard limit are now rejected with cap_exceeded even when they race.
-->
