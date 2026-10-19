---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

Derived list searchability, actionForm load, drawer rowClick

A projectionList over an entity-convention list query whose entity has no searchable field derives `searchable: false` (no search box, no whitelist entry needed); declaring `searchable: true` there fails boot. `ActionFormScreenDefinition.load` (`{ query, idParam? }`) seeds the form from a query keyed by the record id; with `load` no URL param, drawer param or handoff value reaches the form. A `drawer` row action takes `rowClick: true` like `navigate` does, in lists and relatedList sections, and counts toward the one-rowClick limit.

<!-- kumiko-changes
feature: framework
type: improvement
title: Derived list searchability, actionForm load and drawer rowClick
detail: projectionList searchable is derived false for entity-convention lists without searchable fields (searchable true is rejected at boot), actionForm.load registers a query checked at boot, and a drawer row action may set rowClick, counted with navigate rowClick and rejected on projectionDetail header actions.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: actionForm load states and drawer row click
detail: An actionForm with load queries by the route, drawer or URL id and shows loading, error, not-found and missing-id states; loaded values count as prefill for submitPrefilled. A row click fires a rowClick drawer action in entityList, projectionList and relatedList.
-->
