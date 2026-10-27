---
"@cosmicdrift/kumiko-bundled-features": minor
---

`CapSpec.limit(tier, context)` of cap-overview gets the target tenant and a db: `context.tenantId` and `context.db` (the same system-mode db `usage` gets), next to `context.config`. A limit can read app-owned rows such as booked add-ons, so the overview shows the limit the enforcement path applies.

<!-- kumiko-changes
feature: cap-overview
type: improvement
title: Cap limits see the tenant and can read its add-ons
detail: `caps-usage` and `tenant-caps-list` resolved each limit from the tier and the tenant's config only, so an app whose limit depends on booked add-ons had to show the bare tier limit while enforcement already counted the add-ons (a 300 % bar for a tenant that may still provision). Both queries now pass `tenantId` (the target tenant, also on the SystemAdmin override and per listed row) and `db`. The new context type is exported as `CapSpecLimitContext`; existing limits that take the narrower `CapLimitContext` keep compiling.
-->
