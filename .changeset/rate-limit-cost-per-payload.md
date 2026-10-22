---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Write handlers can book rateLimit tokens per payload element with `rateLimitCost`.

<!-- kumiko-changes
feature: framework
type: improvement
title: rateLimitCost for write handlers
detail: A write handler can declare `rateLimitCost: (payload) => number`. The result is booked on every declared `rateLimit` bucket instead of the options' static `cost`; values below 1 count as 1 and non-finite values fail the request. The bucket is charged after schema validation, so an invalid payload costs nothing, and a rejected request consumes no tokens. Boot fails when `rateLimitCost` is set without an active `rateLimit`.
migration: Optional. Bulk handlers should add `rateLimitCost: (p) => p.files.length` so a request with many items is not counted as one.
-->
