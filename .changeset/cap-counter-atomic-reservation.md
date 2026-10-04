---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

withCapEnforcement reserves cap usage before the handler transaction

`withCapEnforcement` used to check the cap and book the usage in two separate steps, so parallel calls could all pass the same stale read and exceed the hard limit. The wrapper now only declares the cap through the new `WriteHandlerDef.reserveBeforeTransaction` hook. The dispatcher runs the hook after the access, feature and schema checks and before the handler transaction opens. The hard-cap check and the increment are one short, version-guarded write that commits at once, so no connection is held across the handler and capped calls on the same counter still run in parallel. The returned release gives the amount back (never below 0) after the transaction ended without committing: rollback, failure result, throw or failed commit. A capped handler reached through a nested `ctx.write` is rejected unless the top-level batch reserved it. If a COMMIT fails with an unknown outcome, the release can under-count. `bookCapUsage` accepts a `guardCurrentValue` callback, `markCapSoftWarned` and `enforceCapAndMaybeNotify` can write outside the handler transaction, and the soft-warning pre-check now honors `amount`. `withRollingCapEnforcement` is unchanged and keeps its check-then-book race.

<!-- kumiko-changes
feature: cap-counter
type: fix
title: withCapEnforcement reserves cap usage before the handler transaction so parallel calls cannot exceed the hard limit
migration: No action needed. Calls above the hard limit are now rejected with cap_exceeded even when they race. A capped handler must not be called through ctx.write from another handler.
-->
