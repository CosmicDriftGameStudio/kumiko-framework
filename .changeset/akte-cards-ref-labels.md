---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
---

Reference labels resolve by id wherever a stored value is shown: read-only detail fields, the reference combobox, embedded-list reference cells and list reference columns. A record beyond the first 50 (picker) or 200 (list lookup) rows of the target entity shows its label instead of its raw id.

<!-- kumiko-changes
feature: renderer
type: fix
title: Reference labels resolve by id beyond the lookup caps
detail: ReadOnlyReferenceValue, the reference combobox and embedded-list reference cells request the stored ids next to their first options page; list reference columns request the ids on screen in chunks of 200 instead of the first 200 rows of the target. The ids go out as `ids` for directory sources and an id-in filter for entity list handlers, which only narrow the caller's list query, so tenant, ownership and field-read rules keep applying. Author `optionsQuery` handlers on reference fields keep their capped `{ limit, search? }` picker page and are additionally asked for stored values with `{ limit, ids }`; a handler that ignores `ids` keeps the previous capped behaviour. List columns keep labels already known while the ids of a new page load and only claim "Unknown" once the current ids have resolved.
-->
