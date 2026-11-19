---
"@cosmicdrift/kumiko-bundled-features": patch
---

`template-resolver:query:by-tenant` reads only the listed columns, sorted and capped.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Text block list is sorted and capped
detail: The anonymous content-tree query loaded every text block with all columns and no limit. It now reads only the columns it returns plus the delivery check, sorted by slug and locale and capped at 1,000 blocks.
-->
