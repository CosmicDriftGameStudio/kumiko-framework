---
"@cosmicdrift/kumiko-bundled-features": patch
---

subscription-paddle drops the one-time takeover of Paddle checkouts opened before the checkout ledger existed.

<!-- kumiko-changes
feature: subscription-paddle
type: improvement
title: Paddle checkout-ledger backfill removed
detail: The `backfill-checkout-ledger` job, the `subscription-paddle:write:ledger-backfill-marker` handler, the `ledger-backfill-sweep-completed` event and the 5xx redelivery of ignored webhooks that still carried the old `tenantBinding` are gone. The takeover window they served has closed; a webhook is accepted only for a transaction in the checkout ledger, as before. Marker events already stored stay in the event store and are ignored.
-->
