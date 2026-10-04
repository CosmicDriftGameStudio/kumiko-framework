---
"@cosmicdrift/kumiko-bundled-features": patch
---

Subscription tier sync keeps manual tier grants

The billing webhook sync now skips tier assignments with `source: "manual"`, so a `set-tenant-tier` grant is no longer overwritten by Stripe created/canceled events. Rows the sync writes are marked `source: "billing"`. `TierAssignmentSources` is exported from tier-engine.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Subscription webhooks no longer overwrite manual tier grants
-->
