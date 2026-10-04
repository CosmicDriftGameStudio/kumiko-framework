---
"@cosmicdrift/kumiko-bundled-features": minor
---

The delivery log now records when a provider accepted a send without confirming delivery (for example a Teams webhook answering 202). `store_delivery_attempts` gets a nullable boolean column `confirmed`: `false` means accepted but unconfirmed, `null` means confirmed or not applicable. The `deliveryAttempt` event carries `confirmed: false` on both the inline and the job path, `delivery:query:log` returns `confirmed` per row, and the status cell shows "Sent (unconfirmed)" for such rows.

<!-- kumiko-changes
feature: delivery
type: improvement
title: Delivery log marks sends the provider did not confirm
migration: |
  New nullable column store_delivery_attempts.confirmed. Consumers generate the migration with the generator (kumiko-schema generate) and apply it; existing rows stay null.
-->
