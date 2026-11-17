---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Custom query handlers declare resultEntity so field read rules apply to their result.

<!-- kumiko-changes
feature: framework
type: breaking
title: Query handlers declare their result entity
detail: `r.queryHandler({ resultEntity })` applies the entity's field read rules and writeOnly mask to the handler's result (a row, an array of rows or `{ rows }`), as the `entity:verb` naming convention already did. `unfilteredResult: { reason }` marks a query that returns no entity rows. In a feature whose entities have a field with `access.read`, a writeOnly text field or an embedded sub-field with `access.read`, every query handler without a colon in its name must declare one of the two, or the boot fails.
migration: For each query handler the boot names, set `resultEntity` to the entity whose rows it returns. When it returns options, counts or other derived values, set `unfilteredResult: { reason }` with a real reason instead.
affects: queryHandler
-->
