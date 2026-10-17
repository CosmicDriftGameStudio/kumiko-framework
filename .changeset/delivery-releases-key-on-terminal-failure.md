---
"@cosmicdrift/kumiko-bundled-features": patch
---

Delivery idempotency key release

<!-- kumiko-changes
feature: delivery
type: fix
title: A failed final delivery attempt frees the idempotency key
detail: A soft send failure and any error thrown on the final render or send attempt release the idempotency key, so the caller's retry is not dropped as a duplicate.
-->
