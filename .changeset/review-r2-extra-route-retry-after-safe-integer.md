---
"@cosmicdrift/kumiko-framework": patch
---

`ExtraRouteRejection` now rejects a `retryAfterSeconds` beyond the safe-integer range, so the `Retry-After` header is always valid delta-seconds. Password-reset style token-request routes no longer log `rate_limited` handler results as errors.

<!-- kumiko-changes
feature: framework
type: fix
title: ExtraRouteRejection retryAfterSeconds must be a safe integer; token-request routes stop logging rate_limited
-->
