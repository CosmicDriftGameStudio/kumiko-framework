---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-types": minor
---

In an actionForm, a row with `default: true` in an `optionsQuery` result seeds an empty select field like a prefill.

<!-- kumiko-changes
feature: renderer
type: improvement
title: actionForm optionsQuery selects seed the row marked default
detail: A row of an optionsQuery result can carry default: true. In an actionForm the first such row fills an empty field as a baseline value, like a prefill, so the form stays unchanged and leaving it asks nothing; set submitPrefilled to submit the suggestion unchanged. When a sibling field changes the payload and the old value drops out of the new rows, the new default replaces it as a normal change. configEdit never pre-selects, and a set value is never replaced.
-->
