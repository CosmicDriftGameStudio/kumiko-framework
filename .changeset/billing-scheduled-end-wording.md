---
"@cosmicdrift/kumiko-bundled-features": patch
---

Billing and sign-in copy use one term for a subscription that is scheduled to end

The error for switching plans on a subscription with a scheduled cancellation now says "scheduled to end", like the plan badge, and the invalid-credentials message reads the same in every source that registers it.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: The switch-plan error for a subscription with a scheduled cancellation says "scheduled to end", matching the plan badge
-->
