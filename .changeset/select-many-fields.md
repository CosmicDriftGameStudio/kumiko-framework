---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

selectMany supports column projection via SelectOptions.fields

<!-- kumiko-changes
feature: framework
type: feature
title: selectMany supports column projection via SelectOptions.fields
detail: SelectOptions gains fields, a list of entity field names. selectMany then selects only those columns instead of all of them. An empty list or a name that is not a column of the table throws.
-->
