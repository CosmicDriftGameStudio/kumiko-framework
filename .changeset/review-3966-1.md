---
"@cosmicdrift/kumiko-framework": patch
---

A list aggregate on an entity that has postQuery hooks is now refused instead of counting rows the hooks would hide, and only results built by `answerListAggregate` skip the hook and field-read pipeline.

<!-- kumiko-changes
feature: list-aggregate
type: fix
title: list aggregates no longer bypass postQuery hooks and read filtering by shape
detail: The dispatcher treated any `{ groups: [...] }` result as an aggregate and skipped postQuery hooks and `filterReadFields`. Aggregates are now recognised by a brand set in `answerListAggregate` (`isAnsweredListAggregate`), so a hand-written handler returning that shape runs through the hooks again. An aggregate query on an entity with handler or entity postQuery hooks fails with `access_denied` (`field_access_denied` reason), because the counts would include rows a hook hides.
-->
