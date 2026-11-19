---
"@cosmicdrift/kumiko-bundled-features": minor
---

Queued deliveries run as one sealed delivery.send job; the delivery.render job is gone.

<!-- kumiko-changes
feature: delivery
type: breaking
title: Queued delivery renders inside the send job and seals the message content
detail: Queued channels (email, push, chat) no longer pass through a separate `delivery.render` job. `delivery.send` renders and sends in one step, so neither rendered HTML nor the plaintext title, body and data sit in Redis or the job-run table. With a master key the job payload carries a single `sealedContent` field (recipient address plus message) bound to its purpose and tenant; without one it carries `content` in plaintext. `DeliveryJobs.render` is removed. A send retry renders again.
migration: Remove references to `DeliveryJobs.render` or the `delivery:job:render` job name. The queue does not need to be drained: the new worker still parses `delivery.send` jobs with the old `address`/`sealedAddress` payload and keeps processing queued `delivery.render` jobs. The other direction fails: a job with `sealedContent` that a 0.424 worker picks up does not parse and lands in the failed set after its attempts. Roll out the worker before the web process, and after the rollout retry the `delivery.send` runs that failed during the deploy window in the jobs screen.
affects: kumiko-bundled-features/delivery, createDeliveryFeature, DeliveryJobs, delivery:job:render
-->
