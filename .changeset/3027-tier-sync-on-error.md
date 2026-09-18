---
"@cosmicdrift/kumiko-bundled-features": minor
---

`createSubscriptionTierSync()` used to always report the webhook as successful once the primary write committed, only logging a warning if the follow-up tier-engine sync failed. For a caller whose retry is idempotent on the primary write (e.g. Stripe), that meant a transient sync failure had no path back to a correct tier — nothing re-triggers the sync once no further billing events arrive (typical for a cancellation). `SubscriptionTierSyncDeps` now takes an optional `onSyncError: "log" | "fail-webhook"` (default `"log"`, unchanged for existing consumers): `"fail-webhook"` fails the webhook response on a sync error too, giving an idempotent caller's retry a second shot at the sync step itself.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: add onSyncError option to createSubscriptionTierSync
detail: |
  `SubscriptionTierSyncDeps<TTier>` gets an optional `onSyncError?: "log" | "fail-webhook"`
  (default `"log"`, matching prior behavior exactly). `"fail-webhook"` makes a tier-sync
  failure also fail the webhook response, so an idempotent-retry caller (whose retry
  no-ops the already-committed primary write) gets another attempt at the sync step.
-->
