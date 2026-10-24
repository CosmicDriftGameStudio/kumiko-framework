---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-types": minor
---

A row with `default: true` in an `optionsQuery` result is pre-selected while the select field is empty.

<!-- kumiko-changes
feature: renderer
type: improvement
title: optionsQuery selects pre-select the row marked default
detail: A row of an optionsQuery result can carry default: true. While the field is empty the renderer selects the first such row, also when a payload change dropped the previous value from the new rows. A set value is never replaced, and without a default row nothing changes.
-->
