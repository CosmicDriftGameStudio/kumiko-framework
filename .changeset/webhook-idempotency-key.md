---
"@cosmicdrift/kumiko-bundled-features": minor
---

Webhook sends carry an Idempotency-Key header

Every `r.step.webhook.send` request now has `Idempotency-Key: <dispatch stream id>`. The value stays the same when the same dispatch request is delivered again, so receivers can deduplicate. An explicit `Idempotency-Key` in `headers` (any casing) takes precedence.

<!-- kumiko-changes
feature: step-dispatcher
type: improvement
title: Webhook sends carry an Idempotency-Key header that is stable across redeliveries
-->
