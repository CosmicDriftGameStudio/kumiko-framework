---
"@cosmicdrift/kumiko-bundled-features": patch
---

withCapEnforcement reserves cap usage atomically

`withCapEnforcement` used to check the cap and book the usage in two separate steps, so parallel calls could all pass the same stale read and exceed the hard limit. `withRollingCapEnforcement` is unchanged and keeps its check-then-book race. It now reserves the usage before the handler runs: the hard-cap check and the increment happen in one version-guarded write, and a version-conflict retry re-reads and re-checks. A handler that returns a failure releases its reservation (a thrown error rolls the transaction back). `bookCapUsage` accepts a `guardCurrentValue` callback, and the soft-warning pre-check now honors `amount`.

<!-- kumiko-changes
feature: cap-counter
type: fix
title: withCapEnforcement reserves cap usage atomically so parallel calls cannot exceed the hard limit
migration: No action needed. Calls above the hard limit are now rejected with cap_exceeded even when they race.
-->
