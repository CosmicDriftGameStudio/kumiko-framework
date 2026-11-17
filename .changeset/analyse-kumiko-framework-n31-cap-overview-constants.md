---
"@cosmicdrift/kumiko-bundled-features": minor
---

`@cosmicdrift/kumiko-bundled-features/cap-overview/constants` exports the cap-overview constants and the `caps:usage` contract for client code.

<!-- kumiko-changes
feature: cap-overview
type: improvement
title: cap-overview constants subpath with the caps:usage contract
detail: Client code imports `CapOverviewQueries` and `CapOverviewContracts.capsUsage` (payload `{ tenantId?: string }`, result `{ rows: readonly CapUsageWithMeta[] }`) from `@cosmicdrift/kumiko-bundled-features/cap-overview/constants` instead of hard-coding `"cap-overview:query:caps:usage"`. `useQuery(CapOverviewContracts.capsUsage, {})` returns the typed rows.
-->
