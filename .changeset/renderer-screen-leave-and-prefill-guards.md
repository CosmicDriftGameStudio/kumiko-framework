---
"@cosmicdrift/kumiko-renderer": patch
---

An entityEdit delete action with a `redirect` now still reports the deletion to its host, and a delete with no entity list screen reloads the record instead of leaving the form on the deleted record. Overflow-menu actions are disabled while one is running, so a second click can no longer fire the write twice. URL prefill ignores an empty money param, non-finite number params, embedded-list cells with too many decimals or invalid dates, and a dateRange filter with `from` after `to` is put in order before it reaches the handler.

<!-- kumiko-changes
feature: renderer
type: fix
title: Screen actions and URL prefill no longer leave stale, doubled or invalid state
-->
