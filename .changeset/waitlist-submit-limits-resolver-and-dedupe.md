---
"@cosmicdrift/kumiko-bundled-features": patch
---

Waitlist: emailRateLimits [] boots, notifyRecipient resolves outside the lock, duplicate check filters by status

<!-- kumiko-changes
feature: waitlist
type: fix
title: Waitlist submit honors emailRateLimits: [], resolves notifyRecipient before the advisory lock and checks only open entries
detail: createWaitlistFeature({ emailRateLimits: [] }) no longer fails boot validation; the per-email bucket is dropped as documented. notifyRecipient runs before the per-email advisory lock and the entry insert, so a failing resolver can no longer abort the submit transaction or hold the lock; a throwing resolver only skips the admin notice. The duplicate check queries status pending or invited with limit 1 instead of scanning the first 50 rows of the address. The feature description now states that the response body is identical for known and unknown addresses while response timing can differ.
-->
