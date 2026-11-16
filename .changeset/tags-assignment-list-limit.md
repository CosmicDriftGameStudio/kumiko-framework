---
"@cosmicdrift/kumiko-bundled-features": patch
---

The tag chips in lists and the tag filter show up again.

<!-- kumiko-changes
feature: tags
type: improvement
title: Tag cell and tag filter query assignments within the list limit
detail: `TagsCell` and `TagFilter` asked for 500 assignment rows, but the list schema caps `limit` at 200, so the query failed validation and no tags were shown. `TagsCell` now filters on the row's `entityId`, `TagFilter` on the host `entityType`, both with `limit: 200`.
-->
