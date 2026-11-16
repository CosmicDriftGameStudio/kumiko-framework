---
"@cosmicdrift/kumiko-bundled-features": patch
---

`template-resolver:query:tenant-override-counts` counts in SQL.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Override counts no longer load every tenant row
detail: The SystemAdmin overview count loaded every tenant override of every tenant and grouped in memory. It now counts distinct enabled tenants with an active override per slug and kind in one aggregate query; templates without an active override are left out of counts instead of listed with 0.
-->
