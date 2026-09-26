---
"@cosmicdrift/kumiko-bundled-features": patch
---

bookCapUsage/markCapSoftWarned count parallel bookings instead of losing them

Both re-read and retry when they lose an optimistic-lock race, so parallel bookings for the same cap period all count instead of failing or getting silently dropped. The outsideTransaction path runs each attempt in its own transaction (runInOwnTransaction), keeping event append and projection update atomic. withCapEnforcement now throws a failed booking instead of discarding it.

<!-- kumiko-changes
feature: cap-counter
type: fix
title: bookCapUsage/markCapSoftWarned count parallel bookings instead of losing them
-->
