---
"@cosmicdrift/kumiko-bundled-features": patch
---

Billing stale created events

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Stale subscription created events are ignored and manual-grant skips are logged
detail: A created event for a subscription that is no longer current no longer replaces the active one while the current row blocks checkout, and the tier sync logs its own code when a manual grant keeps the tier.
-->
