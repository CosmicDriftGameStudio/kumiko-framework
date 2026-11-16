---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

A subscription change found by the drift sync now updates the tenant's tier, and the drift sync runs daily instead of once per boot.

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: Tier sync follows the subscription events; drift sync runs daily
detail: `createSubscriptionTierSync()` returns a new `createFeature()` that mounts the `subscription-tier-sync` feature: an event-triggered job on the five subscription events runs the tier sync through `subscription-tier-sync:write:sync-tier`. Before, the tier sync ran only after a webhook, so a cancellation that the `sync-subscriptions` job found on the provider's side was stored while the tenant kept the paid tier. The `billing` boot option mounts the feature on its own. The `sync-subscriptions` job now runs daily in the maintenance window instead of on every boot. The tier-engine `create`, `update` and `list` handlers and `billing-foundation:query:subscription:list` also accept the system role the job runs as.
migration: Apps that call `createSubscriptionTierSync()` themselves (instead of the `billing` boot option) add `tierSync.createFeature()` to their features; it needs `tier-engine` mounted. Apps that relied on the drift sync at boot dispatch `billing-foundation:job:sync-subscriptions` themselves when they need it outside the maintenance window.
-->
