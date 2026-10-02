---
"@cosmicdrift/kumiko-bundled-features": patch
---

`redeemRowBoundGrant` now logs a warning (error name and code only, never the token or subject) when the anchor lookup throws, so a database outage no longer looks like an expired link. The result is still the same bare rejection.

<!-- kumiko-changes
feature: shared
type: fix
title: Row-bound grant redemption logs a failing anchor lookup instead of swallowing it silently
-->
