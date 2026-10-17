---
"@cosmicdrift/kumiko-renderer": patch
---

List search keeps the newest typed text; file lists tolerate duplicate ids; date ranges and locked selects validate correctly

<!-- kumiko-changes
feature: renderer
type: fix
title: List search keeps the newest typed text; file lists tolerate duplicate ids; date ranges and locked selects validate correctly
detail: A late echo of an older debounced search emit no longer overwrites newer typing. Duplicate file ids no longer collide as React keys. An inverted date range is swapped only when both bounds parse. Select rules on writeExcluded or readOnly fields are now checked by the form schema.
-->
