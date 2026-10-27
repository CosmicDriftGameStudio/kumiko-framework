---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

A sortable field takes `sortNulls: "first" | "last"`, which fixes where rows without a value appear in a list in both sort directions, so a `defaultSort` descending on a nullable timestamp no longer puts every row without a date on top.

<!-- kumiko-changes
feature: framework
type: improvement
title: sortNulls places rows without a value in list sorting
detail: Without the option the list keeps Postgres' order (nulls last ascending, first descending), which a plain index serves. With `sortNulls` the list query adds `NULLS FIRST` or `NULLS LAST` to the order and the keyset cursor follows it, so paging across the rows without a value stays complete. A sort that must stay on an index needs an index with the same NULLS order.
-->
