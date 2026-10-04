---
"@cosmicdrift/kumiko-bundled-features": minor
---

`delivery:query:log` returns a `recipientLabel` per row and the delivery log screen shows it in the recipient column: the user's display name, else the decrypted address, else the recipient id. Names are resolved with one batched lookup per page, and only when the user feature is mounted. The new `resolveUserDisplayNames(db, userIds)` is exported from the user feature. The recipient column is not sortable.

<!-- kumiko-changes
feature: delivery
type: improvement
title: Delivery log shows the recipient name
-->
