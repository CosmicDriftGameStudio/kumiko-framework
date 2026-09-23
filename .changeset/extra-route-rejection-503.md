---
"@cosmicdrift/kumiko-framework": minor
---

`ExtraRouteRejection` now accepts status `503` alongside an optional `retryAfterSeconds`, which renders as a `Retry-After` header, so signature routes can report "temporarily not ready" from `verify()` without inventing a verify-side sentinel (kumiko-framework#3168).

<!-- kumiko-changes
feature: framework
type: improvement
title: ExtraRouteRejection supports 503 + Retry-After for signature routes whose verify() is temporarily unable to run
-->
