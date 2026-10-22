---
"@cosmicdrift/kumiko-bundled-features": patch
---

Review fixes for billing-foundation consumer protection and cap-counter tests: ordered lists keep their numbers in the contract confirmation mail, the revoke paragraph uses a typed show-if option, the stored user email decrypt helper is shared, the receipt mail distinguishes a rate limit from an unavailable limiter, an abandoned checkout no longer reopens the withdrawal period, and a same-second update no longer revives a canceled subscription.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Ordered terms lists keep their numbers in the confirmation mail
detail: The contract confirmation mail prefixes each item of an ordered Markdown list with its number, so references such as "see no. 3" in terms and cancellation policies stay intact.
-->

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Operator notice tells an unavailable receipt limiter from a reached limit
detail: When the termination receipt mail is withheld because the rate limiter failed or has no digest key, the operator notice reports "receipt_not_sent" instead of the per-recipient limit reason.
-->

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: An abandoned plan-change checkout no longer restarts the withdrawal period
detail: The withdrawal period now runs from the latest subscription start only; a checkout consent without a following subscription start does not reopen it, so a later withdrawal of an old contract is cancelled at period end.
-->

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Same-second provider update cannot revive a canceled subscription
detail: When a non-terminal state event carries the same provider timestamp as a stored cancellation, it is treated as late and discarded.
-->
