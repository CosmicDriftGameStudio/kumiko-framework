---
"@cosmicdrift/kumiko-bundled-features": patch
---

`sync-subscription` no longer holds a database transaction while it waits for the payment provider.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Drift sync calls the provider outside the transaction
detail: `sync-subscription` now runs with `transaction: "perCommand"`: it reads the subscription and calls `retrieveSubscription` outside any transaction and hands the snapshot to the new `billing-foundation:write:apply-subscription-snapshot` handler (system role and SystemAdmin only), which locks the subscription stream, reads the row again and appends the drift. Before, every tenant's sync kept a transaction and a pool connection open for a whole provider round trip. The result `{ synced, reason }` is unchanged; a subscription replaced while the provider answered now gives `no_live_subscription`. `sync-subscription` can no longer run nested inside another write or in a batch.
-->
