---
"@cosmicdrift/kumiko-bundled-features": minor
---

Queued deliveries run as one sealed delivery.send job; the delivery.render job is gone.

<!-- kumiko-changes
feature: delivery
type: breaking
title: Queued delivery renders inside the send job and seals the message content
detail: Queued channels (email, push, chat) no longer pass through a separate `delivery.render` job. `delivery.send` renders and sends in one step, so neither rendered HTML nor the plaintext title, body and data sit in Redis or the job-run table. With a master key the job payload carries a single `sealedContent` field (recipient address plus message) bound to its purpose and tenant; without one it carries `content` in plaintext. `DeliveryJobs.render` is removed. A send retry renders again.
migration: Remove references to `DeliveryJobs.render` or the `delivery:job:render` job name. Drain the delivery queue before deploying: queued `delivery.render` jobs and `delivery.send` jobs with the old `address`/`sealedAddress` payload no longer parse.
affects: kumiko-bundled-features/delivery, createDeliveryFeature, DeliveryJobs, delivery:job:render
-->
