---
"@cosmicdrift/kumiko-bundled-features": patch
---

A user whose deletion is pending can cancel it from the link in the deletion-requested mail, without signing in.

<!-- kumiko-changes
feature: user-data-rights
type: improvement
title: Cancel a pending deletion from the mail link
detail: A deletionRequested account cannot sign in, so the old "sign in and cancel" advice in the deletion-requested mail led nowhere. The new anonymous handler `cancel-deletion-by-token` takes a signed token and puts the account back to active while the grace period runs. The feature option `deletionCancelUrl` (needs `deletionTokenSecret`) makes request-deletion and confirm-deletion-by-token put a `Cancel deletion` button with a token link into the mail; `sendDeletionRequestedEmail` callbacks receive it as `cancelUrl`. Without the option the mail keeps the sign-in sentence. `makePublicDeletionGate` takes an optional `cancelPath` that renders the new `CancelAccountDeletionScreen`. Apps set `deletionCancelUrl` and `cancelPath` to the same route. The anonymous confirm flow now sends the deletion-requested mail too, which it did not before.
-->
