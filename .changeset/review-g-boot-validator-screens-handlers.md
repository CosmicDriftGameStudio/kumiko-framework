---
"@cosmicdrift/kumiko-framework": patch
---

Boot validator rejects more invalid screen and handler declarations

<!-- kumiko-changes
feature: framework
type: fix
title: Boot validator covers option, prefill, emptyState, anonymous rate-limit and searchable-access gaps
detail: Rejects optionsQuery combined with optionsAvailabilityQuery, invalid dashboard valueFormat kinds, from-today panels without ranges or brush, params on emptyState navigate/drawer, unknown submitPrefilled keys, per-user rate limits on tenantless anonymous handlers, unknown conditional select option values, and searchable fields (including embedded sub-fields) the reader cannot access.
-->
