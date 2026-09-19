---
"@cosmicdrift/kumiko-bundled-features": minor
---

Deletion tokens are genuinely single-use, and a losing redeem no longer leaks status

`redeemDeletionToken` previously carried an `unsafeSkip` and a separate status check before the lifecycle write, so two concurrent redemptions of the same token could both get through. The lifecycle transition now rides the executor's `expect:` precondition inside the anchor spend, so exactly one redemption wins.

Externally visible: the loser of a concurrent redeem now receives the same generic `invalid_or_expired_token` reason on the anonymous path as an unknown token, instead of `cannot_process_deletion`. That was the point — the old reason distinguished "known token, wrong state" from "unknown token" to an unauthenticated caller. Integrators matching on the old string on that endpoint should expect the generic one.

`pendingDeletionRequestId` is now cleared on confirm as well, closing a pre-existing gap. `skipOptimisticLock: true` stays in the lifecycle path and now carries the reason it is correct there: callers structurally never hold a row version to pass through.

<!-- kumiko-changes
feature: user-data-rights
type: improvement
title: Deletion tokens are genuinely single-use, and a losing redeem no longer leaks status
-->
