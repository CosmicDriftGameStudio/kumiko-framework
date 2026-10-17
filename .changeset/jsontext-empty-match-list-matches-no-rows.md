---
"@cosmicdrift/kumiko-framework": patch
---

An empty jsonText match list no longer returns every row

<!-- kumiko-changes
feature: framework
type: fix
title: An empty jsonText match list no longer returns every row
detail: A where filter `{ jsonText: [] }` on a jsonb column used to add no condition, so the query returned all rows. It now matches no rows, like `in: []`. A `null` or non-object entry in the list throws the descriptive jsonText error instead of a bare TypeError.
-->
